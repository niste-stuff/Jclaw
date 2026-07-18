#!/usr/bin/env bash
# Fails if rust/Cargo.toml's [workspace.package] version doesn't match the
# given release tag (minus its leading `v`). Run in CI on every `v*` tag push
# so jclaw's self-reported version (used by `jclaw update`'s comparison
# logic) can't silently drift from the release tags again — see
# docs/superpowers/specs/2026-07-18-jclaw-update-command-design.md.
#
# Usage: scripts/check-version-matches-tag.sh v0.2.0-beta.5
set -euo pipefail

TAG="${1:?usage: check-version-matches-tag.sh <tag>}"
EXPECTED="${TAG#v}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_TOML="${JCLAW_CARGO_TOML_OVERRIDE:-$REPO/rust/Cargo.toml}"

ACTUAL="$(grep -m1 '^version = ' "$CARGO_TOML" | sed -E 's/^version = "(.*)"$/\1/' || true)"

if [ -z "$ACTUAL" ]; then
  echo "no \"version = \" line found in $CARGO_TOML" >&2
  exit 1
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "version mismatch: rust/Cargo.toml has \"$ACTUAL\", tag $TAG expects \"$EXPECTED\"" >&2
  echo "bump [workspace.package] version in rust/Cargo.toml to \"$EXPECTED\" before tagging." >&2
  exit 1
fi

echo "OK: rust/Cargo.toml version ($ACTUAL) matches tag $TAG"
