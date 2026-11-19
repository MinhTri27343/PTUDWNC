-- V0 stores the optional request settings with each job.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb;
