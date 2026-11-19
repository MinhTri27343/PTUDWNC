$ErrorActionPreference = 'Stop'
python tests/automated/F7/run.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$result = Get-Content 'evidence/F7/f7-result.json' -Raw | ConvertFrom-Json
$batch = $result.batch_id
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT j.id, j.version, j.status, a.worker_name, a.started_at, a.finished_at, s.content FROM jobs j JOIN processing_attempts a ON a.job_id = j.id JOIN summaries s ON s.job_id = j.id WHERE j.options ->> 'batch_id' = '$batch' ORDER BY j.version;" |
  Set-Content -LiteralPath 'evidence/F7/jobs-and-summaries.csv' -Encoding utf8
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath 'evidence/F7/queue-state.txt' -Encoding utf8
Write-Host "F7 passed for batch $batch."
