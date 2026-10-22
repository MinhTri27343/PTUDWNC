import { decodeJwt } from 'jose';
import { fingerprint, iso } from '../util.js';

/**
 * The Flow UI shows REAL traffic, but never secrets: every secret-bearing value becomes a labelled
 * fingerprint such as `<code:867d63bf>`. The same value always gets the same label, so a viewer can see
 * that e.g. `state` came back unchanged, or that the `code` in a redirect is the one sent to /token.
 */
const SECRET_KEYS = new Set([
  'code',
  'state',
  'code_challenge',
  'code_verifier',
  'refresh_token',
  'access_token',
  'client_secret',
  'password',
  'csrf',
  'id_token',
]);

export const label = (key: string, value: string): string => `<${key}:${fingerprint(value).slice(4)}>`;

function jwtClaims(token: string): Record<string, unknown> | undefined {
  try {
    const c = decodeJwt(token);
    return {
      iss: c.iss,
      aud: c.aud,
      sub: c.sub,
      client_id: c.client_id,
      scope: c.scope,
      principal_type: c.principal_type,
      exp: c.exp ? iso(c.exp) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k) && typeof v === 'string' ? label(k, v) : redactObject(v, depth + 1);
  }
  const at = (value as Record<string, unknown>).access_token;
  if (typeof at === 'string') {
    const claims = jwtClaims(at);
    if (claims) out.access_token_claims = claims; // payload only: what the signed token asserts
  }
  return out;
}

export function redactQuery(params: URLSearchParams): Record<string, string> {
  return redactObject(Object.fromEntries(params)) as Record<string, string>;
}

export function redactLocation(location: string, base: string): string {
  try {
    const url = new URL(location, base);
    for (const [k, v] of [...url.searchParams]) {
      if (SECRET_KEYS.has(k)) url.searchParams.set(k, label(k, v));
    }
    return decodeURIComponent(url.toString());
  } catch {
    return location;
  }
}

/** Describe an Authorization header without exposing the credential. */
export function describeAuthorization(header: string | undefined): Record<string, unknown> | undefined {
  if (!header) return undefined;
  if (/^basic /i.test(header)) {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        return s;
      }
    };
    return { scheme: 'Basic', client_id: dec(decoded.slice(0, i)), client_secret: label('client_secret', dec(decoded.slice(i + 1))) };
  }
  if (/^bearer /i.test(header)) {
    const token = header.slice(7).trim();
    return { scheme: 'Bearer', token: label('jwt', token), claims: jwtClaims(token) };
  }
  return { scheme: header.split(' ')[0] };
}
