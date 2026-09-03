' tasks.vbs
' spend-lens - scheduled-task tools that never open a console window.
'
'   wscript.exe tasks.vbs          -> audit (default)
'   wscript.exe tasks.vbs audit    -> which tasks can put a window on screen,
'                                     and which of them repeat every few minutes
'   wscript.exe tasks.vbs fix      -> move every task that flashes a console onto
'                                     a principal with no desktop: the two
'                                     spend-lens tasks, plus any claude-* task
'
' The audit is read-only: it names tasks, it never disables or deletes one.
' Removing somebody else's scheduled task is the owner's decision, not a
' script's - and it is the whole reason the audit exists as a separate step.
'
' The result arrives in a self-dismissing dialog, not in a terminal: a modal
' MsgBox in a non-interactive session draws on an invisible window station where
' nobody can close it, and the process then hangs until its execution limit.
' That is the 2026-08-24 failure class (three orphaned shells, 45 minutes).
'
' Why a .vbs: wscript.exe belongs to the GUI subsystem, so it is never given a
' console - not even the brief flash a double-clicked .cmd gives.
'
' ASCII only: WScript reads .vbs in the ANSI codepage, so Cyrillic here would
' depend on the machine locale.

Option Explicit

Const POPUP_SECONDS = 180         ' long enough to read, short enough to never block
Const POPUP_INFO = 64             ' vbInformation
Const POPUP_WARN = 48             ' vbExclamation
Const POPUP_ERROR = 16            ' vbCritical
Const MAX_POPUP_CHARS = 1800

Dim shell, fso, scriptDir, repoRoot, mode, runScript, summaryFile
Dim psExe, cmdLine, rc, text, title

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' If .vbs is associated with cscript.exe (a console host), re-launch under
' wscript.exe so no console shows up, and pass the exit code through.
If InStr(1, WScript.FullName, "cscript.exe", vbTextCompare) > 0 Then
    Dim relaunch
    relaunch = "wscript.exe """ & WScript.ScriptFullName & """"
    If WScript.Arguments.Count > 0 Then
        relaunch = relaunch & " " & WScript.Arguments(0)
    End If
    WScript.Quit shell.Run(relaunch, 0, True)
End If

mode = "audit"
If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "fix" Then mode = "fix"
End If

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)

If mode = "fix" Then
    runScript = fso.BuildPath(scriptDir, "fix-tasks.ps1")
    summaryFile = fso.BuildPath(repoRoot, "collector\.cache\task-fix-summary.txt")
    title = "spend-lens: scheduled tasks re-registered"
Else
    runScript = fso.BuildPath(scriptDir, "audit-tasks.ps1")
    summaryFile = fso.BuildPath(repoRoot, "collector\.cache\task-audit-summary.txt")
    title = "spend-lens: scheduled task audit"
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

' 0 = hidden window; True = wait, so the summary file is complete before it is read.
rc = shell.Run(cmdLine, 0, True)

text = ReadSummary(summaryFile)

If text = "" Then
    shell.Popup "spend-lens: the " & mode & " step produced no summary (exit code " & rc & ")." & _
                vbCrLf & vbCrLf & "Expected: " & summaryFile, _
                POPUP_SECONDS, "spend-lens", POPUP_WARN
    WScript.Quit 2
End If

If rc = 0 Then
    shell.Popup text, POPUP_SECONDS, title, POPUP_INFO
Else
    shell.Popup text, POPUP_SECONDS, title, POPUP_WARN
End If

WScript.Quit rc

Function ReadSummary(path)
    Dim stream, content
    ReadSummary = ""
    If Not fso.FileExists(path) Then Exit Function
    On Error Resume Next
    Set stream = fso.OpenTextFile(path, 1)
    If Err.Number <> 0 Then Exit Function
    content = stream.ReadAll
    stream.Close
    On Error GoTo 0
    If Len(content) > MAX_POPUP_CHARS Then
        content = Left(content, MAX_POPUP_CHARS) & vbCrLf & "... truncated, see the log"
    End If
    ReadSummary = content
End Function
