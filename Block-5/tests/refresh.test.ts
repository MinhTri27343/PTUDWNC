import request from 'supertest';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csrfOf, linkWallet, M2M, makeAs, tokenCall, WEB, type TestAs } from './helpers.js';

let as: TestAs;
beforeAll(async () => {
  as = await makeAs();
});
afterAll(() => as.cleanup());

const refresh = (rt: string, client = WEB, extra: Record<string, string> = {}) =>
  tokenCall(as, client, { grant_type: 'refresh_token', refresh_token: rt, ...extra });

describe('refresh_token grant', () => {
  it('rotates: new pair, old token is dead', async () => {
    const { tokens } = await linkWallet(as);
    const r1 = tokens.body.refresh_token as string;
    const res = await refresh(r1);
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.refresh_token).not.toBe(r1);
    expect(decodeJwt(res.body.access_token)).toMatchObject({ sub: 'u_alice', client_id: 'taxi-web', principal_type: 'user' });
    expect((await refresh(r1)).body.error).toBe('invalid_grant');
  });

  it('replaying a used token revokes the whole family, including the newest token', async () => {
    const { tokens } = await linkWallet(as);
    const r1 = tokens.body.refresh_token as string;
    const r2 = (await refresh(r1)).body.refresh_token as string;
    const replay = await refresh(r1);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
    expect((await refresh(r2)).body.error).toBe('invalid_grant');
  });

  it('a different client cannot use the token, and the owner is not punished', async () => {
    const { tokens } = await linkWallet(as);
    const r1 = tokens.body.refresh_token as string;
    const other = await refresh(r1, M2M);
    expect(other.status).toBe(400);
    expect(other.body.error).toBe('invalid_grant');
    expect((await refresh(r1)).status).toBe(200);
  });

  it('scope may be narrowed but never widened', async () => {
    const { tokens } = await linkWallet(as, 'wallet:read offline_access');
    const r1 = tokens.body.refresh_token as string;
    const wider = await refresh(r1, WEB, { scope: 'wallet:read wallet:charge' });
    expect(wider.status).toBe(400);
    expect(wider.body.error).toBe('invalid_scope');
    const narrower = await refresh(r1, WEB, { scope: 'wallet:read' });
    expect(narrower.status).toBe(200);
    expect(narrower.body.scope).toBe('wallet:read');
    // the rejected escalation did not consume the token
    expect(decodeJwt(narrower.body.access_token).scope).toBe('wallet:read');
  });

  it('expired refresh token → invalid_grant', async () => {
    const { tokens } = await linkWallet(as);
    as.db.prepare('UPDATE refresh_tokens SET expires_at = 1').run();
    expect((await refresh(tokens.body.refresh_token)).body.error).toBe('invalid_grant');
  });

  it('unknown refresh token → invalid_grant; missing → invalid_request', async () => {
    expect((await refresh('nope')).body.error).toBe('invalid_grant');
    expect((await tokenCall(as, WEB, { grant_type: 'refresh_token' })).body.error).toBe('invalid_request');
  });

  it('wrong client secret → 401', async () => {
    const { tokens } = await linkWallet(as);
    expect((await refresh(tokens.body.refresh_token, { id: 'taxi-web', secret: 'bad' })).status).toBe(401);
  });

  it('concurrent refreshes with the same token: one wins, the family is then revoked', async () => {
    const { tokens } = await linkWallet(as);
    const rt = tokens.body.refresh_token as string;
    const results = await Promise.all(Array.from({ length: 4 }, () => refresh(rt)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const winner = results.find((r) => r.status === 200)!;
    expect((await refresh(winner.body.refresh_token)).body.error).toBe('invalid_grant');
  });
});

describe('revocation (account page)', () => {
  async function aliceAccount() {
    const agent = request.agent(as.app);
    const login = await agent.get('/account');
    const home = await agent
      .post('/login')
      .type('form')
      .send({ csrf: csrfOf(login.text), username: 'alice', password: 'alice-pass' });
    expect(home.status).toBe(303);
    return agent;
  }

  it('lists Taxi and revoking kills consent + every refresh family; sibling consents unaffected', async () => {
    const a = await linkWallet(as);
    const b = await linkWallet(as); // second family for the same pair
    const agent = await aliceAccount();
    const page = await agent.get('/account');
    expect(page.text).toContain('Taxi');

    const res = await agent.post('/account/revoke').type('form').send({ csrf: csrfOf(page.text), client_id: 'taxi-web' });
    expect(res.status).toBe(200);

    for (const t of [a.tokens, b.tokens]) {
      const r = await refresh(t.body.refresh_token);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_grant');
    }
    expect(as.db.prepare("SELECT COUNT(*) AS n FROM consents WHERE client_id = 'taxi-web' AND revoked_at IS NULL").get()).toEqual({ n: 0 });
    expect((await agent.get('/account')).text).toContain('No apps have access');
  });

  it('revoke needs a session and CSRF', async () => {
    const anon = await request(as.app).post('/account/revoke').type('form').send({ client_id: 'taxi-web' });
    expect(anon.status).toBe(400);
    const agent = await aliceAccount();
    const noCsrf = await agent.post('/account/revoke').type('form').send({ client_id: 'taxi-web' });
    expect(noCsrf.status).toBe(400);
  });

  it('a new consent after revocation works again', async () => {
    const again = await linkWallet(as);
    expect((await refresh(again.tokens.body.refresh_token)).status).toBe(200);
  });
});

describe('client_credentials grant', () => {
  const cc = (scope?: string, client = M2M) =>
    tokenCall(as, client, { grant_type: 'client_credentials', ...(scope ? { scope } : {}) });

  it('issues a client token: sub=client_id, principal_type=client, no refresh token', async () => {
    const res = await cc('rates:read');
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeUndefined();
    expect(decodeJwt(res.body.access_token)).toMatchObject({
      sub: 'taxi-m2m',
      client_id: 'taxi-m2m',
      scope: 'rates:read',
      principal_type: 'client',
      aud: 'wallet-api',
    });
  });

  it('defaults to the client allowed scopes when scope is omitted', async () => {
    expect((await cc()).body.scope).toBe('rates:read');
  });

  it('scope outside the allowed list → invalid_scope', async () => {
    for (const scope of ['wallet:charge', 'rates:read wallet:read']) {
      const res = await cc(scope);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_scope');
    }
  });

  it('a client not registered for the grant → unauthorized_client', async () => {
    const res = await cc('wallet:read', WEB);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unauthorized_client');
  });

  it('wrong secret → 401', async () => {
    expect((await cc('rates:read', { id: 'taxi-m2m', secret: 'bad' })).status).toBe(401);
  });
});
