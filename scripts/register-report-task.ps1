# register-report-task.ps1
# Registers a daily Windows Task Scheduler job "spend-lens-report" that runs
# run-report.ps1 every day at 21:00 (local time): collector + daily PDF digest,
# monthly digest on the 1st, yearly digest on January 1st.
# Compatible with Windows PowerShell 5.1 (no &&, no ternary operators).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-report-task.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-report-task.ps1 -Time 22:15
#
# Remove the task later with:
#   schtasks /Delete /TN "spend-lens-report" /F

param(
    [string]$Time = "21:00"
)

$ErrorActionPreference = "Stop"

$taskName = "spend-lens-report"
$runScript = Join-Path $PSScriptRoot "run-report.ps1"

if (-not (Test-Path $runScript)) {
    Write-Error "run-report.ps1 not found next to this script: $runScript"
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
    Write-Host "Log after each run: collector\.cache\report-run.log"
    Write-Host "Verify with: schtasks /Query /TN $taskName /V /FO LIST"
}
else {
    Write-Error "schtasks failed with exit code $LASTEXITCODE (try an elevated prompt if access was denied)."
    exit $LASTEXITCODE
}
