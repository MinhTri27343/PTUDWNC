import express, { type Express } from 'express';
import session from 'express-session';
import type { Db } from '../db.js';
import { config } from '../config.js';
import { mountDocs } from '../docs.js';
import { randomToken, sha256B64Url } from '../util.js';
import { getJwks } from './keys.js';
import { accountRouter } from './routes/account.js';
import { authorizeRouter } from './routes/authorize.js';
import { tokenRouter } from './routes/token.js';

export function createAsApp(db: Db): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    session({
      name: 'as_sid',
      secret: config.taxiSessionSecret + ':as',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60 * 1000 },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  app.get('/.well-known/jwks.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(getJwks());
  });

  app.use(authorizeRouter(db));
  app.use(tokenRouter(db));
  app.use(accountRouter(db));

  // Lab helper for manual demos (Swagger): a fresh PKCE pair. The verifier is not stored.
  app.get('/lab/pkce', (_req, res) => {
    const verifier = randomToken(32);
    res.json({ code_verifier: verifier, code_challenge: sha256B64Url(verifier), code_challenge_method: 'S256' });
  });
  mountDocs(app, 'as.yaml', config.asUrl);

  app.get('/', (_req, res) => {
    res.type('text/plain').send('Wallet Authorization Server (lab). See /.well-known/jwks.json');
  });

  return app;
}
