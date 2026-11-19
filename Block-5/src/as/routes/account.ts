import { Router, type Request } from 'express';
import type { Db } from '../../db.js';
import { config } from '../../config.js';
import { log, randomToken, safeEqual } from '../../util.js';
import { revokeConsent } from '../services/grants.js';
import { accountPage, loginPage } from '../views/pages.js';

const q = (value: unknown): string => (typeof value === 'string' ? value : '');

function csrf(req: Request): string {
  req.session.csrf ??= randomToken(16);
  return req.session.csrf;
}

const csrfOk = (req: Request): boolean => {
  const sent = q(req.body?.csrf);
  return !!req.session.csrf && sent !== '' && safeEqual(sent, req.session.csrf);
};

/** Alice's account page: see which apps hold access to her wallet and revoke them (P5). */
export function accountRouter(db: Db): Router {
  const router = Router();

  const render = (req: Request, message?: string): string => {
    const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.session.userId) as {
      display_name: string;
    };
    const apps = db
      .prepare(
        `SELECT c.client_id, cl.name, GROUP_CONCAT(DISTINCT c.scope) AS scope
         FROM consents c JOIN clients cl ON cl.client_id = c.client_id
         WHERE c.user_id = ? AND c.revoked_at IS NULL GROUP BY c.client_id, cl.name`,
      )
      .all(req.session.userId) as { client_id: string; name: string; scope: string }[];
    return accountPage({ csrf: csrf(req), userName: user.display_name, apps, message });
  };

  router.get('/account', (req, res) => {
    if (!req.session.userId) {
      req.session.pending = undefined;
      req.session.returnTo = '/account';
      res.send(loginPage({ csrf: csrf(req) }));
      return;
    }
    res.send(render(req));
  });

  router.post('/account/revoke', (req, res) => {
    if (!req.session.userId || !csrfOk(req)) {
      res.status(400).send('Invalid request');
      return;
    }
    const clientId = q(req.body.client_id);
    const result = revokeConsent(db, req.session.userId, clientId);
    log('as', 'consent_revoked', { user: req.session.userId, client: clientId, ...result });
    res.send(
      render(
        req,
        `Access revoked (${result.refreshTokens} refresh token(s) revoked). Access tokens already issued stay valid until they expire (at most ${config.accessTtl}s).`,
      ),
    );
  });

  router.post('/logout', (req, res) => {
    if (!csrfOk(req)) {
      res.status(400).send('Invalid request');
      return;
    }
    req.session.destroy(() => res.redirect(303, '/account'));
  });

  return router;
}
