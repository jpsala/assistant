#ifndef MyAppName
  #define MyAppName "Assistant"
#endif

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#ifndef MyAppPublisher
  #define MyAppPublisher "Blackboard"
#endif

#ifndef AppSourceDir
  #define AppSourceDir "build\stable-win-x64\Assistant"
#endif

#ifndef AppIconFile
  #define AppIconFile "assets\tray-icon.ico"
#endif

#ifndef OutputDir
  #define OutputDir "artifacts\windows-installer"
#endif

#ifndef AppDocsUrl
  #define AppDocsUrl "https://mdview.jpsala.dev"
#endif

[Setup]
AppId={{5DDA4F65-1B9D-46DA-BD05-5E59B4A3652A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename={#MyAppName}-Installer
SetupIconFile={#AppIconFile}
UninstallDisplayIcon={app}\Resources\app.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#AppSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Resources\app.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Resources\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\launcher.exe"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
Filename: "{#AppDocsUrl}"; Description: "Open Quick Start Guide"; Flags: postinstall shellexec skipifsilent unchecked
