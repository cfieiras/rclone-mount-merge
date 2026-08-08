Set fso = CreateObject("Scripting.FileSystemObject")
ScriptFolder = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = ScriptFolder
WshShell.Run "cmd.exe /c run.bat", 0, False
