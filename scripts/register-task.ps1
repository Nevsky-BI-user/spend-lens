# register-task.ps1
# Registers a daily Windows Task Scheduler job "spend-lens-daily" that runs
# run-collector.ps1 every day at 20:00 (local time).
# Compatible with Windows PowerShell 5.1 (no &&, no ternary operators).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-task.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Time 21:30
#
# Remove the task later with:
#   schtasks /Delete /TN "spend-lens-daily" /F

param(
    [string]$Time = "20:00"
)

$ErrorActionPreference = "Stop"

$taskName = "spend-lens-daily"
$runScript = Join-Path $PSScriptRoot "run-collector.ps1"

if (-not (Test-Path $runScript)) {
    Write-Error "run-collector.ps1 not found next to this script: $runScript"
    exit 1
}

# Absolute path to Windows PowerShell 5.1.
$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $psExe)) {
    Write-Error "powershell.exe not found: $psExe"
    exit 1
}

# Inner quotes must be backslash-escaped so schtasks receives them intact
# when the string passes through PowerShell 5.1 native-command quoting.
$taskRun = '\"' + $psExe + '\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $runScript + '\"'

schtasks /Create /F /TN $taskName /SC DAILY /ST $Time /TR $taskRun

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Task '$taskName' registered: daily at $Time."
    Write-Host "It runs: $runScript"
    Write-Host "Log after each run: collector\.cache\last-run.log"
    Write-Host "Verify with: schtasks /Query /TN $taskName /V /FO LIST"
}
else {
    Write-Error "schtasks failed with exit code $LASTEXITCODE (try an elevated prompt if access was denied)."
    exit $LASTEXITCODE
}
