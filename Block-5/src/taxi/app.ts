import express, { type Express, type Request, type Response } from 'express';
import session from 'express-session';
import { config } from '../config.js';
import { escapeHtml as h, fingerprint, iso, log, nowSec } from '../util.js';
import { CLIENT_ID, getOAuthConfig, oidc, REDIRECT_URI, REQUESTED_SCOPE } from './oauthClient.js';
import { runPaymentJob } from './paymentJob.js';
import type { TaxiStore } from './store.js';
import { getAccessToken, NotLinkedError } from './tokenManager.js';

declare module 'express-session' {
  interface SessionData {
    taxiUser?: string;
    oauth?: { state: string; codeVerifier: string };
    flash?: string;
  }
}

export function createTaxiApp(store: TaxiStore): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    session({
      name: 'taxi_sid',
      secret: config.taxiSessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  const currentUser = (req: Request): string => req.session.taxiUser ?? 'alice';
  const back = (req: Request, res: Response, message: string): void => {
    req.session.flash = message;
    res.redirect(303, '/');
  };

  app.get('/', (req, res) => {
    const userId = currentUser(req);
    const link = store.getLink(userId);
    const flash = req.session.flash;
    req.session.flash = undefined;
    const rides = store.rides(userId);

    const linkText =
      link?.status === 'linked'
        ? `Linked — scope <code>${h(link.scope)}</code>, access token expires ${link.access_exp ? h(iso(link.access_exp)) : '?'}`
        : link?.status === 'unlinked'
          ? 'Unlinked (the Wallet rejected our refresh token)'
          : 'Not linked';

    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Taxi</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;color:#1b2430}
button{padding:8px 14px;border:0;border-radius:8px;background:#0b5fff;color:#fff;cursor:pointer;margin:4px 4px 4px 0}
.card{background:#f4f6f8;border-radius:10px;padding:14px 18px;margin:14px 0} code{background:#e8ecf1;padding:1px 5px;border-radius:4px}
.flash{background:#fff7d6;padding:10px 14px;border-radius:8px} table{width:100%;border-collapse:collapse} td,th{text-align:left;padding:4px 6px;border-bottom:1px solid #dde2e8}</style>
</head><body>
<h1>Taxi</h1>
${flash ? `<p class="flash">${h(flash)}</p>` : ''}
<div class="card"><form method="post" action="/switch">
  Taxi account: <select name="user" onchange="this.form.submit()">
  ${store
    .users()
    .map((u) => `<option value="${h(u.id)}"${u.id === userId ? ' selected' : ''}>${h(u.display_name)}</option>`)
    .join('')}</select></form></div>
<div class="card"><strong>Wallet:</strong> ${linkText}
  <form method="post" action="/link"><button>Link wallet</button></form>
  <form method="post" action="/balance"><button>Show balance</button></form></div>
<div class="card"><strong>Rides</strong>
  <table><tr><th>Ride</th><th>Amount</th><th>Status</th></tr>
  ${rides.map((r) => `<tr><td>${h(r.id)}</td><td>${r.amount_cents}</td><td>${h(r.status)}</td></tr>`).join('')}</table>
  <form method="post" action="/rides"><button>New ride (2500)</button></form>
  <form method="post" action="/payment-job"><button>Run payment job (no session)</button></form></div>
</body></html>`);
  });

  app.post('/switch', (req, res) => {
    const user = String(req.body?.user ?? '');
    if (store.users().some((u) => u.id === user)) req.session.taxiUser = user;
    res.redirect(303, '/');
  });

  app.post('/link', async (req, res) => {
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    req.session.oauth = { state, codeVerifier }; // verifier stays server side, never in the browser
    const url = oidc.buildAuthorizationUrl(getOAuthConfig(), {
      redirect_uri: REDIRECT_URI,
      scope: REQUESTED_SCOPE,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
    });
    log('taxi', 'link_redirect', { user: currentUser(req), authorize_url: url.origin + url.pathname });
    res.redirect(303, url.href);
  });

  app.get('/callback', async (req, res) => {
    const pending = req.session.oauth;
    req.session.oauth = undefined;
    const userId = currentUser(req);
    if (!pending) {
      back(req, res, 'Link failed: no pending authorization (state missing).');
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
      });
      back(req, res, 'Wallet linked.');
    } catch (err) {
      const code = err instanceof oidc.AuthorizationResponseError || err instanceof oidc.ResponseBodyError ? err.error : 'error';
      log('taxi', 'link_failed', { user: userId, error: code });
      back(req, res, `Link failed: ${code}`);
    }
  });

  app.post('/balance', async (req, res) => {
    const userId = currentUser(req);
    try {
      const accessToken = await getAccessToken(store, userId);
      const r = await fetch(`${config.apiUrl}/wallet/balance`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = (await r.json()) as { balance_cents?: number; error?: string };
      back(req, res, r.ok ? `Balance: ${body.balance_cents}` : `Wallet API said ${r.status} ${body.error ?? ''}`);
    } catch (err) {
      if (err instanceof NotLinkedError) {
        back(req, res, 'Wallet is not linked.');
        return;
      }
      throw err;
    }
  });

  app.post('/rides', (req, res) => {
    store.createRide(currentUser(req), 2500);
    res.redirect(303, '/');
  });

  app.post('/payment-job', async (req, res) => {
    const summary = await runPaymentJob(store, currentUser(req));
    back(
      req,
      res,
      `Job: charged ${summary.charged.length}, skipped ${summary.skipped.length}, failed ${summary.failed.length}. Wallet API counter ${summary.counterBefore} → ${summary.counterAfter}.`,
    );
  });

  // JSON status for scripts/tests — never includes tokens.
  app.get('/status', (req, res) => {
    const link = store.getLink(currentUser(req));
    res.json({ user: currentUser(req), status: link?.status ?? 'none', access_exp: link?.access_exp ?? null });
  });

  return app;
}
