CREATE TABLE IF NOT EXISTS items (
  item_id   TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  price     INTEGER NOT NULL,
  available INTEGER NOT NULL,
  initial   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL,
  item_id        TEXT NOT NULL,
  quantity       INTEGER NOT NULL,
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED')),
  reserve_op_id  TEXT NOT NULL,
  release_op_id  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS movements (
  movement_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL,
  reservation_id  TEXT NOT NULL,
  op_id           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('RESERVE','RELEASE')),
  item_id         TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  available_after INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
