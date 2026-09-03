' refresh.vbs
' spend-lens - on-demand run of a pipeline, WITHOUT a console window.
'
' Double-click this file (or a desktop shortcut to it): it re-parses the
' transcripts, rewrites the local snapshot, pushes aggregates to Supabase and
' syncs the local preview copy. Nothing appears on screen. Then press
' "Onovyty" in the dashboard to re-read the fresh data.
'
' Optional argument selects the pipeline:
'   wscript.exe refresh.vbs            -> run-collector.ps1 (default)
'   wscript.exe refresh.vbs report     -> run-report.ps1 (collect + build + PDF + mail)
' For a desktop shortcut to the report pipeline set the shortcut target to:
'   wscript.exe "<repo>\scripts\refresh.vbs" report
'
' Why a .vbs and not a .cmd: wscript.exe belongs to the GUI subsystem, so it is
' never given a console - not even the brief flash a double-clicked .cmd gives.
' Shell.Run(cmd, 0, True) passes SW_HIDE in STARTUPINFO, so conhost creates the
' PowerShell window already hidden; -WindowStyle Hidden in the command line is
' the second line of defence.
'
' Feedback never blocks: failures use Popup with a timeout, never MsgBox. A
' modal MsgBox in a non-interactive session renders on an invisible window
' station where nobody can close it - the task then hangs until its execution
' limit. That is exactly the 2026-08-24 failure class (three orphaned shells).
'
' ASCII only on purpose: WScript reads .vbs in the ANSI codepage, so Cyrillic
' here depends on the machine locale. User-facing text lives in the dashboard
' and the PDF, not in operational scripts.

Option Explicit

Const POPUP_SECONDS = 60          ' dialogs self-dismiss: never block a run
Const POPUP_WARN = 48             ' vbExclamation
Const POPUP_ERROR = 16            ' vbCritical

Dim shell, fso, scriptDir, repoRoot, runScript, logFile, psExe, cmdLine, rc, mode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' If .vbs happens to be associated with cscript.exe (a console host), re-launch
' under wscript.exe so no console window shows up. Wait for it and pass the exit
' code through - otherwise the caller always sees 0 and cannot tell a failure.
If InStr(1, WScript.FullName, "cscript.exe", vbTextCompare) > 0 Then
    Dim relaunch
    relaunch = "wscript.exe """ & WScript.ScriptFullName & """"
    If WScript.Arguments.Count > 0 Then
        relaunch = relaunch & " " & WScript.Arguments(0)
    End If
    WScript.Quit shell.Run(relaunch, 0, True)
End If

mode = "collector"
If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "report" Then mode = "report"
End If

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)

If mode = "report" Then
    runScript = fso.BuildPath(scriptDir, "run-report.ps1")
    logFile = fso.BuildPath(repoRoot, "collector\.cache\report-run.log")
Else
    runScript = fso.BuildPath(scriptDir, "run-collector.ps1")
    logFile = fso.BuildPath(repoRoot, "collector\.cache\last-run.log")
End If

If Not fso.FileExists(runScript) Then
    shell.Popup "spend-lens: runner not found next to this script:" & vbCrLf & runScript, _
                POPUP_SECONDS, "spend-lens", POPUP_ERROR
    WScript.Quit 1
End If

psExe = fso.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), _
                      "System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(psExe) Then
    psExe = "powershell.exe"
End If

cmdLine = """" & psExe & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & _
          runScript & """"

' 0 = hidden window; True = wait so the exit code can be reported.
rc = shell.Run(cmdLine, 0, True)

' Silence is the success signal (the dashboard shows the data age). A failure
' would otherwise be invisible, so it gets a self-dismissing dialog - never a
' terminal, and never a dialog that can block the process forever.
If rc <> 0 Then
    shell.Popup "spend-lens: the " & mode & " pipeline failed with exit code " & rc & "." & _
                vbCrLf & vbCrLf & "Log: " & logFile, _
                POPUP_SECONDS, "spend-lens", POPUP_WARN
End If

WScript.Quit rc
