$ErrorActionPreference = 'Stop'

function Invoke-JsonApi($Uri, $Method = 'GET', $Body = $null) {
  if ($null -eq $Body) {
    return Invoke-RestMethod -Uri $Uri -Method $Method
  }
  return Invoke-RestMethod -Uri $Uri -Method $Method -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 8 -Compress)
}

function Get-EnvValue($Name, $Fallback) {
  $line = Get-Content '.env' | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if ($line) { return ($line -split '=', 2)[1] }
  return $Fallback
}

$api = 'http://127.0.0.1:3000'
$mock = 'http://127.0.0.1:3001'
$evidencePath = 'evidence/D4'
New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null

Invoke-JsonApi "$mock/reset" 'POST' @{} | Out-Null
Invoke-JsonApi "$mock/config" 'POST' @{ default_delay_ms = 50 } | Out-Null

$queued = Invoke-JsonApi "$api/summaries" 'POST' @{ video_id = 'V7'; options = @{ scenario = 'D4' } }
$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 100
  $job = Invoke-JsonApi "$api$($queued.status_url)"
} while ($job.status -ne 'DONE' -and (Get-Date) -lt $deadline)
if ($job.status -ne 'DONE') { throw 'Job did not finish.' }

$attemptsBefore = Invoke-JsonApi "$api/summaries/$($queued.job_id)/attempts"
if ($attemptsBefore.attempts.Count -ne 1 -or $attemptsBefore.attempts[0].result -ne 'SUCCEEDED') {
  throw 'The initial attempt is not SUCCEEDED.'
}

$user = Get-EnvValue 'RABBITMQ_USER' 'app'
$password = Get-EnvValue 'RABBITMQ_PASSWORD' 'app_password'
$token = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${password}"))
$headers = @{ Authorization = "Basic $token" }
$message = @{
  message_id = $job.message_id
  correlation_id = $job.correlation_id
  job_id = $job.job_id
  video_id = $job.video_id
  version = $job.version
  created_at = [DateTime]::UtcNow.ToString('o')
  options = @{ scenario = 'D4' }
}
$publishBody = @{
  properties = @{ content_type = 'application/json'; delivery_mode = 2; message_id = $job.message_id; correlation_id = $job.correlation_id }
  routing_key = 'summaries'
  payload = ($message | ConvertTo-Json -Depth 8 -Compress)
  payload_encoding = 'string'
}
$published = Invoke-RestMethod -Uri 'http://127.0.0.1:15672/api/exchanges/%2f/amq.default/publish' -Method Post -Headers $headers -ContentType 'application/json' -Body ($publishBody | ConvertTo-Json -Depth 8 -Compress)
if (-not $published.routed) { throw 'RabbitMQ did not route the duplicate message.' }

do {
  Start-Sleep -Milliseconds 100
  $attemptsAfter = Invoke-JsonApi "$api/summaries/$($queued.job_id)/attempts"
} while ($attemptsAfter.attempts.Count -lt 2 -and (Get-Date) -lt $deadline)

$mockCalls = Invoke-JsonApi "$mock/calls/$($queued.job_id)"
if ($attemptsAfter.attempts.Count -ne 2 -or $attemptsAfter.attempts[1].result -ne 'DUPLICATE') {
  throw 'The replayed message was not recorded as DUPLICATE.'
}
if ($mockCalls.count -ne 1) { throw 'Mock LLM was called more than once.' }

$summaryCount = docker compose exec -T postgres psql -U app -d video_summary -tA -c "SELECT COUNT(*) FROM summaries WHERE job_id = '$($queued.job_id)';"
if ([int]$summaryCount -ne 1) { throw 'Expected exactly one summary for the job.' }

$result = @{
  queued_response = $queued
  job = $job
  attempts_before = $attemptsBefore
  attempts_after = $attemptsAfter
  mock_llm_calls = $mockCalls
  broker_publish = $published
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$evidencePath/d4-result.json" -Encoding utf8

docker compose exec -T rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged |
  Set-Content -LiteralPath "$evidencePath/queue-state.txt" -Encoding utf8
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT j.id AS job_id, j.message_id, j.status, COUNT(s.id) AS summary_count FROM jobs j LEFT JOIN summaries s ON s.job_id = j.id WHERE j.id = '$($queued.job_id)' GROUP BY j.id, j.message_id, j.status;" |
  Set-Content -LiteralPath "$evidencePath/database-snapshot.csv" -Encoding utf8

Write-Host 'D4 passed: one SUCCEEDED attempt, one DUPLICATE attempt, and one Mock LLM call.'
