import type { Db } from '../db.js';
import { nowSec } from '../util.js';

export interface WalletLink {
  taxi_user_id: string;
  status: 'linked' | 'unlinked';
  refresh_token: string | null;
  access_token: string | null;
  access_exp: number | null;
  scope: string | null;
  updated_at: number;
}

export interface Ride {
  id: string;
  taxi_user_id: string;
  amount_cents: number;
  status: 'pending' | 'charged' | 'failed';
  created_at: number;
  charged_at: number | null;
}

export class TaxiStore {
  constructor(readonly db: Db) {}

  users(): { id: string; display_name: string }[] {
    return this.db.prepare('SELECT id, display_name FROM taxi_users ORDER BY id').all() as {
      id: string;
      display_name: string;
    }[];
  }

  getLink(userId: string): WalletLink | undefined {
    return this.db.prepare('SELECT * FROM wallet_links WHERE taxi_user_id = ?').get(userId) as
      | WalletLink
      | undefined;
  }

  linkedUserIds(): string[] {
    return (
      this.db.prepare("SELECT taxi_user_id FROM wallet_links WHERE status = 'linked' ORDER BY taxi_user_id").all() as {
        taxi_user_id: string;
      }[]
    ).map((r) => r.taxi_user_id);
  }

  /** Server-side token store: the refresh token never leaves this process. */
  saveTokens(
    userId: string,
    t: { refresh_token?: string; access_token: string; access_exp: number; scope?: string },
  ): void {
    const existing = this.getLink(userId);
    this.db
      .prepare(
        `INSERT INTO wallet_links (taxi_user_id, status, refresh_token, access_token, access_exp, scope, updated_at)
         VALUES (@id, 'linked', @refresh, @access, @exp, @scope, @now)
         ON CONFLICT(taxi_user_id) DO UPDATE SET
           status = 'linked', refresh_token = @refresh, access_token = @access,
           access_exp = @exp, scope = @scope, updated_at = @now`,
      )
      .run({
        id: userId,
        refresh: t.refresh_token ?? existing?.refresh_token ?? null,
        access: t.access_token,
        exp: t.access_exp,
        scope: t.scope ?? existing?.scope ?? null,
        now: nowSec(),
      });
  }

  markUnlinked(userId: string): void {
    this.db
      .prepare(
        `UPDATE wallet_links SET status = 'unlinked', refresh_token = NULL, access_token = NULL,
         access_exp = NULL, updated_at = ? WHERE taxi_user_id = ?`,
      )
      .run(nowSec(), userId);
  }

  expireAccessTokens(): void {
    this.db.prepare("UPDATE wallet_links SET access_exp = ? WHERE status = 'linked'").run(nowSec() - 1);
  }

  pendingRides(userId: string): Ride[] {
    return this.db
      .prepare("SELECT * FROM rides WHERE taxi_user_id = ? AND status = 'pending' ORDER BY created_at, id")
      .all(userId) as Ride[];
  }

  rides(userId: string): Ride[] {
    return this.db.prepare('SELECT * FROM rides WHERE taxi_user_id = ? ORDER BY created_at DESC, id DESC').all(userId) as Ride[];
  }

  createRide(userId: string, amountCents: number): Ride {
    const id = `ride-${Date.now()}`;
    this.db
      .prepare("INSERT INTO rides (id, taxi_user_id, amount_cents, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(id, userId, amountCents, nowSec());
    return this.db.prepare('SELECT * FROM rides WHERE id = ?').get(id) as Ride;
  }

  markRide(id: string, status: 'charged' | 'failed'): void {
    this.db
      .prepare('UPDATE rides SET status = ?, charged_at = ? WHERE id = ?')
      .run(status, status === 'charged' ? nowSec() : null, id);
  }
}
