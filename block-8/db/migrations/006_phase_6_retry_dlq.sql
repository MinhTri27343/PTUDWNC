ALTER TABLE processing_attempts
  ADD COLUMN IF NOT EXISTS replay_number INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS dead_letters (
  message_id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  payload JSONB NOT NULL,
  error_type TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMPTZ,
  replay_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS dead_letters_active_lookup
  ON dead_letters (message_id)
  WHERE active = TRUE;
