CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY, name TEXT NOT NULL, balance INTEGER NOT NULL, initial INTEGER NOT NULL);
-- append-only: rows are only ever INSERTed
CREATE TABLE IF NOT EXISTS ledger (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('CHARGE','REFUND')),
  charge_id TEXT NOT NULL, refund_id TEXT, order_id TEXT NOT NULL,
  account_id TEXT NOT NULL, amount INTEGER NOT NULL, op_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_charge ON ledger(charge_id, type);
