-- Wallet Authorization Server schema. All timestamps are epoch seconds.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL              -- argon2id
);

CREATE TABLE clients (
  client_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  secret_hash    TEXT NOT NULL,            -- argon2id
  redirect_uri   TEXT,                     -- exactly one registered URI (NULL: no browser flow)
  allowed_scopes TEXT NOT NULL,            -- space separated
  grant_types    TEXT NOT NULL             -- space separated
);

CREATE TABLE consents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  client_id  TEXT NOT NULL REFERENCES clients(client_id),
  scope      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_consents_pair ON consents(user_id, client_id);

CREATE TABLE auth_codes (
  code_hash      TEXT PRIMARY KEY,         -- SHA-256 of the code; plaintext is never stored
  client_id      TEXT NOT NULL REFERENCES clients(client_id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  redirect_uri   TEXT NOT NULL,
  scope          TEXT NOT NULL,
  code_challenge TEXT,
  expires_at     INTEGER NOT NULL,
  used_at        INTEGER,
  family_id      TEXT,                     -- refresh-token family issued from this code (for reuse revocation)
  created_at     INTEGER NOT NULL
);

CREATE TABLE refresh_tokens (
  token_hash  TEXT PRIMARY KEY,            -- SHA-256 of the token; plaintext is never stored
  family_id   TEXT NOT NULL,
  client_id   TEXT NOT NULL REFERENCES clients(client_id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  scope       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  replaced_by TEXT,                        -- token_hash of the successor; non-NULL means "already used"
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_pair ON refresh_tokens(user_id, client_id);
