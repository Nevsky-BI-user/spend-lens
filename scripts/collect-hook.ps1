# collect-hook.ps1
# Запускає колектор у фоні після завершення сесії Claude Code.
# Викликається з хука SessionEnd у ~/.claude/settings.json.
#
# Чому не Task Scheduler: завдання spend-lens-daily одного разу тихо зникло з
# планувальника, і дашборд відставав два тижні, поки цього не помітили очима.
# Хук живе там само, де й дані: нові транскрипти зʼявляються рівно тоді, коли
# завершується сесія Claude Code. Не працювали — не було й нових витрат, тож
# пропущений день нічого не втрачає.
#
# Три властивості, без яких хук на кожному закритті сесії був би шкідливим:
#   дросель — не частіше ніж раз на $ThrottleHours (кілька сесій на день не
#             перетворюються на кілька пушів у Supabase поспіль);
#   замок   — дві сесії закрилися одночасно, другий запуск просто виходить;
#   фон     — хук віддає керування миттєво, колектор доживає окремим процесом,
#             інакше закриття сесії гальмувало б на 12 секунд.
#
# Сумісність: Windows PowerShell 5.1 (без &&, без тернарних операторів).
#
# Ручний запуск (обминає дросель):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect-hook.ps1 -Force

param(
    [int]$ThrottleHours = 3,
    [int]$StaleLockMinutes = 30,
    [switch]$Force,
    # Службовий: під ним скрипт викликає сам себе у відчепленому процесі.
    [switch]$Worker
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runScript = Join-Path $PSScriptRoot "run-collector.ps1"
$cacheDir = Join-Path $repoRoot "collector\.cache"
$logFile = Join-Path $cacheDir "last-run.log"
$lockFile = Join-Path $cacheDir "collect.lock"
$hookLog = Join-Path $cacheDir "hook.log"

function Write-HookLog([string]$message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    try {
        "[$stamp] $message" | Out-File -FilePath $hookLog -Append -Encoding utf8
    }
    catch {
        # Лог — зручність, а не умова роботи: сесія не мусить падати через нього.
    }
}

# ---------------------------------------------------------------------------
# Робоча гілка: сюди потрапляє лише відчеплений процес.
# Замок знімається у finally — інакше невдалий прогін заблокував би наступні
# на $StaleLockMinutes.
# ---------------------------------------------------------------------------
if ($Worker) {
    try {
        & $runScript | Out-Null
        Write-HookLog "collector finished (exit $LASTEXITCODE)"
    }
    catch {
        Write-HookLog "collector threw: $($_.Exception.Message)"
    }
    finally {
        Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

# ---------------------------------------------------------------------------
# Гілка хука. Мусить завершитися за мілісекунди й завжди кодом 0: ненульовий
# код із SessionEnd видно користувачу, а несвіжий дашборд того не вартий.
# ---------------------------------------------------------------------------
try {
    if (-not (Test-Path $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }

    if (-not (Test-Path $runScript)) {
        Write-HookLog "skip: run-collector.ps1 not found at $runScript"
        exit 0
    }

    # Дросель. Мітка — час зміни last-run.log, тобто свіжість ДАНИХ, а не факт
    # запуску хука. Увага: лог пише run-collector.ps1, тому прямий виклик
    # `node collector\collect.mjs` мітку НЕ оновлює — після нього хук збере
    # дані ще раз. Це навмисно: дешевше зібрати двічі, ніж пропустити день.
    if (-not $Force) {
        if (Test-Path $logFile) {
            $ageHours = ((Get-Date) - (Get-Item $logFile).LastWriteTime).TotalHours
            if ($ageHours -lt $ThrottleHours) {
                Write-HookLog ("skip: data is {0:N1} h old, throttle is {1} h" -f $ageHours, $ThrottleHours)
                exit 0
            }
        }
    }

    # Замок. Прострочений замок (процес упав, не знявши його) вважається мертвим.
    if (Test-Path $lockFile) {
        $lockAge = ((Get-Date) - (Get-Item $lockFile).LastWriteTime).TotalMinutes
        if ($lockAge -lt $StaleLockMinutes) {
            Write-HookLog ("skip: another run is in progress ({0:N1} min)" -f $lockAge)
            exit 0
        }
        Write-HookLog ("stale lock ({0:N1} min), taking over" -f $lockAge)
    }

    "pid=$PID started=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $lockFile -Encoding utf8

    $psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $workerArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", $PSCommandPath, "-Worker"
    )
    Start-Process -FilePath $psExe -ArgumentList $workerArgs -WindowStyle Hidden | Out-Null
    Write-HookLog "started collector in background"
}
catch {
    Write-HookLog "hook error: $($_.Exception.Message)"
    Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
}

exit 0
