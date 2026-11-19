$ErrorActionPreference = 'Stop'
python tests/automated/F4/run.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath 'evidence/F4/queue-state.txt' -Encoding utf8
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT message_id, job_id, error_type, attempt_count, replay_count, active, replayed_at FROM dead_letters WHERE job_id = (SELECT id FROM jobs WHERE options ->> 'scenario' = 'F4' ORDER BY created_at DESC LIMIT 1);" |
  Set-Content -LiteralPath 'evidence/F4/dead-letter-after-replay.csv' -Encoding utf8
Write-Host 'F4 passed.'
