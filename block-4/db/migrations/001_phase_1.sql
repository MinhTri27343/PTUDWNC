-- Phase 1 baseline. This migration is idempotent so it also upgrades
-- the database volume created during phase 0.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_path TEXT;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('QUEUED', 'DONE', 'DEAD_LETTERED'));

ALTER TABLE processing_attempts DROP CONSTRAINT IF EXISTS processing_attempts_result_check;
ALTER TABLE processing_attempts
  ADD CONSTRAINT processing_attempts_result_check
  CHECK (result IN ('SUCCEEDED', 'TRANSIENT_ERROR', 'PERMANENT_ERROR', 'DUPLICATE', 'CRASHED'));

INSERT INTO videos (id, source_path, has_audio)
VALUES
  ('V1', NULL, TRUE),
  ('V7', NULL, TRUE),
  ('V9', '/app/videos/V9.mp4', FALSE)
ON CONFLICT (id) DO UPDATE
SET source_path = EXCLUDED.source_path,
    has_audio = EXCLUDED.has_audio;
