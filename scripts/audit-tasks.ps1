# audit-tasks.ps1
# spend-lens - read-only inventory of Windows scheduled tasks that can put a
# console window on the screen, plus every task that repeats more often than
# once an hour. It answers "what is opening a terminal every N minutes?"
# without opening one: run it through scripts\tasks.vbs and read the summary.
#
# READ ONLY. It registers nothing, deletes nothing, disables nothing. Naming a
# task is a different decision from removing it, and somebody else's scheduled
# task is not this script's call to make.
#
# Output:
#   collector\.cache\task-audit.log          - full inventory
#   collector\.cache\task-audit-summary.txt  - the suspects, one line each
#
# Exit code: 0 = no task can show a window, 1 = suspects found, 2 = failed.
#
# Windows PowerShell 5.1 compatible. ASCII only on purpose: PS 5.1 reads a .ps1
# without a BOM in the ANSI codepage, so Cyrillic here would be mojibake.

param(
    [string]$LogPath,
    [int]$FrequentMinutes = 60,
    [int]$HistoryHours = 3
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $repoRoot "collector\.cache"
if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}
if (-not $LogPath) { $LogPath = Join-Path $cacheDir "task-audit.log" }
$summaryPath = Join-Path $cacheDir "task-audit-summary.txt"

# Hosts that own a console window whenever Windows starts them in a session that
# has a desktop. wscript.exe is deliberately absent: it belongs to the GUI
# subsystem and is never given a console - that is exactly why the project's own
# on-demand entry point is a .vbs and not a .cmd.
$consoleHosts = @(
    "powershell.exe", "pwsh.exe", "cmd.exe", "cscript.exe", "wt.exe",
    "node.exe", "python.exe", "py.exe", "java.exe", "ruby.exe", "perl.exe",
    "bash.exe", "sh.exe", "wsl.exe", "git.exe", "curl.exe", "robocopy.exe"
)

# Principals that get a desktop. S4U / Password / ServiceAccount / None run in a
# session with no window station, so no window can be drawn there in the first
# place - that is the whole point of the S4U switch in register-task.ps1.
$desktopLogons = @("Interactive", "InteractiveOrPassword", "Group")

function Get-Leaf {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $clean = $Path.Trim().Trim('"')
    try { return ([System.IO.Path]::GetFileName($clean)).ToLowerInvariant() }
    catch { return $clean.ToLowerInvariant() }
}

function Get-RepeatMinutes {
    param($Trigger)
    $repetition = $null
    try { $repetition = $Trigger.Repetition } catch { return $null }
    if ($null -eq $repetition) { return $null }
    $interval = $repetition.Interval
    if ([string]::IsNullOrWhiteSpace($interval)) { return $null }
    # Task Scheduler stores the interval as an ISO-8601 duration ("PT5M").
    try { return [System.Xml.XmlConvert]::ToTimeSpan($interval).TotalMinutes }
    catch { return $null }
}

function Format-Repeat {
    param($Minutes)
    if ($null -eq $Minutes) { return "no repeat" }
    if ($Minutes -lt 60) { return ("every " + [int]$Minutes + " min") }
    if ($Minutes -lt 1440) { return ("every " + [math]::Round($Minutes / 60, 1) + " h") }
    return ("every " + [math]::Round($Minutes / 1440, 1) + " d")
}

$tasks = @()
try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop)
}
catch {
    $failure = "audit-tasks: Get-ScheduledTask failed: " + $_.Exception.Message
    Set-Content -Path $LogPath -Value $failure -Encoding UTF8
    Set-Content -Path $summaryPath -Value $failure -Encoding UTF8
    exit 2
}

$rows = @()
foreach ($task in $tasks) {
    $repeat = $null
    $kinds = @()
    foreach ($trigger in @($task.Triggers)) {
        if ($null -eq $trigger) { continue }
        $kind = ""
        try { $kind = [string]$trigger.CimClass.CimClassName } catch { $kind = "" }
        if ($kind) { $kinds += ($kind -replace "^MSFT_Task", "" -replace "Trigger$", "") }
        $minutes = Get-RepeatMinutes $trigger
        if ($null -ne $minutes) {
            if ($null -eq $repeat -or $minutes -lt $repeat) { $repeat = $minutes }
        }
    }

    $execs = @()
    foreach ($action in @($task.Actions)) {
        if ($null -eq $action) { continue }
        $exe = ""
        try { $exe = [string]$action.Execute } catch { $exe = "" }
        if ($exe) { $execs += $exe }
    }
    $leaves = @($execs | ForEach-Object { Get-Leaf $_ } | Where-Object { $_ })

    $logon = ""
    try { $logon = [string]$task.Principal.LogonType } catch { $logon = "" }
    $state = ""
    try { $state = [string]$task.State } catch { $state = "" }

    $hasConsoleHost = $false
    foreach ($leaf in $leaves) {
        if ($consoleHosts -contains $leaf) { $hasConsoleHost = $true }
    }

    $rows += [pscustomobject]@{
        Path        = ([string]$task.TaskPath + [string]$task.TaskName)
        State       = $state
        Logon       = $logon
        Repeat      = $repeat
        Triggers    = (($kinds | Select-Object -Unique) -join ",")
        Exe         = ($leaves -join ",")
        Command     = ($execs | Select-Object -First 1)
        ShowsWindow = (($state -ne "Disabled") -and ($desktopLogons -contains $logon) -and $hasConsoleHost)
        Frequent    = (($null -ne $repeat) -and ($repeat -le $FrequentMinutes))
    }
}

$repeatKey = @{ Expression = { if ($null -eq $_.Repeat) { [double]::MaxValue } else { $_.Repeat } } }
$flashers = @($rows | Where-Object { $_.ShowsWindow } | Sort-Object $repeatKey, Path)
$quietButFrequent = @($rows | Where-Object { $_.Frequent -and -not $_.ShowsWindow } | Sort-Object $repeatKey, Path)

# What actually fired, from the Task Scheduler operational log. This is the part
# that answers "something flashed just now": the inventory above says what COULD
# show a window, the log says what DID run, when, and how often.
$fireNote = ""
$fires = @()
try {
    $events = @(Get-WinEvent -FilterHashtable @{
        LogName   = "Microsoft-Windows-TaskScheduler/Operational"
        Id        = @(129, 200)
        StartTime = (Get-Date).AddHours(-1 * $HistoryHours)
    } -ErrorAction Stop)

    $byTask = @{}
    foreach ($logEvent in $events) {
        $name = ""
        try { $name = [string]$logEvent.Properties[0].Value } catch { $name = "" }
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if (-not $byTask.ContainsKey($name)) { $byTask[$name] = @() }
        $byTask[$name] += $logEvent.TimeCreated
    }

    foreach ($name in $byTask.Keys) {
        $times = @($byTask[$name] | Sort-Object -Descending)
        $gap = $null
        if ($times.Count -gt 1) {
            $spanMinutes = ($times[0] - $times[$times.Count - 1]).TotalMinutes
            $gap = $spanMinutes / ($times.Count - 1)
        }
        $row = $rows | Where-Object { $_.Path -eq $name } | Select-Object -First 1
        $fires += [pscustomobject]@{
            Name        = $name
            Count       = $times.Count
            Last        = $times[0]
            GapMinutes  = $gap
            ShowsWindow = ($null -ne $row -and $row.ShowsWindow)
            Exe         = $(if ($null -ne $row) { $row.Exe } else { "" })
        }
    }
    $fires = @($fires | Sort-Object -Property @{ Expression = "Count"; Descending = $true }, Name)
}
catch {
    # An empty window, a disabled channel or a log the account may not read is
    # not a failure of the audit - the inventory above still stands.
    $reason = [string]$_.Exception.Message
    if ($reason -match "No events were found") {
        $fireNote = "No scheduled task fired in the last " + $HistoryHours + " h."
    }
    else {
        $fireNote = "Task Scheduler log unavailable (" + $reason + ")"
    }
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm")
$summary = New-Object 'System.Collections.Generic.List[string]'

$repeaters = @($fires | Where-Object { $_.Count -ge 3 -and $null -ne $_.GapMinutes -and $_.GapMinutes -le $FrequentMinutes })
if ($repeaters.Count -gt 0) {
    $summary.Add("Fired repeatedly in the last " + $HistoryHours + " h:")
    foreach ($fire in ($repeaters | Select-Object -First 8)) {
        $mark = ""
        if ($fire.ShowsWindow) { $mark = "  <- SHOWS A WINDOW" }
        $summary.Add("  ~every " + [int]$fire.GapMinutes + " min (" + $fire.Count + "x, last " + $fire.Last.ToString("HH:mm:ss") + ") | " + $fire.Name + $mark)
    }
    $summary.Add("")
}
elseif ($fireNote -ne "") {
    $summary.Add($fireNote)
    $summary.Add("")
}

if ($flashers.Count -eq 0) {
    $summary.Add("Clean: none of the " + $rows.Count + " scheduled tasks can show a console window.")
}
else {
    $summary.Add("Tasks that DO put a console window on screen (" + $flashers.Count + " of " + $rows.Count + "):")
    foreach ($row in ($flashers | Select-Object -First 10)) {
        $summary.Add("  " + (Format-Repeat $row.Repeat) + " | " + $row.Path + " | " + $row.Exe + " | logon=" + $row.Logon)
    }
    if ($flashers.Count -gt 10) {
        $summary.Add("  ... " + ($flashers.Count - 10) + " more, see the log")
    }
}

if ($quietButFrequent.Count -gt 0) {
    $summary.Add("")
    $summary.Add("Frequent, but windowless (their session has no desktop):")
    foreach ($row in ($quietButFrequent | Select-Object -First 5)) {
        $summary.Add("  " + (Format-Repeat $row.Repeat) + " | " + $row.Path + " | " + $row.Exe + " | logon=" + $row.Logon)
    }
    if ($quietButFrequent.Count -gt 5) {
        $summary.Add("  ... " + ($quietButFrequent.Count - 5) + " more, see the log")
    }
}

$summary.Add("")
$summary.Add("Full inventory: " + $LogPath)

$report = New-Object 'System.Collections.Generic.List[string]'
$report.Add("spend-lens task audit - " + $stamp)
$report.Add("Host: " + $env:COMPUTERNAME + "   User: " + $env:USERNAME)
$frequentCount = @($rows | Where-Object { $_.Frequent }).Count
$report.Add("Tasks inspected: " + $rows.Count + "   window-capable: " + $flashers.Count + "   repeating <= " + $FrequentMinutes + " min: " + $frequentCount)
$report.Add("")
foreach ($line in $summary) { $report.Add($line) }
$report.Add("")
$report.Add("=== full inventory: WIN = shows a window, FREQ = repeats often ===")
$report.Add("")

if ($fires.Count -gt 0) {
    $report.Add("=== actually fired in the last " + $HistoryHours + " h (Task Scheduler log) ===")
    $report.Add("")
    foreach ($fire in $fires) {
        $cadence = "once"
        if ($null -ne $fire.GapMinutes) { $cadence = "~every " + [int]$fire.GapMinutes + " min" }
        $window = ""
        if ($fire.ShowsWindow) { $window = "  [shows a window]" }
        $report.Add("  " + $fire.Count + "x  " + $cadence + "  last=" + $fire.Last.ToString("yyyy-MM-dd HH:mm:ss") + "  " + $fire.Name + "  " + $fire.Exe + $window)
    }
    $report.Add("")
}
elseif ($fireNote -ne "") {
    $report.Add("=== actually fired: " + $fireNote + " ===")
    $report.Add("")
}

$ordered = @($rows | Sort-Object @{ Expression = "ShowsWindow"; Descending = $true }, $repeatKey, Path)
foreach ($row in $ordered) {
    $flag = "    "
    if ($row.ShowsWindow) { $flag = "WIN " }
    elseif ($row.Frequent) { $flag = "FREQ" }
    $report.Add($flag + " " + $row.Path)
    $report.Add("       state=" + $row.State + "  logon=" + $row.Logon + "  " + (Format-Repeat $row.Repeat) + "  triggers=" + $row.Triggers)
    $report.Add("       run=" + $row.Command)
}

Set-Content -Path $LogPath -Value $report -Encoding UTF8
Set-Content -Path $summaryPath -Value $summary -Encoding UTF8

if ($flashers.Count -gt 0) { exit 1 }
exit 0
