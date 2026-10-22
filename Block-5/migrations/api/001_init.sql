-- Wallet API schema.

CREATE TABLE wallets (
  user_id       TEXT PRIMARY KEY,          -- equals the access token `sub`
  balance_cents INTEGER NOT NULL
);

CREATE TABLE charges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL
);

-- Minimal idempotency store: key -> the response we already produced.
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Single-row counter of charges actually applied (evidence for "charged exactly once").
CREATE TABLE charge_counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  count INTEGER NOT NULL
);
INSERT INTO charge_counter (id, count) VALUES (1, 0);
