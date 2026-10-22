/**
 * Generates the evidence files in evidence/ from REAL runs against the three running apps.
 * Prerequisites: a FRESH `npm run db:reset`, then `npm run as`, `npm run api`, `npm run taxi` in other terminals.
 * (Fresh matters: the payment evidence expects Alice's single seeded pending ride and charge counter 0.)
 *
 *   npm run evidence                 # full run (the expired-code attack case waits CODE_TTL+2 seconds)
 *   npm run evidence -- --wait=3     # when the AS was started with CODE_TTL_SECONDS=2
 *
 * Codes, states, tokens and cookies are never written in full; they are replaced by labelled fingerprints.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodeJwt } from 'jose';
import { config } from '../src/config.js';
import { ROOT } from '../src/db.js';
import { fingerprint } from '../src/util.js';
import { AS, authorize, csrfOf, form, Jar, M2M, newPkce, REDIRECT_URI, send, WEB } from './attack.js';

const OUT = path.join(ROOT, 'evidence');
fs.mkdirSync(OUT, { recursive: true });
const write = (name: string, content: string): void => {
  fs.writeFileSync(path.join(OUT, name), content.endsWith('\n') ? content : `${content}\n`);
  console.log(`wrote evidence/${name}`);
};
const stamp = (): string => new Date().toISOString().slice(11, 23) + 'Z';
const waitArg = process.argv.find((a) => a.startsWith('--wait='));

const counter = async (): Promise<number> =>
  ((await (await fetch(`${config.apiUrl}/debug/counter`)).json()) as { charge_counter: number }).charge_counter;

// ---------- redaction ----------

const redactUrl = (raw: string): string => {
  const url = new URL(raw, AS);
  for (const [k, label] of [['code', 'code'], ['state', 'state'], ['code_challenge', 'challenge']] as const) {
    const v = url.searchParams.get(k);
    if (v) url.searchParams.set(k, `<${label}:${fingerprint(v).slice(4)}>`);
  }
  return decodeURIComponent(url.toString());
};

// ---------- 1. redirect trace: wallet linking through the browser ----------

const jars = new Map<string, Jar>();
const jarFor = (url: string): Jar => {
  const origin = new URL(url).origin;
  if (!jars.has(origin)) jars.set(origin, new Jar());
  return jars.get(origin)!;
};

async function redirectTrace(): Promise<string[]> {
  const lines: string[] = [
    '# Redirect trace — wallet linking (Taxi -> Wallet AS -> Taxi)',
    `# Captured ${new Date().toISOString()}. codes/states/challenges are labelled fingerprints, cookies are not shown.`,
    '# Browser view only. The code->token exchange is a server-to-server call (Taxi -> AS /token) the browser never sees.',
    '',
  ];
  const hop = async (method: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await send(jarFor(url), url, { method, ...init });
    const loc = res.headers.get('location');
    lines.push(`${stamp()}  ${method.padEnd(4)} ${redactUrl(url)}\n              -> ${res.status}${loc ? `  Location: ${redactUrl(new URL(loc, url).toString())}` : ''}`);
    return res;
  };

  let res = await hop('POST', `${config.taxiUrl}/link`);
  res = await hop('GET', new URL(res.headers.get('location')!, config.taxiUrl).toString());
  let html = await res.text();
  res = await hop('POST', `${AS}/login`, {
    ...form({ csrf: csrfOf(html), username: 'alice', password: 'alice-pass' }),
  });
  lines.push('              (login form submitted as Alice; password not shown)');
  html = await res.text();
  res = await hop('POST', `${AS}/consent`, { ...form({ csrf: csrfOf(html), decision: 'approve' }) });
  lines.push('              (consent screen: Alice pressed Allow)');
  const callback = new URL(res.headers.get('location')!, config.taxiUrl).toString();
  res = await hop('GET', callback);
  res = await hop('GET', new URL(res.headers.get('location')!, config.taxiUrl).toString());
  const body = await res.text();
  lines.push('', `Result page shows: ${/Wallet linked\./.test(body) ? '"Wallet linked."' : '(not linked)'}`);
  const status = (await (await send(jarFor(config.taxiUrl), `${config.taxiUrl}/status`)).json()) as { status: string };
  lines.push(`Taxi /status (never contains tokens): ${JSON.stringify(status)}`);
  return lines;
}

// ---------- 2. payment job ----------

function runJob(expire: boolean): string {
  const args = ['--import', 'tsx', path.join(ROOT, 'src/taxi/paymentJob.ts'), ...(expire ? ['--expire'] : [])];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`.trim();
}

async function paymentEvidence(): Promise<string[]> {
  // After `npm run db:reset` Alice has exactly one pending ride (ride-1001), so the counter must go 0 -> 1.
  const lines = [
    '# Payment job — no user session, expired access token, refresh then charge',
    `# Captured ${new Date().toISOString()}. "exp" values are ISO timestamps of the access token in use.`,
    '',
    `Wallet API charge counter before: ${await counter()}`,
    '',
    '## Run 1 (--expire: Alice left, stored access token is stale)',
    runJob(true),
    '',
    `Wallet API charge counter after run 1: ${await counter()}`,
    '',
    '## Run 2 (same job again; nothing pending, the Idempotency-Key = ride id protects retries)',
    runJob(false),
    '',
    `Wallet API charge counter after run 2: ${await counter()}`,
  ];
  return lines;
}

// ---------- 3. grant table from observed responses ----------

interface Observed {
  grant: string;
  client: string;
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

async function tokenRaw(client: { id: string; secret: string }, params: Record<string, string>): Promise<Observed> {
  const basic = Buffer.from(`${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`).toString('base64');
  const res = await fetch(`${AS}/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return { grant: params.grant_type, client: client.id, status: res.status, headers: res.headers, body: (await res.json()) as Record<string, unknown> };
}

async function grantTable(): Promise<string> {
  const jar = new Jar();
  const pkce = newPkce();
  const out = await authorize(jar, { code_challenge: pkce.challenge });
  const rows: Observed[] = [];
  const codeResp = await tokenRaw(WEB, {
    grant_type: 'authorization_code',
    code: out.code ?? '',
    code_verifier: pkce.verifier,
    redirect_uri: REDIRECT_URI,
  });
  rows.push(codeResp);
  rows.push(await tokenRaw(WEB, { grant_type: 'refresh_token', refresh_token: String(codeResp.body.refresh_token ?? '') }));
  rows.push(await tokenRaw(M2M, { grant_type: 'client_credentials', scope: 'rates:read' }));

  const cell = (v: unknown): string => (v === undefined ? '—' : `\`${String(v)}\``);
  const table = rows.map((r) => {
    const c = r.body.access_token ? decodeJwt(String(r.body.access_token)) : {};
    const hasRefresh = typeof r.body.refresh_token === 'string';
    return `| ${r.grant} | ${r.client} | ${r.status} | ${hasRefresh ? 'yes' : 'no'} | ${cell(c.sub)} | ${cell(c.aud)} | ${cell(r.body.scope)} | ${cell(c.principal_type)} | ${cell(r.body.expires_in)} | ${cell(r.body.token_type)} |`;
  });

  const check = (r: Observed): string[] => {
    const nostore = r.headers.get('cache-control') === 'no-store' && r.headers.get('pragma') === 'no-cache';
    const exp = r.body.expires_in;
    const refreshRule =
      r.grant === 'client_credentials'
        ? `refresh_token ${typeof r.body.refresh_token === 'string' ? 'PRESENT (violates §4.4.3 SHOULD NOT)' : 'absent (§4.4.3 ok)'}`
        : `refresh_token ${typeof r.body.refresh_token === 'string' ? 'present (allowed; offline_access)' : 'absent'}`;
    return [
      `- **${r.grant}** (${r.client}): access_token ${r.body.access_token ? 'present' : 'MISSING'} (REQUIRED); ` +
        `token_type ${String(r.body.token_type).toLowerCase() === 'bearer' ? 'Bearer' : 'WRONG'} (REQUIRED); ` +
        `expires_in ${Number.isInteger(exp) ? `${exp} (integer, RECOMMENDED)` : 'invalid'}; ` +
        `scope ${r.body.scope ? 'returned' : 'omitted'}; ${refreshRule}; ` +
        `Cache-Control: no-store + Pragma: no-cache ${nostore ? 'present (MUST, §5.1)' : 'MISSING'}`,
    ];
  };

  return [
    '# Grant table — filled from observed /token responses',
    `# Captured ${new Date().toISOString()}. Values come from the responses and the decoded access-token claims, not from slides.`,
    '',
    '| grant_type | client | HTTP | refresh_token | sub | aud | scope | principal_type | expires_in | token_type |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...table,
    '',
    '## RFC 6749 §5.1 check (per observed response)',
    ...rows.flatMap(check),
  ].join('\n');
}

// ---------- 4. revocation ----------

async function revocationEvidence(): Promise<string[]> {
  const lines = [
    '# Revocation — Alice revokes Taxi on the AS account page',
    `# Captured ${new Date().toISOString()}.`,
    '',
  ];
  const taxi = jarFor(config.taxiUrl);
  const asJar = jarFor(AS);
  const balance = async (): Promise<string> => {
    const r = await send(taxi, `${config.taxiUrl}/balance`, { method: 'POST' });
    const home = await send(taxi, new URL(r.headers.get('location')!, config.taxiUrl).toString());
    return /<p class="flash">([^<]*)</.exec(await home.text())?.[1] ?? '(no message)';
  };
  const status = async (): Promise<string> =>
    JSON.stringify(await (await send(taxi, `${config.taxiUrl}/status`)).json());

  await send(taxi, `${config.taxiUrl}/rides`, { method: 'POST' });
  lines.push(`${stamp()}  before revocation: Taxi status ${await status()}; balance call -> ${await balance()}`);

  // Alice's AS session is still in the jar from the linking run.
  const page = await (await send(asJar, `${AS}/account`)).text();
  lines.push(`${stamp()}  AS /account lists: ${page.includes('Taxi') ? 'Taxi' : '(nothing)'}`);
  const res = await send(asJar, `${AS}/account/revoke`, {
    method: 'POST',
    ...form({ csrf: csrfOf(page), client_id: 'taxi-web' }),
  });
  lines.push(`${stamp()}  POST /account/revoke (Alice -> taxi-web) -> ${res.status}`);

  lines.push(
    `${stamp()}  immediately after: balance call -> ${await balance()}   <- the access token is a stateless JWT verified offline, it stays valid until exp (<= ${config.accessTtl}s)`,
  );
  lines.push('', '## Payment job after revocation (stored access token considered expired)', runJob(true));
  lines.push('', `${stamp()}  after job: Taxi status ${await status()}   <- unlinked: the AS answered invalid_grant`);
  return lines;
}

// ---------- main ----------

async function main(): Promise<void> {
  // 0. attack run (own process, its own output)
  const attackArgs = ['--import', 'tsx', path.join(ROOT, 'scripts/attack.ts'), ...(waitArg ? [waitArg] : [])];
  const attack = spawnSync(process.execPath, attackArgs, { cwd: ROOT, encoding: 'utf8' });
  write('attack-after.txt', `${attack.stdout}${attack.stderr}`.trim());

  write('redirect-trace.txt', (await redirectTrace()).join('\n'));
  write('payment-job-log.txt', (await paymentEvidence()).join('\n'));
  write('grant-table.md', await grantTable());
  write('revocation.txt', (await revocationEvidence()).join('\n'));
}

await main();
