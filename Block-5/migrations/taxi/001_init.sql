-- Taxi (OAuth client) schema. Wallet tokens live here, server side only.

CREATE TABLE taxi_users (
  id           TEXT PRIMARY KEY,           -- Taxi's own account id
  display_name TEXT NOT NULL
);

CREATE TABLE wallet_links (
  taxi_user_id  TEXT PRIMARY KEY REFERENCES taxi_users(id),
  status        TEXT NOT NULL CHECK (status IN ('linked', 'unlinked')),
  refresh_token TEXT,
  access_token  TEXT,
  access_exp    INTEGER,                   -- epoch seconds
  scope         TEXT,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE rides (
  id           TEXT PRIMARY KEY,
  taxi_user_id TEXT NOT NULL REFERENCES taxi_users(id),
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'charged', 'failed')),
  created_at   INTEGER NOT NULL,
  charged_at   INTEGER
);
