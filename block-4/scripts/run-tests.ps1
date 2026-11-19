$ErrorActionPreference = 'Stop'

# Runs the complete integration suite in the same order used in the demo.
# Every individual script asserts its own acceptance criteria and writes
# evidence under evidence/<case>/.
$suiteDirectory = 'evidence/TEST-SUITE'
New-Item -ItemType Directory -Force -Path $suiteDirectory | Out-Null

$cases = @(
  @{ Name = 'B0'; Script = 'tests/automated/B0/run.ps1'; Evidence = 'evidence/B0' },
  @{ Name = 'H0'; Script = 'tests/automated/H0/run.ps1'; Evidence = 'evidence/H0' },
  @{ Name = 'D4'; Script = 'tests/automated/D4/run.ps1'; Evidence = 'evidence/D4' },
  @{ Name = 'H1'; Script = 'tests/demo/H1/run.ps1'; Evidence = 'evidence/H1' },
  @{ Name = 'F7'; Script = 'tests/automated/F7/run.ps1'; Evidence = 'evidence/F7' },
  @{ Name = 'F2'; Script = 'tests/automated/F2/run.ps1'; Evidence = 'evidence/F2' },
  @{ Name = 'F3'; Script = 'tests/automated/F3/run.ps1'; Evidence = 'evidence/F3' },
  @{ Name = 'F4'; Script = 'tests/automated/F4/run.ps1'; Evidence = 'evidence/F4' },
  @{ Name = 'F1'; Script = 'tests/demo/F1/run.ps1'; Evidence = 'evidence/F1' },
  @{ Name = 'F5'; Script = 'tests/demo/F5/run.ps1'; Evidence = 'evidence/F5' },
  @{ Name = 'F8'; Script = 'tests/demo/F8/run.ps1'; Evidence = 'evidence/F8' },
  @{ Name = 'F6'; Script = 'tests/demo/F6/run.ps1'; Evidence = 'evidence/F6' }
)

$records = @()
try {
  Invoke-RestMethod 'http://127.0.0.1:3000/health' | Out-Null
  Invoke-RestMethod 'http://127.0.0.1:3001/health' | Out-Null

  foreach ($case in $cases) {
    $started = Get-Date
    Write-Host "Running $($case.Name)"
    & $case.Script
    if ($LASTEXITCODE -ne 0) {
      throw "$($case.Name) exited with code $LASTEXITCODE"
    }
    $records += [pscustomobject]@{
      Case = $case.Name
      Result = 'PASS'
      DurationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
      Evidence = $case.Evidence
    }
  }
}
catch {
  $records += [pscustomobject]@{
    Case = if ($case) { $case.Name } else { 'preflight' }
    Result = 'FAIL'
    DurationSeconds = 0
    Evidence = if ($case) { $case.Evidence } else { '' }
  }
  $message = $_.Exception.Message
  $records | ConvertTo-Json | Set-Content -LiteralPath "$suiteDirectory/results.json" -Encoding utf8
  @('# Test suite FAILED', '', "- Error: $message") | Set-Content -LiteralPath "$suiteDirectory/summary.md" -Encoding utf8
  docker compose ps | Set-Content -LiteralPath "$suiteDirectory/containers.txt" -Encoding utf8
  throw
}

$records | ConvertTo-Json | Set-Content -LiteralPath "$suiteDirectory/results.json" -Encoding utf8
$lines = @(
  '# Phase 8 test suite'
  ''
  '- Result: PASS.'
  '- Each script checked its own acceptance assertions and wrote evidence.'
  ''
  '| Case | Result | Seconds | Evidence |'
  '| --- | --- | ---: | --- |'
)
foreach ($record in $records) {
  $lines += "| $($record.Case) | $($record.Result) | $($record.DurationSeconds) | $($record.Evidence) |"
}
$lines | Set-Content -LiteralPath "$suiteDirectory/summary.md" -Encoding utf8
docker compose ps | Set-Content -LiteralPath "$suiteDirectory/containers.txt" -Encoding utf8
Write-Host "All $($records.Count) integration cases passed. Evidence: $suiteDirectory"
