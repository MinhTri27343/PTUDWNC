CREATE TABLE IF NOT EXISTS crash_plans (
  message_id TEXT PRIMARY KEY,
  marker TEXT NOT NULL CHECK (marker IN ('before_llm_call', 'after_llm_before_commit', 'after_commit_before_ack')),
  triggered_at TIMESTAMPTZ,
  worker_name TEXT
);
