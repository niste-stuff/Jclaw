//! Core logic for `jclaw update`: checking GitHub releases for
//! `niste-stuff/Jclaw`, comparing against the running binary's own version,
//! and locating the jclaw git checkout (macOS/Linux only — Windows updates
//! via the packaged installer, no git involved). Pure/testable functions
//! live here; the network- and process-touching wrappers that call them are
//! in `run_update_command` et al. in `lib.rs`, following the same split
//! `tui.rs`'s `bun_candidates()`/`locate_bun()` uses.
//!
//! See docs/superpowers/specs/2026-07-18-jclaw-update-command-design.md.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub(crate) const RELEASES_API_URL: &str = "https://api.github.com/repos/niste-stuff/Jclaw/releases";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReleaseAsset {
    pub(crate) name: String,
    pub(crate) download_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReleaseInfo {
    pub(crate) tag_name: String,
    pub(crate) assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VersionComparison {
    UpToDate,
    UpdateAvailable,
}

/// Compares the running binary's `CARGO_PKG_VERSION` against a release tag
/// (which may have a leading `v`). Prerelease-aware via `semver`, so
/// `0.2.0-beta.10` correctly sorts after `0.2.0-beta.5`.
pub(crate) fn compare_versions(
    current: &str,
    latest_tag: &str,
) -> Result<VersionComparison, String> {
    let latest = latest_tag.strip_prefix('v').unwrap_or(latest_tag);
    let current_v = semver::Version::parse(current)
        .map_err(|e| format!("failed to parse current version {current:?}: {e}"))?;
    let latest_v = semver::Version::parse(latest)
        .map_err(|e| format!("failed to parse latest tag {latest_tag:?} as a version: {e}"))?;
    Ok(if latest_v > current_v {
        VersionComparison::UpdateAvailable
    } else {
        VersionComparison::UpToDate
    })
}

/// Walks up from `start` (typically `std::env::current_exe()`) looking for a
/// directory containing both `.git` and `rust/Cargo.toml` — the jclaw repo
/// root. Bounded to 8 parent levels so an unrelated `.git` far up the tree
/// (e.g. the user's home directory) can't be mistaken for it.
pub(crate) fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut dir = start.parent()?;
    for _ in 0..8 {
        if dir.join(".git").exists() && dir.join("rust").join("Cargo.toml").is_file() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
    None
}

/// Picks the Windows installer + its checksum sidecar out of a release's
/// asset list. Returns `(installer, checksum)`.
pub(crate) fn select_windows_assets(
    assets: &[ReleaseAsset],
) -> Option<(&ReleaseAsset, &ReleaseAsset)> {
    let installer = assets.iter().find(|a| a.name == "jclaw-setup.exe")?;
    let checksum = assets.iter().find(|a| a.name == "jclaw-setup.exe.sha256")?;
    Some((installer, checksum))
}

/// Verifies `data` against a `sha256sum`-style sidecar's contents
/// (`"<hex digest>  <filename>"`, tolerant of a bare hex digest too).
pub(crate) fn verify_sha256(data: &[u8], sidecar_contents: &str) -> bool {
    let expected_hex = sidecar_contents
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    if expected_hex.is_empty() {
        return false;
    }
    let mut hasher = Sha256::new();
    hasher.update(data);
    let actual_hex = format!("{:x}", hasher.finalize());
    expected_hex == actual_hex
}

use std::io::Read;
use std::process::Command;

/// Fetches the newest release (including prereleases — the list endpoint
/// returns everything, newest first) for `niste-stuff/Jclaw`.
pub(crate) fn fetch_latest_release(
    client: &reqwest::blocking::Client,
) -> Result<ReleaseInfo, String> {
    let response = client
        .get(RELEASES_API_URL)
        .header("User-Agent", "jclaw-update")
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("failed to reach GitHub releases: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub releases request failed: HTTP {}",
            response.status()
        ));
    }

    // reqwest's `Response::json()` needs the `json` feature, which this
    // crate doesn't enable (matching `tools`' existing reqwest declaration
    // in Cargo.toml) — parse via serde_json directly instead.
    let text = response
        .text()
        .map_err(|e| format!("failed to read GitHub releases response: {e}"))?;
    let body: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("failed to parse GitHub releases response: {e}"))?;

    let releases = body
        .as_array()
        .ok_or_else(|| "unexpected GitHub releases response shape (not an array)".to_string())?;

    let latest = releases
        .iter()
        .find(|r| r.get("draft").and_then(serde_json::Value::as_bool) != Some(true))
        .ok_or_else(|| "no non-draft releases found".to_string())?;

    let tag_name = latest
        .get("tag_name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "release is missing tag_name".to_string())?
        .to_string();

    let assets = latest
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let name = a.get("name")?.as_str()?.to_string();
                    let download_url = a.get("browser_download_url")?.as_str()?.to_string();
                    Some(ReleaseAsset { name, download_url })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ReleaseInfo { tag_name, assets })
}

/// Downloads `jclaw-setup.exe` + its checksum sidecar, verifies the
/// checksum, and launches the installer interactively (same UI a manual
/// double-click goes through — beta.5's `ExtractPayload` `DelTree` fix
/// already makes re-running it a safe in-place upgrade). Does not wait for
/// the installer to finish; the caller should exit jclaw immediately after
/// this returns so the installer can freely overwrite the install dir.
pub(crate) fn run_windows_update(
    client: &reqwest::blocking::Client,
    release: &ReleaseInfo,
) -> Result<(), String> {
    let (installer_asset, checksum_asset) =
        select_windows_assets(&release.assets).ok_or_else(|| {
            format!(
            "release {} exists but the Windows installer isn't attached yet — try again shortly.",
            release.tag_name
        )
        })?;

    let installer_bytes = download(client, &installer_asset.download_url)?;
    let checksum_text = String::from_utf8(download(client, &checksum_asset.download_url)?)
        .map_err(|e| format!("checksum file is not valid text: {e}"))?;

    if !verify_sha256(&installer_bytes, &checksum_text) {
        return Err(
            "downloaded installer failed checksum verification — refusing to run it.".to_string(),
        );
    }

    // Write to a unique path per run so concurrent/repeat updates can't
    // collide and a stale file can't be silently reused. The checksum has
    // already been verified above, so we only ever write bytes we trust.
    let installer_path = std::env::temp_dir().join(unique_installer_name());
    std::fs::write(&installer_path, &installer_bytes).map_err(|e| {
        format!(
            "failed to write installer to {}: {e}",
            installer_path.display()
        )
    })?;

    Command::new(&installer_path)
        .spawn()
        .map_err(|e| format!("failed to launch {}: {e}", installer_path.display()))?;

    Ok(())
}

/// Builds a per-run installer filename that won't collide with a concurrent
/// or previous update. Combines the process id with a high-resolution
/// timestamp so two runs on the same machine can't land on the same path,
/// avoiding reuse of a stale `jclaw-setup.exe`.
fn unique_installer_name() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("jclaw-setup-{}-{}.exe", std::process::id(), nanos)
}

fn download(client: &reqwest::blocking::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .header("User-Agent", "jclaw-update")
        .send()
        .map_err(|e| format!("failed to download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "download failed: {url} returned HTTP {}",
            response.status()
        ));
    }
    let mut buf = Vec::new();
    response
        .read_to_end(&mut buf)
        .map_err(|e| format!("failed to read response body from {url}: {e}"))?;
    Ok(buf)
}

/// Updates a macOS/Linux source checkout to `tag`: refuses on a dirty
/// working tree, otherwise `git fetch --tags` + `git checkout <tag>`
/// (detached HEAD — expected, this installs exactly that release), re-syncs
/// `tui/node_modules` via `bun install` (the new tag may have changed JS
/// deps, and `node_modules` is git-ignored so checkout alone won't touch
/// it), then rebuilds + relinks via the existing install script.
pub(crate) fn run_unix_update(repo_root: &Path, tag: &str) -> Result<(), String> {
    if crate::git_worktree_is_dirty(repo_root) {
        return Err(
            "the jclaw checkout has uncommitted changes — commit or stash them, then run `jclaw update` again.".to_string(),
        );
    }

    run_checked(repo_root, "git", &["fetch", "--tags"])?;
    run_checked(repo_root, "git", &["checkout", tag])?;
    // `current_dir` alone is enough for `bun install` to target `tui/` — no
    // need for an extra `--cwd` flag.
    run_checked(&repo_root.join("tui"), "bun", &["install"])?;

    let install_script = repo_root.join("scripts").join("install-jclaw.sh");
    let install_script_str = install_script.display().to_string();
    run_checked(repo_root, "bash", &[install_script_str.as_str()])?;

    Ok(())
}

fn run_checked(cwd: &Path, program: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("failed to run `{program}`: {e} (is it installed and on PATH?)"))?;
    if !output.status.success() {
        return Err(format!(
            "`{program} {}` failed:\n{}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn compare_versions_detects_update_available() {
        assert_eq!(
            compare_versions("0.1.3", "v0.2.0-beta.5").unwrap(),
            VersionComparison::UpdateAvailable
        );
    }

    #[test]
    fn compare_versions_detects_up_to_date() {
        assert_eq!(
            compare_versions("0.2.0-beta.5", "v0.2.0-beta.5").unwrap(),
            VersionComparison::UpToDate
        );
    }

    #[test]
    fn compare_versions_running_newer_than_latest_is_up_to_date() {
        assert_eq!(
            compare_versions("0.2.0-beta.6", "v0.2.0-beta.5").unwrap(),
            VersionComparison::UpToDate
        );
    }

    #[test]
    fn compare_versions_prerelease_ordering_is_semver_aware() {
        // beta.10 must sort after beta.5, not before it (string comparison
        // would get this backwards).
        assert_eq!(
            compare_versions("0.2.0-beta.5", "v0.2.0-beta.10").unwrap(),
            VersionComparison::UpdateAvailable
        );
    }

    #[test]
    fn compare_versions_rejects_unparseable_current_version() {
        assert!(compare_versions("not-a-version", "v0.2.0-beta.5").is_err());
    }

    #[test]
    fn find_repo_root_locates_root_from_nested_release_binary_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("rust").join("target").join("release")).unwrap();
        fs::write(
            root.join("rust").join("Cargo.toml"),
            "[workspace.package]\n",
        )
        .unwrap();
        let exe_path = root
            .join("rust")
            .join("target")
            .join("release")
            .join("jclaw");
        fs::write(&exe_path, "").unwrap();

        assert_eq!(find_repo_root(&exe_path), Some(root.to_path_buf()));
    }

    #[test]
    fn find_repo_root_returns_none_outside_a_checkout() {
        let tmp = TempDir::new().unwrap();
        let exe_path = tmp.path().join("jclaw");
        fs::write(&exe_path, "").unwrap();
        assert_eq!(find_repo_root(&exe_path), None);
    }

    #[test]
    fn find_repo_root_ignores_git_dir_without_rust_cargo_toml() {
        // A `.git` far up the tree (e.g. the user's home directory happens to
        // be a repo) must not be mistaken for the jclaw checkout.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("some").join("nested").join("dir")).unwrap();
        let exe_path = root.join("some").join("nested").join("dir").join("jclaw");
        fs::write(&exe_path, "").unwrap();

        assert_eq!(find_repo_root(&exe_path), None);
    }

    #[test]
    fn select_windows_assets_finds_installer_and_checksum() {
        let assets = vec![
            ReleaseAsset {
                name: "jclaw-setup.exe".to_string(),
                download_url: "https://example.com/jclaw-setup.exe".to_string(),
            },
            ReleaseAsset {
                name: "jclaw-setup.exe.sha256".to_string(),
                download_url: "https://example.com/jclaw-setup.exe.sha256".to_string(),
            },
            ReleaseAsset {
                name: "claw-linux-x64".to_string(),
                download_url: "https://example.com/claw-linux-x64".to_string(),
            },
        ];
        let (installer, checksum) = select_windows_assets(&assets).unwrap();
        assert_eq!(installer.name, "jclaw-setup.exe");
        assert_eq!(checksum.name, "jclaw-setup.exe.sha256");
    }

    #[test]
    fn select_windows_assets_none_when_installer_missing() {
        let assets = vec![ReleaseAsset {
            name: "claw-linux-x64".to_string(),
            download_url: "https://example.com/claw-linux-x64".to_string(),
        }];
        assert!(select_windows_assets(&assets).is_none());
    }

    #[test]
    fn verify_sha256_accepts_matching_digest() {
        let data = b"hello world";
        // sha256sum-style sidecar: "<hex>  <filename>\n"
        let sidecar =
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9  jclaw-setup.exe\n";
        assert!(verify_sha256(data, sidecar));
    }

    #[test]
    fn verify_sha256_rejects_mismatched_digest() {
        let data = b"tampered content";
        let sidecar =
            "b94d27b9934d3e08a52e52d7da7dacefac9debc7860badd1cf3c00f10e5d3d3  jclaw-setup.exe\n";
        assert!(!verify_sha256(data, sidecar));
    }

    #[test]
    fn verify_sha256_rejects_empty_sidecar() {
        assert!(!verify_sha256(b"anything", ""));
    }
}
