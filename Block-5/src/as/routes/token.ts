import argon2 from 'argon2';
import { Router, type Request, type Response } from 'express';
import type { Db } from '../../db.js';
import { log, nowSec } from '../../util.js';
import { signAccessToken } from '../keys.js';
import {
  clientCredentialsScope,
  redeemAuthorizationCode,
  rotateRefreshToken,
  type ClientRow,
  type GrantResult,
  type Issuable,
} from '../services/grants.js';

const field = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? (body[key] as string) : '';

/** RFC 6749 §5.2 error response. 401 carries WWW-Authenticate, everything is no-store. */
export function oauthError(res: Response, status: number, error: string, description?: string): void {
  res.status(status);
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  if (status === 401) res.set('WWW-Authenticate', 'Basic realm="wallet-as", charset="UTF-8"');
  res.json({ error, ...(description ? { error_description: description } : {}) });
}

/** RFC 6749 §2.3.1: id and secret are form-urlencoded, then base64 in the Basic header. */
function parseBasic(req: Request): { id: string; secret: string } | null {
  const header = req.get('authorization');
  if (!header?.toLowerCase().startsWith('basic ')) return null;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
  try {
    return { id: dec(decoded.slice(0, idx)), secret: dec(decoded.slice(idx + 1)) };
  } catch {
    return null;
  }
}

// Verified against this when the client_id is unknown so both failures cost the same time.
const DUMMY_HASH = await argon2.hash('no-such-client', { type: argon2.argon2id });

async function authenticateClient(db: Db, req: Request): Promise<ClientRow | null> {
  const basic = parseBasic(req);
  if (!basic) return null;
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(basic.id) as ClientRow | undefined;
  const ok = await argon2.verify(client?.secret_hash ?? DUMMY_HASH, basic.secret).catch(() => false);
  return client && ok ? client : null;
}

export function tokenRouter(db: Db): Router {
  const router = Router();

  router.post('/token', async (req, res) => {
    // 1. Client authentication (HTTP Basic against the argon2id hash).
    const client = await authenticateClient(db, req);
    if (!client) {
      log('as', 'token_rejected', { reason: 'invalid_client' });
      oauthError(res, 401, 'invalid_client', 'Client authentication failed');
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const grantType = field(body, 'grant_type');

    const reject = (r: Extract<GrantResult<unknown>, { ok: false }>): void => {
      log('as', 'token_rejected', { grant: grantType, client: client.client_id, error: r.error, reason: r.reason });
      oauthError(res, 400, r.error, r.description);
    };

    const respond = async (grant: string, userId: string, scope: string, principal: 'user' | 'client', refresh?: string) => {
      const { token, exp } = await signAccessToken({ sub: userId, clientId: client.client_id, scope, principalType: principal });
      res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
      res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: exp - nowSec(),
        scope,
        ...(refresh ? { refresh_token: refresh } : {}),
      });
      log('as', 'token_issued', { grant, client: client.client_id, sub: userId, scope, refresh: !!refresh });
    };

    const issue = (grant: string, result: GrantResult<Issuable>) =>
      result.ok
        ? respond(grant, result.value.userId, result.value.accessScope, 'user', result.value.refreshToken)
        : reject(result);

    switch (grantType) {
      case 'authorization_code': {
        const code = field(body, 'code');
        const codeVerifier = field(body, 'code_verifier');
        const redirectUri = field(body, 'redirect_uri');
        if (!code || !codeVerifier || !redirectUri) {
          oauthError(res, 400, 'invalid_request', 'code, code_verifier and redirect_uri are required');
          return;
        }
        await issue(grantType, redeemAuthorizationCode(db, client, { code, codeVerifier, redirectUri }));
        return;
      }
      case 'refresh_token': {
        const refreshToken = field(body, 'refresh_token');
        if (!refreshToken) {
          oauthError(res, 400, 'invalid_request', 'refresh_token is required');
          return;
        }
        await issue(grantType, rotateRefreshToken(db, client, { refreshToken, requestedScope: field(body, 'scope') || undefined }));
        return;
      }
      case 'client_credentials': {
        const scope = clientCredentialsScope(client, field(body, 'scope') || undefined);
        if (!scope.ok) {
          reject(scope);
          return;
        }
        // sub is the client itself; no refresh token (RFC 6749 §4.4.3).
        await respond(grantType, client.client_id, scope.value, 'client');
        return;
      }
      case '':
        oauthError(res, 400, 'invalid_request', 'grant_type is required');
        return;
      default:
        oauthError(res, 400, 'unsupported_grant_type', `grant_type "${grantType}" is not supported`);
    }
  });

  return router;
}
