import argon2 from 'argon2';
import { Router, type Request, type Response } from 'express';
import type { Db } from '../../db.js';
import { config } from '../../config.js';
import { log, nowSec, randomToken, safeEqual, sha256Hex } from '../../util.js';
import { consentPage, errorPage, loginPage } from '../views/pages.js';

/** BASE64URL(SHA-256(...)) without padding is always 43 characters (RFC 7636 §4.2). */
const CODE_CHALLENGE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

interface PendingAuth {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrf?: string;
    pending?: PendingAuth;
    returnTo?: string;
  }
}

const q = (value: unknown): string => (typeof value === 'string' ? value : '');

function csrfToken(req: Request): string {
  req.session.csrf ??= randomToken(16);
  return req.session.csrf;
}

function csrfOk(req: Request): boolean {
  const sent = q(req.body?.csrf);
  return !!req.session.csrf && sent !== '' && safeEqual(sent, req.session.csrf);
}

/** Redirect to the client's redirect_uri with params; `state` is always echoed back unchanged. */
function redirectToClient(res: Response, pending: PendingAuth, params: Record<string, string>): void {
  const url = new URL(pending.redirect_uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (pending.state !== undefined) url.searchParams.set('state', pending.state);
  res.redirect(302, url.toString());
}

export function authorizeRouter(db: Db): Router {
  const router = Router();

  router.get('/authorize', (req, res) => {
    const pending: PendingAuth = {
      client_id: q(req.query.client_id),
      redirect_uri: q(req.query.redirect_uri),
      response_type: q(req.query.response_type),
      scope: q(req.query.scope),
      state: typeof req.query.state === 'string' ? req.query.state : undefined,
      code_challenge: typeof req.query.code_challenge === 'string' ? req.query.code_challenge : undefined,
      code_challenge_method:
        typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : undefined,
    };

    // 1. Unknown client / 2. redirect_uri mismatch: the redirect_uri cannot be trusted, so the error is
    //    shown on the AS page and we NEVER redirect (RFC 6749 §4.1.2.1, open-redirect defence).
    const client = db
      .prepare('SELECT name, redirect_uri, allowed_scopes FROM clients WHERE client_id = ?')
      .get(pending.client_id) as { name: string; redirect_uri: string | null; allowed_scopes: string } | undefined;
    if (!client || !client.redirect_uri) {
      log('as', 'authorize_rejected', { reason: 'unknown_client', client: pending.client_id });
      res.status(400).send(errorPage({ title: 'Invalid request', message: 'Unknown or unsupported client.' }));
      return;
    }
    if (pending.redirect_uri !== client.redirect_uri) {
      log('as', 'authorize_rejected', { reason: 'redirect_uri_mismatch', client: pending.client_id });
      res
        .status(400)
        .send(errorPage({ title: 'Invalid request', message: 'The redirect URI is not registered for this client.' }));
      return;
    }

    // From here the redirect_uri is trusted: report errors to the client, always echoing `state`.
    const reject = (error: string, reason: string): void => {
      log('as', 'authorize_rejected', { reason, client: pending.client_id, error });
      redirectToClient(res, pending, { error, error_description: reason });
    };

    // 3. Only the authorization code flow exists here (no implicit).
    if (pending.response_type !== 'code') {
      reject('unsupported_response_type', 'response_type must be "code"');
      return;
    }
    // 4. PKCE is mandatory and only S256 is accepted (no "plain").
    if (!pending.code_challenge || !CODE_CHALLENGE_FORMAT.test(pending.code_challenge)) {
      reject('invalid_request', 'code_challenge is required (43-char base64url SHA-256)');
      return;
    }
    if (pending.code_challenge_method !== 'S256') {
      reject('invalid_request', 'code_challenge_method must be S256');
      return;
    }
    // 5. Scope must be non-empty and within what this client is allowed to ask for.
    const requested = pending.scope.split(' ').filter(Boolean);
    const allowed = new Set(client.allowed_scopes.split(' '));
    if (requested.length === 0 || !requested.every((s) => allowed.has(s))) {
      reject('invalid_scope', 'scope is empty or contains a scope this client may not request');
      return;
    }

    req.session.pending = pending;
    const clientName = client.name;

    if (!req.session.userId) {
      res.status(200).send(loginPage({ csrf: csrfToken(req), clientName }));
      return;
    }
    renderConsent(req, res, db, clientName);
  });

  router.post('/login', async (req, res) => {
    const pending = req.session.pending;
    const toAccount = !pending && req.session.returnTo === '/account';
    if ((!pending && !toAccount) || !csrfOk(req)) {
      res.status(400).send('Invalid request');
      return;
    }
    const client = pending
      ? (db.prepare('SELECT name FROM clients WHERE client_id = ?').get(pending.client_id) as { name: string } | undefined)
      : undefined;
    const clientName = pending ? (client?.name ?? pending.client_id) : undefined;

    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(q(req.body.username)) as
      | { id: string; password_hash: string }
      | undefined;
    const ok = user ? await argon2.verify(user.password_hash, q(req.body.password)) : false;
    if (!user || !ok) {
      log('as', 'login_failed', { username: q(req.body.username) });
      res.status(401).send(loginPage({ csrf: csrfToken(req), clientName, error: 'Invalid username or password.' }));
      return;
    }

    // Fresh session id after authentication (session fixation defence).
    const { pending: keep, csrf, returnTo } = req.session;
    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.userId = user.id;
    req.session.pending = keep;
    req.session.returnTo = returnTo;
    req.session.csrf = csrf ?? randomToken(16);
    log('as', 'login_ok', { user: user.id });
    if (!pending) {
      res.redirect(303, '/account');
      return;
    }
    renderConsent(req, res, db, clientName ?? pending.client_id);
  });

  router.post('/consent', (req, res) => {
    const pending = req.session.pending;
    const userId = req.session.userId;
    if (!pending || !userId || !csrfOk(req)) {
      res.status(400).send('Invalid request');
      return;
    }
    req.session.pending = undefined;

    if (q(req.body.decision) !== 'approve') {
      log('as', 'consent_denied', { client: pending.client_id, user: userId });
      redirectToClient(res, pending, { error: 'access_denied' });
      return;
    }

    const now = nowSec();
    db.prepare(
      'INSERT INTO consents (user_id, client_id, scope, created_at) VALUES (?, ?, ?, ?)',
    ).run(userId, pending.client_id, pending.scope, now);

    const code = randomToken(32);
    db.prepare(
      `INSERT INTO auth_codes (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sha256Hex(code),
      pending.client_id,
      userId,
      pending.redirect_uri,
      pending.scope,
      pending.code_challenge ?? null,
      now + config.codeTtl,
      now,
    );
    log('as', 'code_issued', { client: pending.client_id, user: userId, scope: pending.scope });
    redirectToClient(res, pending, { code });
  });

  return router;
}

function renderConsent(req: Request, res: Response, db: Db, clientName: string): void {
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.session.userId) as
    | { display_name: string }
    | undefined;
  const scopes = (req.session.pending?.scope ?? '').split(' ').filter(Boolean);
  res.status(200).send(
    consentPage({ csrf: csrfToken(req), clientName, userName: user?.display_name ?? '?', scopes }),
  );
}
