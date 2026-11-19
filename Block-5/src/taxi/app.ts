import express, { type Express, type Request } from 'express';
import session from 'express-session';
import { config } from '../config.js';
import { corsFor, flowRouter, flowTap, FlowBus } from '../flow/bus.js';
import { fingerprint, iso, log, nowSec } from '../util.js';
import {
  CLIENT_ID,
  getM2mConfig,
  getOAuthConfig,
  oidc,
  REDIRECT_URI,
  REQUESTED_SCOPE,
  TAXI_HEADERS,
} from './oauthClient.js';
import { runPaymentJob } from './paymentJob.js';
import type { TaxiStore } from './store.js';
import { getAccessToken, NotLinkedError } from './tokenManager.js';

declare module 'express-session' {
  interface SessionData {
    taxiUser?: string;
    oauth?: { state: string; codeVerifier: string };
  }
}

/**
 * Taxi is the OAuth *client* (a backend). It has no screen of its own: the Flow UI drives it through this
 * small JSON API, and the browser popup only ever visits /callback. Tokens never leave this process.
 */
export function createTaxiApp(store: TaxiStore): Express {
  const app = express();
  app.disable('x-powered-by');

  const bus = new FlowBus('taxi');
  const sessions = new session.MemoryStore();
  app.use(
    flowRouter(bus, () => {
      store.reset();
      sessions.clear();
    }),
  );
  // The Flow UI is another origin: allow it to call /api with the Taxi session cookie (same site: localhost).
  app.use('/api', corsFor(config.flowUrl, { credentials: true }));
  app.use(
    session({
      store: sessions,
      name: 'taxi_sid',
      secret: config.taxiSessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 },
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(flowTap(bus));

  const currentUser = (req: Request): string => req.session.taxiUser ?? 'alice';

  app.get('/', (_req, res) => {
    res.type('text/plain').send(`Taxi backend (OAuth client). No UI here — open the Flow UI at ${config.flowUrl}`);
  });

  app.get('/api/state', (req, res) => {
    const userId = currentUser(req);
    const link = store.getLink(userId);
    res.json({
      user: userId,
      users: store.users(),
      link: {
        status: link?.status ?? 'none',
        scope: link?.scope ?? null,
        access_exp: link?.access_exp ?? null,
        // fingerprints only: shows rotation (the value changes after each refresh) without exposing tokens
        refresh_fp: link?.refresh_token ? fingerprint(link.refresh_token) : null,
        access_fp: link?.access_token ? fingerprint(link.access_token) : null,
      },
      rides: store.rides(userId),
      now: nowSec(),
    });
  });

  app.post('/api/user', (req, res) => {
    const user = String(req.body?.user ?? '');
    if (!store.users().some((u) => u.id === user)) {
      res.status(400).json({ error: 'unknown_user' });
      return;
    }
    req.session.taxiUser = user;
    res.json({ user });
  });

  /** Step 1 of linking: Taxi creates state + PKCE verifier (kept server side) and returns the AS URL. */
  app.post('/api/link/start', async (req, res) => {
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    req.session.oauth = { state, codeVerifier };
    const url = oidc.buildAuthorizationUrl(getOAuthConfig(), {
      redirect_uri: REDIRECT_URI,
      scope: REQUESTED_SCOPE,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
    });
    log('taxi', 'pkce_started', { note: 'code_verifier stays in the Taxi session; only its S256 challenge goes to the AS', user: currentUser(req) });
    res.json({ authorize_url: url.href });
  });

  /** Step 2: the browser (popup) lands here with ?code&state. Taxi exchanges the code on the back channel. */
  app.get('/callback', async (req, res) => {
    const pending = req.session.oauth;
    req.session.oauth = undefined;
    const userId = currentUser(req);
    const done = (ok: boolean, message: string): void => {
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Taxi callback</title>
<body style="font-family:system-ui;padding:24px"><h1>${ok ? 'Wallet linked' : 'Link failed'}</h1><p>${message}</p><p>You can close this window.</p>
<script>try{window.opener&&window.opener.postMessage({type:'taxi:link',ok:${ok}},${JSON.stringify(config.flowUrl)})}catch(e){}
setTimeout(function(){window.close()},400)</script></body>`);
    };
    if (!pending) {
      log('taxi', 'link_failed', { user: userId, error: 'no pending authorization (state missing)' });
      done(false, 'No pending authorization.');
      return;
    }
    try {
      const currentUrl = new URL(req.originalUrl, config.taxiUrl);
      const tokens = await oidc.authorizationCodeGrant(
        getOAuthConfig(),
        currentUrl,
        { pkceCodeVerifier: pending.codeVerifier, expectedState: pending.state },
        { redirect_uri: REDIRECT_URI },
      );
      store.saveTokens(userId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_exp: nowSec() + (tokens.expires_in ?? 0),
        scope: tokens.scope,
      });
      log('taxi', 'wallet_linked', {
        user: userId,
        client: CLIENT_ID,
        scope: tokens.scope,
        refresh: tokens.refresh_token ? fingerprint(tokens.refresh_token) : null,
        access_exp: iso(nowSec() + (tokens.expires_in ?? 0)),
      });
      done(true, 'Taxi now holds the tokens server side.');
    } catch (err) {
      const code = err instanceof oidc.AuthorizationResponseError || err instanceof oidc.ResponseBodyError ? err.error : 'error';
      log('taxi', 'link_failed', { user: userId, error: code });
      done(false, `Error: ${code}`);
    }
  });

  app.post('/api/balance', async (req, res) => {
    const userId = currentUser(req);
    try {
      const accessToken = await getAccessToken(store, userId);
      const r = await fetch(`${config.apiUrl}/wallet/balance`, {
        headers: { ...TAXI_HEADERS, Authorization: `Bearer ${accessToken}` },
      });
      res.json({ http_status: r.status, body: await r.json() });
    } catch (err) {
      if (err instanceof NotLinkedError) {
        res.status(409).json({ error: 'not_linked' });
        return;
      }
      throw err;
    }
  });

  app.post('/api/rides', (req, res) => {
    res.status(201).json(store.createRide(currentUser(req), 2500));
  });

  /** "Simulate Alice being away": the stored access token is treated as expired. */
  app.post('/api/expire', (req, res) => {
    store.expireAccessTokens(currentUser(req));
    log('taxi', 'access_token_aged', { note: 'simulated: stored access token considered expired', user: currentUser(req) });
    res.json({ ok: true });
  });

  /** The background payment job: no browser session involved, only the stored refresh token. */
  app.post('/api/payment-job', async (req, res) => {
    const summary = await runPaymentJob(store, currentUser(req));
    res.json(summary);
  });

  /** Machine-to-machine: Taxi's own identity (client_credentials) reading public rates. */
  app.post('/api/m2m/rates', async (_req, res) => {
    const t = await oidc.clientCredentialsGrant(getM2mConfig(), { scope: 'rates:read' });
    const r = await fetch(`${config.apiUrl}/public/rates`, {
      headers: { ...TAXI_HEADERS, Authorization: `Bearer ${t.access_token}` },
    });
    res.json({ token: { scope: t.scope, expires_in: t.expires_in, refresh_token_issued: !!t.refresh_token }, http_status: r.status, body: await r.json() });
  });

  /** A client token must NOT be able to charge a wallet: the API answers 403 (wrong scope / principal_type). */
  app.post('/api/m2m/try-charge', async (_req, res) => {
    const t = await oidc.clientCredentialsGrant(getM2mConfig(), { scope: 'rates:read' });
    const r = await fetch(`${config.apiUrl}/wallet/charges`, {
      method: 'POST',
      headers: {
        ...TAXI_HEADERS,
        Authorization: `Bearer ${t.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `m2m-attempt-${Date.now()}`,
      },
      body: JSON.stringify({ amount_cents: 100 }),
    });
    res.json({ http_status: r.status, body: await r.json() });
  });

  return app;
}
