@echo off
rem spend-lens - on-demand data refresh (v1.11).
rem Double-click (or a desktop shortcut): re-parses transcripts, rewrites the
rem local snapshot and pushes aggregates to Supabase. Then press "Onovyty"
rem in the dashboard to re-read the fresh data.
rem
rem Same thing without this file: schtasks /Run /TN spend-lens-daily
rem
rem ASCII only on purpose: cmd.exe parses .cmd files in the OEM codepage,
rem so Cyrillic here breaks the parser (verified). User-facing text lives
rem in the dashboard and the PDF, not in operational scripts.

setlocal
set "ROOT=%~dp0.."
pushd "%ROOT%" || (echo Project folder not found & pause & exit /b 1)

echo.
echo === spend-lens: collecting usage data ===
node collector\collect.mjs
set "RC=%ERRORLEVEL%"

rem The local preview (vite preview) serves web\dist, where data\usage.json is a
rem build-time COPY. Without this sync the dashboard keeps showing the previous
rem snapshot after a refresh. Supabase mode is unaffected (it reads the DB).
if "%RC%"=="0" if exist "web\dist\data" copy /y "web\public\data\usage.json" "web\dist\data\usage.json" >nul

popd

if not "%RC%"=="0" (
  echo.
  echo Collector failed with exit code %RC%.
  echo Log: collector\.cache\last-run.log
  pause
  exit /b %RC%
)

echo.
echo Done. Press "Onovyty" in the dashboard to load the fresh data.
timeout /t 5 >nul 2>&1
endlocal
