$ErrorActionPreference = 'Stop'

$demoCases = @(
  'tests/demo/H1/run.ps1',
  'tests/demo/F1/run.ps1',
  'tests/demo/F5/run.ps1',
  'tests/demo/F8/run.ps1',
  'tests/demo/F6/run.ps1'
)

foreach ($scriptPath in $demoCases) {
  Write-Host "Running demo: $scriptPath"
  & $scriptPath
  if ($LASTEXITCODE -ne 0) {
    throw "Demo failed: $scriptPath"
  }
}

Write-Host 'Demo cases completed. See evidence/H1, evidence/F1, evidence/F5, evidence/F8 and evidence/F6.'
