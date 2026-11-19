import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { FlowBus, flowTap, type FlowRecord } from '../src/flow/bus.js';
import { describeAuthorization, redactLocation, redactObject } from '../src/flow/redact.js';
import { linkWallet, makeAs, tokenCall, WEB } from './helpers.js';

const SECRETS = ['s3cr3t-code-value', 'my-verifier-value', 'refresh-value-xyz', 'hunter2'];

describe('flow redaction', () => {
  it('turns secret fields into stable fingerprints and keeps plain fields', () => {
    const a = redactObject({ code: SECRETS[0], code_verifier: SECRETS[1], password: SECRETS[3], scope: 'wallet:read' }) as Record<string, string>;
    const b = redactObject({ code: SECRETS[0] }) as Record<string, string>;
    expect(a.scope).toBe('wallet:read');
    expect(a.code).toMatch(/^<code:[0-9a-f]{8}>$/);
    expect(a.code).toBe(b.code); // same value -> same label, so a viewer can follow it across hops
    expect(JSON.stringify(a)).not.toContain(SECRETS[0]);
    expect(JSON.stringify(a)).not.toContain(SECRETS[3]);
  });

  it('shows access-token claims but never the token', async () => {
    const jwt = await new SignJWT({ scope: 'wallet:read', principal_type: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u_alice')
      .setExpirationTime('2m')
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    const out = redactObject({ access_token: jwt, refresh_token: SECRETS[2], expires_in: 120 }) as Record<string, any>;
    expect(JSON.stringify(out)).not.toContain(jwt);
    expect(JSON.stringify(out)).not.toContain(SECRETS[2]);
    expect(out.access_token_claims).toMatchObject({ sub: 'u_alice', scope: 'wallet:read', principal_type: 'user' });
  });

  it('describes Authorization headers without the credential', () => {
    const basic = `Basic ${Buffer.from('taxi-web:top-secret').toString('base64')}`;
    const d = describeAuthorization(basic) as Record<string, string>;
    expect(d).toMatchObject({ scheme: 'Basic', client_id: 'taxi-web' });
    expect(JSON.stringify(d)).not.toContain('top-secret');
    expect(JSON.stringify(describeAuthorization('Bearer aaa.bbb.ccc'))).not.toContain('aaa.bbb.ccc');
  });

  it('redacts code and state in redirect locations', () => {
    const loc = redactLocation(`http://taxi.test/callback?code=${SECRETS[0]}&state=abc123`, 'http://x');
    expect(loc).not.toContain(SECRETS[0]);
    expect(loc).not.toContain('abc123');
    expect(loc).toMatch(/code=<code:[0-9a-f]{8}>&state=<state:[0-9a-f]{8}>/);
  });
});

describe('flowTap', () => {
  it('records the exchange (actor, status, redacted body) and skips polling/stream paths', async () => {
    const bus = new FlowBus('as');
    const seen: FlowRecord[] = [];
    const orig = bus.push.bind(bus);
    bus.push = (rec) => {
      seen.push(rec);
      orig(rec);
    };
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(flowTap(bus));
    app.post('/token', (_req, res) => res.status(400).json({ error: 'invalid_grant', refresh_token: SECRETS[2] }));
    app.get('/api/state', (_req, res) => res.json({}));

    await request(app).post('/token').set('X-Flow-Actor', 'taxi').type('form').send({ grant_type: 'refresh_token', refresh_token: SECRETS[2] });
    await request(app).get('/api/state');

    const http = seen.filter((r) => r.kind === 'http');
    expect(http).toHaveLength(1);
    expect(http[0]).toMatchObject({ service: 'as', actor: 'taxi', method: 'POST', path: '/token', status: 400, pending: false });
    expect(JSON.stringify(http[0])).not.toContain(SECRETS[2]);
    expect((http[0].req?.body as Record<string, string>).grant_type).toBe('refresh_token');
  });
});

describe('demo reset (/_flow/reset)', () => {
  it('AS forgets grants, tokens and consents but keeps users and clients', async () => {
    const as = await makeAs();
    try {
      const { tokens } = await linkWallet(as);
      expect(tokens.status).toBe(200);
      expect(as.db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens').get()).toEqual({ n: 1 });

      const res = await request(as.app).post('/_flow/reset');
      expect(res.status).toBe(200);
      for (const table of ['auth_codes', 'refresh_tokens', 'consents']) {
        expect(as.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      }
      expect(as.db.prepare('SELECT COUNT(*) AS n FROM clients').get()).toEqual({ n: 2 });
      expect(as.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 2 });
      // the old refresh token no longer works
      const again = await tokenCall(as, WEB, { grant_type: 'refresh_token', refresh_token: tokens.body.refresh_token });
      expect(again.body.error).toBe('invalid_grant');
    } finally {
      as.cleanup();
    }
  });
});
