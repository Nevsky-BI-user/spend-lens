# run-collector.ps1
# Runs the spend-lens collector and writes a log to collector/.cache/last-run.log.
# Compatible with Windows PowerShell 5.1 (no &&, no ternary operators).
# Intended to be called by Task Scheduler (see register-task.ps1) or manually:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-collector.ps1

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
    # NativeCommandError wrapping of stderr lines.
    $cmdLine = 'node "' + $collectorScript + '" 2>&1'
    cmd.exe /d /c $cmdLine | Out-File -FilePath $logFile -Append -Encoding utf8
    $exitCode = $LASTEXITCODE
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
