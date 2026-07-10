; Inno Setup script for the jclaw Windows installer (beta).
; Compiled on CI with:
;   ISCC /DStagingDir=<dir with payload.zip> /DAppVer=0.1.0-beta.1 installer\jclaw.iss
; StagingDir must contain payload.zip — a zip of jclaw.exe + bun.exe + tui\
; (incl. node_modules), produced in CI. The installer ships that single
; archive and extracts it at install time with Windows' built-in tar, so Inno
; never per-file-compresses the ~100k-file node_modules tree (that took 40+ min).

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
; payload.zip is already compressed and shipped with the nocompression flag
; below, so the installer just stores the one archive — compiling is fast, no
; per-file lzma over the ~100k-file node_modules tree.
Compression=lzma2/normal
SolidCompression=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName=jclaw {#AppVer}
UninstallDisplayIcon={app}\jclaw.exe

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; Ship the single archive to a temp dir; the [Run] tar step extracts it into
; {app} and it is deleted afterward.
Source: "{#StagingDir}\payload.zip"; DestDir: "{tmp}"; Flags: nocompression deleteafterinstall

[Icons]
Name: "{group}\jclaw"; Filename: "{app}\jclaw.exe"; WorkingDir: "{userdocs}"
Name: "{group}\Uninstall jclaw"; Filename: "{uninstallexe}"
Name: "{userdesktop}\jclaw"; Filename: "{app}\jclaw.exe"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Run]
; Extract the bundled runtime into {app} during install. Windows 10+ ships
; tar.exe (bsdtar, handles zip) in System32; the 64-bit install mode above maps
; {sys} to the real System32, avoiding WOW64 redirection from the 32-bit setup.
Filename: "{sys}\tar.exe"; Parameters: "-xf ""{tmp}\payload.zip"" -C ""{app}"""; StatusMsg: "Extracting bundled runtime (one-time)..."; Flags: runhidden waituntilterminated
Filename: "{app}\jclaw.exe"; Description: "Launch jclaw"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The runtime under {app} is extracted by tar, not tracked by [Files], so the
; uninstaller would not remove it automatically — clear the whole app dir.
Type: filesandordirs; Name: "{app}"
