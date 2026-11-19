import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import { DATA } from './db.js';
import { HttpError } from './types.js';
export const ISSUER = 'block-6-lab', AUDIENCE = 'task-api';
export function persistentSecret(): Uint8Array {
  const file = path.join(DATA, '.jwt-secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
  return readFileSync(file);
}
export async function issueToken(id: string, secret: Uint8Array, expiry = '1h') {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
    .setIssuedAt().setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime(expiry).sign(secret);
}
export function authenticate(secret: Uint8Array): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '');
    if (!match) return next(new HttpError(401, 'unauthenticated'));
    try {
      const { payload } = await jwtVerify(match[1], secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE, requiredClaims: ['sub', 'exp', 'iat'] });
      if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Missing subject');
      res.locals.uid = payload.sub;
      next();
    } catch { next(new HttpError(401, 'invalid_or_expired_token')); }
  };
}
