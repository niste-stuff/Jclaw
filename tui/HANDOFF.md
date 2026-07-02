# jclaw TUI — Handoff

**jclaw** is a Rust CLI (repo root: `/Users/westin/Desktop/Jclaw`). We vendored
**opencode's** full Bun/Solid/OpenTUI front end **and** the server it needs into `tui/`,
wired a Rust launcher (`claw tui`), and rebranded the user-facing surface to jclaw
**without breaking the OpenCode Zen free-model backend**.

The user-facing rebrand, the jclaw-specific features, and a full debug audit (see §3) are
**done and merged to `main`** (fast-forward from `jclaw-rebrand-sweep` at `42d4ee0`).

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

**Run it (simplest):** `jclaw` is installed globally at `~/.local/bin/jclaw` (via
`scripts/install-jclaw.sh`) — just `cd <project> && jclaw`. It execs the **release** binary,
which in turn runs the vendored TS via Bun, so **edits under `tui/` take effect on the next
`jclaw` with no rebuild**. Only re-run `install-jclaw.sh` if the *Rust* launcher changes.
Dev alternative: `cd rust && cargo run --bin claw -- tui`. Needs a real TTY (full-screen).

---

## 2. Critical constraints — DO NOT BREAK

1. **Keep OpenCode Zen working (user requirement).** The free models (e.g.
   `deepseek-v4-flash-free`) come from provider `providerID: "opencode"` = **OpenCode Zen**,
   opencode's hosted gateway. Leave all of this alone:
   - Provider IDs / the `opencode` provider (`packages/*/src/provider/**`, model catalogs).
   - Functional URLs: `https://opencode.ai/config.json` (config **schema**), `opencode.ai/zen`,
     `opencode.ai/zen/v1`, `api.opencode.ai`, `app.opencode.ai`, `console.opencode.ai`, the
     anthropic/cloudflare proxy endpoints, npm/registry/install URLs, the theme `$schema` URL.
   - The **"OpenCode Zen" / "OpenCode Go"** product names in `dialog-provider.tsx` /
     `dialog-model.tsx` — real external services the user authenticates against.
   - `x-title: "opencode"` / HTTP attribution headers (telemetry; harmless to leave).
2. **Config is intentionally SHARED with the user's real opencode** so Zen + prior setup
   carry over. `packages/core/src/global.ts` hardcodes `const app = "opencode"`, so jclaw
   reads/writes `~/.config/opencode`, `~/.local/share/opencode` (sessions DB),
   `~/.local/state/opencode` (model selection). **Do NOT change `app` to "jclaw"** unless the
   user explicitly asks to isolate — it would lose the inherited Zen/model setup.

**Rule of thumb:** rebrand **display strings** (titles, descriptions, tips, dialog copy, help,
logo, window title). Leave **wire/plumbing** untouched: provider IDs, schema/API/zen URLs, the
XDG app dir, env-var names (`OPENCODE_*`), `Flag.*`, config filenames/paths (`opencode.json`,
`.opencode/`), internal identifiers (`OpencodeModeStack`, `opencode-plain-text`), and the
opencode GitHub-agent infrastructure (`github.handler.ts`).

---

## 3. Done on branch `jclaw-rebrand-sweep` (items 1–8 first session; 9–13 the audit/feature session)

Verified via per-package `tsgo --noEmit` typecheck, the non-TTY render probe, the live server
`/agent` endpoint, and (since item 10) the full bun test suites of all vendored packages.

1. `8b1af3a` **Finish the user-facing rebrand + disable opencode-only features.** Rebranded
   display strings across CLI `describe:`/output, home tips, permission dialogs (main + mini),
   crash headline, notifications, MCP/error hints, mini splash. Fixed a latent bug: the
   `show()` logo guard in `index.ts` still checked `"opencode "` after `scriptName("claw")`.
   **Disabled** the `upgrade`/`uninstall` CLI commands (unregistered in `index.ts`; the files
   remain as dead exports). **Removed** home tips for opencode-hosted infra (GitHub agent,
   docker image). The crash screen now copies a **plain-text** report instead of a pre-filled
   `github.com/anomalyco/opencode` issue URL (jclaw has no issue tracker).
2. `4414590` **Default `jclaw` color theme** — `packages/tui/src/theme/assets/jclaw.json`
   (teal primary / amber accent), registered in `theme/index.ts`, set as default in
   `context/theme.tsx`. The built-in `opencode` theme stays available in `/themes`.
3. `bafcee4` **User-editable splash texts** replace the built-in tip rotation. Home screen
   shows a random line each launch from
   `packages/tui/src/feature-plugins/home/splash-texts.ts` (the file to edit). `tips-view.tsx`
   was slimmed to read from it (built-in tips + shortcut machinery removed).
4. `a5b3779` **Renamed the `plan` agent → `lore planning`** and repurposed its injected prompt
   (`session/prompt/plan.txt`, and the experimental `plan-mode.txt`) for character work: lore,
   personality, appearance, backstory, relationships, voice, scenario hooks. Updated the
   `"plan"` identifier checks in `session/reminders.ts`, the `plan_enter` switch handler in
   `routes/session/index.tsx`, and the `plan_enter`/`plan_exit` tool copy.
5. `e930e43` **New `peak` agent** (`packages/opencode/src/agent/prompt/peak.txt`, registered in
   `agent/agent.ts`) — a primary, edit-capable card author. Its prompt forbids the "bad card"
   anatomy (AI tells, clichés, adjective-list personalities, token bloat, speaking for
   `{{user}}`, bad formatting) and requires a strong **hook** (a first message that drops
   `{{user}}` into a live scene without dictating their actions). Its prompt fully replaces the
   base system prompt (see `session/llm/request.ts:60`).
6. `3061e1f` **Splash-text content** (the user's own lines).
7. `6ed35ae` **`lore planning` + `peak` are model-following presets.** The TUI stored the model
   per agent name (`modelStore.model[agentName]` in `context/local.tsx`); a new `modelKey()`
   helper routes those two presets to the shared `build` model slot for reads + all setters, so
   switching to them keeps the current model and changing the model applies across all three.
8. `4680cac` **Pruned dev/infra commands, added card-authoring commands, tidied the palette.**
   Removed everything with no value to card authoring: the plugin manager and diff-viewer
   builtins (unregistered from `feature-plugins/builtins.ts`), the debug/console/heap-snapshot
   and terminal-suspend dev actions, the git worktree/workspace commands (`workspace.copy_path`,
   `workspace.list`, `workspace.set`/Warp), and the file-context/diffwrap/session-directory-
   filter toggles — erased at all three coupling points (command def in `app.tsx` or
   `component/prompt/index.tsx`, the keybind gather array, and `config/keybind.ts`
   `Definitions`/`CommandMap`). Added three new `/` commands in `component/prompt/index.tsx`
   (category "Cards") that prefill the composer via a `fillPrompt` helper: `/card` (scaffold a
   new card, switches to `peak`), `/rewrite` (de-slop the current card, switches to `peak`),
   `/contradictions` (scan for internal inconsistencies, stays on current agent). Tidied
   `command-palette.tsx` (the `ctrl+p` dialog) to match the `/` popup: commands need a
   `slashName` to appear in the palette, and the palette no longer shows description text (just
   title + keybind footer).

9. `0629ba4` **Fixed dead ctrl+z + removed the obsolete `terminalSuspend` option.** Found by
   the audit: removing the suspend command left ctrl+z bound to nothing on macOS/Linux (the
   ctrl+z→undo remap only ran on Windows). ctrl+z is now part of the `input_undo` default;
   `resolve()` lost its options argument (callers in `config/tui.ts` + `run/runtime.boot.ts`
   updated).
10. `e2189e5` **Synced the vendored test suites** with the rebrand/agent/pruning changes (33
   stale failures across tui/opencode/schema): claw epilogue + models-hint copy, jclaw
   notification title + permission copy, plan → "lore planning" (+ peak in the roster),
   removed diff/plugin keybinds, regenerated CLI help snapshots, event-manifest counts.
   **All 8 package suites now pass** — treat `bun test` as a gate from now on.
11. `94f9043` **Restored the palette-dropped commands** by giving them slash names (see §8's
   old list): `/mode`, `/lockmode`, `/docs`, `/terminaltitle`, `/animations`, `/pastesummary`,
   `/autoapprove` (alias `/yolo`), `/variantcycle`, `/sidebar`, `/conceal`, `/tooldetails`,
   `/scrollbar`, `/tooloutput`, `/copylast`, `/clearcontext`, `/tips`. Also removed the `Flag`
   import orphaned in `component/prompt/index.tsx` by the command pruning.
12. `748331e` **Repurposed `build` as jclaw's workshop default** — new
   `agent/prompt/build.txt` (replaces the opencode coding persona): general-purpose assistant,
   card-library management, same no-slop bar as peak, routes brainstorming → `lore planning`
   and whole-card writing → `peak`. Name/permissions/tools unchanged.
13. `544ee14` **Light-mode theme contrast fix** — textMuted/primary/accent were below 4.5:1 on
   the light background; now ~5:1. Dark mode was already fine.

Earlier (pre-session, already on `main`): logo wordmark, `scriptName("claw")`, terminal window
title, and the "Open docs" command (opens jclaw's README via `JCLAW_DOCS_URL`).

**Result:** "opencode" mentions under `packages/tui/src` + `packages/opencode/src/cli` went
507 → ~458; the remainder is all plumbing (see §2 rule of thumb).

---

## 4. Deliberately LEFT (don't "re-fix" these — it breaks things)

- OpenCode Zen / OpenCode Go product copy and the `opencode` provider id (constraint §2.1).
- Shared XDG app dir + config filenames (`opencode.json`, `.opencode/`) (constraint §2.2).
- Functional URLs, `OPENCODE_*` env vars, `Flag.*`, internal identifiers.
- The opencode GitHub-agent infrastructure in `cli/cmd/github.handler.ts` (workflow names, API
  endpoints, bot usernames, `/opencode` triggers) — rebranding would break a feature that only
  works against opencode's hosted infra anyway.
- `uninstall.ts` / `upgrade.ts` file bodies (the commands are unregistered; source is dead).

---

## 5. Notes / gotchas specific to this work

- **Theme won't visibly change on this machine.** `~/.local/state/opencode/kv.json` has
  `theme: "tokyonight"`, which overrides the new `jclaw` default (default only applies when no
  theme is chosen). To see jclaw: `/themes` → **jclaw** (or clear that KV key).
- **Agents are keyed by `name`, which doubles as the identifier and (titlecased) the display.**
  The record key in `agent/agent.ts` must equal `name`. `@`-mentions exclude primary agents, so
  the space in `"lore planning"` is safe. Switcher shows the raw name; footer titlecases it.
- **Per-agent model storage** lives in `context/local.tsx` (`modelStore.model[agentName]`,
  in-memory only — not persisted; `model.json` only holds `recent`/`favorite`/`variant`). The
  `modelKey()` helper is where you'd add/remove "preset" agents that share `build`'s model.
- The **default agent model** for `peak`/`lore planning` is whatever you've selected (free
  DeepSeek V4 Flash via Zen by default). Pin a stronger model to `peak` by adding a `model:` to
  its `agent/agent.ts` entry if desired.
- **Command wiring (palette / `/` popup / keybinds) — one command definition drives all three.**
  Commands are registered via `useBindings({ commands: [...] })` scattered across several files
  (`app.tsx`, `component/prompt/index.tsx`, `routes/session/index.tsx`,
  `feature-plugins/system/*.tsx`); each entry needs `namespace: "palette"` to reach the `ctrl+p`
  dialog, and a `slashName` to also reach the `/` popup (`command-palette.tsx` now requires
  `slashName` to show in `ctrl+p` too, so the two lists stay identical). A keybind needs a
  matching entry in `config/keybind.ts` (`Definitions` + `CommandMap`) *and* the command name
  added to the relevant `keymap.gather(...)` array in the file that registers it — removing a
  command means deleting it in all three places or you'll get a dangling reference.
  `noUnusedLocals` is off in `tui/tsconfig.json`, so an orphaned import after removing a command
  won't fail typecheck — grep for stray references by hand.

---

## 6. Build / run / verify

- **Rust side** (from `/Users/westin/Desktop/Jclaw/rust`): `scripts/fmt.sh --check` (repo-root
  format gate); `cargo clippy -p rusty-claude-cli --all-targets -- -D warnings` (**strict**);
  `cargo build --bin claw`. (No Rust changed this session — all edits were in `tui/` TS.)
- **TUI side** (from `/Users/westin/Desktop/Jclaw/tui`, `export PATH="$HOME/.bun/bin:$PATH"`):
  - Deps: `bun install` (needs network; ~1 GB). `node_modules` is present on this machine.
  - **Typecheck (the TS build gate):** `bun run --cwd packages/tui typecheck` and
    `bun run --cwd packages/opencode typecheck` (each runs `tsgo --noEmit`). Both pass.
  - **Tests (now a gate):** `bun test` in each vendored package that has tests (tui, opencode,
    core, llm, schema, protocol, ui, http-recorder, effect-drizzle-sqlite). All pass as of
    this session. Known flake: `test/server/httpapi-v2-pty.test.ts` can fail under full-suite
    load (timing); it passes solo — rerun the file alone before blaming a change.
  - **Headless boot + agent list** (great end-to-end check):
    `bun run --cwd packages/opencode src/index.ts serve --port 14784 --print-logs`, then
    `curl -s http://127.0.0.1:14784/agent` (expect JSON incl. `lore planning`, `peak`). Kill
    with `lsof -ti tcp:14784 | xargs kill`.
  - **TUI render probe** (non-TTY; confirms it draws): run
    `bun run --cwd packages/opencode src/index.ts < /dev/null` for ~7s and grep the output for
    `Ask anything` / `▀▀█▀` (masthead) / `OpenCode Zen` (Zen intact).
  - **Real interactive run:** `jclaw` in a Terminal window (or the `osascript` Terminal trick).

---

## 7. Environment gotchas

- **Bun**: `~/.bun/bin/bun` (1.3.14), not always on PATH — `export PATH="$HOME/.bun/bin:$PATH"`.
  The Rust launcher finds it at `~/.bun/bin/bun` (or `$JCLAW_BUN`).
- **Vendoring build fixes already applied** (don't undo): `tui/package.json` `workspaces`
  trimmed to vendored packages; `husky` `prepare` script removed; `tui/patches/` copied so
  `patchedDependencies` resolve. "Workspace not found" on `bun install` = a package.json
  references an un-vendored package; trim or vendor it.
- **git**: `tui/node_modules` is git-ignored; never commit it. Rust gates (fmt + strict clippy)
  must stay green.
- **Bash tool cwd** can reset to repo root between calls — prefix with
  `cd /Users/westin/Desktop/Jclaw/tui &&`.
- Full-screen TUIs can't be driven from a non-TTY channel; use the render probe for automated
  checks and a real Terminal for interactive verification. Background the probe and grep its
  output file (foreground `sleep` is blocked by the harness).
- **Disk pressure causes phantom test failures.** This machine's data volume runs near 100%
  full; when free space drops to ~150 MB, snapshot/pty tests fail with confusing
  `FileSystem.writeFile`/ENOSPC errors. Check `df -h /System/Volumes/Data` before debugging.
  Safe space wins: `rust/target/debug` (~15 GB, regenerable — keep `target/release`, the
  installed `jclaw` execs it) and `/var/folders/.../T/opencode-test-data-*`.

---

## 8. Possible next steps

- Optional polish (ask user): pin a stronger model to `peak`; refine the jclaw logo glyphs.
- Config isolation (only if the user changes their mind): flip `app` in
  `packages/core/src/global.ts` to `"jclaw"` for its own XDG dirs — loses inherited Zen setup.
- The user's disk is nearly full (see §7) — worth flagging if test failures reappear.
