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

    exec_replacing(command, &bun)
}

/// Locate the `bun` executable: explicit override, then the default install
/// location, then `PATH`.
fn locate_bun() -> Result<PathBuf, Box<dyn Error>> {
    if let Some(path) = std::env::var_os("JCLAW_BUN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(&home).join(".bun/bin/bun");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Some(found) = which_in_path("bun") {
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
