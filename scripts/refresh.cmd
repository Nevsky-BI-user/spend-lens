@echo off
rem spend-lens - on-demand data refresh (v1.12): compatibility shim.
rem
rem Kept only so existing desktop shortcuts keep working. It prints nothing,
rem asks nothing and waits for nothing: it hands the job to refresh.vbs, which
rem runs the collector with a hidden window, and exits immediately.
rem
rem Explicitly opening a terminal is banned (CONTRACT.md, "Process launch
rem policy"). A double-clicked .cmd still flashes a console for a fraction of a
rem second before cmd.exe can hand off - that flash is exactly why the real
rem entry point is scripts\refresh.vbs. Point new shortcuts at the .vbs.
rem
rem Same thing without any file: schtasks /Run /TN spend-lens-daily
rem
rem ASCII only on purpose: cmd.exe parses .cmd files in the OEM codepage,
rem so Cyrillic here breaks the parser (verified). User-facing text lives
rem in the dashboard and the PDF, not in operational scripts.

setlocal
if not exist "%~dp0refresh.vbs" (
  rem Nothing to delegate to: exit with an error code, still silently.
  exit /b 1
)
start "" /b wscript.exe "%~dp0refresh.vbs"
endlocal
exit /b 0
