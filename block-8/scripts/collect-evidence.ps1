$ErrorActionPreference = 'Stop'

$output = 'evidence/TEST-SUITE'
New-Item -ItemType Directory -Force -Path $output | Out-Null
docker compose ps | Set-Content -LiteralPath "$output/containers.txt" -Encoding utf8
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath "$output/queue-state.txt" -Encoding utf8

@(
  '# Evidence collection'
  ''
  '- containers.txt: final Docker Compose state.'
  '- queue-state.txt: RabbitMQ queue depth after the selected test/demo run.'
  '- Per-case evidence is stored in evidence/B0, evidence/H0, evidence/H1, evidence/F1 through evidence/F8 and evidence/D4.'
) | Set-Content -LiteralPath "$output/collection.md" -Encoding utf8

Write-Host "Collected final state in $output."
