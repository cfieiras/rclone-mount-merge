; Inno Setup Script for Rclone Cloud Merger & Mapper
; Compiles into RcloneCloudMerger-Setup-v1.0.exe

#define MyAppName "Rclone Cloud Merger & Mapper"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Antigravity Devs"
#define MyAppURL "https://github.com/cfieiras/rclone-mount-merge"
#define MyAppExeName "launch.vbs"

[Setup]
AppId={{C98DB4E2-5A13-6DCE-A1B2-C3D4E5F6A7B8}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={userappdata}\RcloneCloudMerger
DisableDirPage=yes
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=RcloneCloudMerger-Setup-v1.0
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; ExcludePattern: ".git,node_modules,bin\cache,tmp,*.iss"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 275
Name: "{autodesktop}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 275; Tasks: desktopicon

[Run]
Filename: "wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; Description: "Ejecutar {#MyAppName}"; Flags: nowait postinstall skipifsilent
