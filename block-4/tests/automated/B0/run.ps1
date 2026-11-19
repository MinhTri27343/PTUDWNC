$ErrorActionPreference = 'Stop'

python tests/automated/B0/run.py
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

New-Item -ItemType Directory -Force -Path 'evidence/B0' | Out-Null
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT j.id AS job_id, j.video_id, j.version, j.status, s.id AS summary_id, s.content FROM jobs j LEFT JOIN summaries s ON s.job_id = j.id WHERE j.options ->> 'baseline' = 'B0' ORDER BY j.created_at;" |
  Set-Content -LiteralPath 'evidence/B0/database-snapshot.csv' -Encoding utf8

Write-Host 'Đã tạo evidence/B0/response-times.csv, summary.md, mock-llm-calls.json và database-snapshot.csv.'
