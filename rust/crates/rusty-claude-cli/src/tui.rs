//! Launcher for the vendored opencode-derived TUI (Bun sidecar).
//!
//! `claw tui [project]` hands the terminal off to the full-screen TUI vendored
//! under the repo's `tui/` directory — a Bun + Solid/OpenTUI front end plus the
//! opencode server it talks to. jclaw owns that source (see `tui/`); this module
//! only locates Bun and the vendored tree, then replaces the current process
//! with the TUI so it fully owns the controlling terminal (mouse, raw mode,
//! alternate screen, closeable dialogs).
//!
//! Resolution overrides (env):
//! - `JCLAW_TUI_DIR` — absolute path to the vendored `tui/` directory.
//! - `JCLAW_BUN` — absolute path to the `bun` executable.

use std::error::Error;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Relative path from the vendored `tui/` root to the CLI/TUI entry point.
const TUI_ENTRY_REL: &str = "packages/opencode/src/index.ts";
/// Relative path from the vendored `tui/` root to the package whose `bunfig`
/// (preload, conditions) must be active — Bun's `--cwd`.
const TUI_PKG_REL: &str = "packages/opencode";

/// Entry point for `claw tui`. Forwards any extra args (e.g. a project path)
/// straight through to the TUI.
pub fn run_tui(args: &[String]) -> Result<(), Box<dyn Error>> {
    let bun = locate_bun()?;
    let tui_dir = locate_tui_dir()?;

    let entry = tui_dir.join(TUI_ENTRY_REL);
    if !entry.exists() {
        return Err(format!(
            "vendored TUI entry not found at {}.\nThe `tui/` tree looks incomplete.",
            entry.display()
        )
        .into());
    }
    if !tui_dir.join("node_modules").is_dir() {
        return Err(format!(
            "TUI dependencies are not installed.\nRun:  (cd {} && bun install)\nThen retry `claw tui`.",
            tui_dir.display()
        )
        .into());
    }

    let mut command = Command::new(&bun);
    command
        .arg("run")
        .arg("--cwd")
        .arg(tui_dir.join(TUI_PKG_REL))
        .arg(&entry)
        .args(args)
        // Marker so the front end can branch on being launched by jclaw.
        .env("JCLAW_TUI", "1");

    // Bun's `--cwd` points at the vendored package (so its deps and the opentui
    // preload resolve), which would otherwise make the TUI treat that package as
    // the project. Pass the user's actual directory as the `[project]` positional
    // so `cd <dir> && jclaw` opens there. A project the user named explicitly
    // still wins — it appears earlier in argv and the TUI takes the first one.
    if let Ok(cwd) = std::env::current_dir() {
        command.arg(cwd);
    }

    exec_replacing(command, &bun)
}

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

/// Locate the vendored `tui/` root by checking, in order: the `JCLAW_TUI_DIR`
/// override, the build-time repo layout (dev builds), and a walk up from both
/// the executable's directory and the current working directory.
fn locate_tui_dir() -> Result<PathBuf, Box<dyn Error>> {
    if let Some(dir) = std::env::var_os("JCLAW_TUI_DIR") {
        let dir = PathBuf::from(dir);
        if is_tui_dir(&dir) {
            return Ok(dir);
        }
        return Err(format!(
            "JCLAW_TUI_DIR={} does not contain {TUI_ENTRY_REL}",
            dir.display()
        )
        .into());
    }

    // Dev builds: `<repo>/rust/crates/rusty-claude-cli` → `<repo>/tui`.
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_dir.ancestors().nth(3) {
        let candidate = repo_root.join("tui");
        if is_tui_dir(&candidate) {
            return Ok(candidate);
        }
    }

    // Installed/relocated: walk up from the executable and the cwd.
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        roots.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    for start in roots {
        for ancestor in start.ancestors() {
            let candidate = ancestor.join("tui");
            if is_tui_dir(&candidate) {
                return Ok(candidate);
            }
        }
    }

    Err("could not find the vendored `tui/` directory.\nSet JCLAW_TUI_DIR to the path of jclaw's `tui/` folder.".into())
}

/// A directory is the vendored TUI root if it holds the entry file.
fn is_tui_dir(dir: &Path) -> bool {
    dir.join(TUI_ENTRY_REL).is_file()
}

/// Minimal `which`: scan `PATH` for an executable named `name`.
fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Replace the current process with the TUI so it owns the terminal directly.
#[cfg(unix)]
fn exec_replacing(mut command: Command, bun: &Path) -> Result<(), Box<dyn Error>> {
    use std::os::unix::process::CommandExt;
    // `exec` only returns on failure.
    let error = command.exec();
    Err(format!("failed to launch the TUI via {}: {error}", bun.display()).into())
}

/// Non-Unix fallback: spawn, wait, and propagate the exit code.
#[cfg(not(unix))]
fn exec_replacing(mut command: Command, bun: &Path) -> Result<(), Box<dyn Error>> {
    let status = command
        .status()
        .map_err(|error| format!("failed to launch the TUI via {}: {error}", bun.display()))?;
    std::process::exit(status.code().unwrap_or(1));
}

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
            PathBuf::from("/home/u")
                .join(".bun")
                .join("bin")
                .join(bun_name())
        );
    }

    #[test]
    fn user_profile_used_when_home_absent() {
        let got = bun_candidates(None, None, None, Some(OsStr::new("C:\\Users\\u")));
        assert_eq!(
            got,
            vec![PathBuf::from("C:\\Users\\u")
                .join(".bun")
                .join("bin")
                .join(bun_name())]
        );
    }

    #[test]
    fn empty_when_nothing_available() {
        assert!(bun_candidates(None, None, None, None).is_empty());
    }
}
