$ErrorActionPreference = 'Stop'
$env:CRASH_CASE = 'F1'
python tests/demo/run_crash_case.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose exec -T postgres psql -U app -d video_summary --csv -c "SELECT c.message_id, c.marker, c.triggered_at, c.worker_name FROM crash_plans c JOIN jobs j ON j.message_id = c.message_id WHERE j.options ->> 'scenario' = 'F1' ORDER BY j.created_at DESC LIMIT 1;" | Set-Content -LiteralPath 'evidence/F1/crash-plan.csv' -Encoding utf8
docker compose ps | Set-Content -LiteralPath 'evidence/F1/containers.txt' -Encoding utf8
