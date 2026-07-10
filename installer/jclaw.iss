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
; Lets Explorer/new consoles pick up the PATH change made in [Code] below
; without requiring a reboot.
ChangesEnvironment=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; Ship the single archive to a temp dir; ExtractPayload ([Code]) extracts it
; into {app} — with the exit code checked, unlike a [Run] entry — and it is
; deleted afterward.
Source: "{#StagingDir}\payload.zip"; DestDir: "{tmp}"; Flags: nocompression deleteafterinstall; AfterInstall: ExtractPayload

[Icons]
Name: "{group}\jclaw"; Filename: "{app}\jclaw.exe"; WorkingDir: "{userdocs}"
Name: "{group}\Uninstall jclaw"; Filename: "{uninstallexe}"
Name: "{userdesktop}\jclaw"; Filename: "{app}\jclaw.exe"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Run]
; WorkingDir matters: without it the launched TUI inherits {app} as its
; working directory and treats the install folder itself as the project.
Filename: "{app}\jclaw.exe"; Description: "Launch jclaw"; WorkingDir: "{userdocs}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The runtime under {app} is extracted by tar, not tracked by [Files], so the
; uninstaller would not remove it automatically — clear the whole app dir.
Type: filesandordirs; Name: "{app}"

[Code]
// Extracts the bundled runtime into {app} during install. Windows 10+ ships
// tar.exe (bsdtar, handles zip) in System32; the 64-bit install mode above
// maps {sys} to the real System32, avoiding WOW64 redirection from the 32-bit
// setup. Runs as an AfterInstall handler so a failed or partial extraction
// raises an exception — which aborts and rolls back the install — instead of
// silently producing a broken install the way an unchecked [Run] entry would.
procedure ExtractPayload;
var
  ResultCode: Integer;
begin
  WizardForm.StatusLabel.Caption := 'Extracting bundled runtime (one-time)...';
  ForceDirectories(ExpandConstant('{app}'));
  { Upgrade installs: extracting over a previous version's tui\ tree leaves
    stale files behind (removed packages, old layouts) that can shadow the
    fresh ones. The tree is fully regenerated from payload.zip, so drop it. }
  if DirExists(ExpandConstant('{app}\tui')) then
    DelTree(ExpandConstant('{app}\tui'), True, True, True);
  if not Exec(ExpandConstant('{sys}\tar.exe'),
      ExpandConstant('-xf "{tmp}\payload.zip" -C "{app}"'),
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Could not run tar.exe to extract the bundled runtime.');
  if ResultCode <> 0 then
    RaiseException(Format('Extracting the bundled runtime failed (tar exit code %d). ' +
      'Check free disk space and try again.', [ResultCode]));
  { Sentinels: files the runtime cannot boot without. Catches an archive that
    extracted "successfully" but is missing pieces. }
  if not FileExists(ExpandConstant('{app}\jclaw.exe')) or
     not FileExists(ExpandConstant('{app}\bun.exe')) or
     not FileExists(ExpandConstant('{app}\tui\packages\opencode\src\index.ts')) or
     not FileExists(ExpandConstant('{app}\tui\node_modules\@opencode-ai\core\package.json')) then
    RaiseException('The bundled runtime extracted incompletely (missing core files).');
end;

// Adds/removes {app} from the per-user PATH (HKCU\Environment) so `jclaw`
// resolves in a terminal, not just the Start Menu shortcut. Per-user because
// PrivilegesRequired=lowest above means we never touch HKLM.
const
  EnvironmentKey = 'Environment';

procedure EnvAddPath(Path: string);
var
  Paths: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths) then
    Paths := '';

  { Already present: nothing to do }
  if Pos(';' + Uppercase(Path) + ';', ';' + Uppercase(Paths) + ';') > 0 then
    exit;

  if Length(Paths) > 0 then
    Paths := Paths + ';' + Path
  else
    Paths := Path;

  { Expand-sz, not plain sz: the user PATH value is normally REG_EXPAND_SZ and
    may contain %VAR% references that a plain REG_SZ write would stop expanding. }
  if not RegWriteExpandStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths) then
    Log(Format('EnvAddPath: failed to write PATH (%s)', [Path]));
end;

procedure EnvRemovePath(Path: string);
var
  Paths: string;
  P: Integer;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths) then
    exit;

  P := Pos(';' + Uppercase(Path) + ';', ';' + Uppercase(Paths) + ';');
  if P = 0 then
    exit;

  { P is 1-based in the ';'-padded string, so the entry starts at index P in
    Paths. At the start of PATH remove the entry plus its trailing ';';
    elsewhere remove the leading ';' plus the entry. }
  if P = 1 then
    Delete(Paths, 1, Length(Path) + 1)
  else
    Delete(Paths, P - 1, Length(Path) + 1);

  if not RegWriteExpandStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths) then
    Log(Format('EnvRemovePath: failed to write PATH (%s)', [Path]));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    EnvAddPath(ExpandConstant('{app}'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    EnvRemovePath(ExpandConstant('{app}'));
end;
