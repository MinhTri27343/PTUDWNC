$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:3000'
$mock = 'http://127.0.0.1:3001'
New-Item -ItemType Directory -Force -Path 'evidence/F6' | Out-Null
Invoke-RestMethod "$mock/reset" -Method Post -ContentType 'application/json' -Body '{}'
$job = Invoke-RestMethod "$api/summaries" -Method Post -ContentType 'application/json' -Body '{"video_id":"V1","options":{"scenario":"F6","mock_delay_ms":4000}}'
Start-Sleep -Milliseconds 500
$restartedAt = (Get-Date).ToString('o')
docker compose restart rabbitmq
Start-Sleep -Seconds 12
$final = Invoke-RestMethod "$api$($job.status_url)"
$attempts = Invoke-RestMethod "$api/summaries/$($job.job_id)/attempts"
$attemptResults = ($attempts.attempts | ForEach-Object { "attempt $($_.attempt_number): $($_.result), redelivered=$($_.redelivered)" }) -join '; '
@{ queued = $job; final = $final; attempts = $attempts } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'evidence/F6/result.json' -Encoding utf8
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged | Set-Content -LiteralPath 'evidence/F6/queue-state.txt' -Encoding utf8
if ($final.status -ne 'DONE') { throw 'F6 job did not finish after RabbitMQ restart.' }
@(
  '# F6 timeline'
  ''
  '- Job was queued with Mock LLM delay: 4000 ms.'
  "- RabbitMQ restart requested at: $restartedAt"
  '- The final job state is DONE after RabbitMQ becomes healthy again.'
  "- Processing attempts recorded: $($attempts.attempts.Count) ($attemptResults)."
) | Set-Content -LiteralPath 'evidence/F6/timeline.md' -Encoding utf8
Write-Host 'F6 passed.'
