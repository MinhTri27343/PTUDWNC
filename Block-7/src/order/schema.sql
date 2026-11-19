-- Order service DB (data/order.db). Order owns the Saga record: it is the orchestrator's durable memory.
-- Executed on every start, so everything is IF NOT EXISTS. `operations` (confirm/cancel ops) comes from ensureOpsTable().

CREATE TABLE IF NOT EXISTS orders (
  order_id     TEXT PRIMARY KEY,                 -- O-xxxxxx
  saga_id      TEXT NOT NULL UNIQUE,             -- S-xxxxxx
  create_op_id TEXT NOT NULL UNIQUE,             -- Idempotency-Key: same key -> same order
  account_id   TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  amount       INTEGER,                          -- known after reserve (from Inventory's price)
  status       TEXT NOT NULL,                    -- always == sagas.phase
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sagas (
  saga_id        TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL UNIQUE REFERENCES orders(order_id),
  phase          TEXT NOT NULL CHECK (phase IN
                   ('PENDING','RESERVED','CHARGED','RECOVERING','COMPENSATING','CONFIRMED','CANCELLED')),
  intent         TEXT,                           -- JSON {step, op_id, request, at}: written BEFORE calling a provider
  pending        TEXT NOT NULL DEFAULT '[]',     -- JSON compensation steps still owed, in order: ["refund","release"]
  reservation_id TEXT,
  charge_id      TEXT,
  refund_id      TEXT,
  released_at    TEXT,                           -- set when release SUCCEEDED (guard: no unreleased reservation)
  amount         INTEGER,
  last_error     TEXT,
  op_ids         TEXT NOT NULL,                  -- JSON {create,reserve,charge,confirm,refund,release,cancel}: minted ONCE
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saga_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  saga_id TEXT NOT NULL,
  at      TEXT NOT NULL,
  phase   TEXT,
  kind    TEXT NOT NULL,                         -- INTENT | OUTCOME | STATE | RESUME | QUERY | ERROR | MARKER
  step    TEXT,
  op_id   TEXT,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS ix_saga_events_saga ON saga_events (saga_id, id);
CREATE INDEX IF NOT EXISTS ix_sagas_phase ON sagas (phase);
