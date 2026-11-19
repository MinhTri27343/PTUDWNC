import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { config } from '../config.js';
import { log } from '../util.js';

export interface AuthContext {
  sub: string;
  clientId: string;
  scopes: string[];
  principalType: 'user' | 'client';
  exp: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Offline verification: the Wallet API never calls the AS per request, only fetches (and caches) the JWKS.
const jwks = createRemoteJWKSet(new URL(`${config.asUrl}/.well-known/jwks.json`), {
  headers: { 'X-Flow-Actor': 'api' }, // so the Flow UI can show "the API fetched the AS public keys"
});

function unauthorized(res: Response, error: string, description: string): void {
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer realm="wallet-api", error="${error}", error_description="${description}"`)
    .json({ error, error_description: description });
}

export interface Requirement {
  scope?: string;
  principalType?: 'user' | 'client';
}

/** Verify the Bearer JWT (signature, iss, aud, exp), then enforce scope / principal_type. */
export function requireAuth(req: Requirement) {
  return async (request: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = request.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      log('wallet-api', 'jwt_rejected', { reason: 'no bearer token' });
      res.status(401).set('WWW-Authenticate', 'Bearer realm="wallet-api"').json({ error: 'invalid_request' });
      return;
    }

    try {
      const { payload } = await jwtVerify(match[1], jwks, {
        issuer: config.asUrl,
        audience: config.audience,
        algorithms: ['ES256'],
      });
      request.auth = {
        sub: String(payload.sub),
        clientId: String(payload.client_id),
        scopes: String(payload.scope ?? '').split(' ').filter(Boolean),
        principalType: payload.principal_type === 'client' ? 'client' : 'user',
        exp: Number(payload.exp),
      };
      log('wallet-api', 'jwt_verified', {
        checks: 'ES256 signature via JWKS, iss, aud=wallet-api, exp',
        sub: request.auth.sub,
        principal_type: request.auth.principalType,
        scope: request.auth.scopes.join(' '),
      });
    } catch (err) {
      const expired = err instanceof errors.JWTExpired;
      const reason = err instanceof errors.JOSEError ? err.code : 'invalid';
      log('wallet-api', 'jwt_rejected', { reason });
      unauthorized(res, 'invalid_token', expired ? 'The access token expired' : 'The access token is invalid');
      return;
    }

    if (req.scope && !request.auth.scopes.includes(req.scope)) {
      log('wallet-api', 'scope_denied', { required: req.scope, has: request.auth.scopes.join(' ') });
      res
        .status(403)
        .set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${req.scope}"`)
        .json({ error: 'insufficient_scope', required_scope: req.scope });
      return;
    }
    if (req.principalType && request.auth.principalType !== req.principalType) {
      log('wallet-api', 'principal_denied', { required: req.principalType, has: request.auth.principalType });
      res.status(403).json({ error: 'forbidden', error_description: `Requires principal_type=${req.principalType}` });
      return;
    }
    next();
  };
}
