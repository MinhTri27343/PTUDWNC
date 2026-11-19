$ErrorActionPreference = 'Stop'
python tests/demo/H1/run.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$result = Get-Content 'evidence/H1/h1-result.json' -Raw | ConvertFrom-Json
$batch = $result.batch_id
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT j.id, j.version, j.status, a.worker_name, a.result FROM jobs j JOIN processing_attempts a ON a.job_id = j.id WHERE j.options ->> 'batch_id' = '$batch' ORDER BY j.version;" |
  Set-Content -LiteralPath 'evidence/H1/jobs-and-attempts.csv' -Encoding utf8
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath 'evidence/H1/queue-state.txt' -Encoding utf8
Write-Host "H1 passed for batch $batch."
