CREATE UNIQUE INDEX IF NOT EXISTS jobs_video_version_unique
  ON jobs (video_id, version);

CREATE INDEX IF NOT EXISTS jobs_current_summary_lookup
  ON jobs (video_id, version DESC)
  WHERE status = 'DONE';
