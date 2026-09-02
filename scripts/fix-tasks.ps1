# fix-tasks.ps1
# Re-registers the two spend-lens scheduled tasks with the S4U principal.
#
# WHY THIS EXISTS: fixing the code does not fix a task that is already on the
# machine. Tasks created before v1.13 were made by schtasks /Create, i.e. with
# LogonType=InteractiveToken - they keep flashing a console at 20:00 and 08:00
# for as long as they stay registered, no matter what register-task.ps1 says
# today. This runs the corrected registration once so the live tasks move to a
# session with no desktop.
#
# It calls the two register scripts in-process with the & operator: no extra
# shell, no extra window, and their own S4U-with-fallback logic stays the single
# source of truth.
#
# Output:
#   collector\.cache\task-fix.log          - what happened
#   collector\.cache\task-fix-summary.txt  - one line per task, for the dialog
#
# Exit code: 0 = both tasks now run without a desktop, 1 = at least one did not.
#
# Windows PowerShell 5.1 compatible, ASCII only (see audit-tasks.ps1 header).

param(
    [string]$DailyTime = "20:00",
    [string]$ReportTime = "08:00"
)

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $repoRoot "collector\.cache"
if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}
$logPath = Join-Path $cacheDir "task-fix.log"
$summaryPath = Join-Path $cacheDir "task-fix-summary.txt"

# A principal without a desktop: no window station, so no window can be created.
$windowlessLogons = @("S4U", "Password", "ServiceAccount", "None")

$targets = @(
    [pscustomobject]@{ Name = "spend-lens-daily";  Script = "register-task.ps1";        Time = $DailyTime },
    [pscustomobject]@{ Name = "spend-lens-report"; Script = "register-report-task.ps1"; Time = $ReportTime }
)

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm")
$log = New-Object 'System.Collections.Generic.List[string]'
$summary = New-Object 'System.Collections.Generic.List[string]'
$log.Add("spend-lens task fix - " + $stamp)
$log.Add("")

$failed = 0
foreach ($target in $targets) {
    $scriptPath = Join-Path $PSScriptRoot $target.Script
    $log.Add("--- " + $target.Name + " (" + $target.Script + " -Time " + $target.Time + ") ---")

    if (-not (Test-Path $scriptPath)) {
        $log.Add("  register script missing: " + $scriptPath)
        $summary.Add($target.Name + ": FAILED - " + $target.Script + " is missing")
        $failed = $failed + 1
        continue
    }

    try {
        $output = & $scriptPath -Time $target.Time 2>&1
        foreach ($line in @($output)) { $log.Add("  " + [string]$line) }
    }
    catch {
        $log.Add("  registration threw: " + $_.Exception.Message)
    }

    $logon = ""
    try { $logon = [string](Get-ScheduledTask -TaskName $target.Name -ErrorAction Stop).Principal.LogonType }
    catch { $logon = "" }

    if ($logon -eq "") {
        $log.Add("  RESULT: task not found after registration")
        $summary.Add($target.Name + ": FAILED - not registered")
        $failed = $failed + 1
    }
    elseif ($windowlessLogons -contains $logon) {
        $log.Add("  RESULT: logon=" + $logon + " - runs without a desktop, no window possible")
        $summary.Add($target.Name + ": OK, logon=" + $logon + " (no desktop, no window)")
    }
    else {
        $log.Add("  RESULT: logon=" + $logon + " - still has a desktop, a brief flash stays possible")
        $log.Add("  Grant the account the 'Log on as a batch job' right and run this again.")
        $summary.Add($target.Name + ": PARTIAL, logon=" + $logon + " - flash still possible")
        $failed = $failed + 1
    }
    $log.Add("")
}

if ($failed -eq 0) {
    $summary.Add("")
    $summary.Add("Both tasks now run in a session with no desktop.")
}
$summary.Add("")
$summary.Add("Details: " + $logPath)

Set-Content -Path $logPath -Value $log -Encoding UTF8
Set-Content -Path $summaryPath -Value $summary -Encoding UTF8

if ($failed -gt 0) { exit 1 }
exit 0
