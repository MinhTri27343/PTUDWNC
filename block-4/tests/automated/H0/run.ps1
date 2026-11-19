$ErrorActionPreference = 'Stop'

python tests/automated/H0/run.py
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

New-Item -ItemType Directory -Force -Path 'evidence/H0' | Out-Null
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath 'evidence/H0/queue-state.txt' -Encoding utf8
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT j.id AS job_id, j.message_id, j.status, s.content FROM jobs j LEFT JOIN summaries s ON s.job_id = j.id WHERE j.options ->> 'scenario' = 'H0' ORDER BY j.created_at DESC LIMIT 1;" |
  Set-Content -LiteralPath 'evidence/H0/database-snapshot.csv' -Encoding utf8

Write-Host 'Đã tạo evidence/H0/h0-result.json, queue-state.txt và database-snapshot.csv.'
