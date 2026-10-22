import type { Db } from '../../db.js';
import { config } from '../../config.js';
import { nowSec, randomToken, safeEqual, sha256B64Url, sha256Hex } from '../../util.js';

/** Result of a grant check: either an OAuth error (RFC 6749 §5.2) or what we are allowed to issue. */
export type GrantResult<T> = { ok: true; value: T } | { ok: false; error: string; description: string; reason: string };

const fail = (error: string, description: string, reason: string): { ok: false; error: string; description: string; reason: string } => ({
  ok: false,
  error,
  description,
  reason,
});

export interface ClientRow {
  client_id: string;
  secret_hash: string;
  allowed_scopes: string;
  grant_types: string;
}

export interface Issuable {
  userId: string;
  accessScope: string;
  /** Plaintext refresh token (returned once; only its hash is stored) */
  refreshToken?: string;
}

const VERIFIER_FORMAT = /^[A-Za-z0-9\-._~]{43,128}$/;
const scopesOf = (scope: string): string[] => scope.split(' ').filter(Boolean);

export function revokeFamily(db: Db, familyId: string): void {
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL').run(
    nowSec(),
    familyId,
  );
}

/** Insert a refresh token (hash only) in a family; returns the plaintext for the one-time response. */
function insertRefreshToken(db: Db, p: { userId: string; clientId: string; scope: string; familyId: string }): { token: string; hash: string } {
  const token = randomToken(32);
  const hash = sha256Hex(token);
  const now = nowSec();
  db.prepare(
    `INSERT INTO refresh_tokens (token_hash, family_id, client_id, user_id, scope, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(hash, p.familyId, p.clientId, p.userId, p.scope, now + config.refreshTtl, now);
  return { token, hash };
}

/**
 * authorization_code grant (RFC 6749 §4.1.3 + RFC 7636 §4.6).
 *
 * Runs inside ONE immediate transaction: the code is burned (`used_at`) and the refresh token row is
 * written atomically, so two concurrent requests can never both redeem the same code.
 * The code is burned on the first attempt that reaches this point, even if a later check fails,
 * so an attacker cannot keep guessing `code_verifier` against the same code.
 */
export function redeemAuthorizationCode(
  db: Db,
  client: ClientRow,
  input: { code: string; codeVerifier: string; redirectUri: string },
): GrantResult<Issuable> {
  const txn = db.transaction((): GrantResult<Issuable> => {
    const now = nowSec();
    const codeHash = sha256Hex(input.code);
    const row = db.prepare('SELECT * FROM auth_codes WHERE code_hash = ?').get(codeHash) as
      | {
          client_id: string;
          user_id: string;
          redirect_uri: string;
          scope: string;
          code_challenge: string | null;
          expires_at: number;
          used_at: number | null;
          family_id: string | null;
        }
      | undefined;
    if (!row) return fail('invalid_grant', 'Unknown authorization code', 'code_unknown');

    // Reuse: reject, and revoke whatever the first redemption produced (RFC 6749 §4.1.2).
    if (row.used_at !== null) {
      if (row.family_id) revokeFamily(db, row.family_id);
      return fail('invalid_grant', 'Authorization code already used', 'code_reused');
    }
    const burned = db
      .prepare('UPDATE auth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL')
      .run(now, codeHash);
    if (burned.changes !== 1) return fail('invalid_grant', 'Authorization code already used', 'code_reused');

    if (row.expires_at <= now) return fail('invalid_grant', 'Authorization code expired', 'code_expired');
    if (row.client_id !== client.client_id) {
      return fail('invalid_grant', 'Authorization code was issued to another client', 'code_client_mismatch');
    }
    if (row.redirect_uri !== input.redirectUri) {
      return fail('invalid_grant', 'redirect_uri does not match the authorization request', 'redirect_uri_mismatch');
    }
    if (
      !row.code_challenge ||
      !VERIFIER_FORMAT.test(input.codeVerifier) ||
      !safeEqual(sha256B64Url(input.codeVerifier), row.code_challenge)
    ) {
      return fail('invalid_grant', 'PKCE verification failed', 'pkce_mismatch');
    }

    const value: Issuable = { userId: row.user_id, accessScope: row.scope };
    if (scopesOf(row.scope).includes('offline_access')) {
      const familyId = randomToken(16);
      const refresh = insertRefreshToken(db, { userId: row.user_id, clientId: client.client_id, scope: row.scope, familyId });
      db.prepare('UPDATE auth_codes SET family_id = ? WHERE code_hash = ?').run(familyId, codeHash);
      value.refreshToken = refresh.token;
    }
    return { ok: true, value };
  });
  return txn.immediate();
}

/**
 * refresh_token grant with rotation (RFC 6749 §6, RFC 9700 §4.14).
 * Each token is single use; presenting an already-used token revokes the whole family.
 */
export function rotateRefreshToken(
  db: Db,
  client: ClientRow,
  input: { refreshToken: string; requestedScope?: string },
): GrantResult<Issuable> {
  const txn = db.transaction((): GrantResult<Issuable> => {
    const now = nowSec();
    const hash = sha256Hex(input.refreshToken);
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hash) as
      | {
          family_id: string;
          client_id: string;
          user_id: string;
          scope: string;
          expires_at: number;
          revoked_at: number | null;
          replaced_by: string | null;
        }
      | undefined;
    if (!row) return fail('invalid_grant', 'Unknown refresh token', 'refresh_unknown');

    // Belongs to another client: reject, but do not punish the real owner's family.
    if (row.client_id !== client.client_id) {
      return fail('invalid_grant', 'Refresh token was issued to another client', 'refresh_client_mismatch');
    }
    if (row.revoked_at !== null) return fail('invalid_grant', 'Refresh token revoked', 'refresh_revoked');
    if (row.replaced_by !== null) {
      revokeFamily(db, row.family_id); // replay of a rotated token: assume theft, kill the family
      return fail('invalid_grant', 'Refresh token already used', 'refresh_replayed');
    }
    if (row.expires_at <= now) return fail('invalid_grant', 'Refresh token expired', 'refresh_expired');

    // Consent must still be active, and the new scope may not exceed what Alice approved.
    const consents = db
      .prepare('SELECT scope FROM consents WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL')
      .all(row.user_id, row.client_id) as { scope: string }[];
    if (consents.length === 0) return fail('invalid_grant', 'Consent revoked', 'consent_revoked');
    const approved = new Set(consents.flatMap((c) => scopesOf(c.scope)));
    const original = new Set(scopesOf(row.scope));

    const requested = input.requestedScope ? scopesOf(input.requestedScope) : scopesOf(row.scope);
    if (requested.length === 0 || !requested.every((s) => original.has(s) && approved.has(s))) {
      return fail('invalid_scope', 'Requested scope exceeds the originally approved scope', 'scope_escalation');
    }

    const successor = insertRefreshToken(db, {
      userId: row.user_id,
      clientId: row.client_id,
      scope: row.scope, // the new refresh token keeps the original ceiling even if this access token is narrower
      familyId: row.family_id,
    });
    const marked = db
      .prepare('UPDATE refresh_tokens SET replaced_by = ? WHERE token_hash = ? AND replaced_by IS NULL AND revoked_at IS NULL')
      .run(successor.hash, hash);
    if (marked.changes !== 1) {
      revokeFamily(db, row.family_id);
      return fail('invalid_grant', 'Refresh token already used', 'refresh_replayed');
    }
    return { ok: true, value: { userId: row.user_id, accessScope: requested.join(' '), refreshToken: successor.token } };
  });
  return txn.immediate();
}

/** client_credentials grant (RFC 6749 §4.4): no user, no refresh token. */
export function clientCredentialsScope(client: ClientRow, requestedScope?: string): GrantResult<string> {
  if (!scopesOf(client.grant_types).includes('client_credentials')) {
    return fail('unauthorized_client', 'Client may not use client_credentials', 'grant_not_allowed');
  }
  const allowed = new Set(scopesOf(client.allowed_scopes));
  const requested = requestedScope ? scopesOf(requestedScope) : [...allowed];
  if (requested.length === 0 || !requested.every((s) => allowed.has(s))) {
    return fail('invalid_scope', 'Requested scope is not allowed for this client', 'scope_not_allowed');
  }
  return { ok: true, value: requested.join(' ') };
}

/** Revocation (P5): withdraw consent and kill every refresh family for the (user, client) pair. */
export function revokeConsent(db: Db, userId: string, clientId: string): { consents: number; refreshTokens: number } {
  const now = nowSec();
  return db.transaction(() => {
    const c = db
      .prepare('UPDATE consents SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL')
      .run(now, userId, clientId);
    const r = db
      .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL')
      .run(now, userId, clientId);
    return { consents: c.changes, refreshTokens: r.changes };
  })();
}
