/**
 * Attack script: talks to the Wallet AS directly over HTTP and tries every request the AS must reject.
 * Prints the HTTP status and OAuth error code per case. Codes and tokens are never printed (labels only).
 *
 *   npm run attack                 # waits CODE_TTL+2 seconds for the "expired code" case
 *   npm run attack -- --wait=3     # use with an AS started with CODE_TTL_SECONDS=2
 *   npm run attack -- --strict     # exit 1 if any case is NOT BLOCKED
 */
import { pathToFileURL } from 'node:url';
import { config, requireConfig } from '../src/config.js';
import { fingerprint, randomToken, sha256B64Url } from '../src/util.js';

requireConfig('taxiWebSecret', 'taxiM2mSecret');

export const AS = config.asUrl;
export const REDIRECT_URI = `${config.taxiUrl}/callback`;
const EVIL_REDIRECT = 'http://evil.example/callback';
export const WEB = { id: 'taxi-web', secret: config.taxiWebSecret };
export const M2M = { id: 'taxi-m2m', secret: config.taxiM2mSecret };

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const waitSeconds = Number(arg('wait') ?? config.codeTtl + 2);
const strict = process.argv.includes('--strict');

// ---------- tiny HTTP client with a cookie jar (no automatic redirects) ----------

export class Jar {
  private cookies = new Map<string, string>();
  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export async function send(jar: Jar, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('Cookie', cookie);
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.absorb(res);
  return res;
}

export const form = (data: Record<string, string>): { body: string; headers: Record<string, string> } => ({
  body: new URLSearchParams(data).toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

export const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

// ---------- OAuth helpers ----------

interface AuthorizeOutcome {
  status: number;
  location?: string;
  code?: string;
  error?: string;
  state?: string;
}

interface AuthorizeParams {
  redirect_uri?: string;
  scope?: string;
  code_challenge?: string | null; // null = omit the parameter entirely
  state?: string;
}

/** Run /authorize as Alice: login (if needed) -> consent (approve). Returns where the AS finally sent us. */
export async function authorize(jar: Jar, p: AuthorizeParams): Promise<AuthorizeOutcome> {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: WEB.id,
    redirect_uri: p.redirect_uri ?? REDIRECT_URI,
    scope: p.scope ?? 'wallet:read wallet:charge offline_access',
    state: p.state ?? `st-${randomToken(6)}`,
  });
  if (p.code_challenge !== null) {
    q.set('code_challenge', p.code_challenge ?? 'x');
    q.set('code_challenge_method', 'S256');
  }

  let res = await send(jar, `${AS}/authorize?${q}`);
  if (res.status !== 200) return outcome(res); // rejected (or redirected) before login/consent

  let html = await res.text();
  if (html.includes('name="username"')) {
    res = await send(jar, `${AS}/login`, {
      method: 'POST',
      ...form({ csrf: csrfOf(html), username: 'alice', password: 'alice-pass' }),
    });
    html = await res.text();
  }
  if (!html.includes('name="decision"')) return { status: res.status };

  res = await send(jar, `${AS}/consent`, {
    method: 'POST',
    ...form({ csrf: csrfOf(html), decision: 'approve' }),
  });
  return outcome(res);
}

function outcome(res: Response): AuthorizeOutcome {
  const location = res.headers.get('location') ?? undefined;
  const result: AuthorizeOutcome = { status: res.status, location };
  if (location) {
    const url = new URL(location);
    result.code = url.searchParams.get('code') ?? undefined;
    result.error = url.searchParams.get('error') ?? undefined;
    result.state = url.searchParams.get('state') ?? undefined;
  }
  return result;
}

interface Pkce {
  verifier: string;
  challenge: string;
}
export const newPkce = (): Pkce => {
  const verifier = randomToken(32);
  return { verifier, challenge: sha256B64Url(verifier) };
};

interface TokenOutcome {
  status: number;
  error?: string;
  body: Record<string, unknown>;
}

export async function token(
  client: { id: string; secret: string },
  params: Record<string, string>,
): Promise<TokenOutcome> {
  const basic = Buffer.from(`${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`).toString('base64');
  const res = await fetch(`${AS}/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, error: typeof body.error === 'string' ? body.error : undefined, body };
}

export const exchange = (client: { id: string; secret: string }, code: string, verifier: string, redirectUri = REDIRECT_URI) =>
  token(client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });

export const refresh = (client: { id: string; secret: string }, refreshToken: string) =>
  token(client, { grant_type: 'refresh_token', refresh_token: refreshToken });

/** Get a fresh, valid authorization code for taxi-web (a Jar reuses Alice's AS session). */
export async function freshCode(jar: Jar, pkce: Pkce): Promise<string> {
  const out = await authorize(jar, { code_challenge: pkce.challenge });
  if (!out.code) throw new Error(`could not obtain a code (status ${out.status}, error ${out.error})`);
  return out.code;
}

const show = (t: TokenOutcome): string => `${t.status}${t.error ? ' ' + t.error : t.status === 200 ? ' OK' : ''}`;
const redact = (loc?: string): string => (loc ? loc.replace(/code=[^&]+/, 'code=<redacted>') : '(no Location header)');

// ---------- cases ----------

interface CaseResult {
  name: string;
  expected: string;
  observed: string;
  blocked: boolean;
}

async function run(): Promise<void> {
  const jar = new Jar();
  const results: CaseResult[] = [];

  // Control: the legitimate flow must work, otherwise the attack results mean nothing.
  const control = newPkce();
  const controlCode = await freshCode(jar, control);
  const controlTokens = await exchange(WEB, controlCode, control.verifier);
  const controlOk = controlTokens.status === 200 && typeof controlTokens.body.access_token === 'string';

  // 1. unregistered redirect_uri -> error page on the AS, no redirect
  {
    const out = await authorize(jar, { redirect_uri: EVIL_REDIRECT, code_challenge: newPkce().challenge });
    results.push({
      name: '1 unregistered redirect_uri',
      expected: '400, no redirect',
      observed: out.location ? `${out.status} -> ${redact(out.location)}` : `${out.status}, no Location`,
      blocked: out.status === 400 && !out.location,
    });
  }

  // 2. missing code_challenge -> redirect with invalid_request (+ state)
  {
    const state = `st-${randomToken(6)}`;
    const out = await authorize(jar, { code_challenge: null, state });
    results.push({
      name: '2 missing code_challenge',
      expected: '302 error=invalid_request',
      observed: `${out.status} ${out.error ? 'error=' + out.error : out.code ? 'code issued WITHOUT PKCE' : ''}`.trim(),
      blocked: out.status === 302 && out.error === 'invalid_request' && out.state === state,
    });
  }

  // 3. authorization code reuse -> invalid_grant, and the tokens from the first use are revoked
  {
    const pkce = newPkce();
    const code = await freshCode(jar, pkce);
    const first = await exchange(WEB, code, pkce.verifier);
    const second = await exchange(WEB, code, pkce.verifier);
    const rt = typeof first.body.refresh_token === 'string' ? first.body.refresh_token : '';
    const after = rt ? await refresh(WEB, rt) : undefined;
    results.push({
      name: '3 reused authorization code',
      expected: '400 invalid_grant + family revoked',
      observed: `1st ${show(first)}; reuse ${show(second)}; refresh from 1st exchange ${after ? show(after) : 'n/a'}`,
      blocked: second.status === 400 && second.error === 'invalid_grant' && after?.error === 'invalid_grant',
    });
  }

  // 4. expired code -> invalid_grant
  {
    const pkce = newPkce();
    const code = await freshCode(jar, pkce);
    process.stdout.write(`  (waiting ${waitSeconds}s for the code to expire...)\n`);
    await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    const out = await exchange(WEB, code, pkce.verifier);
    results.push({
      name: `4 expired code (+${waitSeconds}s)`,
      expected: '400 invalid_grant',
      observed: show(out),
      blocked: out.status === 400 && out.error === 'invalid_grant',
    });
  }

  // 5. wrong code_verifier -> invalid_grant
  {
    const pkce = newPkce();
    const code = await freshCode(jar, pkce);
    const out = await exchange(WEB, code, newPkce().verifier);
    results.push({
      name: '5 wrong code_verifier',
      expected: '400 invalid_grant',
      observed: show(out),
      blocked: out.status === 400 && out.error === 'invalid_grant',
    });
  }

  // 6. wrong client secret -> 401 invalid_client
  {
    const pkce = newPkce();
    const code = await freshCode(jar, pkce);
    const out = await exchange({ id: WEB.id, secret: 'not-the-secret' }, code, pkce.verifier);
    results.push({
      name: '6 wrong client secret',
      expected: '401 invalid_client',
      observed: show(out),
      blocked: out.status === 401 && out.error === 'invalid_client',
    });
  }

  // 7. code redeemed by a different (authenticated) client -> invalid_grant
  {
    const pkce = newPkce();
    const code = await freshCode(jar, pkce);
    const out = await exchange(M2M, code, pkce.verifier);
    results.push({
      name: '7 code redeemed by other client',
      expected: '400 invalid_grant',
      observed: `taxi-m2m: ${show(out)}`,
      blocked: out.status === 400 && out.error === 'invalid_grant',
    });
  }

  // 8 + 9 share a legitimately issued refresh token.
  {
    const pkce = newPkce();
    const code = await freshCode(jar, pkce);
    const first = await exchange(WEB, code, pkce.verifier);
    const r1 = String(first.body.refresh_token ?? '');
    if (!r1) throw new Error('no refresh_token issued; cannot run cases 8/9');

    // 9. refresh by a different client (checked first, while r1 is still the live token)
    const other = await refresh(M2M, r1);
    results.push({
      name: '9 refresh by other client',
      expected: '400 invalid_grant',
      observed: `taxi-m2m: ${show(other)}`,
      blocked: other.status === 400 && other.error === 'invalid_grant',
    });

    // 8. rotation + replay of the old token
    const rotated = await refresh(WEB, r1);
    const r2 = String(rotated.body.refresh_token ?? '');
    const replay = await refresh(WEB, r1);
    const successor = r2 ? await refresh(WEB, r2) : undefined;
    results.push({
      name: '8 replay of old refresh token',
      expected: '400 invalid_grant + family revoked',
      observed: `rotate ${show(rotated)} (${r2 ? fingerprint(r2) : 'no new token'}); replay ${show(replay)}; successor ${successor ? show(successor) : 'n/a'}`,
      blocked: replay.error === 'invalid_grant' && successor?.error === 'invalid_grant',
    });
  }

  // ---------- report ----------
  console.log(`\nAttack run against ${AS} at ${new Date().toISOString()}`);
  console.log(`Control (legitimate code exchange): ${controlOk ? 'OK' : 'FAILED - results below are not meaningful'}\n`);
  const order = results.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const r of order) {
    console.log(`${r.blocked ? 'BLOCKED    ' : 'NOT BLOCKED'}  ${r.name}`);
    console.log(`             expected: ${r.expected}`);
    console.log(`             observed: ${r.observed}`);
  }
  const blocked = order.filter((r) => r.blocked).length;
  console.log(`\nSummary: ${blocked}/${order.length} attacks blocked`);
  if (strict && (blocked !== order.length || !controlOk)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
