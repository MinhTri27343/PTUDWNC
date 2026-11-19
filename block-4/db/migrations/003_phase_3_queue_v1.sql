ALTER TABLE jobs ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS correlation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_message_id_unique
  ON jobs (message_id)
  WHERE message_id IS NOT NULL;
