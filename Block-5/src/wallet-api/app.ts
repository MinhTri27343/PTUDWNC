import express, { type Express } from 'express';
import type { Db } from '../db.js';
import { config } from '../config.js';
import { mountDocs } from '../docs.js';
import { log } from '../util.js';
import { requireAuth } from './verify.js';

interface ChargeResult {
  charge_id: number;
  amount_cents: number;
  balance_cents: number;
  idempotency_key: string;
}

export function createApiApp(db: Db): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  mountDocs(app, 'wallet-api.yaml', config.apiUrl);

  app.get('/wallet/balance', requireAuth({ scope: 'wallet:read' }), (req, res) => {
    const wallet = db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(req.auth!.sub) as
      | { balance_cents: number }
      | undefined;
    if (!wallet) {
      res.status(404).json({ error: 'wallet_not_found' });
      return;
    }
    res.json({ user: req.auth!.sub, balance_cents: wallet.balance_cents, currency: 'VND' });
  });

  const charge = db.transaction(
    (userId: string, clientId: string, amount: number, key: string): { replay: boolean; result?: ChargeResult; error?: string } => {
      const seen = db.prepare('SELECT response_json FROM idempotency_keys WHERE key = ?').get(key) as
        | { response_json: string }
        | undefined;
      if (seen) return { replay: true, result: JSON.parse(seen.response_json) as ChargeResult };

      const wallet = db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(userId) as
        | { balance_cents: number }
        | undefined;
      if (!wallet) return { replay: false, error: 'wallet_not_found' };
      if (wallet.balance_cents < amount) return { replay: false, error: 'insufficient_funds' };

      const now = new Date().toISOString();
      db.prepare('UPDATE wallets SET balance_cents = balance_cents - ? WHERE user_id = ?').run(amount, userId);
      const info = db
        .prepare(
          'INSERT INTO charges (user_id, client_id, amount_cents, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, clientId, amount, key, now);
      db.prepare('UPDATE charge_counter SET count = count + 1 WHERE id = 1').run();

      const result: ChargeResult = {
        charge_id: Number(info.lastInsertRowid),
        amount_cents: amount,
        balance_cents: wallet.balance_cents - amount,
        idempotency_key: key,
      };
      db.prepare('INSERT INTO idempotency_keys (key, user_id, response_json, created_at) VALUES (?, ?, ?, ?)').run(
        key,
        userId,
        JSON.stringify(result),
        now,
      );
      return { replay: false, result };
    },
  );

  app.post(
    '/wallet/charges',
    requireAuth({ scope: 'wallet:charge', principalType: 'user' }),
    (req, res) => {
      const key = req.get('idempotency-key');
      const amount = Number(req.body?.amount_cents);
      if (!key) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Idempotency-Key header is required' });
        return;
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ error: 'invalid_request', error_description: 'amount_cents must be a positive integer' });
        return;
      }

      const outcome = charge(req.auth!.sub, req.auth!.clientId, amount, key);
      if (outcome.error) {
        res.status(outcome.error === 'wallet_not_found' ? 404 : 422).json({ error: outcome.error });
        return;
      }
      log('wallet-api', outcome.replay ? 'charge_replayed' : 'charge_applied', {
        user: req.auth!.sub,
        client: req.auth!.clientId,
        key,
        amount,
      });
      res.status(outcome.replay ? 200 : 201).set('Idempotent-Replayed', String(outcome.replay)).json(outcome.result);
    },
  );

  app.get('/public/rates', requireAuth({ scope: 'rates:read' }), (_req, res) => {
    res.json({ currency: 'VND', base_fare_cents: 1200, per_km_cents: 800 });
  });

  // Lab-only evidence endpoint (no auth): how many charges were really applied.
  app.get('/debug/counter', (_req, res) => {
    const row = db.prepare('SELECT count FROM charge_counter WHERE id = 1').get() as { count: number };
    res.json({ charge_counter: row.count });
  });

  return app;
}
