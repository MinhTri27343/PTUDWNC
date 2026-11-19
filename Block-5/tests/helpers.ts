import argon2 from 'argon2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { config } from '../src/config.js';
import { openDb, type Db } from '../src/db.js';
import { createAsApp } from '../src/as/app.js';
import { initKeys } from '../src/as/keys.js';
import { randomToken, sha256B64Url } from '../src/util.js';

export const REDIRECT = `${config.taxiUrl}/callback`;
export const WEB = { id: 'taxi-web', secret: config.taxiWebSecret };
export const M2M = { id: 'taxi-m2m', secret: config.taxiM2mSecret };

export interface TestAs {
  db: Db;
  app: ReturnType<typeof createAsApp>;
  cleanup: () => void;
}

/** Fresh AS on a throw-away SQLite file with the two lab clients and Alice/Bob. */
export async function makeAs(): Promise<TestAs> {
  await initKeys();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-test-'));
  const db = openDb('as', path.join(dir, 'as.db'));
  const hash = (s: string) => argon2.hash(s, { type: argon2.argon2id, memoryCost: 1024, timeCost: 2 });

  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u_alice', 'alice', 'Alice', await hash('alice-pass'));
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u_bob', 'bob', 'Bob', await hash('bob-pass'));
  db.prepare('INSERT INTO clients VALUES (?, ?, ?, ?, ?, ?)').run(
    'taxi-web',
    'Taxi',
    await hash(WEB.secret),
    REDIRECT,
    'wallet:read wallet:charge offline_access',
    'authorization_code refresh_token',
  );
  db.prepare('INSERT INTO clients VALUES (?, ?, ?, ?, ?, ?)').run(
    'taxi-m2m',
    'Taxi M2M',
    await hash(M2M.secret),
    null,
    'rates:read',
    'client_credentials',
  );
  return {
    db,
    app: createAsApp(db),
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const pkce = () => {
  const verifier = randomToken(32);
  return { verifier, challenge: sha256B64Url(verifier) };
};

export const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

export function authorizeQuery(over: Record<string, string | undefined> = {}, challenge = pkce().challenge): string {
  const base: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: 'taxi-web',
    redirect_uri: REDIRECT,
    scope: 'wallet:read wallet:charge offline_access',
    state: 'st-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...over,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== undefined) q.set(k, v);
  return q.toString();
}

/** Full browser flow as a user: authorize → login → consent. Returns the final response. */
export async function browserFlow(
  as: TestAs,
  opts: { query?: Record<string, string | undefined>; challenge?: string; user?: string; decision?: 'approve' | 'deny' } = {},
  agent = request.agent(as.app),
) {
  const user = opts.user ?? 'alice';
  let res = await agent.get(`/authorize?${authorizeQuery(opts.query, opts.challenge)}`);
  if (res.status !== 200) return { res, agent };
  if (res.text.includes('name="username"')) {
    res = await agent
      .post('/login')
      .type('form')
      .send({ csrf: csrfOf(res.text), username: user, password: `${user}-pass` });
  }
  res = await agent
    .post('/consent')
    .type('form')
    .send({ csrf: csrfOf(res.text), decision: opts.decision ?? 'approve' });
  return { res, agent };
}

export const codeFrom = (res: { headers: Record<string, string> }): string =>
  new URL(res.headers.location).searchParams.get('code') ?? '';

export const basic = (c: { id: string; secret: string }): string =>
  `Basic ${Buffer.from(`${encodeURIComponent(c.id)}:${encodeURIComponent(c.secret)}`).toString('base64')}`;

export function tokenCall(as: TestAs, client: { id: string; secret: string }, form: Record<string, string>) {
  return request(as.app).post('/token').set('Authorization', basic(client)).type('form').send(form);
}

/** Authorization code → tokens for taxi-web, returning everything a test may need. */
export async function linkWallet(as: TestAs, scope = 'wallet:read wallet:charge offline_access') {
  const p = pkce();
  const { res } = await browserFlow(as, { query: { scope }, challenge: p.challenge });
  const code = codeFrom(res as never);
  const tokens = await tokenCall(as, WEB, {
    grant_type: 'authorization_code',
    code,
    code_verifier: p.verifier,
    redirect_uri: REDIRECT,
  });
  return { code, verifier: p.verifier, tokens };
}
