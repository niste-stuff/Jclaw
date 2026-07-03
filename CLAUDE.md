# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Detected stack
- Languages: Rust.
- Frameworks: none detected from the supported starter markers.

## Verification
- Run Rust verification from repo root: `scripts/fmt.sh --check`; for formatting use `scripts/fmt.sh`. Run Rust clippy/tests from `rust/`: `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`

## Repository shape
- `rust/` contains the Rust workspace and active CLI/runtime implementation.
- `tui/` contains the vendored Bun/Solid/OpenTUI front end, rebranded to jclaw.
- `tests/` contains `test_pre_push_hook_contract.py`, which validates `.github/hooks/pre-push`. Run it with `python3 -m unittest discover -s tests`.

## Working agreement
- Prefer small, reviewable changes and keep generated bootstrap files aligned with actual repo workflows.
- Keep shared defaults in `.claude.json`; reserve `.claude/settings.local.json` for machine-local overrides.
- Do not overwrite existing `CLAUDE.md` content automatically; update it intentionally when repo workflows change.
