# run-report.ps1
# Daily pipeline for spend-lens v1.2/v1.3 email PDF digests (scheduled 08:00,
# the daily report covers the PREVIOUS Kyiv day):
#   1. collector collect (refreshes web/public/data/usage.json + Supabase push if configured)
#   2. npm --prefix web run build (v1.3: the PDF prints the real site from web/dist)
#   3. report --type daily (previous Kyiv day)
#   4. on the 1st day of a month: also report --type monthly
#   5. on January 1st: also report --type yearly
# Logs to collector/.cache/report-run.log.
# Compatible with Windows PowerShell 5.1 (no &&, no ternary operators).
# Intended to be called by Task Scheduler (see register-report-task.ps1) or manually:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-report.ps1

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$collectorScript = Join-Path $repoRoot "collector\collect.mjs"
$reportScript = Join-Path $repoRoot "report\report.mjs"
$cacheDir = Join-Path $repoRoot "collector\.cache"
$logFile = Join-Path $cacheDir "report-run.log"

if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}

function Write-Log([string]$message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$stamp] $message" | Out-File -FilePath $script:logFile -Append -Encoding utf8
}

$startStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$startStamp] spend-lens report pipeline: run started" | Out-File -FilePath $logFile -Encoding utf8

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    Write-Log "ERROR: node.exe not found in PATH"
    exit 1
}
Write-Log "Using node: $($nodeCmd.Source)"

if (-not (Test-Path $reportScript)) {
    Write-Log "ERROR: report script not found: $reportScript"
    exit 1
}

# Runs one node script and appends its merged stdout+stderr to the log.
# cmd.exe merges the streams natively, avoiding PowerShell 5.1
# NativeCommandError wrapping of stderr lines. Returns the exit code.
function Invoke-NodeStep([string]$stepName, [string]$scriptPath, [string]$extraArgs) {
    Write-Log "--- step: $stepName ---"
    $cmdLine = 'node "' + $scriptPath + '" ' + $extraArgs + ' 2>&1'
    cmd.exe /d /c $cmdLine | Out-File -FilePath $script:logFile -Append -Encoding utf8
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        Write-Log "step '$stepName' OK (exit 0)"
    }
    else {
        Write-Log "step '$stepName' FAILED (exit $code)"
    }
    return $code
}

$overallExit = 0

Push-Location $repoRoot
try {
    # 1. Collector (with Supabase push if collector/.env is configured)
    if (Test-Path $collectorScript) {
        $code = Invoke-NodeStep "collector collect" $collectorScript ""
        if ($code -ne 0) {
            # A stale snapshot is still better than no report at all.
            Write-Log "WARNING: collector failed, reports will use the existing snapshot"
            $overallExit = $code
        }
    }
    else {
        Write-Log "WARNING: collector script not found ($collectorScript), skipping collect step"
    }

    # 2. Web build (v1.3: PDF = the real site; keeps web/dist in sync with web/src).
    #    On failure report.mjs falls back to the legacy renderer with a loud log line.
    $webDir = Join-Path $repoRoot "web"
    if (Test-Path (Join-Path $webDir "package.json")) {
        Write-Log "--- step: web build ---"
        $buildCmd = 'npm --prefix "' + $webDir + '" run build 2>&1'
        cmd.exe /d /c $buildCmd | Out-File -FilePath $script:logFile -Append -Encoding utf8
        $code = $LASTEXITCODE
        if ($code -eq 0) {
            Write-Log "step 'web build' OK (exit 0)"
        }
        else {
            Write-Log "WARNING: web build FAILED (exit $code), report.mjs will use the legacy renderer"
            $overallExit = $code
        }
    }
    else {
        Write-Log "WARNING: web/package.json not found, skipping web build step"
    }

    # 3. Daily report (always; covers the previous Kyiv day)
    $code = Invoke-NodeStep "report daily" $reportScript "--type daily"
    if ($code -ne 0) { $overallExit = $code }

    # 4. Monthly report on the 1st day of every month
    $today = Get-Date
    if ($today.Day -eq 1) {
        $code = Invoke-NodeStep "report monthly" $reportScript "--type monthly"
        if ($code -ne 0) { $overallExit = $code }
    }

    # 5. Yearly report on January 1st
    if ($today.Day -eq 1 -and $today.Month -eq 1) {
        $code = Invoke-NodeStep "report yearly" $reportScript "--type yearly"
        if ($code -ne 0) { $overallExit = $code }
    }
}
finally {
    Pop-Location
}

if ($overallExit -eq 0) {
    Write-Log "report pipeline finished OK"
}
else {
    Write-Log "report pipeline finished with errors (exit $overallExit)"
}

exit $overallExit
