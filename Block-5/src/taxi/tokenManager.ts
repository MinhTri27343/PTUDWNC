import { nowSec, fingerprint, iso, log } from '../util.js';
import { getOAuthConfig, oidc } from './oauthClient.js';
import type { TaxiStore } from './store.js';

/** Refresh slightly early so a token never expires between "check" and "use". */
const SKEW_SECONDS = 10;

export class NotLinkedError extends Error {
  constructor(userId: string) {
    super(`Wallet is not linked for ${userId}`);
  }
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Serialize work per user. Refresh tokens rotate, so two concurrent refreshes with the same
 * token would look like a replay to the AS and revoke the whole family.
 */
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(userId, tail);
  try {
    return await run;
  } finally {
    if (locks.get(userId) === tail) locks.delete(userId);
  }
}

/** Return a valid access token for the user, refreshing (and persisting the rotated pair) if needed. */
export function getAccessToken(store: TaxiStore, userId: string): Promise<string> {
  return withUserLock(userId, async () => {
    const link = store.getLink(userId);
    if (!link || link.status !== 'linked' || !link.refresh_token) throw new NotLinkedError(userId);

    if (link.access_token && link.access_exp && link.access_exp - nowSec() > SKEW_SECONDS) {
      return link.access_token;
    }

    log('taxi', 'access_token_expired', {
      user: userId,
      old_access_exp: link.access_exp != null ? iso(link.access_exp) : null,
      refresh: fingerprint(link.refresh_token),
    });

    try {
      const tokens = await oidc.refreshTokenGrant(getOAuthConfig(), link.refresh_token);
      const exp = nowSec() + (tokens.expires_in ?? 0);
      // Persist the new pair immediately: the old refresh token is now dead.
      store.saveTokens(userId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_exp: exp,
        scope: tokens.scope,
      });
      log('taxi', 'token_refreshed', {
        user: userId,
        new_access_exp: iso(exp),
        new_refresh: tokens.refresh_token ? fingerprint(tokens.refresh_token) : null,
      });
      return tokens.access_token;
    } catch (err) {
      if (err instanceof oidc.ResponseBodyError && err.error === 'invalid_grant') {
        store.markUnlinked(userId);
        log('taxi', 'wallet_unlinked', { user: userId, reason: 'invalid_grant' });
        throw new NotLinkedError(userId);
      }
      throw err;
    }
  });
}
