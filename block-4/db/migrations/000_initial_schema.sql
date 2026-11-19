CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  source_path TEXT,
  has_audio BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  version INTEGER NOT NULL,
  message_id TEXT UNIQUE,
  correlation_id TEXT,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'DONE', 'DEAD_LETTERED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id, version)
);

CREATE TABLE IF NOT EXISTS summaries (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processing_attempts (
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT NOT NULL,
  job_id TEXT,
  attempt_number INTEGER NOT NULL,
  replay_number INTEGER NOT NULL DEFAULT 0,
  worker_name TEXT,
  redelivered BOOLEAN NOT NULL DEFAULT FALSE,
  result TEXT CHECK (result IN ('SUCCEEDED', 'TRANSIENT_ERROR', 'PERMANENT_ERROR', 'DUPLICATE', 'CRASHED')),
  error_type TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

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

CREATE TABLE IF NOT EXISTS crash_plans (
  message_id TEXT PRIMARY KEY,
  marker TEXT NOT NULL CHECK (marker IN ('before_llm_call', 'after_llm_before_commit', 'after_commit_before_ack')),
  triggered_at TIMESTAMPTZ,
  worker_name TEXT
);

