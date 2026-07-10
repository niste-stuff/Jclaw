; Inno Setup script for the jclaw Windows one-click installer (beta).
; Compiled on CI with:
;   ISCC /DStagingDir=<abs staging path> /DAppVer=0.1.0-beta.1 installer\jclaw.iss
; StagingDir must contain jclaw.exe, bun.exe, and tui\ (with pruned node_modules).

#ifndef StagingDir
  #error StagingDir must be passed via ISCC /DStagingDir=...
#endif
#ifndef AppVer
  #define AppVer "0.1.0-beta.1"
#endif

[Setup]
AppId={{A1F2C3D4-5E6F-47A8-9B0C-1D2E3F4A5B6C}
AppName=jclaw
AppVersion={#AppVer}
AppVerName=jclaw {#AppVer}
AppPublisher=jclaw
DefaultDirName={localappdata}\Programs\jclaw
DefaultGroupName=jclaw
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=jclaw-setup
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName=jclaw {#AppVer}
UninstallDisplayIcon={app}\jclaw.exe

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#StagingDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\jclaw"; Filename: "{app}\jclaw.exe"; WorkingDir: "{userdocs}"
Name: "{group}\Uninstall jclaw"; Filename: "{uninstallexe}"
Name: "{userdesktop}\jclaw"; Filename: "{app}\jclaw.exe"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Run]
Filename: "{app}\jclaw.exe"; Description: "Launch jclaw"; Flags: nowait postinstall skipifsilent
