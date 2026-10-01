import crypto from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { errors } from './errors';

// User duy nhất của app, gán cứng theo đề (không có bảng users, không có /register).
const USER = { username: 'user', password: '1234' };

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a: string, b: string) => crypto.timingSafeEqual(digest(a), digest(b));

export function verifyCredentials(username: string, password: string): boolean {
  // Không short-circuit để thời gian xử lý không lộ username đúng hay sai.
  const userOk = safeEqual(username, USER.username);
  const passOk = safeEqual(password, USER.password);
  return userOk && passOk;
}

export function signToken(username: string): { access_token: string; token_type: 'Bearer'; expires_in: number } {
  const access_token = jwt.sign({ sub: username }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });
  return { access_token, token_type: 'Bearer', expires_in: config.jwtExpiresIn };
}

/**
 * Handler cho securityScheme `bearerAuth` của express-openapi-validator.
 * Validator chạy bước security TRƯỚC bước validate schema → 401 luôn đến trước 400.
 */
export function bearerAuthHandler(req: Request): boolean {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw errors.unauthorized();
  try {
    jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return true;
  } catch {
    throw errors.unauthorized();
  }
}
