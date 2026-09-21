' refresh.vbs
' spend-lens - on-demand data refresh, launched WITHOUT a console window.
'
' Double-click this file (or a desktop shortcut to it): it re-parses the
' transcripts, rewrites the local snapshot, pushes aggregates to Supabase and
' syncs the local preview copy. Nothing appears on screen. Then press
' "Onovyty" in the dashboard to re-read the fresh data.
'
' Why a .vbs and not a .cmd: wscript.exe is not a console host, so no window
' is ever created - not even the brief flash a double-clicked .cmd gives.
' Explicitly opening a terminal is banned by CONTRACT.md ("Process launch
' policy"): background work runs hidden, feedback lives in the log, the
' dashboard and the PDF.
'
' Same thing without this file: schtasks /Run /TN spend-lens-daily
'
' ASCII only on purpose: WScript reads .vbs in the ANSI codepage, so Cyrillic
' here depends on the machine locale. User-facing text lives in the dashboard
' and the PDF, not in operational scripts.

Option Explicit

Dim shell, fso, scriptDir, repoRoot, runScript, psExe, cmdLine, rc, logFile

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' If .vbs happens to be associated with cscript.exe (a console host), re-launch
' under wscript.exe so a console window never shows up.
If InStr(1, WScript.FullName, "cscript.exe", vbTextCompare) > 0 Then
    shell.Run "wscript.exe """ & WScript.ScriptFullName & """", 0, False
    WScript.Quit 0
End If

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)
runScript = fso.BuildPath(scriptDir, "run-collector.ps1")
logFile = fso.BuildPath(repoRoot, "collector\.cache\last-run.log")

If Not fso.FileExists(runScript) Then
    MsgBox "spend-lens: run-collector.ps1 not found next to this script:" & vbCrLf & _
           runScript, vbCritical, "spend-lens"
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
' would otherwise be invisible, so it gets a dialog - a message box, never a
' terminal.
If rc <> 0 Then
    MsgBox "spend-lens: the collector failed with exit code " & rc & "." & vbCrLf & vbCrLf & _
           "Log: " & logFile, vbExclamation, "spend-lens"
End If

WScript.Quit rc
