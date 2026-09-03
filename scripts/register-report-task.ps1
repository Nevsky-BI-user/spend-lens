# register-report-task.ps1
# Registers a daily Windows Task Scheduler job "spend-lens-report" that runs
# run-report.ps1 every day at 08:00 (local time): collector + web build + daily
# PDF digest for the PREVIOUS Kyiv day, monthly digest on the 1st, yearly on Jan 1.
# Compatible with Windows PowerShell 5.1 (no &&, no ternary operators).
#
# Usage (a command the USER types — an explicit action, so a console here is fine):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-report-task.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-report-task.ps1 -Time 22:15
#
# Remove the task later with:
#   schtasks /Delete /TN "spend-lens-report" /F
#
# WHY NOT schtasks /Create (used until v1.12): schtasks without /RU /RP /NP creates
# the task with LogonType=InteractiveToken, i.e. it runs ONLY inside a session that
# has a desktop. Every firing therefore had a desktop, Task Scheduler started
# powershell.exe without SW_HIDE in STARTUPINFO, and -WindowStyle Hidden only hid
# the window AFTER conhost had created it — a visible flash at 08:00 every day, while the user is at the computer.
# Register-ScheduledTask with an S4U principal runs the task without an interactive
# logon (session 0, no desktop at all), so no window can be created in the first
# place. This is the fix for the one self-initiated terminal launch in the project.

param(
    [string]$Time = "08:00"
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

# -WindowStyle Hidden stays as the second line of defence for the fallback branch
# below; under S4U there is no window station to draw on anyway.
$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runScript + '"'

$action = New-ScheduledTaskAction -Execute $psExe -Argument $argument
$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# Умови запуску: дозволити на батареї, не спиняти при переході на батарею
# і наздогнати пропущений запуск (комп спав). Без цього Планувальник відмовляє
# з кодом 0x800710E0 на ноутбуці без мережі.
# MultipleInstances IgnoreNew задано явно: підвислий екземпляр не має накопичувати
# чергу, а ExecutionTimeLimit прибирає його через годину.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

$userId = "$env:USERDOMAIN\$env:USERNAME"
$registered = $false
$mode = ""

try {
    # S4U = "Run whether user is logged on or not" without storing a password.
    # The task then runs in a non-interactive session: no desktop, no window.
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
    $registered = $true
    $mode = "S4U - runs without an interactive logon; no desktop, so no window at all"
}
catch {
    Write-Warning ("S4U principal rejected (" + $_.Exception.Message + ").")
    Write-Warning "Fallback: interactive token. Window stays hidden by -WindowStyle Hidden,"
    Write-Warning "but a brief console flash is possible. To get the clean path, grant the"
    Write-Warning "account the 'Log on as a batch job' right and re-run this script."
}

if (-not $registered) {
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
    $mode = "Interactive - fallback; window hidden, but a brief flash is possible"
}

Write-Host ""
Write-Host "Task '$taskName' registered: daily at $Time."
Write-Host "Principal: $mode"
Write-Host "It runs: $runScript"
Write-Host "Log after each run: collector\.cache\report-run.log"
Write-Host "Verify with: schtasks /Query /TN $taskName /V /FO LIST"
