# fix-tasks.ps1
# Moves the scheduled tasks that flash a console window onto a principal that
# has no desktop, so no window can be drawn for them at all.
#
# WHY THIS EXISTS: fixing the code does not fix a task that is already on the
# machine. A task created by schtasks /Create (or by any tool that did not ask
# for S4U) carries LogonType=InteractiveToken - it keeps flashing a console for
# as long as it stays registered, no matter what register-task.ps1 says today.
#
# Two passes:
#   1. spend-lens-daily / spend-lens-report - re-registered by running the two
#      register scripts in-process with the & operator: no extra shell, no extra
#      window, and their own S4U-with-fallback logic stays the single source of
#      truth.
#   2. every other task whose name matches -Name (default "claude-*") - repaired
#      in place with Set-ScheduledTask: only the principal changes, the action,
#      the triggers and the schedule are left exactly as they are.
#
# Pass 2 is deliberately narrow. It never touches a task that belongs to another
# account or to a vendor (OneDrive, Zoom, an updater): renaming somebody else's
# task into a session with no desktop can break it, and that is the owner's
# decision. Widen it explicitly when you mean to:
#   powershell -File fix-tasks.ps1 -Name "claude-*","my-own-task"
#
# Output:
#   collector\.cache\task-fix.log          - what happened
#   collector\.cache\task-fix-summary.txt  - one line per task, for the dialog
#
# Exit code: 0 = every task handled now runs without a desktop, 1 = at least one
# did not (and the summary says which, and why).
#
# Windows PowerShell 5.1 compatible, ASCII only (see audit-tasks.ps1 header).

param(
    [string]$DailyTime = "20:00",
    [string]$ReportTime = "08:00",
    [string[]]$Name = @("claude-*"),
    [switch]$SkipSpendLens
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

# Kept in step with audit-tasks.ps1: hosts that own a console window whenever
# Windows starts them in a session that has a desktop.
$consoleHosts = @(
    "powershell.exe", "pwsh.exe", "cmd.exe", "cscript.exe", "wt.exe",
    "node.exe", "python.exe", "py.exe", "java.exe", "ruby.exe", "perl.exe",
    "bash.exe", "sh.exe", "wsl.exe", "git.exe", "curl.exe", "robocopy.exe"
)

function Get-Leaf {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $clean = $Path.Trim().Trim('"')
    try { return ([System.IO.Path]::GetFileName($clean)).ToLowerInvariant() }
    catch { return $clean.ToLowerInvariant() }
}

function Test-ConsoleAction {
    param($Task)
    foreach ($action in @($Task.Actions)) {
        if ($consoleHosts -contains (Get-Leaf $action.Execute)) { return $true }
    }
    return $false
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm")
$log = New-Object 'System.Collections.Generic.List[string]'
$summary = New-Object 'System.Collections.Generic.List[string]'
$log.Add("spend-lens task fix - " + $stamp)
$log.Add("")

$failed = 0
$handled = 0

# ---------------------------------------------------------------- pass 1 -----
# spend-lens's own tasks: re-run the corrected registration.

if (-not $SkipSpendLens) {
    $targets = @(
        [pscustomobject]@{ Name = "spend-lens-daily";  Script = "register-task.ps1";        Time = $DailyTime },
        [pscustomobject]@{ Name = "spend-lens-report"; Script = "register-report-task.ps1"; Time = $ReportTime }
    )

    foreach ($target in $targets) {
        $scriptPath = Join-Path $PSScriptRoot $target.Script
        $log.Add("--- " + $target.Name + " (" + $target.Script + " -Time " + $target.Time + ") ---")
        $handled = $handled + 1

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
}

# ---------------------------------------------------------------- pass 2 -----
# Anything else that matches -Name: swap the principal, keep the task.

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$patterns = @($Name | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

$matched = @()
if ($patterns.Count -gt 0) {
    try {
        $all = @(Get-ScheduledTask -ErrorAction Stop)
    }
    catch {
        $all = @()
        $log.Add("Could not enumerate scheduled tasks: " + $_.Exception.Message)
        $log.Add("")
    }
    foreach ($task in $all) {
        if ($task.TaskName -eq "spend-lens-daily" -or $task.TaskName -eq "spend-lens-report") { continue }
        foreach ($pattern in $patterns) {
            if ($task.TaskName -like $pattern) { $matched += $task; break }
        }
    }
}

$log.Add("--- name patterns: " + ($patterns -join ", ") + " (" + $matched.Count + " task(s) matched) ---")

foreach ($task in $matched) {
    $full = [string]$task.TaskPath + [string]$task.TaskName
    $logon = [string]$task.Principal.LogonType
    $state = [string]$task.State
    $owner = [string]$task.Principal.UserId
    $runLevel = [string]$task.Principal.RunLevel
    if ([string]::IsNullOrWhiteSpace($runLevel)) { $runLevel = "Limited" }

    $log.Add("  " + $full)
    foreach ($action in @($task.Actions)) {
        if ($action.Execute) { $log.Add("      action: " + $action.Execute + " " + $action.Arguments) }
    }
    $log.Add("      state=" + $state + "  logon=" + $logon + "  user=" + $owner + "  runlevel=" + $runLevel)

    if ($windowlessLogons -contains $logon) {
        $log.Add("      SKIP: already runs without a desktop")
        $summary.Add($task.TaskName + ": already OK, logon=" + $logon)
        continue
    }
    if ($state -eq "Disabled") {
        $log.Add("      SKIP: disabled, it cannot start at all")
        $summary.Add($task.TaskName + ": disabled, left as is")
        continue
    }
    if (-not (Test-ConsoleAction $task)) {
        $log.Add("      SKIP: no console-host action, this one does not flash")
        continue
    }
    if ($owner -and $owner -ne $currentUser -and $owner -ne $env:USERNAME) {
        $log.Add("      SKIP: belongs to " + $owner + ", not to " + $currentUser)
        $summary.Add($task.TaskName + ": SKIPPED - owned by " + $owner)
        continue
    }

    $handled = $handled + 1
    try {
        $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel $runLevel
        Set-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName -Principal $principal -ErrorAction Stop | Out-Null
    }
    catch {
        $log.Add("      FAILED: " + $_.Exception.Message)
        $summary.Add($task.TaskName + ": FAILED - " + $_.Exception.Message)
        $failed = $failed + 1
        continue
    }

    $after = ""
    try { $after = [string](Get-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName -ErrorAction Stop).Principal.LogonType }
    catch { $after = "" }

    if ($windowlessLogons -contains $after) {
        $log.Add("      RESULT: logon=" + $after + " - no desktop, no window possible")
        $summary.Add($task.TaskName + ": OK, logon=" + $after + " (no desktop, no window)")
    }
    else {
        $log.Add("      RESULT: logon=" + $after + " - still has a desktop")
        $log.Add("      Grant the account the 'Log on as a batch job' right and run this again.")
        $summary.Add($task.TaskName + ": PARTIAL, logon=" + $after + " - flash still possible")
        $failed = $failed + 1
    }
}
$log.Add("")

# ----------------------------------------------------------------- report ----

if ($handled -eq 0) {
    $summary.Add("Nothing to fix: no matching task can put a window on the screen.")
}
elseif ($failed -eq 0) {
    $summary.Add("")
    $summary.Add("All " + $handled + " task(s) now run in a session with no desktop.")
}
$summary.Add("")
$summary.Add("A task fixed here keeps its schedule and its action - only its logon changed.")
$summary.Add("Details: " + $logPath)

Set-Content -Path $logPath -Value $log -Encoding UTF8
Set-Content -Path $summaryPath -Value $summary -Encoding UTF8

if ($failed -gt 0) { exit 1 }
exit 0
