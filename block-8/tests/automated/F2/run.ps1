$ErrorActionPreference = 'Stop'
python tests/automated/F2/run.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath 'evidence/F2/queue-state.txt' -Encoding utf8
Write-Host 'F2 passed.'
