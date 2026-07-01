# jclaw TUI — Handoff

You are continuing work on **jclaw**, a Rust CLI (repo root: `/Users/westin/Desktop/Jclaw`).
We vendored **opencode's** full Bun/Solid/OpenTUI front end **and** the server it needs
into `tui/`, wired a Rust launcher (`claw tui`), and started rebranding it to jclaw.
Your job: finish the opencode→jclaw rebrand of the **user-facing** surface **without**
breaking the OpenCode Zen free-model backend.

---

## 1. Architecture (how it fits together)

- `tui/` is a **Bun workspace** — a vendored subset of opencode's monorepo: the 14-package
  transitive closure needed to run the TUI + server (`tui, ui, core, sdk, plugin, server,
  opencode, llm, schema, protocol, script, http-recorder, effect-drizzle-sqlite,
  effect-sqlite-node`) plus root config and `patches/`.
- `tui/node_modules` is **git-ignored** (~1 GB). Run `bun install` in `tui/` to materialize it.
- Entry / launch: opencode's CLI at `tui/packages/opencode/src/index.ts`; the default command
  (`[project]`) starts the TUI (worker + embedded server + Solid/OpenTUI UI).
- Rust launcher: `rust/crates/rusty-claude-cli/src/tui.rs`, dispatched from `main.rs` `run()`
  when `argv[0] == "tui"`. It finds Bun + the `tui/` dir and `exec`s
  `bun run --cwd tui/packages/opencode src/index.ts <args>`.

**Run it:** `cd /Users/westin/Desktop/Jclaw/rust && cargo run --bin claw -- tui`
(or the built binary: `rust/target/debug/claw tui`). Needs a real TTY (full-screen).

---

## 2. Critical constraints — DO NOT BREAK

1. **Keep OpenCode Zen working (user requirement).** The free models (e.g.
   `deepseek-v4-flash-free`) come from provider `providerID: "opencode"` = **OpenCode Zen**,
   opencode's hosted gateway. Leave all of this alone:
   - Provider IDs / the `opencode` provider (`packages/*/src/provider/**`, model catalogs).
   - Functional URLs: `https://opencode.ai/config.json` (config **schema**), `opencode.ai/zen`,
     `opencode.ai/zen/v1`, `api.opencode.ai`, `app.opencode.ai`, `console.opencode.ai`,
     the anthropic/cloudflare proxy endpoints, npm/registry/install URLs.
   - `x-title: "opencode"` / HTTP attribution headers (telemetry; harmless to leave).
2. **Config is intentionally SHARED with the user's real opencode** so Zen + prior setup
   carry over. `packages/core/src/global.ts` hardcodes `const app = "opencode"`, so jclaw
   reads/writes `~/.config/opencode`, `~/.local/share/opencode` (sessions DB),
   `~/.local/state/opencode` (model selection). **Do NOT change `app` to "jclaw"** unless the
   user explicitly asks to isolate — it would lose the inherited Zen/model setup. (Trade-off is
   documented; it's their call.)

**Rule of thumb:** rebrand **display strings** (titles, descriptions, tips, dialog copy, help,
logo, window title). Leave **wire/plumbing** (provider IDs, schema/API/zen URLs, XDG app dir,
env-var names like `OPENCODE_*`, `Flag.*`) untouched.

---

## 3. Already done (verified: TUI boots + renders as jclaw)

- Logo → "jclaw" wordmark, all 3 copies: `packages/tui/src/logo.ts`,
  `packages/tui/src/util/presentation.ts`, `packages/opencode/src/cli/ui.ts` (the flat
  `wordmark`). (Rough `a`/`w` glyphs — refine if desired.)
- CLI `scriptName("opencode")` → `"claw"` in `packages/opencode/src/index.ts`.
- Terminal window title "OpenCode"/"OC | …" → "jclaw"/"jclaw | …" in
  `packages/tui/src/app.tsx` (~line 452–469).
- "Open docs" command no longer opens opencode.ai; opens jclaw's README (env override
  `JCLAW_DOCS_URL`), `packages/tui/src/app.tsx` (~line 804).

---

## 4. Remaining rebrand sweep (the bulk of the work)

Find candidates:
```
cd /Users/westin/Desktop/Jclaw/tui
grep -rniE "opencode" packages/tui/src packages/opencode/src/cli \
  --include=*.ts --include=*.tsx | grep -v node_modules
```
For each hit, decide **display vs plumbing** using the rule in §2. Rebrand display; skip plumbing.

Highest-value user-facing hotspots (counts are approximate "opencode" mentions):
- `packages/tui/src/feature-plugins/home/tips-view.tsx` (~25) — home-screen tips; several name
  opencode / "opencode.ai" (e.g. the `/share` tip, `/connect` tip). Rebrand copy; `/share`
  itself is a functional opencode feature (uploads to opencode.ai) — reword, don't remove,
  or flag to the user.
- `packages/tui/src/context/theme.tsx` (~9) — built-in theme names (e.g. an "opencode" theme).
  Rename the default/label to jclaw; consider a jclaw color theme (see §5).
- `packages/tui/src/component/dialog-provider.tsx` / `dialog-model.tsx` — "OpenCode Go/Zen"
  copy and the `opencode.ai/go` link in the provider dialog. Reword labels; the Go/Zen URLs
  are functional (keep the URL, soften surrounding prose).
- `packages/tui/src/attention.ts` (~10) — notification/attention strings.
- `packages/tui/src/component/error-component.tsx` — error UI mentioning opencode (issue link).
- CLI command **descriptions** (`describe:`) across `packages/opencode/src/cli/cmd/*.ts`
  (`run.ts`, `tui.ts`, `models.ts`, `import.ts`, `mcp.ts`, `providers.ts`, `pr.ts`,
  `github.handler.ts`, `debug/*`, `run/*`). Many say "opencode" ("start opencode tui",
  "run opencode with a message"). Rebrand the human text; keep flags/behavior.
  - `uninstall.ts` (~25) references `opencode-ai` npm pkg + install paths — that's the real
    opencode installer/uninstaller for the prebuilt binary. Low priority; arguably leave or
    disable, since jclaw isn't installed via npm. Confirm with user before touching.

Nice-to-have, lower priority:
- Help dialog (`packages/tui/src/ui/dialog-help.tsx`) copy/links.
- `packages/opencode/src/cli/cmd/upgrade.ts`, `installation/index.ts` — self-upgrade points at
  opencode releases; not meaningful for jclaw. Consider disabling `claw upgrade`.

---

## 5. Deeper customization (beyond string rebrand) — optional, ask user first

- **Theme**: add a jclaw color theme in `packages/tui/src/context/theme.tsx` (or the theme
  registry it reads) and make it default. The current accent is opencode's purple/orange.
- **Default agent = janitor card author**: jclaw's real purpose is authoring JanitorAI
  character cards. The opencode "Build/Plan" agents live in the agent config
  (`packages/*/src/agent/**` + config). Wire a default jclaw agent whose system prompt is the
  card-author persona (mirror `rust/crates/runtime/src/prompt.rs` `JANITOR_STYLE_PROMPT`).
- **Config isolation** (only if user changes their mind): flip `app` in
  `packages/core/src/global.ts` to `"jclaw"` → own `~/.config/jclaw` etc. Loses inherited Zen
  setup; user said keep it shared for now.

---

## 6. Build / run / verify

- **Rust side** (from `/Users/westin/Desktop/Jclaw/rust`):
  - `scripts/fmt.sh --check` (repo root) — formatting gate.
  - `cargo clippy -p rusty-claude-cli --all-targets -- -D warnings` — **strict**, must pass.
  - Build: `cargo build --bin claw`.
- **TUI side** (from `/Users/westin/Desktop/Jclaw/tui`, `export PATH="$HOME/.bun/bin:$PATH"`):
  - Deps: `bun install` (needs network; ~1 GB).
  - **Headless boot test** (verifies the server + stack run):
    `bun run --cwd packages/opencode src/index.ts serve --port 14780 --print-logs` then
    `curl -s http://127.0.0.1:14780/app | head` (expect HTML). Kill with `lsof -ti tcp:14780 | xargs kill`.
  - **TUI render probe** (non-TTY; confirms it draws, then exits on no-TTY):
    `bun run --cwd packages/opencode src/index.ts < /dev/null` for ~7s, grep the output for
    `▀▀█▀` / `Ask anything` to confirm the jclaw masthead renders.
  - **Real interactive run**: launch in a Terminal window, e.g. via
    `osascript -e 'tell application "Terminal" to do script "exec /Users/westin/Desktop/Jclaw/rust/target/debug/claw tui"'`.
  - `bun typecheck` at `tui/` root exists but is heavy; per-file review is usually enough.

---

## 7. Environment gotchas

- **Bun**: installed at `~/.bun/bin/bun` (1.3.14). Not on the default PATH in every shell —
  `export PATH="$HOME/.bun/bin:$PATH"` or use the absolute path. The Rust launcher finds it at
  `~/.bun/bin/bun` (or `$JCLAW_BUN`).
- **Vendoring build fixes already applied** (don't undo): `tui/package.json` `workspaces` was
  trimmed to only the vendored packages (removed `packages/console/*`, `packages/stats/*`,
  `packages/slack`); the `husky` `prepare` script was removed; `tui/patches/` was copied so
  `patchedDependencies` resolve. If `bun install` errors with "Workspace not found", a
  package.json references a package that wasn't vendored — trim it or vendor that package.
- **git**: `tui/node_modules` is git-ignored; never commit it. The vendored source (~3.5k files)
  is committed. Rust gates (fmt + strict clippy) must stay green.
- **Bash tool cwd**: it can reset to the repo root between calls — prefix commands with an
  explicit `cd /Users/westin/Desktop/Jclaw/tui &&`.
- Full-screen TUIs can't be driven from a non-TTY tool channel; use the render probe for
  automated checks and a real Terminal for interactive verification.

---

## 8. Suggested next steps (in order)

1. Sweep CLI `describe:` strings in `packages/opencode/src/cli/cmd/*.ts` (quick, high-signal).
2. Rebrand `tips-view.tsx` home tips + `dialog-provider.tsx`/`dialog-model.tsx` copy.
3. `context/theme.tsx` + `attention.ts` + `error-component.tsx`.
4. Then (ask user): jclaw theme, default card-author agent, disable `upgrade`/`uninstall`.
5. Re-verify: headless boot test + TUI render probe + Rust clippy/fmt. Commit in logical chunks.
</content>
