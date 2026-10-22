import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/util.js';
import { authorizeQuery, browserFlow, codeFrom, csrfOf, makeAs, REDIRECT, type TestAs } from './helpers.js';

let as: TestAs;
beforeAll(async () => {
  as = await makeAs();
});
afterAll(() => as.cleanup());

const get = (over: Record<string, string | undefined>) => request(as.app).get(`/authorize?${authorizeQuery(over)}`);
const err = (res: { headers: Record<string, string> }) => new URL(res.headers.location).searchParams;

describe('/authorize — errors shown on the AS page (never redirected)', () => {
  it('unknown client_id', async () => {
    const res = await get({ client_id: 'nope' });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('client without a browser flow (taxi-m2m)', async () => {
    const res = await get({ client_id: 'taxi-m2m' });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it.each([
    ['unregistered host', 'http://evil.example/callback'],
    ['trailing slash', `${REDIRECT}/`],
    ['different case', REDIRECT.toUpperCase()],
    ['extra query', `${REDIRECT}?x=1`],
    ['missing', undefined],
  ])('redirect_uri must match exactly: %s', async (_name, uri) => {
    const res = await get({ redirect_uri: uri });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('/authorize — errors redirected to the client with state', () => {
  it('response_type other than code', async () => {
    const res = await get({ response_type: 'token' });
    expect(res.status).toBe(302);
    expect(err(res as never).get('error')).toBe('unsupported_response_type');
    expect(err(res as never).get('state')).toBe('st-123');
  });

  it('missing code_challenge → invalid_request', async () => {
    const res = await get({ code_challenge: undefined });
    expect(res.status).toBe(302);
    expect(err(res as never).get('error')).toBe('invalid_request');
    expect(err(res as never).get('state')).toBe('st-123');
  });

  it('code_challenge_method=plain is rejected', async () => {
    const res = await get({ code_challenge_method: 'plain' });
    expect(err(res as never).get('error')).toBe('invalid_request');
  });

  it('missing code_challenge_method is rejected', async () => {
    const res = await get({ code_challenge_method: undefined });
    expect(err(res as never).get('error')).toBe('invalid_request');
  });

  it('malformed code_challenge is rejected', async () => {
    const res = await get({ code_challenge: 'short' });
    expect(err(res as never).get('error')).toBe('invalid_request');
  });

  it.each([
    ['unknown scope', 'wallet:read admin'],
    ['scope of another client', 'rates:read'],
    ['empty', ''],
    ['missing', undefined],
  ])('invalid_scope: %s', async (_n, scope) => {
    const res = await get({ scope });
    expect(res.status).toBe(302);
    expect(err(res as never).get('error')).toBe('invalid_scope');
    expect(err(res as never).get('state')).toBe('st-123');
  });

  it('no state sent → none invented', async () => {
    const res = await get({ state: undefined, scope: 'bogus' });
    expect(err(res as never).has('state')).toBe(false);
  });
});

describe('login and consent', () => {
  it('valid request shows the login page', async () => {
    const res = await get({});
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="username"');
  });

  it('wrong password → 401, no code', async () => {
    const agent = request.agent(as.app);
    const page = await agent.get(`/authorize?${authorizeQuery()}`);
    const res = await agent
      .post('/login')
      .type('form')
      .send({ csrf: csrfOf(page.text), username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('login without the CSRF token is refused', async () => {
    const agent = request.agent(as.app);
    await agent.get(`/authorize?${authorizeQuery()}`);
    const res = await agent.post('/login').type('form').send({ username: 'alice', password: 'alice-pass' });
    expect(res.status).toBe(400);
  });

  it('Deny → access_denied + state', async () => {
    const { res } = await browserFlow(as, { decision: 'deny' });
    expect(res.status).toBe(302);
    expect(err(res as never).get('error')).toBe('access_denied');
    expect(err(res as never).get('state')).toBe('st-123');
  });

  it('Approve → consent stored, code redirected with state, only the code hash is stored', async () => {
    const { res } = await browserFlow(as, {});
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st-123');

    const code = codeFrom(res as never);
    expect(code.length).toBeGreaterThanOrEqual(43);
    const row = as.db.prepare('SELECT * FROM auth_codes WHERE code_hash = ?').get(sha256Hex(code)) as Record<string, unknown>;
    expect(row).toMatchObject({ client_id: 'taxi-web', user_id: 'u_alice', redirect_uri: REDIRECT, used_at: null });
    expect(row.code_challenge).toBeTruthy();
    expect(JSON.stringify(as.db.prepare('SELECT * FROM auth_codes').all())).not.toContain(code);

    const consent = as.db
      .prepare("SELECT * FROM consents WHERE user_id = 'u_alice' AND client_id = 'taxi-web' ORDER BY id DESC")
      .get() as { scope: string; revoked_at: number | null };
    expect(consent.scope).toBe('wallet:read wallet:charge offline_access');
    expect(consent.revoked_at).toBeNull();
  });

  it('consent without CSRF is refused', async () => {
    const agent = request.agent(as.app);
    const page = await agent.get(`/authorize?${authorizeQuery()}`);
    await agent.post('/login').type('form').send({ csrf: csrfOf(page.text), username: 'alice', password: 'alice-pass' });
    const res = await agent.post('/consent').type('form').send({ decision: 'approve' });
    expect(res.status).toBe(400);
  });
});
