# run-collector.ps1
# Runs the spend-lens collector and writes a log to collector/.cache/last-run.log.
# Compatible with Windows PowerShell 5.1 (no &&, no ternary operators).
# Intended to be called by Task Scheduler (see register-task.ps1), by the
# windowless launcher scripts\refresh.vbs, or manually:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\run-collector.ps1
# Always launched hidden - this script never opens a console of its own and
# never waits for input (CONTRACT.md, "Process launch policy"). Progress and
# failures go to the log, not to the screen.

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$collectorScript = Join-Path $repoRoot "collector\collect.mjs"
$cacheDir = Join-Path $repoRoot "collector\.cache"
$logFile = Join-Path $cacheDir "last-run.log"

if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}

$startStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$startStamp] spend-lens collector: run started" | Out-File -FilePath $logFile -Encoding utf8

if (-not (Test-Path $collectorScript)) {
    "[$startStamp] ERROR: collector script not found: $collectorScript" | Out-File -FilePath $logFile -Append -Encoding utf8
    exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    "[$startStamp] ERROR: node.exe not found in PATH" | Out-File -FilePath $logFile -Append -Encoding utf8
    exit 1
}
"[$startStamp] Using node: $($nodeCmd.Source)" | Out-File -FilePath $logFile -Append -Encoding utf8

Push-Location $repoRoot
try {
    # cmd.exe merges stdout+stderr natively, avoiding PowerShell 5.1
    # NativeCommandError wrapping of stderr lines. Its output is redirected, so
    # it reuses this (hidden) console instead of creating a window of its own.
    $cmdLine = 'node "' + $collectorScript + '" 2>&1'
    cmd.exe /d /c $cmdLine | Out-File -FilePath $logFile -Append -Encoding utf8
    $exitCode = $LASTEXITCODE

    # The local preview (vite preview) serves web\dist, where data\usage.json is
    # a build-time COPY. Without this sync the dashboard keeps showing the
    # previous snapshot after a refresh. Supabase mode is unaffected (it reads
    # the DB). This used to live in refresh.cmd, which no longer runs anything
    # itself - the on-demand refresh now goes through this script.
    if ($exitCode -eq 0) {
        $snapshot = Join-Path $repoRoot "web\public\data\usage.json"
        $distData = Join-Path $repoRoot "web\dist\data"
        if ((Test-Path $snapshot) -and (Test-Path $distData)) {
            Copy-Item -Path $snapshot -Destination (Join-Path $distData "usage.json") -Force
            $syncStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            "[$syncStamp] Synced snapshot to web\dist\data\usage.json" | Out-File -FilePath $logFile -Append -Encoding utf8
        }
    }
}
finally {
    Pop-Location
}

$endStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
if ($exitCode -eq 0) {
    "[$endStamp] Collector finished OK (exit 0)" | Out-File -FilePath $logFile -Append -Encoding utf8
}
else {
    "[$endStamp] Collector FAILED (exit $exitCode)" | Out-File -FilePath $logFile -Append -Encoding utf8
}

exit $exitCode
