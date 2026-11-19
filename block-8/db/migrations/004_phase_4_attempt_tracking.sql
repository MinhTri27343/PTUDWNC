ALTER TABLE processing_attempts
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER;
ALTER TABLE processing_attempts
  ADD COLUMN IF NOT EXISTS redelivered BOOLEAN NOT NULL DEFAULT FALSE;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY started_at, id) AS number
  FROM processing_attempts
)
UPDATE processing_attempts attempts
SET attempt_number = numbered.number
FROM numbered
WHERE attempts.id = numbered.id
  AND attempts.attempt_number IS NULL;

ALTER TABLE processing_attempts
  ALTER COLUMN attempt_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS processing_attempts_message_number_unique
  ON processing_attempts (message_id, attempt_number);
