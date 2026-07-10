# Windows One-Click Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a double-click `jclaw-setup.exe` that installs jclaw (Rust launcher + bundled Bun + vendored TS + pruned deps) on Windows with no terminal, as the first beta build.

**Architecture:** A GitHub Actions job on `windows-latest` stages a self-contained payload (`jclaw.exe`, pinned `bun.exe`, `tui/` source, production-only `node_modules`), verifies it boots headlessly, then compiles an Inno Setup script into a per-user installer and publishes it as a pre-release asset. The installed `jclaw.exe` finds its bundled Bun via a small cross-platform fix to `locate_bun`.

**Tech Stack:** Rust (launcher), Bun (runtime), Inno Setup 6 (installer), GitHub Actions (build/release).

## Global Constraints

- **Distribution:** fat offline bundle — installer ships `jclaw.exe` + `bun.exe` + `tui/` source + `node_modules`; no first-run network fetch.
- **Installer toolchain:** Inno Setup 6, compiled by `ISCC.exe` on `windows-latest`.
- **Install location:** per-user, no admin — `{localappdata}\Programs\jclaw` (Inno `PrivilegesRequired=lowest`).
- **Bun pin:** `1.3.14` exactly (matches the version the vendored TS is tested against). Bundle `bun-windows-x64`.
- **Prune:** `node_modules` staged via `bun install --production` (omit devDeps) — a single production install, never full-then-prune.
- **Prune safety gate:** headless `serve` + `/agent` boot probe against the *pruned staged* tree must pass before packaging; job fails otherwise.
- **Binary:** build `--bin jclaw` (not `claw`).
- **Beta release:** tag `v0.1.0-beta.1`, GitHub release marked `prerelease: true`, Inno `AppVersion` shows the beta string.
- **Do not break:** the `#[cfg(unix)]` exec path in `tui.rs`; OpenCode Zen; the shared `app = "opencode"` XDG config (constraint §2 of `tui/HANDOFF.md`).
- **Rust gates:** `scripts/fmt.sh --check` clean; `cargo clippy -p rusty-claude-cli --all-targets -- -D warnings` clean; `cargo test -p rusty-claude-cli` green.

## File Structure

- `rust/crates/rusty-claude-cli/src/tui.rs` — MODIFY. Refactor `locate_bun` to probe a Bun sitting next to the running executable and to handle the Windows binary name (`bun.exe`) + `USERPROFILE`. Add unit tests.
- `installer/jclaw.iss` — CREATE. Inno Setup script; consumes a staging dir passed via `ISCC /DStagingDir=...`.
- `.github/workflows/release.yml` — MODIFY. Add an `installer-windows` job that stages, prunes, boot-verifies, compiles the `.iss`, and publishes the pre-release asset.

---

### Task 1: Cross-platform Bun discovery in `locate_bun`

Make the installed `jclaw.exe` find a bundled `bun.exe` next to it, and fix native-Windows detection (`USERPROFILE`, `bun.exe`). Done as a pure, unit-testable candidate-builder so it can be tested on this macOS dev machine without a Windows runner.

**Files:**
- Modify: `rust/crates/rusty-claude-cli/src/tui.rs` (`locate_bun`, `which_in_path`, add `bun_candidates` + `#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `fn bun_candidates(jclaw_bun: Option<&OsStr>, exe_dir: Option<&Path>, home: Option<&OsStr>, user_profile: Option<&OsStr>) -> Vec<PathBuf>` — ordered, most-specific-first list of non-PATH candidate paths. Uses `std::env::consts::EXE_SUFFIX` so the binary name is `bun` on Unix and `bun.exe` on Windows.
- Consumes (unchanged): `exec_replacing` (the existing `#[cfg(unix)]` / `#[cfg(not(unix))]` split — do not touch).

- [ ] **Step 1: Write the failing tests**

Add at the bottom of `rust/crates/rusty-claude-cli/src/tui.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::bun_candidates;
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    fn bun_name() -> String {
        format!("bun{}", std::env::consts::EXE_SUFFIX)
    }

    #[test]
    fn jclaw_bun_override_is_first() {
        let got = bun_candidates(
            Some(OsStr::new("/opt/custom/bun")),
            Some(Path::new("/install/jclaw")),
            Some(OsStr::new("/home/u")),
            None,
        );
        assert_eq!(got.first(), Some(&PathBuf::from("/opt/custom/bun")));
    }

    #[test]
    fn bundled_sibling_probed_before_home() {
        let got = bun_candidates(
            None,
            Some(Path::new("/install/jclaw")),
            Some(OsStr::new("/home/u")),
            None,
        );
        assert_eq!(got[0], PathBuf::from("/install/jclaw").join(bun_name()));
        assert_eq!(
            got[1],
            PathBuf::from("/home/u").join(".bun").join("bin").join(bun_name())
        );
    }

    #[test]
    fn user_profile_used_when_home_absent() {
        let got = bun_candidates(None, None, None, Some(OsStr::new("C:\\Users\\u")));
        assert_eq!(
            got,
            vec![PathBuf::from("C:\\Users\\u").join(".bun").join("bin").join(bun_name())]
        );
    }

    #[test]
    fn empty_when_nothing_available() {
        assert!(bun_candidates(None, None, None, None).is_empty());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd rust && cargo test -p rusty-claude-cli bun_candidates`
Expected: FAIL — `cannot find function bun_candidates in this scope`.

- [ ] **Step 3: Implement `bun_candidates` and rewire `locate_bun` / `which_in_path`**

In `rust/crates/rusty-claude-cli/src/tui.rs`, add `use std::ffi::OsStr;` to the imports at the top (alongside the existing `use std::path::{Path, PathBuf};`).

Replace the whole `locate_bun` function (currently lines ~70-88) with:

```rust
/// Ordered, most-specific-first list of non-`PATH` places to look for Bun.
/// Pure and platform-neutral (takes env values + the running exe's directory)
/// so it can be unit-tested anywhere. The binary name is `bun` on Unix and
/// `bun.exe` on Windows via `EXE_SUFFIX`.
fn bun_candidates(
    jclaw_bun: Option<&OsStr>,
    exe_dir: Option<&Path>,
    home: Option<&OsStr>,
    user_profile: Option<&OsStr>,
) -> Vec<PathBuf> {
    let bun_name = format!("bun{}", std::env::consts::EXE_SUFFIX);
    let mut out = Vec::new();
    if let Some(explicit) = jclaw_bun {
        out.push(PathBuf::from(explicit));
    }
    // A Bun bundled next to jclaw's own binary (the installed layout).
    if let Some(dir) = exe_dir {
        out.push(dir.join(&bun_name));
    }
    // A user's own Bun install: `$HOME/.bun/bin/bun` (Unix) or
    // `%USERPROFILE%\.bun\bin\bun.exe` (Windows).
    for base in [home, user_profile].into_iter().flatten() {
        out.push(PathBuf::from(base).join(".bun").join("bin").join(&bun_name));
    }
    out
}

/// Locate the `bun` executable: explicit override, then a Bun bundled next to
/// jclaw, then the user's own install, then `PATH`.
fn locate_bun() -> Result<PathBuf, Box<dyn Error>> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let candidates = bun_candidates(
        std::env::var_os("JCLAW_BUN").as_deref(),
        exe_dir.as_deref(),
        std::env::var_os("HOME").as_deref(),
        std::env::var_os("USERPROFILE").as_deref(),
    );
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Some(found) = which_in_path(&format!("bun{}", std::env::consts::EXE_SUFFIX)) {
        return Ok(found);
    }
    Err("`claw tui` needs Bun, which was not found.\nInstall it with:  curl -fsSL https://bun.sh/install | bash\n(or set JCLAW_BUN to the bun binary)."
        .into())
}
```

Leave `which_in_path` as-is — it already takes the name to search for; `locate_bun` now passes `bun.exe` on Windows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd rust && cargo test -p rusty-claude-cli bun_candidates`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run the Rust gates**

Run: `cd rust && cargo clippy -p rusty-claude-cli --all-targets -- -D warnings && cargo test -p rusty-claude-cli`
Then from repo root: `scripts/fmt.sh --check`
Expected: clippy clean, tests green, fmt clean.

- [ ] **Step 6: Commit**

```bash
git add rust/crates/rusty-claude-cli/src/tui.rs
git commit -m "fix(tui): find bundled bun.exe next to jclaw on Windows

locate_bun now probes a Bun sitting beside the running executable and
handles the Windows binary name (bun.exe) and USERPROFILE, so an
installed jclaw.exe finds its bundled runtime with no env-var trickery.
Extracted a pure bun_candidates() builder with unit tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Inno Setup script

Create the installer definition. It consumes a pre-built staging directory (produced by Task 3) via an `ISCC` command-line define, and produces a per-user `jclaw-setup.exe`.

**Files:**
- Create: `installer/jclaw.iss`

**Interfaces:**
- Consumes: a `StagingDir` value passed as `ISCC /DStagingDir=<abs path>` — that directory must contain `jclaw.exe`, `bun.exe`, and `tui\` (with pruned `node_modules`) at its root. Produced by Task 3.
- Produces: `Output\jclaw-setup.exe` (name/dir set below), consumed by Task 3's upload steps.

- [ ] **Step 1: Create `installer/jclaw.iss`**

```iss
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
```

Notes baked into the choices above (do not "fix" these):
- `PrivilegesRequired=lowest` + `{localappdata}\Programs\jclaw` = per-user, no UAC.
- The Start Menu / Desktop shortcuts target `jclaw.exe` **directly**. jclaw is a console-subsystem app, so Windows auto-allocates a console on launch. Launching through `wt.exe` (Windows Terminal) is a deliberate post-beta polish, out of scope for this first build.
- `WorkingDir: {userdocs}` so a double-click opens the TUI somewhere sensible; `cd project && jclaw` in a terminal is unaffected.
- `AppId` GUID is fixed so future versions upgrade in place. Keep it stable.

- [ ] **Step 2: Validate the script structure locally**

`ISCC.exe` only runs on Windows, so verify structurally on this machine instead:

Run: `grep -Eq '^\[Setup\]' installer/jclaw.iss && grep -Eq 'OutputBaseFilename=jclaw-setup' installer/jclaw.iss && grep -Eq 'PrivilegesRequired=lowest' installer/jclaw.iss && grep -Eq 'Source: "\{#StagingDir\}' installer/jclaw.iss && echo OK`
Expected: prints `OK`. (Real compilation is exercised by Task 3 on the Windows runner.)

- [ ] **Step 3: Commit**

```bash
git add installer/jclaw.iss
git commit -m "feat(installer): add Inno Setup script for Windows one-click install

Per-user (LOCALAPPDATA, no admin) installer definition; bundles the
staged jclaw.exe + bun.exe + tui/ payload, adds Start Menu / optional
Desktop shortcuts and an uninstaller. Compiled on CI in the next task.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: CI `installer-windows` job + beta pre-release

Add a job that builds `jclaw.exe`, stages the payload, prunes to production deps, verifies the pruned tree boots, compiles the `.iss`, and publishes `jclaw-setup.exe` as a pre-release asset. This task is the integration test for Tasks 1–2 (Inno + full boot can only run on Windows).

**Files:**
- Modify: `.github/workflows/release.yml` (add one job; leave the existing `build` matrix untouched)

**Interfaces:**
- Consumes: `installer/jclaw.iss` (Task 2), the `jclaw` bin (Task 1's crate), `oven-sh/setup-bun@v2`, `softprops/action-gh-release@v2` (already used in this file).
- Produces: workflow artifact `jclaw-windows-installer` and, on a tag, a pre-release asset `jclaw-setup.exe` (+ `.sha256`).

- [ ] **Step 1: Add the `installer-windows` job**

Append this job under `jobs:` in `.github/workflows/release.yml` (sibling to `build`; do not nest it in the matrix):

```yaml
  installer-windows:
    name: windows-installer
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: rust -> target

      - name: Build jclaw.exe
        working-directory: rust
        run: cargo build --release --bin jclaw

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Stage payload (jclaw.exe + tui source)
        shell: pwsh
        run: |
          $staging = "$env:RUNNER_TEMP\staging"
          New-Item -ItemType Directory -Force -Path $staging | Out-Null
          Copy-Item "rust\target\release\jclaw.exe" "$staging\jclaw.exe"
          # Copy the vendored TS source, excluding any local node_modules/.git.
          robocopy "tui" "$staging\tui" /E /XD node_modules .git /NFL /NDL /NJH /NJS /NP
          if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
          $global:LASTEXITCODE = 0
          "STAGING=$staging" | Out-File -FilePath $env:GITHUB_ENV -Append

      - name: Bundle pinned bun.exe
        shell: pwsh
        run: |
          $url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64.zip"
          Invoke-WebRequest -Uri $url -OutFile "$env:RUNNER_TEMP\bun.zip"
          Expand-Archive -Path "$env:RUNNER_TEMP\bun.zip" -DestinationPath "$env:RUNNER_TEMP\bun" -Force
          Copy-Item "$env:RUNNER_TEMP\bun\bun-windows-x64\bun.exe" "$env:STAGING\bun.exe"

      - name: Prune install (production deps only)
        shell: pwsh
        working-directory: ${{ env.STAGING }}\tui
        run: bun install --production

      - name: Verify pruned tree boots (headless /agent probe)
        shell: pwsh
        run: |
          $bun = "$env:STAGING\bun.exe"
          $entry = "$env:STAGING\tui\packages\opencode\src\index.ts"
          $proc = Start-Process -FilePath $bun `
            -ArgumentList @("run","--cwd","$env:STAGING\tui\packages\opencode",$entry,"serve","--port","14784","--print-logs") `
            -PassThru -WindowStyle Hidden
          try {
            $ok = $false
            foreach ($i in 1..30) {
              Start-Sleep -Seconds 2
              try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:14784/agent" -UseBasicParsing -TimeoutSec 3
                if ($resp.Content -match '"peak"' -and $resp.Content -match '"build"') { $ok = $true; break }
              } catch { }
            }
            if (-not $ok) { throw "pruned tree failed to boot or /agent missing expected agents" }
            Write-Host "Pruned tree booted; /agent lists peak + build."
          } finally {
            if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
          }

      - name: Compile installer
        shell: pwsh
        run: |
          choco install innosetup --no-progress -y
          $iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
          $ver = if ($env:GITHUB_REF -like 'refs/tags/v*') { $env:GITHUB_REF -replace '^refs/tags/v','' } else { '0.0.0-dev' }
          & $iscc "/DStagingDir=$env:STAGING" "/DAppVer=$ver" "installer\jclaw.iss"
          if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }
          New-Item -ItemType Directory -Force -Path dist | Out-Null
          Copy-Item "installer\Output\jclaw-setup.exe" "dist\jclaw-setup.exe"
          $hash = (Get-FileHash "dist\jclaw-setup.exe" -Algorithm SHA256).Hash.ToLower()
          "$hash  jclaw-setup.exe" | Out-File -Encoding ascii "dist\jclaw-setup.exe.sha256"

      - name: Upload workflow artifact
        uses: actions/upload-artifact@v4
        with:
          name: jclaw-windows-installer
          path: |
            dist/jclaw-setup.exe
            dist/jclaw-setup.exe.sha256

      - name: Upload release asset
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          prerelease: true
          files: |
            dist/jclaw-setup.exe
            dist/jclaw-setup.exe.sha256
          fail_on_unmatched_files: true
          body: |
            ### jclaw Windows beta

            First Windows one-click build. Download `jclaw-setup.exe`, run it (per-user, no admin), launch **jclaw** from the Start Menu.

            **Known beta limitations**
            - Unsigned installer — Windows SmartScreen will warn on first run ("More info" → "Run anyway").
            - The interactive TUI has passed a headless boot check in CI but has not been verified on a real Windows console. Windows Terminal is recommended over the legacy console.
```

- [ ] **Step 2: Lint the workflow YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"`
Expected: prints `YAML OK` (no parse error from the added job).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build Windows one-click installer as a beta pre-release

New installer-windows job stages jclaw.exe + pinned bun.exe + tui source,
does a production-only bun install, gates on a headless /agent boot probe
of the pruned tree, compiles the Inno Setup script, and publishes
jclaw-setup.exe as a prerelease asset on v* tags.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Integration test — trigger the job (no tag) and inspect the artifact**

This is the real test for Tasks 2–3 (Inno compile + full boot need Windows). Run the workflow on a branch without cutting a release:

```bash
git push
gh workflow run "Release binaries" --ref <this-branch>
gh run watch
```

Expected: the `windows-installer` job is green; the boot-probe step prints "Pruned tree booted; /agent lists peak + build."; a `jclaw-windows-installer` artifact exists.

```bash
gh run download --name jclaw-windows-installer --dir /tmp/jclaw-installer
ls -la /tmp/jclaw-installer
```

Expected: `jclaw-setup.exe` (a few hundred MB) + `.sha256` present.

- [ ] **Step 5: Cut the beta pre-release**

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
gh run watch
```

Expected: the tagged run publishes a **pre-release** `v0.1.0-beta.1` with `jclaw-setup.exe` attached.

- [ ] **Step 6: Manual Windows verification (documented, not CI-gated)**

On a real Windows 10/11 machine: download `jclaw-setup.exe` from the pre-release, run it (dismiss SmartScreen via "More info" → "Run anyway"), confirm it installs to `%LOCALAPPDATA%\Programs\jclaw`, launch **jclaw** from the Start Menu, and confirm the TUI draws and a free OpenCode Zen model responds. Record the result (pass / rendering issues) in the tracking notes — this is the beta's real-console shakeout.

---

## Self-Review

**Spec coverage:**
- Fat offline bundle → Task 3 staging (jclaw.exe + bun.exe + tui + node_modules). ✓
- Inno Setup per-user LOCALAPPDATA + shortcuts + uninstaller → Task 2. ✓
- `locate_bun` Windows fix → Task 1. ✓
- Bun pin 1.3.14 → Global Constraints + Task 3 (setup-bun + bundled zip). ✓
- Production prune + verified boot gate → Task 3 steps "Prune install" + "Verify pruned tree boots". ✓
- Build `--bin jclaw` → Task 3 "Build jclaw.exe". ✓
- Beta prerelease tag + AppVersion + SmartScreen/console notes → Global Constraints + Task 3 release body + Task 2 AppVersion. ✓
- Don't break Unix exec path / Zen / shared XDG → Task 1 leaves `exec_replacing` untouched; no `global.ts`/provider changes anywhere. ✓
- Known-risk (interactive Windows console unverified) → Task 3 Step 6 + release body. ✓

**Placeholder scan:** No TBD/TODO. `<this-branch>` in Step 4 is a genuine user-supplied value (the working branch), not a placeholder for omitted content. All code/scripts are complete.

**Type consistency:** `bun_candidates` signature is identical in the Interfaces block, the failing test (`super::bun_candidates`), and the implementation. `StagingDir`/`AppVer` defines in the `.iss` (Task 2) match the `ISCC /DStagingDir= /DAppVer=` invocation (Task 3). `$env:STAGING` is written to `GITHUB_ENV` in "Stage payload" and read by every later Task 3 step.
