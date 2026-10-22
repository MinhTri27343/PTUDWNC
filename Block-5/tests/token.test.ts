import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { sha256Hex } from '../src/util.js';
import {
  browserFlow,
  codeFrom,
  linkWallet,
  M2M,
  makeAs,
  pkce,
  REDIRECT,
  tokenCall,
  WEB,
  type TestAs,
} from './helpers.js';

let as: TestAs;
beforeAll(async () => {
  as = await makeAs();
});
afterAll(() => as.cleanup());

const exchange = (code: string, verifier: string, over: Record<string, string> = {}, client = WEB) =>
  tokenCall(as, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, ...over });

async function freshCode() {
  const p = pkce();
  const { res } = await browserFlow(as, { challenge: p.challenge });
  return { code: codeFrom(res as never), verifier: p.verifier };
}

describe('/token — client authentication', () => {
  it('wrong secret → 401 invalid_client + WWW-Authenticate', async () => {
    const { code, verifier } = await freshCode();
    const res = await exchange(code, verifier, {}, { id: 'taxi-web', secret: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/^Basic/);
  });

  it('unknown client and missing credentials → 401 invalid_client', async () => {
    expect((await exchange('x', 'y', {}, { id: 'ghost', secret: 'x' })).status).toBe(401);
    const res = await (await import('supertest')).default(as.app).post('/token').type('form').send({ grant_type: 'authorization_code' });
    expect(res.status).toBe(401);
  });

  it('a bad-secret attempt does not burn the code', async () => {
    const { code, verifier } = await freshCode();
    await exchange(code, verifier, {}, { id: 'taxi-web', secret: 'nope' });
    expect((await exchange(code, verifier)).status).toBe(200);
  });

  it('missing/unknown grant_type', async () => {
    expect((await tokenCall(as, WEB, {})).body.error).toBe('invalid_request');
    const res = await tokenCall(as, WEB, { grant_type: 'password', username: 'alice', password: 'alice-pass' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });
});

describe('/token — authorization_code', () => {
  it('happy path: access token contract + refresh token only with offline_access', async () => {
    const { tokens } = await linkWallet(as);
    expect(tokens.status).toBe(200);
    expect(tokens.headers['cache-control']).toBe('no-store');
    expect(tokens.body).toMatchObject({ token_type: 'Bearer', expires_in: expect.any(Number), scope: 'wallet:read wallet:charge offline_access' });
    expect(tokens.body.expires_in).toBeLessThanOrEqual(config.accessTtl);

    const claims = decodeJwt(tokens.body.access_token);
    expect(decodeProtectedHeader(tokens.body.access_token)).toMatchObject({ alg: 'ES256' });
    expect(decodeProtectedHeader(tokens.body.access_token).kid).toBeTruthy();
    expect(claims).toMatchObject({
      iss: config.asUrl,
      aud: 'wallet-api',
      sub: 'u_alice',
      client_id: 'taxi-web',
      principal_type: 'user',
      scope: 'wallet:read wallet:charge offline_access',
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(config.accessTtl);
    expect(typeof tokens.body.refresh_token).toBe('string');
  });

  it('no offline_access → no refresh token', async () => {
    const { tokens } = await linkWallet(as, 'wallet:read');
    expect(tokens.status).toBe(200);
    expect(tokens.body.refresh_token).toBeUndefined();
  });

  it('refresh token is stored only as a hash', async () => {
    const { tokens } = await linkWallet(as);
    const rt = tokens.body.refresh_token as string;
    expect(as.db.prepare('SELECT 1 FROM refresh_tokens WHERE token_hash = ?').get(sha256Hex(rt))).toBeTruthy();
    expect(JSON.stringify(as.db.prepare('SELECT * FROM refresh_tokens').all())).not.toContain(rt);
  });

  it('wrong code_verifier → invalid_grant', async () => {
    const { code } = await freshCode();
    const res = await exchange(code, pkce().verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('a wrong verifier burns the code (no second guess)', async () => {
    const { code, verifier } = await freshCode();
    await exchange(code, pkce().verifier);
    expect((await exchange(code, verifier)).body.error).toBe('invalid_grant');
  });

  it('redirect_uri mismatch → invalid_grant', async () => {
    const { code, verifier } = await freshCode();
    const res = await exchange(code, verifier, { redirect_uri: 'http://evil.example/callback' });
    expect(res.body.error).toBe('invalid_grant');
  });

  it('code redeemed by a different client → invalid_grant', async () => {
    const { code, verifier } = await freshCode();
    const res = await exchange(code, verifier, {}, M2M);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('expired code → invalid_grant', async () => {
    const { code, verifier } = await freshCode();
    as.db.prepare('UPDATE auth_codes SET expires_at = ? WHERE code_hash = ?').run(Math.floor(Date.now() / 1000) - 1, sha256Hex(code));
    expect((await exchange(code, verifier)).body.error).toBe('invalid_grant');
  });

  it('unknown code → invalid_grant', async () => {
    expect((await exchange('does-not-exist', pkce().verifier)).body.error).toBe('invalid_grant');
  });

  it('missing parameters → invalid_request', async () => {
    const res = await tokenCall(as, WEB, { grant_type: 'authorization_code', code: 'x' });
    expect(res.body.error).toBe('invalid_request');
  });

  it('reuse → invalid_grant and the refresh family from the first use is revoked', async () => {
    const { code, verifier, tokens } = await linkWallet(as);
    const second = await exchange(code, verifier);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
    const refreshed = await tokenCall(as, WEB, { grant_type: 'refresh_token', refresh_token: tokens.body.refresh_token });
    expect(refreshed.body.error).toBe('invalid_grant');
  });

  it('concurrent redemption: exactly one request wins', async () => {
    const { code, verifier } = await freshCode();
    const results = await Promise.all(Array.from({ length: 6 }, () => exchange(code, verifier)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
  });
});
