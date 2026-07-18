# jclaw TUI — Handoff

**jclaw** is a Rust CLI (repo root: `/Users/westin/Desktop/Jclaw`). We vendored
**opencode's** full Bun/Solid/OpenTUI front end **and** the server it needs into `tui/`,
wired a Rust launcher (`claw tui`), and rebranded the user-facing surface to jclaw
**without breaking the OpenCode Zen free-model backend**.

The user-facing rebrand, the jclaw-specific features, and a full debug audit (see §3) are
**done and merged to `main`** (fast-forward from `jclaw-rebrand-sweep` at `42d4ee0`).
Items 1–39 are committed and pushed to `origin/main`. Items 17–18's outstanding "typecheck only"
caveat was resolved by item 24's session, which ran the full `bun test` across all packages
(3034 pass). Item 33 (dynamic `review-swarm` lens selection) shipped as `92f0aa5`; item 34
(`draft-swarm`/`section-draft` + `/takes`) shipped as `276db78`, which also caught the README up
to item 33; item 35 (`/evolve`/`/refine`) shipped as `94230f1`; item 36 (cross-checked card
rubric against external botmaking guides) shipped as `bb45a78`; item 37 (voice profiles)
committed and pushed. Item 38 (Windows one-click installer) was **merged to `main`** via
`1582435`. Item 39 (this session, 2026-07-10 evening) debugged the installer against a real
Windows laptop through five pre-releases — `v0.1.0-beta.2` (PATH) through `v0.1.0-beta.5`
(symlink-free payload, verified extraction, upstream-upgrade guard) — commits `fb949cc`,
`1519b34`, `071f8a2`, `7e93fac` all on `origin/main`.

**The repo is public**: `origin` → `github.com/niste-stuff/Jclaw`, `main` pushed and in sync
through item 39 (`7e93fac`). Releases `v0.1.0-beta.1`–`beta.5` exist as pre-releases;
**beta.5 is the only one to hand out** (beta.1–.3 install broken trees on end-user machines,
beta.4 lacks the upgrade guard / reinstall cleanup). This file (`tui/HANDOFF.md`) and root
`CLAUDE.md`/`.claude.json`/`.claw.json` are gitignored (item 23) — they stay on your disk and
keep working exactly as before, but a fresh clone of the public repo won't have them.

---

## 1. Architecture (how it fits together)

- `tui/` is a **Bun workspace** — a vendored subset of opencode's monorepo: the 14-package
  transitive closure needed to run the TUI + server (`tui, ui, core, sdk, plugin, server,
  opencode, llm, schema, protocol, script, http-recorder, effect-drizzle-sqlite,
  effect-sqlite-node`) plus root config and `patches/`.
- `tui/node_modules` is **git-ignored** (~1 GB). Run `bun install` in `tui/` to materialize it.
- Entry / launch: opencode's CLI at `tui/packages/opencode/src/index.ts`; the default command
  (`[project]`) starts the TUI (worker + embedded server + Solid/OpenTUI UI).
- Rust launcher: `rust/crates/rusty-claude-cli/src/tui.rs`, dispatched from `lib.rs` `run_cli()`
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

## 3. Done on branch `jclaw-rebrand-sweep` (items 1–8 first session; 9–13 the audit/feature session;
14–16 the theming/provider/upsell session, direct to `main`)

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

14. `47e29fa` **Added a `catppuccin-latte` theme** — the official Catppuccin *light* flavor
    (`packages/tui/src/theme/assets/catppuccin-latte.json`, registered in `theme/index.ts`).
    Authored light-only (same value for both `dark`/`light` keys, like the other catppuccin
    flavors) with light diff-highlight backgrounds so it renders correctly on a light base.
    Motivated by a "light mode doesn't work" report that was actually the active theme
    (`catppuccin-macchiato`) being **dark-only** — its light and dark palettes are identical, so
    the `/mode` toggle had nothing different to show. See §5.

15. `47e29fa` **Promoted OpenRouter, demoted OpenCode Zen/Go to the general provider list.**
    OpenRouter is already in the models.dev catalog (`id: openrouter`, `OPENROUTER_API_KEY`,
    `https://openrouter.ai/api/v1`) — natively BYOK, no code needed to "add" it; it was just not
    surfaced. Changes: `component/dialog-provider.tsx` `PROVIDER_PRIORITY` now leads with
    `openrouter` (then openai/copilot/anthropic/google) and **drops `opencode`/`opencode-go`** so
    they fall into the alphabetical "Providers" list instead of the top "Popular" slot; removed
    their `"(Recommended)"` / subscription blurb descriptions and added `openrouter: "(API key)"`.
    `component/dialog-model.tsx` lost the `provider.id !== "opencode"` sort key that force-pinned
    Zen models to the top. **Free models are untouched** — Zen/Go still work, still show the
    "Free" footer, just aren't front-and-center. **NOTE:** an earlier cosmetic relabel of the
    Zen/Go *display names* → "OpenRouter" (in `provider/provider.ts`) was **reverted** in favor of
    the real provider — do not re-add it.

16. `47e29fa` **Dropped the "Subscribe to OpenCode Go" free-tier upsell.** On a
    `FreeUsageLimitError`, `session/retry.ts` now returns a plain `{ message: "Free usage limit
    reached" }` instead of the Go upsell action/link; removed the now-unused `GO_UPSELL_MESSAGE`
    /`GO_UPSELL_URL` constants. Since no `free_tier_limit` action is emitted anymore, the TUI
    upsell dialog never fires for free tier — removed the dead `free_tier_limit` branch +
    `GO_UPSELL_FREE_TIER_*` KV keys from `routes/session/index.tsx`. Updated `retry.test.ts` +
    `schema-decoding.test.ts`. **Left intact:** the `account_rate_limit` (Go-subscriber PAYG)
    dialog for actual Go users, and the `packages/ui` web-UI i18n `dialog.usageExceeded.freeTier.*`
    keys (separate web surface, typed i18n contract across 6+ locales — not the TUI).

17. `8d16b9a` **Rebuilt the card/lorebook understanding baked into `peak`/`build`/
    `lore planning`, empirically, and added lorebook authoring.** Not a code-audit session —
    the user fed real JanitorAI cards and a real lorebook from
    `card-corpus/` (untracked, gitignored-by-absence, personal reference set — see
    `card-corpus-reference` in project memory) and corrected my read of them turn by turn
    until the model converged; only then did any prompt file change. Full reasoning trail is
    in project memory (`janitorai-card-model`, `corpus-driven-prompt-iteration`,
    `card-corpus-reference`) — this entry is the summary.
    - `agent/prompt/peak.txt` — substantially rewritten. Key corrections to the old rubric:
      a card is exactly four platform-fixed boxes (Scenario/Personality/Opening Messages
      [1–10 slots, only one loads per chat]/Example Dialogue) with **no canonical internal
      template** — formatting inside a box is entirely creator convention. The **visibility
      line**: only Opening Messages are read by a human as prose; Scenario/Personality/Example
      Dialogue are backend instructions for the model, so adjective/tag lists and decorative
      description are fine *there* (previously banned outright) as long as the specifics
      underneath aren't generic filler. Macro guidance: `{{user}}`/`{user}` either brace style
      is valid; the `{{sub}}/{{obj}}/{{poss}}/{{ref}}` pronoun-case macro set is the correct
      tool for gender-agnostic references; a card that drifts from the macro into spelling out
      "the user" as literal prose is a functional bug and a strong unedited-output tell. Token
      economics reframed as density-not-length (~2k–3k sweet spot, 4k–6k fine if lorepacked,
      7k–10k+ bloated) — Scenario/Personality cost every turn, Opening Messages don't (only one
      of up to 10 slots loads). Rewrote the "anatomy of a bad card" around content failures
      (genericness under tags, ensemble-of-one-archetype, scenes that just re-enact the stat
      sheet, verbatim self-repetition across sections) rather than a flat cliché list.
    - `agent/prompt/build.txt` — quality-bar section condensed to match, so it doesn't
      contradict `peak` before routing deep work there.
    - `session/prompt/plan.txt` ("lore planning") — added a lorebook-recommend-and-outline
      section respecting its existing read-only/no-edit constraint; it flags when a concept
      needs a lorebook and outlines candidate entries, but defers authoring to `peak`/`build`.
    - **New: lorebook authoring, in all three agents.** JanitorAI imports the SillyTavern/Chub
      "World Info" JSON schema. All three agents now recognize when a card's permanent fields
      are bloating with offloadable reference lore and **propose** moving it into a lorebook —
      **never author one without explicit user confirmation first**. Authoring rules baked in:
      one lean `constant:true` hub entry (well under ~1000 tokens, seeds the trigger vocabulary
      for everything else) plus `constant:false` conditional entries (~300 tokens soft / 400
      hard) keyed by a case-insensitive word-boundary regex of the topic's name + aliases;
      entries cascade (a hub's content contains the keywords that trigger the next tier down);
      split large worlds across multiple files for organization, not selective attachment. A
      verbatim 27-field entry JSON template is embedded in both `peak.txt` and `build.txt` —
      validated to parse cleanly.
    - `component/prompt/index.tsx` — added `/lorebook` (alias `/worldinfo`) to the "Cards"
      slash-command set alongside `/card`/`/rewrite`/`/contradictions`, following the existing
      `fillPrompt` pattern exactly. Switches to `peak`, prefills a prompt enforcing the
      propose-then-confirm lorebook workflow. No extra keybind-config coupling needed (Cards
      commands aren't key-bound); confirmed the `.map` at line ~625 auto-applies
      `namespace: "palette"` so one array entry reaches both the `/` popup and `ctrl+p`.
    - **Verified:** `bun run --cwd packages/tui typecheck` passes; grepped for content-snapshot
      tests referencing these prompt files/strings (none found, so the rewrite was safe);
      independently parsed the embedded lorebook JSON template with Python to confirm it's
      valid, schema-complete JSON. **NOT verified this session:** the full `bun test` suite and
      the headless `serve` + `/agent` boot probe (§6) — item 10's "all 8 package suites pass"
      predates this work and should be re-run before calling this done.

18. `0baafdb` **Workspace-scoping + format-matching guidance for `peak`/`build`; restyled
    placeholder examples.** Added two behavioral rules (not corpus-derived rubric, so no
    convergence cycle needed): neither agent should browse the workspace on its own when
    authoring/rewriting a card — work only from files the user names or hands over, never a
    self-directed search through other cards for context. And "same format/style as X" means
    matching X's box-formatting conventions and prose register (close in shape), never a
    line-for-line cadence match or lifted content. Also swapped the coding-flavored placeholder
    examples for card/roleplay ones: home screen's rotating set
    (`packages/tui/src/routes/home.tsx`, was "Fix a TODO in the codebase" etc.) and the `claw
    run` command's matching hardcoded placeholder (`cli/cmd/run/footer.prompt.tsx`).
19. `0b6066d` **Stripped claw-code/opencode cosmetic cruft from the repo root, rewrote
    README.** Not a `tui/` change (repo root), but part of the same fork-cleanup arc. Deleted
    ~15k lines / 6.5 MB of upstream marketing docs and dead tooling: `ROADMAP.md` (1.1 MB),
    `PARITY.md`, `PHILOSOPHY.md`, `USAGE.md`, `how_to_run.md`, `concept.md`, `prd.json`,
    `progress.txt`, `DECISIONS.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`,
    `SUPPORT.md`, `Containerfile`, `docker-compose.yml`, `.dockerignore`, `install.sh` (claw-
    code's own installer — jclaw uses `scripts/install-jclaw.sh`), and the whole `docs/`
    (claw-code's `g00x` verification maps) and `assets/` (upstream marketing images) dirs.
    Verified first that every rust/CI reference to these files is a prose comment or a test-
    assertion string literal, never `fs::read`/`include_str!`, so the Rust build/test/clippy
    gates are unaffected. **Kept** `LICENSE` (required — fork attribution) and `CLAUDE.md`.
    **Rewrote** `README.md` to describe jclaw itself, keeping a short upstream-attribution
    note so the MIT provenance `DECISIONS.md` used to document isn't lost. **Left for a
    possible follow-up** (functional, not cosmetic, so out of scope here): root `src/`/`tests/`
    — claw-code's original dead Python implementation (68 `.py` + 32 `.json`, still referenced
    by `CLAUDE.md`); `scripts/roadmap-*.sh` + `cc2_board.py`/`generate_cc2_board.py`/
    `validate_cc2_board.py` (served the now-deleted `ROADMAP.md`); `.github/` workflows +
    `check_doc_source_of_truth.py` (that CI check references the deleted `assets/claw-
    hero.jpeg` + old README — would fail if Actions run today). **Done in item 22.**

Earlier (pre-session, already on `main`): logo wordmark, `scriptName("claw")`, terminal window
title, and the "Open docs" command (opens jclaw's README via `JCLAW_DOCS_URL`).

**Result:** "opencode" mentions under `packages/tui/src` + `packages/opencode/src/cli` went
507 → ~458; the remainder is all plumbing (see §2 rule of thumb).

20. `0dbca65` **Fixed a rebrand miss: sidebar footer version stamp.** A user report ("it still
    says opencode here") traced to `feature-plugins/sidebar/footer.tsx` — the version line under
    the path/branch rendered `"OpenCode"` as two adjacent `<b>` spans (`Open` + `Code`), which the
    original sweep's string-literal grep missed. Collapsed to a single `<b>jclaw</b>` span next to
    `props.api.app.version`.
21. `tokenize` tool + peak/build nudges **Added a real BPE token counter as a built-in tool**,
    so `peak`/`build` stop eyeballing the token-economics guidance in §3.17 against actual
    numbers. `packages/opencode/src/tool/tokenize.ts` (+ `tokenize.txt` description) wraps
    `gpt-tokenizer` (new dependency, pure-JS, no API key, card text never leaves the machine) —
    `o200k_base` (default) or `cl100k_base` encoding, returns token count + char count. Registered
    as a builtin in `tool/registry.ts` (import, `Effect.all`, and the builtin array — three
    touch points, see the existing tool list there for the pattern). Tools are permission-gated,
    not allow-listed, so it's automatically available to every agent with no per-agent wiring.
    Nudged `agent/prompt/peak.txt` and `agent/prompt/build.txt` to call `tokenize` (not estimate)
    when checking a card's permanent-field budget or a lorebook entry's per-entry budget.
    **Verified:** both packages typecheck; booted the headless server and confirmed `tokenize`
    appears in `/experimental/tool/ids` and its JSON-schema-rendered definition is well-formed;
    ran `httpapi-experimental`, `acp/tool`, `agent`, and `skill` test files (79 pass) — **not**
    the full `bun test` suite across all packages.
22. **Repo-root/Rust dead-code sweep** — a follow-up on item 19's punch list (§8), covering
    the CI/docs and Python cruft plus one thing item 19 didn't flag: the pre-TUI Rust REPL.
    - **Fixed the broken `doc-source-of-truth` CI job.** `.github/workflows/rust-ci.yml`'s job
      ran `check_release_readiness.py`, which required `CONTRIBUTING.md`/`SECURITY.md`/
      `SUPPORT.md`/`CODE_OF_CONDUCT.md` to exist — all deleted in item 19, so the job would
      fail on the next push/PR to `main`. Removed the job and its now-dead scripts
      (`check_doc_source_of_truth.py`, `check_release_readiness.py`, `roadmap-check-ids.sh`,
      `roadmap-next-id.sh`, `tests/test_roadmap_helpers.py`), the orphaned `cc2` roadmap-board
      tooling (`scripts/cc2_board.py`, `generate_cc2_board.py`, `validate_cc2_board.py` — served
      the deleted `ROADMAP.md`, called by nothing else), the dead `rust/USAGE.md` redirect stub,
      and the matching stale trigger paths / `roadmap-check-ids.sh` call in
      `.github/hooks/pre-push`. Trimmed `rust-ci.yml`'s path filters to only files that still
      exist.
    - **Removed the dead claw-code Python** at root `src/` + `tests/` (68 `.py` + 32 `.json`,
      confirmed zero diff since the original vendor commit — never run, not referenced by any
      live code path). Kept `tests/test_pre_push_hook_contract.py` (it tests the live
      `.github/hooks/pre-push` bash hook, not the dead Python) and updated root `CLAUDE.md`'s
      repository-shape guidance, which previously told future sessions to keep `src/`/`tests/`
      in sync.
    - **Removed the pre-TUI Rust REPL, its setup wizard, and the `claw-janitor` persona.**
      Traced the reachability chain: `jclaw` invoked with zero args short-circuits straight to
      the vendored TUI (`lib.rs`, `invoked_cli_name() == "jclaw"`) *before* any of this code
      runs, and `scripts/install-jclaw.sh` only ever installs that zero-arg launcher — so the
      Rust-native interactive REPL (`run_repl`/`CliAction::Repl`), its `setup_wizard.rs`
      provider-config flow, and the `claw-janitor` card-authoring persona (a second, unmaintained
      system prompt in `crates/runtime/src/prompt.rs`, last touched before the TUI was even
      vendored) were only reachable via the un-installed `claw`/`claw-janitor` binary names.
      Worse, `janitor_mode()` matched `jclaw` too, so `jclaw prompt "..."` was silently loading
      that stale janitor prompt instead of a normal one — a real bug, not just dead weight, since
      `peak`/`build`/`lore planning` in `tui/` are the actively-maintained equivalent. Removed:
      the `claw-janitor` binary target; `setup_wizard.rs` and every call site (`claw setup`, the
      `--config` flag, the REPL's `/setup`, the auto-provider-check on REPL start); `run_repl`
      and the `CliAction::Repl`/`Setup`/`ConfigMenu` variants (bare `claw`/`jclaw` with no
      subcommand now prints help instead of starting a REPL); `janitor_mode()`,
      `rebrand_cli_name_for_janitor()`, and the janitor branch in `build_system_prompt()`/
      `print_system_prompt()`; the janitor system-prompt constants/loaders in
      `crates/runtime/src/prompt.rs`; the `SlashCommand::Setup` variant in
      `crates/commands/src/lib.rs`. **Deliberately left alone:** `crates/tools/src/card_tools.rs`
      (the `validate_card`/`tokenize`-equivalent tools stay — they're generic, not persona-gated)
      and the full non-REPL subcommand surface (`status`/`doctor`/`config`/`agents`/`mcp`/
      `skills`/`plugins`/`prompt`/etc.), which works identically under both `claw` and `jclaw`.
      **Known follow-up, not done:** dozens of other help/error strings in `lib.rs` still
      reference "the REPL" for commands that need an interactive session (e.g. `/permissions`,
      `/tasks`); left alone since many are pinned by exact-text test assertions and it's a much
      larger, separately-scoped string sweep.
    - **Verified:** `cargo build --workspace`, `cargo test --workspace` (all suites green),
      `cargo clippy --workspace --all-targets -- -D warnings` (clean), `scripts/fmt.sh --check`
      (clean) — all re-run independently after the change, not just trusted from the agent that
      made it.
    - **Found but not touched** (outside this session's scope, flagged for the user): a stray
      empty nested git repo at repo-root `Jclaw/` (own `.git`, one no-op "Initial commit", no
      remote — looks like an accidental `git init` in the wrong folder) and gitignored local
      runtime state at `.omx/` + `.port_sessions/` left over from the now-deleted cc2-board/
      porting tools (harmless, never committed, just disk clutter).
23. `8af1d1a`, `e0192ca`, `6dc3795` **Repo-readiness audit and publication cleanup** — the
    user asked whether the repo was ready to push to a real remote. It wasn't, quite:
    - **Item 22's dead-code sweep was sitting unstaged** (~150 file changes) — committed as
      `8af1d1a` so `git log` actually reflected the working tree state.
    - **29 Claude/Claw session transcripts were committed** at
      `rust/.claude/sessions/session-*.json` (+ one `.jsonl` under
      `rust/crates/rusty-claude-cli/.claw/sessions/`), dating back to the original
      `Phase 1: vendor claw-code` commit — someone else's dev logs
      (`/home/bellman/Workspace/clawd-code/...` paths), 560K total, no secrets found on
      inspection but no business being in a public repo either. Untracked (kept on disk),
      and the `.claude/sessions/`/`.claw/sessions/` ignore rules were widened from
      root-anchored to `**/`-anchored — the originals only matched at repo root and missed
      the nested `rust/` copies, which is exactly how these got committed despite the rule
      existing.
    - **A stray nested git repo at root `Jclaw/`** (own `.git`, one no-op "Initial commit",
      no remote — flagged but not touched by item 22) was deleted. It was never tracked by
      the outer repo, so this was pure disk cleanup, not a git operation.
    - **`card-corpus/`** (the personal JanitorAI reference set, see project memory
      `card-corpus-reference`) was moved out of the repo entirely to
      `/Users/westin/Desktop/jclaw-card-corpus/` — the user chose "move out" over "delete"
      or "gitignore in place" when asked, since gitignoring still leaves the name/directory
      sitting in the tree. All content preserved; project memory updated with the new path.
    - **Root `.claude.json`, `.claw.json`, and `CLAUDE.md`** were untracked and gitignored
      (`8af1d1a`/`6dc3795`) at the user's request — a GitHub file listing showing these made
      the user want them out of the public repo. All three are kept on disk (git tracking
      status doesn't affect whether these get read locally) so nothing changes for this
      machine. `.claude.json`'s `permissions.defaultMode: "dontAsk"` and `.claw.json`'s
      `aliases.quick: "haiku"` were additionally moved into the project's own documented
      local-override convention (`.claude/settings.local.json` / new
      `.claw/settings.local.json`, both already gitignored) — except the `.claude/` merge
      was **blocked by the harness's auto-mode classifier** as a self-modification (editing
      a permissions file to add `defaultMode: "dontAsk"` counts as widening auto-approval
      scope). **Follow-up, not done:** `.claude/settings.local.json` still lacks
      `"defaultMode": "dontAsk"` — add it manually if you want that convenience preserved
      past the point where `.claude.json` might ever get cleaned up (low risk: plain
      `git clean`/`-fd` won't touch it since it's gitignored; only `git clean -ndx`/a fresh
      clone elsewhere would lose it).
    - **`origin` remote added** (`github.com/niste-stuff/Jclaw`) and `main` pushed —
      first time this repo has had a real remote. All of the above landed before the first
      push, so no history rewrite was needed.
    - **Verified:** `cargo build`/`clippy -D warnings`/`test --workspace` (900+ tests),
      `scripts/fmt.sh --check`, and the pre-push hook contract test all green both before
      and after the cleanup.
24. `bb22925` **Agentic self-review: `peak`/`build` auto-spawn a `review` subagent instead of
    waiting for the user to type `/contradictions`.** The user wanted the model to check its
    own card-authoring work on its own initiative, not only when manually asked.
    - The infrastructure for this already existed and was unused by jclaw's own agents:
      `tool/task.ts` (the `task` tool) lets any agent spawn a child session bound to a
      different named agent, run a prompt in it, and get the result back synchronously.
      `peak`/`build` already had permission to call it (their permission set inherits
      `"*": "allow"` from `defaults` in `agent/agent.ts` with no override for `task`) — no
      permission wiring was needed on their end.
    - **New `review` subagent** — `agent/prompt/review.txt`, registered in `agent/agent.ts`
      (`mode: "subagent"`, `native: true`, alongside `explore`/`general`). It's a strict critic,
      not an author: reuses `peak.txt`'s existing "anatomy of a bad card" rubric (genericness,
      unedited-text tells, AI tells in Opening Messages, `{{user}}` macro misuse, token
      economics via `tokenize`) but only reports findings — it must never rewrite or propose a
      fixed version. Permission: denies `edit`/`write`/`bash`/`task` (`"*": "deny"` then
      explicit `read`/`grep`/`glob`/`list`/`tokenize: "allow"`), mirroring how `explore`'s
      permission block is built.
    - **`agent/prompt/peak.txt`** — new "Self-review before showing a finished draft" section
      (after "the anatomy of a bad card"): once a full card or full lorebook entry/hub is
      drafted or substantially rewritten (not a small edit, not a question), call `task` with
      `subagent_type: "review"` before presenting it. Fix concrete findings itself; surface
      only genuine judgment calls to the user. Present the result with one short note (what was
      fixed, or that it passed clean) — never dump the raw findings.
    - **`agent/prompt/build.txt`** — same nudge, condensed into "How you work" to match its
      existing brevity, scoped identically (full card/lorebook only).
    - **`lore planning` and `/contradictions` untouched on purpose** — `lore planning` never
      finalizes card text, so there's nothing for it to self-review; `/contradictions` stays as
      a manual, on-demand deep-dive the user can still invoke, complementary rather than
      replaced.
    - **Verified:** both packages typecheck clean; `test/agent/*` (49 pass), `event-manifest`,
      `tool/task.test.ts` (20 pass) all green; full `bun test` across all packages — 3034 pass,
      only the pre-existing `httpapi-v2-pty` full-suite-load flake failed (§6, passes solo);
      `packages/core` suite 1058 pass, 0 fail; headless boot probe confirms `review` in `/agent`
      JSON with `mode: "subagent"`. **Live end-to-end check** (tmux-driven real `jclaw` run, not
      just typecheck/tests): asked `peak` to write a throwaway card — it planned a todo
      including "Run self-review via review subagent," the transcript showed
      `✓ Review Task — Review grumpy dragon-slayer tea shop card` firing mid-response, and the
      final message included `Self-review came back clean — no issues found.` before the card,
      exactly matching the designed silent-fix-plus-short-note behavior.
25. `c0433a9` **`peak`/`build` can now switch to `lore planning` themselves via a new
    `plan_enter` tool, instead of only ever suggesting the user switch manually.** The
    permission wiring for this (`build`/`peak: plan_enter → allow`) already existed from item
    4, but nothing implemented the tool — `plan-enter.txt`'s description file was sitting
    unused in `tool/`, an orphan. Worse, its counterpart `plan_exit` (the `lore planning →
    build` direction) turned out to be **dead code too**: `tool/registry.ts` only included it
    in the builtin tool list behind `flags.experimentalPlanMode && flags.client === "cli"`,
    and `OPENCODE_EXPERIMENTAL_PLAN_MODE` was never set anywhere in jclaw — so neither
    direction of agent-initiated switching had ever actually run before this session.
    - **New `PlanEnterTool`** in `tool/plan.ts` (alongside the existing `PlanExitTool`) —
      same shape: asks a Yes/No confirmation via `Question.Service`, then on Yes pushes a
      synthetic user message with `agent: "lore planning"` (model carried over from the
      last user message, same pattern as `PlanExitTool`).
    - **`tool/registry.ts`** — registered `planEnter`, and dropped the
      `experimentalPlanMode && client === "cli"` gate entirely for both `plan`/`planEnter`.
      This isn't upstream's experimental plan-mode anymore; it's core jclaw workflow, so it's
      unconditionally on now.
    - **`agent/prompt/build.txt` / `agent/prompt/peak.txt`** — the existing "route to lore
      planning" lines changed from telling the model to *suggest* a manual switch to
      instructing it to call `plan_enter` itself.
    - No changes needed to `agent/agent.ts` (permissions were already correct) or
      `routes/session/index.tsx` (already had the `part.tool === "plan_enter"` switch-side-effect
      wired, also unused until now).
    - **Verified:** both packages typecheck clean; targeted tests (`agent/agent.test.ts`,
      `session/prompt.test.ts`, `tool/parameters.test.ts`) 157 pass, 1 skip; full workspace
      `bun test` 3035 pass, 1 fail (the pre-existing `httpapi-v2-pty` disk-pressure flake per
      §7, unrelated — reproduces solo too, traced to this machine's data volume sitting at
      100% full / 2.8 GB free). **Live tmux end-to-end, both directions, both agents:**
      `build` + a clear brainstorm request → `plan_enter` fires → Yes → footer flips to `Lore
      Planning`, conversation continues in character. Reject (No) path → stays on `Build`,
      clean turn end. `peak` + an *explicit* "switch to lore planning" request → fires and
      switches identically. (Note: `peak` given a *vague*, not-explicit thin-concept prompt
      chose to ask its own clarifying questions instead of calling `plan_enter` — legitimate,
      since `peak.txt` already has separate "ask sharp questions for a thin concept" guidance
      that competes with the new routing instruction; not a bug, just a model judgment call
      worth knowing about.) `lore planning` → "let's go write the card" → `plan_exit` fires
      (first time ever, since it was previously unreachable dead code) → Yes → switches back
      to `Build` cleanly. Also re-verified item 24's `review` subagent auto-spawn in the same
      live session: `build` drafted a full throwaway card, delegated to `review` on its own,
      got back two concrete findings (a stock simile, an off-register word choice), fixed both
      silently, and reported with one short note — matching the designed behavior exactly.

26. `92cf2a7` **Persistent lore library + `/lore`
    build-a-card flow.** A jclaw-owned store the user fills with worldbuilding/lore, then picks
    from to have `peak` author a card grounded in it — jclaw's "lore is the source, card is the
    render" thesis made concrete. Designed corpus-free (product decisions, not a rubric
    convergence): user chose **both** populate paths, **model-reads-by-path** delivery, and
    **always route to peak**. Everything reuses an existing pattern — the theme picker, the
    `plans/*` `external_directory` allow, and the Cards `fillPrompt` flow — no new infra.
    - **Store:** `~/.local/share/opencode/jclaw/lore/` via new `Global.Path.lore` in
      `packages/core/src/global.ts` (added to `paths`/`Interface`/`make()` + the startup
      `Promise.all` mkdir, mirroring `repos`/`log`). Namespaced subdir under the shared
      `Path.data`, so it does **not** violate constraint §2.2 (`app` stays `"opencode"`).
      Auto-created at boot. Flat files or nested "collection" subfolders; `.md`/`.txt`/`.json`.
    - **Picker:** new `packages/tui/src/component/dialog-lore.tsx` — near-verbatim shape of
      `dialog-theme-list.tsx`. Scans the store with `Glob.scan("**/*", { cwd: Global.Path.lore,
      absolute: true })` inside a `createResource`, filters to the three extensions in JS (not a
      brace glob, to avoid depending on brace support), maps to `DialogSelect` options (title =
      basename, `category` = parent subdir or "Lore" so collections group). Empty-state and
      loading are non-selectable disabled rows; the empty one prints the store path so a
      first-run user knows where to drop files. Stays dumb — takes an `onPick(pick)` prop and
      calls `dialog.clear()`; the prompt component owns what happens next.
    - **Commands:** `/lore` and `/lore add` in `component/prompt/index.tsx`, added to the **same
      Cards `commands` array** as `/card`/`/rewrite`/`/lorebook` (~line 615) so the `.map` at the
      end auto-applies `namespace: "palette"` → both reach the `/` popup and `ctrl+p`, no keybind
      wiring. `/lore` (`slashName: "lore"`) opens `DialogLore` via `dialog.replace`, passing an
      `onPick` that calls the existing `fillPrompt(prompt, "peak")` with the picked **absolute
      path** embedded — peak reads the file itself. `/lore add` (`slashName: "loreadd"`, alias
      `addlore`) prefills `build` with a save-into-`Global.Path.lore` instruction. Needed a new
      `import { Global } from "@opencode-ai/core/global"` in that file.
    - **Permissions:** `agent/agent.ts` — added `external_directory: { [Global.Path.lore + "/*"]:
      "allow" }` to `peak`/`build` (via the shared `{ question, plan_enter }` block, one
      `replace_all`) **and** to `lore planning`'s existing `plans/*` block. The store is
      **outside the worktree**, so without this every read/write there would prompt (`defaults`
      set `external_directory: "*": "ask"`, `agent.ts:125-127`; `read.ts:42` — "external absolute
      paths require external_directory approval"). One path-scoped allow covers both the read
      (peak) and the write (build's `/lore add`) — `external_directory` permission is per-path,
      not per-action.
    - **Prompt nudges:** `peak.txt` — a sub-bullet under the "don't self-browse the workspace"
      rule (item 18) carving out the library: reading a lore file whose path the user picked is
      the intended handover, read it in full as canon, and if it's too thin switch to lore
      planning rather than inventing. `build.txt` — a "Managing the lore library" line spelling
      out the `/lore add` save behavior (topic-named kebab `.md`, ask before overwrite, confirm
      the path).
    - **Verified:** typecheck clean (tui/opencode/core); prettier clean on the 3 TS files;
      `packages/core` 1058 pass 0 fail; `packages/tui` 191 pass 0 fail; `packages/opencode` 3034
      pass, **2 fail — both the `httpapi-v2-pty` flake (§7), proven pre-existing** by stashing the
      change and reproducing the same `fail/pass/fail` on the clean tree (a code bug can't pass
      *and* fail the identical tree; it's the hard 5000 ms pty-spawn timeout on this loaded
      machine). Headless `serve` boot lists all agents incl. `peak`/`build`/`lore planning`
      (perm edit didn't break agent load) and auto-created the lore dir; independently ran the
      picker's exact Glob+filter+group logic against seeded files (found both, grouped the nested
      one under its subdir, excluded a `.log`). **NOT verified — needs a real TTY:** the live
      `/lore` picker UX and the no-permission-prompt read (the plan's tmux end-to-end steps).
      Everything headless-testable is green.

27. `7bebb79` **Deep multi-lens review swarm + `/swarm` command.** Item 24 gave `peak`/`build`
    a single-critic self-review (`review` subagent); this adds a heavier, explicit-opt-in
    option: fan the same draft out to four specialist critics in parallel and merge their
    findings, instead of one generalist pass. User asked for "an agent swarm" as a brainstormed
    feature and picked the design via three choices: **both** trigger paths (keep the light
    auto-review, add a manual deep one), **4 fixed lenses**, and a **synthesis step that merges**
    findings rather than dumping four raw reports.
    - **Architecture decision:** no dedicated 5th "synthesis" subagent — the orchestrator
      (`review-swarm`) already receives all 4 lens results in its own context after the `task`
      calls return, so it does the merge/dedupe itself as its final response. One fewer agent
      hop than the original brainstormed design.
    - **Confirmed via a throwaway investigation before building:** tool calls from a single
      assistant turn run in **parallel with no concurrency cap** — the vendored AI SDK's
      `executeTools` (`node_modules/.bun/ai@.../dist/index.js`) maps all `tool_use` blocks
      through `Promise.all`, unbounded. This meant the swarm didn't need
      `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` (still unset/off, unlike item 25's
      `plan_enter` gate which had to be unconditionally enabled) — `review-swarm` just fires
      all 4 `task` calls in one turn and they run concurrently for real.
    - **New subagents**, all `mode: "subagent"`, `native: true`, registered in `agent/agent.ts`
      (imports + entries added right after the existing `review` entry):
      - `review-prose`, `review-lore`, `review-macros`, `review-structure` — each a faithful
        carve-up of `review.txt`'s existing rubric by axis (prose/AI-tells & genericness; cross-box
        and lorebook-cascade consistency; `{{user}}`/`{{char}}` macro correctness including the
        `{{user}}`→"the user" collapse bug; structural/meta-commentary + `tokenize`-based token
        economics), not new rules — same permission shape as `review` (`"*": "deny"` +
        read/grep/glob/list, `review-structure` also gets `tokenize`). Marked `hidden: true` so
        they don't clutter `@`-mention autocomplete or agent listings — confirmed via
        `session/prompt.ts`/`autocomplete.tsx` that `hidden` only affects discovery/listing, not
        `task`'s `agent.get(subagent_type)` lookup, so `review-swarm` can still call them by exact
        name.
      - `review-swarm` — the orchestrator, **not** hidden (so it's directly `@`-mentionable too).
        Its permission is the only one of the five with `task` unlocked, and it's scoped tight:
        `task: { "*": "deny", "review-prose": "allow", "review-lore": "allow", "review-macros":
        "allow", "review-structure": "allow" }` — it cannot spawn any other agent type. Verified
        this scoping live against the running `/agent` JSON, not just by reading the code.
    - **Trigger wiring:** new `/swarm` (alias `/deepreview`) in `component/prompt/index.tsx`'s
      Cards command array (same `fillPrompt` pattern as `/contradictions`/`/lorebook`, no keybind
      needed) — prefills a prompt telling the current agent to call `task` with
      `subagent_type: "review-swarm"` and show the merged findings directly (explicitly told not
      to compress it into item 24's one-line note, since asking for the deep pass is the point).
      Stays on whichever agent (`peak` or `build`) is active, like `/contradictions` does — no
      forced agent switch. Also added one line each to `peak.txt`/`build.txt`'s existing
      self-review section: if the user asks for scrutiny in plain language ("really scrutinize
      this") rather than typing `/swarm`, reach for `review-swarm` instead of `review`.
    - **Verified:** both packages typecheck clean; `test/agent/*` + `test/cli/run/subagent-data`
      + `test/config/agent-color` (56 pass), `event-manifest` + `tool/task.test.ts` (20 pass);
      `packages/tui` 191 pass 0 fail; full `packages/opencode` suite 3035 pass, 1 fail + 1 error —
      both in `test/cli/cmd/tui/attention.test.ts` (audio-notification decode), unrelated to any
      agent/task/prompt code touched here; reran that file solo, 18/18 pass, matching the known
      full-suite-load flake pattern from §7/item 26 rather than a regression. Headless `/agent`
      boot lists all 5 new agents. **Live tmux end-to-end** (not just headless): opened `/swarm`,
      confirmed the popup and prefill, submitted a throwaway card with planted flaws (purple
      prose, `{{user}}` spoken-for/decided-for, hardcoded pronouns, deliberately underweight
      token count). The model first correctly refused to fabricate a card when none was pasted
      yet (asked for the draft instead — not a bug, just worth noting as a real behavior seen).
      On the actual draft, cross-checked the **session DB** (`~/.local/share/opencode/opencode-
      local.db`, `session` table) rather than trusting the transcript's transient progress
      lines: `review-swarm` spawned as a child of the `build` session, and all four lenses
      appear as children of `review-swarm` with `time_created` timestamps ~2 seconds apart —
      genuine parallel fan-out, not sequential. Final merged report named the real planted
      issues plus the real `tokenize` count (112 tokens) and correctly flagged the missing
      Example Dialogue box, then asked whether to rewrite now or go to `lore planning` first —
      matching the designed "findings only, no silent auto-fix" contract for the deep path.
28. `825f5e3` **Worldsmith agent + `/world` command — the authoring front for the lore library.**
    Item 26 built the *consumption* side (a lore library at `~/.local/share/opencode/jclaw/lore/`,
    the `/lore` picker, `/lore add`). This adds the missing *authoring* side: a way to have the
    model write a whole cohesive world from a premise and drop it straight into that library so
    later sessions can build cards from it. User brainstormed the feature, then picked the design
    via six choices: **both** one-shot and refine-in-session; **freeform prose** (not a fixed
    schema); a **new `worldsmith` primary agent** (not folded into `peak`/`build`); saved to a
    **`worlds/` subfolder** of the lore store; **silent after save** (no auto card-build) but
    **can hand off to `peak`** if asked.
    - **New primary agent `worldsmith`** in `agent/agent.ts` (import `PROMPT_WORLDSMITH` +
      entry inserted after `build`, before `general`; `mode: "primary"`, `native: true`).
      Prompt is `agent/prompt/worldsmith.txt`: authors internally-consistent worlds
      (premise/tone, geography, factions, history, characters, rules) where cohesion is the whole
      job — every piece traces back to the others; same no-slop bar as `peak`; freeform Markdown;
      workflow is draft-from-premise → refine → cohesion self-check → save only on explicit
      confirmation to `worlds/<kebab-name>.md`; does not self-browse the workspace.
    - **Permission shape:** `Permission.merge(defaults, …{ question: "allow", plan_enter: "allow",
      external_directory: { [join(Global.Path.lore, "*")]: "allow" }, task: { "*": "deny",
      peak: "allow" } }, user)`. Two facts verified by code inspection, not guessed: (1) the
      `Wildcard.match` compiler (`core/src/util/wildcard.ts`) uses a **dotall** `s` flag, so
      `lore/*` already matches the nested `lore/worlds/foo.md` at any depth — no extra glob needed
      for the subfolder; (2) `tool/task.ts` has **no mode filter** (`agent.get(subagent_type)`),
      so a primary agent like `peak` is spawnable by `worldsmith` once `task.peak: "allow"` is set.
    - **Model slot:** added `"worldsmith"` to `PRESET_AGENTS` in `tui/src/context/local.tsx` so it
      shares the `build` model slot via `modelKey()`, like `peak`/`lore planning`.
    - **Trigger wiring:** new `/world` (alias `/worldbuild`) in `component/prompt/index.tsx`'s
      Cards array (same `fillPrompt(prompt, "worldsmith")` pattern; the trailing `.map` auto-tags
      `namespace: "palette"`, so it reaches both `/` popup and `ctrl+p` — no keybind needed).
      Prefill tells `worldsmith` to interlock geography/factions/history/characters/rules, save
      under `worlds/` at `Global.Path.lore`, ask before overwriting an existing file, and confirm
      the path when done. Also added one line to `/lore`'s prefill: if the picked lore is a whole
      world with more than one character, ask which character/angle to build the card around
      before assuming a single subject.
    - **Test sync:** added `worldsmith: { disable: true }` to the "defaultAgent throws when all
      primary agents are disabled" test config in `test/agent/agent.test.ts` — mandatory whenever
      a new primary agent lands (precedent: items 10, 24, 27), else `defaultAgent()` finds
      `worldsmith` and the throw-test fails.
    - **Verified:** full `bun test` — 8 packages fully green; `packages/opencode` 3034 pass, with
      only the known §7 flakes on solo-rerun (`httpapi-v2-pty`/`httpapi-pty` 13/13 alone,
      `attention.test.ts` 18/18 alone — pty-spawn timing + audio-decode, none touch changed code).
      **Live tmux end-to-end:** `/world` prefill submitted with a premise, model authored a world
      ("Valdris"), saved to `worlds/valdris.md` with **no permission prompt** (confirming the
      dotall glob), and `/lore` then listed it grouped under "worlds".
29. `67f2664` **Verified the item 17 lorebook JSON schema against real data, then added an
    on-demand reference example.** The user asked whether jclaw actually understands the
    lorebook JSON shape. Diffed the 27-field template embedded in `peak.txt`/`build.txt`
    against 4 real reference lorebooks in `jclaw-card-corpus/lorebooks/unsorted/` — exact
    field-for-field match, including the bare-array top-level shape and the `constant: true`
    hub-entry cascade pattern. Then the user pasted JanitorAI's own posted "example" entry —
    only 11 fields, critically **missing `constant` and `name` entirely**, with an empty
    `key` — which looked like it might mean the whole hub/cascade mechanism doesn't exist
    on-platform. Resolved by the user pasting a real, fully-populated 9-entry lorebook
    (matches the 27-field template exactly, `constant: true` hub included) and confirming
    it's **actually working live on JanitorAI**. Conclusion: JanitorAI's own "example" is a
    minimal illustrative stub, not the real supported schema — the platform's importer
    accepts and honors the full ST/Chub superset. **No prompt correction needed** — the
    existing template was already right. Recorded in project memory (`janitorai-card-model`)
    so a future session doesn't get thrown by the same mismatch.
    - **New:** the confirmed-working 9-entry example (1 `constant: true` hub + 8 cascading
      entries) is now a checked-in reference file,
      `agent/prompt/reference/lorebook-example.json` — but NOT embedded in `peak.txt`/
      `build.txt` directly, since that would add ~5k resident tokens to every single
      peak/build turn forever (measured via the `tokenize` tool's own `gpt-tokenizer` dep).
      User chose **on-demand read** over embedding (full or trimmed) when asked.
    - **`agent/agent.ts`** computes the file's absolute path once via
      `fileURLToPath(new URL("./prompt/reference/lorebook-example.json", import.meta.url))`
      (same pattern already used in `tool/shell.ts` for locating a bundled asset relative to
      the running module — portable across any clone location, not a hardcoded path). Wired
      into `peak`/`build`'s existing `external_directory` permission block (exact-path
      `allow`, alongside their `Global.Path.lore` glob) and substituted into their prompt
      text via `.replaceAll("{{LOREBOOK_EXAMPLE_PATH}}", LOREBOOK_EXAMPLE_PATH)` at agent
      registration time — the `.txt` prompt files themselves just contain the literal
      placeholder token, resolved once per process at import time, not per-turn.
    - **`peak.txt`/`build.txt`** — one sentence each in the existing Lorebooks section,
      pointing at the path as an optional check against real data, explicitly framed as
      on-demand ("if you want to check... read `{{LOREBOOK_EXAMPLE_PATH}}`"), not a
      mandatory read.
    - **Verified:** both packages typecheck clean; `test/agent/agent.test.ts` 43/43 pass;
      headless `serve` boot confirms both agents' `/agent` JSON has the exact-path
      `external_directory: allow` entry resolved to the real absolute path, and confirms the
      prompt text has the placeholder fully substituted (searched for the literal
      `LOREBOOK_EXAMPLE_PATH` token — not found; searched for the resolved
      `lorebook-example.json` path — found, in context).
30. `d634f05` **Made `session`/`compact` CLI subcommands functional; added lore-picker
    multi-select.** The user asked to address three README-documented limitations directly:
    "Vestigial CLI Subcommands" (`session`/`compact` were legacy holdovers pointing back at the
    removed REPL — see item 22), "Single-Select Picker Limit" (`/lore` couldn't combine multiple
    files into one card build), and "Heavy Upstream Dependencies" — the user's call on the third
    was **no action needed** (already honestly documented). Picked "make them functional" (not
    "remove" or "fix text only") for the subcommands, "add real multi-select" for the picker,
    "mechanical trim" (not LLM summarization) for `compact`, and "add a persisted active-session
    pointer" for `session switch` (all via clarifying questions before implementation).
    - **`claw session <action>`** (Rust, `lib.rs`) now does real, non-interactive work against
      the managed session store (`.claw/sessions/`): `list` (default), `exists <id>`,
      `switch <id>`, `fork [branch-name]`, `delete <id> [--force]`. New **active-session pointer
      file** (`.claw/sessions/<fingerprint>/.active-session`, written by `switch`/`fork`) lets
      `active` be used as a session reference anywhere `latest`/an id/a path is accepted
      (`claw session exists active`, `claw --resume active /status`, etc) — kept entirely in
      `lib.rs` (CLI layer), not pushed into the shared `runtime` crate, since it's a CLI-only
      convenience the TUI and other `runtime` consumers don't need.
      `resolve_session_reference`/`load_session_reference_excluding` both intercept the `active`
      sentinel before hitting the store.
    - **`claw compact [SESSION]`** (default `latest`) now runs the same
      `runtime::trident::trident_compact_session` mechanical-trim algorithm the `/compact` slash
      command already used inside `--resume` — reused, not reimplemented. Removed the now-dead
      `compact_interactive_only_error()`.
    - **`--resume SESSION /session switch|fork`** rewired to call the same real logic instead of
      returning "requires an interactive REPL."
    - **Error/help text cleanup:** `run_worker_state`'s error and the `State`/`Session`/`Compact`
      `LocalHelpTopic` blocks no longer describe or depend on the removed REPL. New
      `unsupported_session_action` and `no_active_session` error kinds added to
      `classify_error_kind`.
    - **`/lore` picker gains multi-select** in `packages/tui/src/component/dialog-lore.tsx`:
      `space` marks files (checkbox gutter, new `"dialog.lore.toggle"` keybind in
      `config/keybind.ts` mirroring `dialog-mcp.tsx`'s existing toggle-action precedent), `enter`
      builds a card grounded in all marked files at once (falls back to just the highlighted file
      if nothing's marked) — built entirely on `DialogSelect`'s existing `actions`/`gutter`
      extension points, no changes to the shared component itself.
      `component/prompt/index.tsx`'s `/lore` handler adapts its prefilled prompt wording for the
      multi-file case (flag conflicts across files, ask before assuming a single character).
    - **README** updated to match: the §12 CLI reference table's `session`/`compact` rows, the
      "bit of history" paragraph about the removed REPL, and the lore multi-select note in §18.
    - **Verified:** `cargo build`/`clippy --all-targets -- -D warnings`/`test --workspace` (all
      green), `scripts/fmt.sh --check` (clean); updated the two `compact_output.rs` integration
      tests and the `output_format_contract.rs` #767 test that pinned the old error shapes;
      `bun run --cwd packages/tui typecheck` + `packages/opencode typecheck` both clean;
      `packages/opencode/test/config/tui.test.ts` (keybind config) 33 pass.
      **Not verified this session:** a live TTY pass of the new `/lore` multi-select UX (same gap
      already noted for item 26's original picker in §8) and the full `bun test` suite across all
      TS packages (only the targeted keybind-config test was run, since the only files touched —
      `dialog-lore.tsx`/`prompt/index.tsx`/`keybind.ts` — have no other existing test coverage).
31. **Prompt hardening: stole a handful of techniques from a third-party "psychological-depth"
    card-author system prompt the user shared, after first cataloguing why jclaw's architecture
    beats a single static prompt regardless of that prompt's own quality** (README §0, see below).
    Explicitly rejected from that prompt: its mandatory internal-friction/wound/aftercare
    structure forced onto every card no matter what the user asked for, its ad hoc
    `[MANUAL OVERRIDE]` directive-block syntax (jclaw just uses normal conversation), its
    same-context self-grading checklist (jclaw already has separate-context `review`/
    `review-swarm` subagents for this — item 24/27), and its unconscious-habit / dialogue-
    register-spread / double-duty-sentence rules (considered, deliberately not added — no
    stated reason to prefer them over jclaw's existing density/voice guidance). What *was*
    folded in, all user-directed:
    - **`peak.txt`/`build.txt`/`review.txt`/`review-prose.txt`** — a new banned-phrase list
      inside the existing "AI tells in Opening Messages specifically" section: overused
      physical descriptors ("gaze", "orbs" for eyes, "smirk", "chiseled", "lithe", "porcelain",
      "sculpted", "ethereal", "striking"), stock reaction verbs ("breath caught", "heart
      stuttered", "heat pooled", "pulse quickened", "stomach dropped", "knees weakened"),
      narration props ("the kind of [noun] that…", "there was something about…"), and cliché
      intimacy staging ("pulled them closer", "their eyes met", "the air between them",
      "electricity", "tension crackled"). The source prompt's fifth category — hollow
      intensifiers ("somehow", "almost", "just", "slightly") — was explicitly excluded per user
      direction. Scoped to Opening Messages only, same as the existing AI-tells list it sits
      inside; backend fields are unaffected. Added identically to both review agents so critics
      enforce the same bar authors are held to.
    - **`peak.txt`** only (the full-card author; `build` already routes whole-card writing to
      `peak`) — two additions:
      - A "remove `{{user}}`, does it change" test appended to the existing hook section: if
        the scene plays out the same without `{{user}}` in it, the hook isn't done.
      - New "Familiar patterns" section — the source prompt's separate trope-handling and
        anti-cliché procedures, merged into one per user direction, with the anti-cliché side's
        *mandatory* contradiction requirement dropped: name the trope, deliver the emotional
        promise it makes straight rather than subverting it, ground it in details specific to
        the character. A genuine contradiction is used if one falls out naturally, never forced.
    - **README `## 0. Why jclaw over a good system prompt`** — new section (see README diff
      below) written *before* any of the above prompt edits, arguing the case for jclaw's
      architecture independent of any single prompt's quality: schema knowledge that isn't a
      training-data guess, separate-context critique instead of self-grading, parallel
      specialist review lenses, persistent lore across sessions, tool-verified token counts,
      workflow enforced by code/structure rather than instructions the model has to keep
      remembering, real files instead of copy-paste, and — the point that triggered the whole
      exchange — asking what tone/depth the user wants (`lore planning`) instead of a static
      prompt imposing one fixed mold on every card regardless of the request.
    - **Verified:** `bun run --cwd packages/opencode typecheck` clean. Pure prompt-text changes
      with no test coverage on these `.txt` files — no test suite run for this item.
32. `b239a7e` **Compiler-verified dead-code sweep of `rust/`, plus two new TS tools
    (`card_budget`/`card_macro_check`) replacing the idea of porting the old Rust card
    validator.** The user asked "how much code is actually used" across opencode/claw-code/
    jclaw (§0-era question, answered by line-count + dependency-graph analysis, not part of
    this repo's history), which surfaced that `rust/`'s claw-code base carries real orphaned
    code beyond what item 22 already removed. This item acted on "take the real capability,
    wire it, delete the dead weight."
    - **Methodology, and a real mistake it caught:** a first grep-based sweep (matching each
      `runtime`-crate module's re-exported symbol names against the rest of the workspace)
      wrongly flagged `mcp_server.rs` as dead — it's actually constructed at
      `rusty-claude-cli/src/lib.rs:4209` via a bare `use runtime::{McpServer, ...}` import,
      invisible to a naive `modulename::` grep pattern. A second, corrected sweep (excluding
      only the defining file + `runtime/lib.rs` by full path, not by basename — the first
      version had a bug that excluded *every* `lib.rs` in the workspace, hiding usage via
      `tools/lib.rs` etc.) still wasn't fully trusted: every deletion candidate was actually
      deleted and the workspace rebuilt (`cargo build --workspace --all-targets`) as the real
      test. This caught one more false positive the symbol-grep missed: `task_registry` looked
      unused (its 4 re-exported flat names had zero external referrers) but `tools/lib.rs`
      reaches `TaskRegistry` — a *different*, non-re-exported symbol — via the qualified path
      `runtime::task_registry::TaskRegistry`, which only works because the module itself is
      `pub mod`. Reverted that one; kept the rest.
    - **Deleted, compiler-confirmed dead:** 3 orphan crates with nothing path-depending on them
      — `claw-analog` (a separate standalone agent-harness binary), `claw-rag-service` (a
      separate RAG service binary), and `compat-harness` (scraped a *different*, not-vendored
      upstream TS repo — the original claw-code's own `src/commands.ts`/`src/tools.ts`, not
      opencode — to check Rust-port feature parity; its tests silently no-op since no such repo
      exists near this one). Also 6 `runtime` modules with zero external callers anywhere in the
      workspace: `approval_tokens`, `branch_lock`, `remote`, `report_schema`, `sse`,
      `trust_resolver` (~3,200 lines; `trust_resolver` was already `#[cfg(test)]`-gated, so it
      never even compiled into a release build). Also `tools/src/pdf_extract.rs` (a PDF text
      extractor with zero callers since whatever used it predates the current tool surface) and
      its now-orphaned `flate2` dependency. Updated root `README.md`/`rust/README.md`'s
      workspace-layout diagrams to match. **Left alone, deliberately:** the rest of `runtime`'s
      sprawling module list (`lane_events`, `policy_engine`, `worker_boot`, `task_packet`,
      `green_contract`, `g004_conformance`, `mcp_lifecycle_hardened`, etc.) — these have *some*
      real external usage (confirmed via the same sweep), even if it's clearly leftover
      claw-code multi-agent/lane-orchestration scope broader than jclaw's actual single-user
      card-authoring product. Not touched this session; a future dead-weight pass could go
      deeper here, but "some real caller" was the bar for this pass, not "seems relevant to
      jclaw's actual product."
    - **Did NOT port `tools/src/card_tools.rs`** (`validate_card`/`token_budget_check`) despite
      it being real, working, wired-into-claw-code's-own-agent-loop capability. Reading it
      revealed it encodes a **stale, pre-item-17 card model**: required Markdown sections
      (`# Name`/`# Description`/etc.) that don't match the actual JanitorAI four-box schema
      (Scenario/Personality/Opening Messages/Example Dialogue, no canonical internal template),
      and token bands (personality 1k-4k sweet spot) that contradict `peak.txt`'s corpus-derived
      numbers (permanent Scenario+Personality 2k-3k sweet spot, 4k-6k lorepacked-ok, 7k-10k+
      bloated). Porting it verbatim would have handed `peak`/`build`/`review` a validator that
      actively contradicts their own tuned prompts. Flagged this to the user before proceeding
      (not a unilateral call) — user picked "rebuild aligned version in TS" over "skip" or "port
      as-is, flag experimental."
    - **New: `card_budget` and `card_macro_check`**, two TS builtin tools
      (`packages/opencode/src/tool/card_budget.ts` + `.txt`, `card_macro_check.ts` + `.txt`),
      built fresh against the current model rather than translated from the Rust. Split into two
      tools (not one combined validator like the Rust original) specifically so permission
      scoping could match the existing `review-macros`/`review-structure` lens split exactly —
      one tool per concern, same pattern `tokenize` already established.
      - `card_budget`: takes optional `scenario`/`personality` (summed into the permanent
        per-turn budget and banded against peak.txt's real anchors: <2000 under_specified,
        2000-3000 sweet_spot, 3001-6000 lorepacked_range, 6001-6999 approaching_bloat, 7000+
        bloated) and optional `lorebook_hub`/`lorebook_entry` (banded against the ~300 aim/
        ~1000 ceiling and ~300 soft/~400 hard lines from the same prompt). Reuses `tokenize.ts`'s
        BPE encoder loader (exported `loadEncoder`/`Encoding` from that file rather than
        duplicating the lazy-load-and-cache logic).
      - `card_macro_check`: takes `text` (+ optional `box` label), flags spaced placeholders
        (`{{ user }}`), unknown double-brace macros (anything not in
        `user`/`char`/`sub`/`obj`/`poss`/`ref`), and the `{{user}}`→"the user" collapse bug
        (text using the macro *and* containing literal "the user" prose). Deliberately does
        *not* flag single-brace tokens outside `{user}`/`{char}` — no corpus basis for treating
        arbitrary `{word}` prose as a macro-typo signal, so left alone to avoid false positives.
      - **Registration** follows `tokenize`'s exact three-touchpoint pattern in
        `tool/registry.ts` (import, `yield* XTool`, `Tool.init` + `builtin` array entry — no
        extra wiring needed for `peak`/`build`, which inherit `"*": "allow"` from `defaults`).
      - **Permission wiring** in `agent/agent.ts`: `review` gets both (general critic, needs
        everything); `review-structure` gets `card_budget` only (its lens is token economics,
        already had `tokenize`); `review-macros` gets `card_macro_check` only (its lens is macro
        correctness). `review-prose`/`review-lore` get neither — not their concern.
      - **Prompt nudges**: `peak.txt`, `build.txt`, `review.txt`, `review-structure.txt`,
        `review-macros.txt` — replaced their existing "use `tokenize`, don't eyeball it" lines
        with pointers to `card_budget`/`card_macro_check` for the cases those tools now band/
        check directly, keeping `tokenize` as the fallback for anything ad hoc (e.g. a single
        Opening Message, which has no fixed numeric band per peak.txt — "cheap in aggregate").
    - **Verified, thoroughly, before calling it done:** `cargo build/clippy --all-targets -D
      warnings/test --workspace` all clean; `scripts/fmt.sh --check` clean; release binary
      rebuilt and reinstalled via `scripts/install-jclaw.sh` (confirms the actual shipped
      artifact, not just debug); `bun run --cwd packages/opencode typecheck` clean; **full `bun
      test` across all 9 TS packages — 4,642 tests, 0 failures** (no flakes this run, not even
      the known §7 `httpapi-v2-pty` one); headless `serve` boot confirms `card_budget`/
      `card_macro_check` in `/experimental/tool/ids` and the exact intended permission split in
      `/agent` JSON (`review`: both, `review-structure`: `card_budget` only, `review-macros`:
      `card_macro_check` only, `review-prose`/`review-lore`: neither). **Live tmux end-to-end**
      (fresh scratch workspace, real `jclaw`): asked `peak` to draft Scenario+Personality for a
      throwaway "Mira, dockside mechanic" card and explicitly call both new tools — `card_budget`
      correctly summed 59+246=305 tokens and banded it `under_specified` with the exact prompt
      wording; `card_macro_check` correctly passed the `{{sub}}`-using text as clean. Then asked
      for an Opening Message + normal self-review: `task` → `review` subagent fired as usual
      (permission changes didn't break the existing item-24 pipeline), used plain `tokenize` on
      the Opening Message (correct — Opening Messages aren't banded by `card_budget`), and
      reported "Self-review passed clean" — matching the designed silent-fix-or-clean-note
      behavior exactly.
33. **Dynamic lens selection for `review-swarm`** — item 27's orchestrator fired all 4 review
    lenses (`review-prose`, `review-lore`, `review-macros`, `review-structure`) unconditionally
    on every `/swarm` run, even when a lens had nothing to check. Brainstormed and picked by the
    user as a targeted follow-up: have the orchestrator decide, per draft, which lenses actually
    apply. Pure prompt-engineering — confirmed via exploration that `tool/task.ts`'s
    `subagent_type` resolution is a plain string lookup with no dispatch code anywhere, and
    `review-swarm` already receives the draft as literal inline text (no read/grep needed to see
    it), so the decision is simple LLM text judgment on content already in context.
    - `agent/prompt/review-swarm.txt` — old step 1 ("call the `task` tool four times... every
      turn") split into a decision step and a fan-out step. Decision rules: `review-prose` and
      `review-structure` stay default-on (near-universally applicable). `review-lore` is skipped
      when handed a single isolated box/entry with nothing else to cross-reference (its whole
      job is cross-box/cross-file consistency). `review-macros` is skipped when the draft
      contains no `{{...}}`/`{user}`/`{char}`-style token anywhere. Explicit guidance: when
      genuinely unsure whether a lens applies, run it — this stays a judgment call, not a hard
      mandate to minimize calls. Added a transparency requirement to "How to respond": the
      merged report must open with one line stating which lenses ran vs. were skipped and why,
      never silently.
    - Matching "four specialist critics" → "whichever specialist critics apply" wording fixes
      in `agent/prompt/peak.txt:89`, `agent/prompt/build.txt:33` (both reference `review-swarm`
      from their self-review sections), and the `review-swarm` agent's `description` string in
      `agent/agent.ts:369` (user/API-facing via `/agent`, `@`-mention descriptions).
    - **No permission or registration changes** — `review-swarm`'s existing `task` allow-list
      already covers all 4 lens names (`"*": "deny"` then explicit allow per name); calling
      fewer of them needs no permission edit. The 4 lens `.txt` files themselves are untouched.
    - **Verified:** `bun run --cwd packages/opencode typecheck` clean; headless `serve` boot
      confirmed the new `review-swarm` description loaded and all agents still list (`build`,
      `peak`, `review`, `review-swarm`, all 4 lenses, `worldsmith`, etc. — no agent dropped by a
      syntax error in the edited block). **Live tmux end-to-end, both directions** (fresh
      scratch workspace, real `jclaw`, cross-checked against the session DB per item 27's
      technique — not just trusting the report text):
      - **Skip case:** a single Opening Message with zero macro tokens and nothing else handed
        alongside it. The session DB confirmed exactly 3 child sessions spawned under
        `review-swarm` (`review-prose`, `review-structure`, `review-macros`) — `review-lore` was
        genuinely never called, not just described as skipped. The report's header read "Lenses
        run: prose, structure, macros / Lore: skipped (isolated single box, nothing to
        cross-reference)." **Note:** the model (free-tier MiMo V2.5) chose to run `review-macros`
        anyway despite the text having zero macro tokens — a legitimate use of the "when unsure,
        run it" allowance rather than a bug (same category of model-judgment variance already
        noted for item 25's `plan_enter` tiebreak), but it means the macro-skip path is proven
        reachable in the prompt logic without every model/run choosing to take it. The lore-skip
        path fired cleanly.
      - **No-regression case:** a full 4-box card using `{{user}}` with a real gap (a "late
        father's debts" personality hook never demonstrated anywhere else). The session DB
        confirmed all 4 lens sessions spawned under `review-swarm`
        (`review-prose`/`review-macros`/`review-structure`/`review-lore`), timestamps within a
        ~14s window (parallel fan-out, matching item 27's original verified pattern). The merged
        report correctly surfaced real cross-lens findings (density/token-economics from
        structure, a stock-deflection-pattern and cliché line from prose, a father's-status
        contradiction and unsupported debt subplot from lore, a clean pass from macros) —
        matching the already-verified item 27 merge/dedup baseline with no regression.

34. `276db78` **Draft-swarm: parallel per-section variant drafting + `/takes` command.** The
    inverse of item 27's review-swarm — instead of fanning a *finished* draft out to critics,
    fan a *single card section* out to parallel authors that each write a distinct-angle variant,
    then present all of them and stop for the user to pick or modify one before moving to the
    next section. The user asked for "agent swarm write, but only for a singular part of a card,
    not a whole one, as a new agent; finish one section then prompt the user for another after
    they pick or modify the one they like." Three design forks settled up front via
    AskUserQuestion: a **new dedicated hidden worker** (not a reuse of `peak`), **3** variants
    default, slash command **`/variants`** — but see the naming correction below.
    - **New agents**, both registered in `agent/agent.ts` between the `review-swarm` entry and
      `explore` (mirroring the review-swarm/lens family placement):
      - `section-draft` (`mode: "subagent"`, `hidden: true`, `native: true`) — leaf worker. Given
        one section name + optional existing-card context + one creative angle (baked into the
        `task` call's `prompt`), writes exactly one variant and returns **only** the drafted text
        (no preamble — the raw `result.parts.findLast(text)` from `task.ts` *is* the variant
        shown to the user, so any "here's a take using angle X" chatter would leak in).
        `agent/prompt/section-draft.txt` is deliberately terse — it mirrors `peak.txt`'s box
        vocabulary, the visibility line verbatim, macro rules, and the Opening-Message
        banned-phrase list (conditional: applies only when the requested section is an Opening
        Message), rather than re-deriving the whole rubric, since it's a fast worker that only
        ever runs *through* peak/build. Permission: `"*": "deny"` + `read: "allow"` only.
      - `draft-swarm` (`mode: "subagent"`, not hidden, `native: true`) — orchestrator, a close
        sibling of `review-swarm.txt` with the **merge step removed** (variants must stay
        distinct — never dedup/summarize/pick a favorite) and a presentation + explicit
        **hand-back** step added (tell the calling agent to stop and wait for the user's pick,
        not start the next section). Its transparency line names each variant's angle instead of
        review-swarm's "ran/skipped lenses" line. Permission mirrors review-swarm's exactly:
        `"*": "deny"`, read/grep/glob/list allow, `task: { "*": "deny", "section-draft": "allow" }`.
    - **No permission edit on `peak`/`build`** — verified directly (not assumed): the shared
      `defaults` ruleset opens with `"*": "allow"` (`agent.ts:135`), `Permission.evaluate`
      resolves via `findLast` (last-matching-rule-wins, `permission/index.ts:28`), and neither
      `peak` nor `build` ever narrows `task`, so the blanket allow is still the winning rule for
      `task` + any `subagent_type`. Same reason review-swarm needed no such edit. Confirmed by the
      existing `agent.test.ts:84-90` asserting task→arbitrary-name is `allow` for a primary agent.
    - **No `PRESET_AGENTS`/`modelKey()` change** — that set (`context/local.tsx:55`) only covers
      `mode: "primary"` agents sharing `build`'s model slot; both new agents are subagents, like
      review-swarm/the lenses (also absent from the set), which `modelKey()` already handles by
      falling through to the agent's own name.
    - **Prompt nudges:** new `## Drafting multiple takes on one section` section in `peak.txt`
      (after the self-review section) and a matching condensed bullet in `build.txt`'s
      `## How you work` — both instruct calling `task` with `subagent_type: "draft-swarm"` for
      single-section options, showing all variants, waiting for the pick, then asking about the
      next section.
    - **Command:** new Cards entry in `component/prompt/index.tsx` (between `/contradictions` and
      `/swarm`, same `fillPrompt` pattern, no agent-switch so it stays on peak/build). **Naming
      correction found only by running it live:** the intended `/variants` name **collided with a
      pre-existing `variant.list` command** (`app.tsx:667-671`, "Switch model variant", already
      owns `slashName: "variants"`) — the `/` popup showed two `/variants` rows. Renamed the new
      one to **`/takes`** (alias `/draftswarm`). The approved plan doc still says `/variants`; the
      shipped code is `/takes`.
    - **Verified:** typecheck clean (opencode + tui); targeted tests
      (`agent.test.ts`/`subagent-data`/`agent-color`/`task.test.ts`, 68 pass); full `packages/tui`
      191 pass; full `packages/opencode` 3034 pass with only the known §7 `attention.test.ts`
      audio-decode full-suite-load flake (confirmed 18/18 solo). Headless `/agent` boot lists both
      new agents (`draft-swarm` visible, `section-draft` hidden), no agent dropped. **Live tmux
      end-to-end, both a Scenario round and an Opening-Message round** (real `jclaw`, fresh scratch
      workspace, cross-checked against the session DB per item 27/33's technique): each round
      spawned exactly one `draft-swarm` child of the peak/build session and exactly 3
      `section-draft` grandchildren with distinct angle titles (`emergency repair`/`new
      arrival`/`late night` for Scenario), timestamps confirming real parallel fan-out. The
      transcript ended on the designed hand-back ("Let me know which variant you like… then ask
      whether I want to draft another section next"); picking Variant 3 → agent locked it in, ran
      `card_budget`/`card_macro_check` on its own, and asked about the next section; continuing to
      Opening Message spawned a fresh 3-worker round with the prose shifting to scene/dialogue
      register (section-awareness of the banned-phrase branch working). **Note:** dispatch spread
      was ~11s (Scenario) / ~35s (Opening Message) — wider than item 27's ~2s review-swarm
      baseline, but same single-turn parallel-`task` mechanism; attributed to free-tier MiMo V2.5
      queuing under session load, not a code difference. Count and labeling correct both rounds.

35. **`/evolve`/`/refine` — evolutionary refinement loop.** A third review tier alongside
    `/contradictions` (item 24, manual single-pass) and `/swarm` (item 27, deep one-shot
    multi-lens): repeats the existing single-generation self-review cycle (draft → `task`
    `subagent_type: "review"` → fix) automatically for up to N generations, fully unattended,
    stopping early the instant a pass comes back clean. Opt-in only — the ordinary default
    self-review on a normal draft is untouched. Design picked via clarifying questions: new
    command (not a replacement for the default), reviewer per generation is the existing
    `review` subagent (not `review-swarm` — that agent's contract is explicitly "findings only,
    no auto-fix," and looping it would mean changing that contract, which wasn't the ask),
    generation cap user-configurable via trailing argument (`/evolve 5`, default 3, hard-clamped
    to 10), output is the finished result plus one short summary line, never a per-generation
    dump.
    - **No new agent.** `review-swarm`/`draft-swarm` are dedicated orchestrators because they
      fan out to *multiple parallel* child `task` calls and merge results; `/evolve` is strictly
      sequential (one `review` call at a time) and the fix step is authoring logic peak/build
      already own, so a new orchestrator would only duplicate the quality-bar prompt or add a
      pointless extra `task` hop. peak/build already inherit `"*": "allow"` from `defaults` in
      `agent.ts`, so repeated `task` calls to `review` needed no permission change — this is a
      pure prompt-engineering + one small UI change.
    - `agent/prompt/peak.txt` — new `## Evolutionary refinement loop` section (between
      "Self-review before showing a finished draft" and "Drafting multiple takes on one
      section"): explains the loop is `/evolve`/`/refine`-only, spells out the per-generation
      cycle, the clean-pass-is-a-stop-signal rule, the hard cap, and the one-line summary format
      (converged vs. capped wording).
    - `agent/prompt/build.txt` — matching bullet added to `## How you work`, condensed to match
      its existing brevity, right after the self-review bullet.
    - `component/prompt/index.tsx` — three edits. **Crux finding, verified by reading the file
      directly:** the Cards command family (`/card`, `/swarm`, `/takes`, etc.) only ever fires
      via the `/` popup, which auto-hides the instant a space follows the command word
      (`autocomplete.tsx`) — so no Cards command has ever been able to carry a typed trailing
      argument, and `/evolve 5` typed directly + Enter would fall through `submitInner()`'s
      shared dispatch branch (~line 1251, matches only `sync.data.command`, a *different*,
      backend-registered command list) straight to the plain-message `else` branch. Fix: (1)
      `DEFAULT_EVOLVE_GENERATIONS`/`MAX_EVOLVE_GENERATIONS`/`resolveEvolveGenerations`/
      `buildEvolvePrompt` helpers right after `fillPrompt`; (2) a normal Cards entry
      (`slashName: "evolve"`, alias `refine`) for the zero-arg popup-select path; (3) a small
      standalone regex early-return in `submitInner()` right after the existing `exit`/`quit`
      check — `trimmed.match(/^\/(?:evolve|refine)(?:\s+(\d+))?$/i)` — that captures the typed
      argument and calls `fillPrompt` directly, `return false` (no session, no send), for the
      direct-Enter-with-argument path the popup structurally can't reach. As a side effect this
      also makes bare `/evolve` (no number) work when typed and Enter'd directly, closing a
      minor gap every other Cards command still has.
    - **New test:** `test/cli/tui/evolve-command-dispatch.test.ts` (6 pass), mirrors the existing
      `prompt-submit-race.test.ts` convention of re-implementing the control-flow shape in a
      standalone harness rather than importing the real Solid component — asserts the regex
      match + generation-resolve logic directly (default, explicit count, hard-cap clamp, alias,
      non-numeric fallthrough, zero-clamps-to-default).
    - **Verified:** both packages typecheck clean; new test 6/6 pass; full `packages/tui` suite
      197 pass/1 skip/0 fail (no regressions); grepped for existing tests referencing
      `peak.txt`/`build.txt` content or `promptCommands`/`fillPrompt`/`slashName` — none found,
      so the prompt-text and Cards-array edits had no snapshot to break. **Live tmux
      end-to-end**, cross-checked against the session DB (not just the transcript) per the
      established item 27/33/34 technique: direct-Enter `/evolve 2` (no popup) filled the
      composer with the resolved 2-generation text and created no session; bare `/evolve`
      defaulted to 3; popup-selecting `/evolve` (typed `/evol`, Enter) produced the identical
      3-generation fill. A real run against a deliberately flawed test card (banned
      Opening-Message clichés + a `{{user}}`→"the user" macro-collapse bug) spawned a
      `draft-swarm` child first (the model's own choice for the "draft" step, not literally
      what the prompt envisioned but a legitimate reading of it) then, strictly sequentially
      after it finished (`review`'s `time_created` after `draft-swarm`'s `time_updated`), one
      `review` child — converged clean after that single generation, and the final reply was
      exactly one summary line ("1 generation ran. Original had banned purple prose... and a
      pronoun-collapse bug — both fixed. Review passed clean; only open question is...") with no
      per-generation dump. DB confirmed exactly 2 child sessions total, no stray extra loop
      iteration. **Not independently observed live:** the hard-cap-hit path (`/evolve 1` still
      flagging something after forced stop) — the test card happened to converge clean in one
      pass instead, which is itself correct early-stop behavior, just not evidence of the
      cap-enforcement branch specifically; that logic is the same plain "never exceed N"
      instruction already proven to work for the early-stop case.

36. **Cross-checked the card-authoring rubric against 4 external botmaking guides, folded in
    what survived, and live-verified the result.** The card model baked into `peak`/`build`/
    `review*` (item 17 onward) was built entirely from the user's own corpus reads — this
    session brought in outside sources for the first time to generalize/stress-test it, not
    replace it. Process followed the same corpus-driven convention as item 17
    (`corpus-driven-prompt-iteration` in project memory): read sources, diff against the
    existing rubric, resolve every disagreement with the user explicitly, only then edit
    prompt files — no silent merges.
    - **Sources:** NicholasCS's "Big-Ass Botmaking Guide," absolutetrash's bot guide,
      `rentry.org/botcreationguide`, and `rentry.org/letsmakeabot` (the last one flagged by
      its own text as a SillyTavern/generic-card guide, not JanitorAI-specific — weighted
      lower accordingly). Fetched via `WebFetch` with a summarize-not-reproduce prompt (a
      verbatim-extraction attempt was correctly refused as copyright reproduction; the
      summarize framing worked and is the pattern to reuse for future guide reads).
    - **Resolved as "already correct, no change":** four points where guides conflicted with
      each other or with the existing rubric turned out to resolve in favor of what jclaw
      already had — 2nd-person Opening-Message POV is a valid creator choice (not a ban),
      personality-trait count/format is creator convention (not a prescribed 15-20 or 6-ratio
      count), and Example Dialogue is a temporary/context-resident field (loads once, rolls
      off with chat history) rather than a permanent resent-every-turn cost — this last point
      directly overturned one guide's contrary claim.
    - **Explicitly held, not adopted:** the token-ceiling number (3 of 4 guides converged
      well below jclaw's existing 2k-3k sweet spot, but the user chose to keep the existing
      number rather than trust guide say-so on a load-bearing figure without a real-corpus
      check), content/trigger-warning authoring (judged out of scope — belongs to the
      Description/thumbnail field, not the four boxes `peak`/`build` write), a hard ensemble
      character cap (single-source, no corroboration), and the `<START>` Example Dialogue
      format marker (creator convention, not a schema fact to assert).
    - **Folded into `peak.txt`/`build.txt`** (authoring) **and mirrored into
      `review.txt`/`review-structure.txt`/`review-macros.txt`/`review-prose.txt`** (matching
      checks, so critics enforce the same bar authors write to — `review-lore.txt` untouched,
      nothing in this batch fit its cross-consistency lens): Scenario must never describe the
      specific opening/current scene's location or condition (re-read every turn, freezes the
      story there); no time-skips/backstory-dumps in the Opening Message; anti-railroading
      (don't lock a scene into one rigid physical setup); sparse `{{user}}` mentions in Opening
      Messages (mention-frequency copies into replies same as format does); `{{char1}}`/
      `{{char2}}` numbered macros are non-functional, only bare `{{char}}` works; no narrating
      `{{user}}` inside Example Dialogue specifically, and no clustering every example around
      one content type; flag redundant likes/traits that just restate a broader trait; flag
      precise physical measurements (height/weight/build) in favor of relative language;
      state facts the model would otherwise wrongly default-assume; no special fonts/unicode
      in names or prose; side characters get proportionally less permanent-field detail than
      the main character(s) in an ensemble.
    - **Live-verified with disposable test cards in real `jclaw` (tmux), cross-checked against
      the session DB** rather than trusting the transcript, per the established item 27/33/34
      technique — and this is the first time that technique caught a real gap instead of just
      confirming success. First pass: a full Borik-blacksmith card through `review-swarm`
      (confirmed all 4 lenses genuinely spawned as parallel children) plus an isolated
      Dana-diner card through a direct `review` call, both with deliberately planted
      violations of every new rule. Result: 4 of 10 new checks fired cleanly on the first try
      (the `{{char1}}` macro fact, the Opening-Message backstory-dump rule, the redundant-trait
      rule, the Example-Dialogue-clustering rule); 2 — the Scenario-freeze rule and the
      avoid-exact-numbers rule — fired **zero times across both cards**, including a version of
      the Dana card with nothing else planted to distract from the Scenario violation.
    - **Root-caused and fixed, then retested clean on the identical card.** Both dead rules
      were sitting as one bullet apiece inside already-long lists, with no mechanical trigger
      to check against — unlike the working rules, which either had a crisp one-line test or
      quoted phrases the model could pattern-match directly. Fix: gave both a bolded lead-in
      plus an explicit mechanical test (Scenario: "does any sentence use a present-tense scene
      verb — sitting, standing, arguing, currently at/in — to place characters somewhere doing
      something?"; numbers: "flag any number attached to height/weight/build specifically").
      The numbers rule also had a real scoping bug caught in the process, not just a phrasing
      one: its original wording flagged "exact ages" alongside measurements, which contradicts
      every guide's own treatment of age as normal, expected exact card info — likely part of
      why the model wasn't applying it, since the instruction conflicted with its own
      training-data intuition about how real cards read. Narrowed to physical
      measurements/stats only, age explicitly exempted. Retesting the identical Dana card
      afterward: both fired clean, with the numbers finding explicitly stating "Age is fine as
      exact; height/weight/build generally isn't" — confirming the scoping fix landed, not
      just the prominence fix.
    - **Also observed, not a regression:** the `review` subagent returned genuinely empty
      (confirmed via the session DB — zero parts on the assistant message) three times across
      the test session, on what looks like free-tier model/infra flakiness unrelated to the
      prompt content. `peak` handled it the same way each time: disclosed the failure in one
      line ("The review task returned empty...") and ran the review itself inline rather than
      silently dropping the check or looping retries forever. Not caused by this session's
      edits — worth knowing if `review` failures show up again.
    - **Verified:** `bun run --cwd packages/opencode typecheck` clean after both the initial
      fold-in and the strengthening pass. No test suite run — pure prompt-text `.txt` changes
      with no existing test coverage on these files (same as item 31).

37. **Voice profiles — replicate a specific creator's formatting/macro/prose style with close
    fidelity.** Brainstormed and designed via Plan Mode (a formal spec doc + commit wasn't
    possible under Plan Mode's read-only constraint, so the design was folded directly into the
    plan file instead — see that session's plan artifact for the full design rationale). Key
    scope decisions, all confirmed via clarifying questions before any code was written:
    fidelity means *style* (box-formatting conventions, macro/pronoun habits, prose
    register) applied to **fully original content**, never reused phrasing — this keeps the
    feature compatible with the existing anti-slop/anti-copy rubric (item 17 onward) rather than
    contradicting it; derivation is an **analyzed, persistent profile doc** (not raw samples
    re-read every time); storage is a `voices/` subfolder of the *existing* lore library, not a
    new top-level store; trigger is a new `/voice` command family mirroring `/lore`'s; profile
    authoring is a **new dedicated subagent** (`voice-profiler`), not inline `build` logic; a
    `review-voice` fidelity-check lens (parity with `review-swarm`'s other lenses) is explicitly
    **deferred**, not built this round.
    - **New subagent `voice-profiler`** — `agent/prompt/voice-profiler.txt`, registered in
      `agent/agent.ts` (`mode: "subagent"`, `hidden: true`, `native: true`, inserted between
      `draft-swarm` and `explore`). Given raw sample text **inline in its prompt** (never file
      paths), extracts formatting conventions per box, macro/pronoun habits, and prose register
      into a structured Markdown profile (`# Voice profile: <name>` /
      `## Formatting conventions` / `## Macros and pronouns` / `## Prose register` / `## Notes`)
      and returns it as plain text — same "response text IS the artifact" contract
      `section-draft` already uses (item 34), so the caller needs no extra parsing. Explicitly
      told never to quote samples at length (a profile that's mostly lifted sentences would
      defeat the point) and never to comment on content quality — that's `review*`'s job, not
      this agent's. Permission is an exact copy of `review-prose`'s shape: `"*": "deny"` +
      `read`/`grep`/`glob`/`list`: `"allow"` — no `write`, no `external_directory`, since it
      never touches disk itself.
    - **New picker `dialog-voice.tsx`** — near-copy of `dialog-lore.tsx` (same `Glob.scan`
      pattern, extension filter, category grouping), scoped to `Global.Path.lore/voices/`
      instead of the lore root. **Single-select**, unlike `/lore`'s multi-select — only one
      creator's voice applies to an authoring session at a time.
    - **Commands** in `component/prompt/index.tsx`'s Cards array (same `fillPrompt` pattern as
      the rest of the Cards family, inserted right after `card.loreAdd`, no keybind coupling
      needed): **`/voice add`** (alias `/voiceadd`) prefills a `build`-directed instruction to
      gather sample paths/text, then call `task` with `subagent_type: "voice-profiler"` passing
      the raw sample text inline, then save the returned profile to `voices/<name>.md` (ask
      before overwrite, confirm the path) — mirrors `/lore add`'s existing save behavior almost
      exactly. **`/voice`** opens `DialogVoice`; on pick, `fillPrompt(prompt, "peak")` naming the
      profile's absolute path, with an explicit "match the pattern, not the phrasing" line.
    - **No permission changes needed on `peak`/`build`** — both already carry
      `external_directory: { [Global.Path.lore + "/*"]: "allow" }` from earlier items, and the
      dotall-glob behavior confirmed back in item 28 means that pattern already covers the new
      `voices/` subfolder at any depth. Confirmed live (see below): picking a profile via
      `/voice` produced **zero** permission prompts.
    - **Prompt changes:** `peak.txt` gained a new `## Matching a creator's voice (` `/voice`
      ` only)` section (slotted right before "Always do these"), explicitly reconciling with the
      pre-existing, looser "'same format/style as X' means structure and register, not a copy"
      line (item 17-era, still at what's now a slightly later line number) — a voice profile is
      a *stronger*, deliberate request for close pattern fidelity, but the content-originality
      rule and the full "anatomy of a bad card" rubric still apply in full; if the profile's own
      habits would break a hard rule elsewhere (e.g. bloat), flag the conflict rather than
      silently picking one over the other. The old "same format/style as X" line got a one-clause
      pointer back to the new section so the two don't read as contradictory. `build.txt` got a
      condensed mirror bullet in "How you work" for the `/voice add` save flow.
    - **Verified:** both packages typecheck clean; `test/agent/agent.test.ts` 43/43 pass (no
      changes needed — confirmed by investigation that hidden subagents never appear in that
      file's "all primary agents disabled" test or the event-manifest test, matching the
      existing pattern for every prior hidden subagent added: `review-prose`, `section-draft`,
      etc.); `test/event-manifest.test.ts` + `test/tool/task.test.ts` (20 pass); full
      `packages/tui` suite 197 pass/1 skip/0 fail. Headless `serve` boot confirms 18 total
      agents including `voice-profiler` (`mode: "subagent"`, `hidden: true`, permission shape
      matching `review-prose` exactly) and confirms `peak`/`build`'s existing lore permission
      entry is unchanged and present. **Live tmux end-to-end**, cross-checked against real
      artifacts on disk (not just transcript text, following the item 27+ verification
      convention): planted two deliberately distinctive sample cards (bracketed `[Trait: ...]`
      lists, `{char}`/`{sub}`/`{poss}` single-brace macros, terse fragment-heavy prose, a
      recurring "permanently" setting anchor) in a scratch workspace. `/voice add` → `build`
      correctly prompted for external-directory read permission on the scratch paths (expected
      default-`ask` gate, approved), globbed for an existing profile before writing (confirmed
      overwrite-check works), spawned `voice-profiler` (visible in the transcript as "Voice-
      Profiler Task — Profile Rustlatch voice", 19.5s), and saved a genuinely well-formed
      profile to `voices/rustlatch.md` — it correctly named the bracketed trait format, the
      exact macro set used, the fragment prose rhythm, and even independently caught the
      "permanently" recurring motif, while quoting only short phrases rather than lifting whole
      sentences. `/voice` → picker correctly listed `rustlatch.md` under a "Voices" category →
      picking it switched to `peak` with the right prefilled instruction and **no permission
      prompt** → asked `peak` to write a new "Vess, junkyard scavenger" card in that voice →
      the result used the exact bracketed trait format, the same macro set, the same
      fragment-and-beat Opening Message structure ("Silence. Then:"), and zero exclamation
      points — while every word of content was new. Test artifacts (`voices/rustlatch.md`, the
      scratch workspace) were deleted after verification, not left in the real lore library.
      **Also observed, matching item 36's noted pattern:** the free OpenCode Zen tier hit a
      stretch of `Internal server error` retries with exponential backoff (up to ~2.5 minutes
      between attempts) mid-session — infra flakiness unrelated to this change; the run
      eventually succeeded without any code-level retry logic being needed.

38. **Windows one-click installer (beta) — branch `windows-one-click-installer`, since merged to
    `main` via `1582435` (see item 39 for the real-hardware debugging that followed).** First
    cross-platform packaging work. The app itself is CI-proven to boot on
    Windows; the branch ships a real double-click `jclaw-setup.exe`. Built subagent-driven
    (brainstorm → spec → plan → per-task implement+review → final review), then debugged two
    packaging failures live via CI.
    - **Design (spec at `docs/superpowers/specs/2026-07-10-windows-one-click-installer-design.md`,
      plan at `docs/superpowers/plans/2026-07-10-windows-one-click-installer.md`, both on-branch):**
      fat offline bundle (jclaw.exe + pinned bun.exe 1.3.14 + tui source + node_modules) → Inno
      Setup → per-user `%LOCALAPPDATA%\Programs\jclaw` (no admin), Start Menu shortcut, uninstaller.
    - **Task 1 — `rust/crates/rusty-claude-cli/src/tui.rs` `locate_bun` fix (the one piece
      testable on macOS, `cb478aa`).** Extracted a pure `bun_candidates()` builder (unit-tested,
      4 tests) that probes, in order: `JCLAW_BUN` → `bun.exe` next to the running exe (the bundled
      layout) → `%USERPROFILE%\.bun\bin\bun.exe` / `$HOME/.bun/bin/bun` → PATH. Uses
      `std::env::consts::EXE_SUFFIX` so the binary name is `bun` on Unix, `bun.exe` on Windows —
      no `#[cfg(windows)]`, testable anywhere. Fixes the native-Windows gap (old code only read
      `$HOME` + literal `bun`). `#[cfg(unix)]` exec path untouched. **This fix is REQUIRED for a
      direct `cargo run` on Windows too** — on `main` (without it) jclaw can't find bun.exe.
    - **Task 2/3 — `installer/jclaw.iss` + `.github/workflows/release.yml` `installer-windows`
      job.** New job on `windows-latest`: build `--bin jclaw` → install Bun → stage payload →
      full `bun install` → **headless `/agent` boot-probe gate** (asserts `peak`+`build`, dumps
      child serve stdout/stderr on failure) → package → upload artifact / attach to `v*` tags as
      `prerelease: true`.
    - **Debug arc (two real failures, root-caused via systematic-debugging, both reproduced
      locally on macOS before fixing):**
      1. **`bun install --production` broke boot.** opencode declares `@opencode-ai/core` (a
         foundational runtime package, imported at `index.ts` startup, 194 import sites) as a
         **devDependency**; `--production` omits it → `serve` crashed `Cannot find module
         '@opencode-ai/core/...'` → boot-probe correctly failed the job. Fix (`09b9301`): full
         `bun install`, not `--production` (ship the same tree the dev machine runs). User chose
         "ship full" over reclassify/allowlist-delete. **Do NOT re-introduce `--production` here.**
      2. **Inno per-file lzma took 40+ min.** Full node_modules is ~100k tiny files (nested
         duplicate `effect`/`typescript`/`drizzle`); solid `lzma2/max`, then non-solid
         `lzma2/normal`, both ~40 min. **Fix (`f4ebe32`): archive-based installer.** CI tars the
         payload into ONE `payload.zip`; the `.iss` ships that single file (`nocompression`) and a
         `[Run]` step extracts it into `{app}` at install with Windows' built-in `{sys}\tar.exe`
         (64-bit install mode maps `{sys}` to real System32); `[UninstallDelete]` clears `{app}`
         since tar-extracted files aren't tracked by `[Files]`. **Inno compile dropped to 4.7 s.**
    - **Result:** CI run 29101333196 green — `jclaw-setup.exe` **313 MB**, boot-probe passed.
      Promoted to pre-release **`v0.1.0-beta.1`** (tag on branch HEAD `f4ebe32`, not main;
      `gh release`, installer + `.sha256` attached). An intermediate **portable-zip** delivery
      also works (run 29099832196, artifact `jclaw-windows-portable` 285 MB — extract + run
      `jclaw.exe`) if a no-installer bundle is ever wanted; the `.iss` now supersedes it.
    - **UNVERIFIED (needs a real Windows box — the beta's whole point):** (a) the install-time
      `tar` extraction (`{sys}\tar.exe`, path quoting, 64-bit `{sys}` mapping) — CI green only
      proves the installer *compiles*, not that it *installs*; (b) the interactive TUI on a
      Windows console (raw-mode/mouse/alt-screen — upstream has `terminal-win32.ts` but it's
      unproven). SmartScreen will warn (unsigned).
      **[Superseded by item 39: (a) was tested on a real laptop and failed three different ways
      (PATH, then two symlink layers) — all fixed through `v0.1.0-beta.5`; (b) verified working
      on the real laptop with beta.5.]**
    - **Gotchas / notes:** the pre-existing `build-macos-arm64` matrix leg fails independently
      (old raw-`claw`-binary build, untouched by this work) — the run's overall `failure` is that
      leg, not `installer-windows`. GitHub rejects `git push` of files >100 MB, so the ~300 MB
      installer can ONLY ship via release assets / CI artifacts, never committed. Same-tag
      `prerelease`-flag race between the `build` job (normal release) and `installer-windows`
      (prerelease) is a known Minor (final-review flagged) — non-blocking for a manual promote.
    - **Follow-ups:** merge branch → main when the live Windows run passes; a `review-voice` lens
      (item 37) is still separate/unrelated; the archive-based `.iss` could gain a
      Windows-Terminal-aware shortcut (currently launches jclaw.exe directly → auto console).

39. **Windows installer debugged against a real laptop; five pre-releases; upstream
    auto-upgrade neutered.** User installed on a real Windows box (PowerShell 5.1, non-admin
    Guest-type account) and hit successive failures; each fix shipped as a new tag because CI
    only builds on `v*` tag push — **a fix on `main` does nothing for users until tagged**.
    All on `main`: `fb949cc` (user), `1519b34`, `071f8a2`, `7e93fac`.
    - **beta.2 — `jclaw` not recognized in a terminal.** The `.iss` never touched PATH (Start
      Menu only, by design of item 38). Added `[Code]` `EnvAddPath`/`EnvRemovePath` writing
      `{app}` into `HKCU\Environment\Path` + `ChangesEnvironment=yes` (broadcast so *new*
      terminals pick it up without reboot). Install dir: `%LOCALAPPDATA%\Programs\jclaw`.
    - **beta.3 — `error: preload not found "@opentui/solid/preload"`.** Bun's default
      **isolated** linker symlinks every dep from each workspace package's `node_modules` into a
      shared `node_modules/.bun/<pkg>@<hash>` store. CI (admin) creates symlinks fine; the end
      user's install-time `tar.exe` runs under `PrivilegesRequired=lowest` — **no symlink
      privilege, links silently dropped**, `@opentui/*` vanished. Fix: `bun install
      --linker=hoisted` (real files for npm deps).
    - **beta.4 — `Cannot find module '@opencode-ai/core/installation/version'`.** Same privilege
      boundary, second layer: **even hoisted, bun links *workspace* packages as symlinks**
      (`node_modules/@opencode-ai/core → ../../packages/core`; 15 workspace links + 81 `.bin`
      shims on a probe install). Fix chain, **proven locally on macOS first** (scratch hoisted
      install → `tar -a -c -L` zip → extract → 0 symlinks → server boots, `/agent` lists all 18
      agents): (a) archive with `tar -L` (dereference; workspace dep graph checked acyclic —
      `sdk` is a leaf — so no infinite recursion); (b) CI hard-gates `tar -tvf | ^l` = 0 symlink
      entries; (c) **boot check moved AFTER an extraction round-trip** with System32 `tar.exe` +
      zero-reparse-point scan — beta.1–.3 all passed CI because the probe ran on the pristine
      staged tree, never the artifact users actually get; (d) install-time extraction moved from
      `[Run]` (exit code silently ignored — the original silent-brick mechanism) to a `[Code]`
      `ExtractPayload` AfterInstall handler: checks tar's exit code + sentinel files, raises →
      **setup aborts and rolls back** instead of completing broken; (e) PATH written as
      `REG_EXPAND_SZ` (plain `REG_SZ` from beta.2 would stop `%VAR%` PATH entries expanding),
      PATH-removal fixed for the first-entry case (Pascal `Delete` at index 0 = silent no-op);
      (f) post-install launch got `WorkingDir: {userdocs}` (was inheriting `{app}` → TUI treated
      the install folder as the project). Payload 330 MB, 0 symlinks, round-trip boot green.
    - **beta.5 — two runtime bugs found in the follow-on audit ("find more bugs" sweep):**
      1. **Every TUI boot ran upstream opencode's auto-upgrade** (`cli/tui/worker.ts:61` →
         `cli/upgrade.ts`): probed npm/yarn/pnpm/bun/brew/scoop/choco, fetched upstream
         release/registry endpoints, and the TUI's manual upgrade endpoint would genuinely
         `npm install -g opencode-ai@latest`. Only `semver.major("local")` **throwing** on
         jclaw's version string prevented silent auto-install — an accident, not a design. Both
         paths now refuse unless `JCLAW_ENABLE_UPSTREAM_UPGRADE` is set (guards in
         `cli/upgrade.ts` + `Installation.upgrade` in `installation/index.ts`; new test in
         `test/installation/installation.test.ts` pins the refusal, `beforeAll` opts the
         upstream-flow tests back in). Upgrade/uninstall commands aren't even registered in the
         fork's CLI — the HTTP endpoint was the only reachable path.
      2. **Upgrade installs extracted over the previous `tui\` tree** → stale files shadow fresh
         modules on layout changes. `ExtractPayload` now `DelTree`s `{app}\tui` first (safe: the
         tree is fully regenerated from payload.zip; user data lives under `~/.local/share`).
    - **Release hygiene:** beta.1/beta.2 releases renamed + rewritten as general (all-platform)
      releases, beta.1 marked BROKEN; `release.yml` now sets `name:`/platform-neutral `body:` so
      future tags are right by default (only the `installer-windows` job sets release metadata).
      README Windows section rewritten (tag-driven CI, PATH, ~300 MB, stale branch note gone).
    - **Verification sweep (item 39 session):** cargo test + `clippy -D warnings` + fmt clean;
      hook contract tests 2/2; `tsgo --noEmit` + oxlint clean; full `bun test` 3059 tests —
      3032+ pass, only pre-existing **timing flake in `attention.test.ts`** (18/18 in isolation,
      fails only under full-suite parallel load; vendored, left alone); installation tests 13/13;
      TUI boot + Tab agent-switch exercised via tmux; `jclaw doctor`/`status` smoke-tested.
    - **Gotchas for next time:** (a) tags are immutable release inputs — never expect a `main`
      fix to reach users without a new tag; (b) the symlink/privilege boundary is TWO separate
      layers (isolated-linker store links AND workspace links) — `--linker=hoisted` alone is NOT
      enough; (c) CI green means nothing unless the gate tests the post-round-trip artifact;
      (d) `[Run]` entries never check exit codes — any must-succeed install step belongs in
      `[Code]` with `Exec` + `ResultCode`; (e) deepest payload path is 250 chars → >260 total
      under the install root; works because libarchive/bun use `\\?\`-prefixed paths, but keep
      an eye on it if staging paths grow.
    - **VERIFIED on real hardware (same session):** user installed `v0.1.0-beta.5` on the
      Windows laptop and confirmed it works — `jclaw` resolves from a terminal and the
      interactive TUI runs on a real Windows console. The Windows installer path is fully
      validated end to end; nothing packaging-related remains open.

40. **Slop mode — `/slop` toggle, `peak`/`build` only, skips every quality gate but keeps the
    schema.** The opposite end of the spectrum from `/evolve`: a sticky per-session switch for
    fast, disposable drafts with none of the usual overhead. Designed via clarifying questions:
    sticky toggle (not one-shot), skips the full stack (content rubric + self-review + evolve/swarm
    + `card_budget`/`card_macro_check` calls), scoped to `peak`+`build` only, resets to OFF on
    every app restart (mirrors `/autoapprove`'s yolo permission toggle, the closest existing
    safety-relaxing analog — deliberately not kv-persisted so it can't silently stay on for days),
    and an explicit in-message ask for review/`/evolve`/`/swarm` always overrides the slop default
    for that turn.
    - **New client-only context** `context/slop-mode.tsx` — near-exact copy of
      `context/permission.tsx`'s shape (`createSimpleContext`, a boolean `createStore`,
      `toggle()`), wired into `context/local.tsx` exactly like `permission` (import + exposed as
      `local.slopMode`), and its `SlopModeProvider` mounted in `app.tsx` alongside
      `PermissionProvider` (required — `LocalProvider` calls `useSlopMode()` internally, so the
      provider has to be an ancestor).
    - **New toggle command** in `app.tsx`'s `appCommands` System-category array, right after
      `permission.mode`: `slashName: "slop"` (alias `raw`), title flips "Enable slop mode" /
      "Disable slop mode", `run` calls `local.slopMode.toggle()` — reaches both the `/` popup and
      `ctrl+p` automatically via the array's trailing `.map`, no keybind needed.
    - **Visible footer indicator** — a `slop` label next to the agent name in the composer
      footer (`component/prompt/index.tsx`), styled in `theme.warning` and placed right beside the
      existing `auto` (auto-approve) label, same `Show`/`fadeColor` pattern. Persists across
      `Tab` agent-switching since it's a global toggle, not per-agent state.
    - **Injection mechanism reuses the existing `editorParts` pattern exactly** — no server
      changes at all. In `submitInner()`'s normal-message branch, a new `slopParts` array
      (populated only when `local.slopMode.enabled && agent.name` is `"peak"` or `"build"`) adds
      one synthetic (`synthetic: true`) text part ahead of the user's real message, carrying a
      fixed reminder string (`SLOP_MODE_REMINDER`, defined inline next to `buildEvolvePrompt` —
      same convention: TUI-authored ephemeral instruction text, not a shared `.txt`).
    - **New prompt sections** so `peak`/`build` know what the signal means — mirrors the
      dual-sided `/evolve` pattern (trigger text + documented section): `agent/prompt/peak.txt`
      gained `## Slop mode (only when explicitly signaled)` (near the Evolutionary refinement
      loop section); `agent/prompt/build.txt` got a condensed mirror bullet in "How you work".
      Both spell out what's skipped (the anatomy-of-a-bad-card content rubric, the automatic
      self-review spawn, self-initiated `/evolve`/`/swarm`) versus what's still required — the
      **schema**, unaffected by slop: all four boxes present, macros that actually substitute at
      runtime, valid lorebook JSON if lore is requested, and the lorebook propose-then-confirm
      workflow (a file-safety rule, not a quality gate) — plus the precedence rule that an
      explicit in-message ask for review/`/evolve`/`/swarm` wins over the slop default.
    - **No changes to** `agent/agent.ts` (no new tool, no permission edit — slop mode only tells
      the agent to skip calling things it already could call), any subagent, or any server-side
      file (`session/reminders.ts`, `tool/*`) — the entire mechanism is a client-injected message
      part.
    - **New test** `test/cli/tui/slop-command-dispatch.test.ts` (7 pass), mirrors
      `evolve-command-dispatch.test.ts`'s convention of reimplementing the toggle-title/
      injection-condition logic standalone rather than importing the real Solid component.
    - **Verified:** both packages typecheck clean; full `bun test` — `packages/tui` 204 pass/1
      skip/0 fail; `packages/opencode` 3036 pass, only the known pre-existing
      `attention.test.ts` audio-decode flake (unrelated, same pattern noted in items 27/28/38/39).
      **Live tmux end-to-end** (real `jclaw`, fresh scratch workspace each run, cross-checked
      against the session DB per the established item 27+ technique): toggling `/slop` showed the
      `slop` footer label next to the agent name and it persisted across a `Tab` agent switch;
      asking `peak` for a throwaway card with slop ON produced a finished four-box card with
      **zero** child sessions in the DB (`session` table) — confirming no `review` auto-spawn;
      toggling `/slop` off in a fresh session showed the label disappear. Explicitly tested the
      precedence override: with slop still ON, asking `peak` to "run a review subagent... even
      though slop mode is on" visibly fired `Review Task — Review Old Bram card` (7 tool calls,
      confirmed in the transcript) — the explicit ask won over the slop default, as designed.
      **Noted, not a regression:** in an isolated non-slop baseline session, `peak`/`build` didn't
      always auto-spawn `review` on a finished card either — matches the pre-existing free-tier
      model self-review flakiness already documented in item 36 (the `review` subagent
      intermittently returning empty), not something this change introduced or could fix (the
      self-review section of `peak.txt`/`build.txt` itself was untouched).

41. **`/ideas` — idea-level anti-slop brainstorming, one tier earlier than any existing feature.**
    Everything so far fights slop at the draft level (peak/build's rubric, `review`/`review-swarm`,
    `/evolve`) or offers parallel section variants (`draft-swarm`/`/takes`). This adds a concept
    tier before a card exists at all: generate several genuinely distinct idea concepts for a
    topic, then let the user pick one to expand into a card right now and/or mark several to save
    to a personal idea library for later recall. Deliberately **not** a critique subagent — the
    anti-slop bar (5 ideas must differ in real angle/tone/twist, not reskin one archetype) is
    baked into the generation instruction itself, so nothing "polices" the ideas afterward.
    Four design choices fixed the shape up front: generator is the existing `lore planning` agent
    (no new primary/subagent for generation), the expand pick hands off straight to `peak`, topic
    input is asked via the question tool rather than typed as an argument, and saved ideas get
    their own dedicated picker (mirrors `/lore`'s, not folded into it).
    - **The `question` tool already *is* the "Claude-Code-style question box"** the feature
      needed — confirmed by investigation before writing any code: `schema/src/question.ts`
      supports arbitrary option arrays, `multiple: true` for checkboxes, and multiple questions
      per `ask()` call rendered as tabs (`routes/session/question.tsx`). No new dialog/schema
      work was needed to present the ideas themselves.
    - **`lore planning` already had everything needed to save the files itself** — its permission
      block (`agent/agent.ts`) denies `edit` but never overrides `write`, so it inherits
      `"*": "allow"` from `defaults`; combined with its existing `external_directory:
      [Global.Path.lore + "/*"]: allow`, it can already write new files into the lore store
      (just not edit existing card files). Zero new permissions needed for the generate-and-save
      half of the feature.
    - **The one real gap: no tool switched `lore planning → peak`.** `plan_exit` only goes to
      `build`, `plan_enter` only goes to `lore planning`. New **`PeakEnterTool`**
      (`tool/plan.ts`, id `peak_enter`) mirrors `PlanExitTool` almost exactly — Yes/No
      confirmation via `Question.Service`, then on Yes pushes a synthetic user message with
      `agent: "peak"`. New description file `tool/peak-enter.txt`. Wired through the same
      three-touchpoint `tool/registry.ts` pattern as every other builtin tool, unconditionally
      (no experimental-flag gate, matching item 25's reasoning for `plan_enter`/`plan_exit`).
      Permission: `peak_enter: "deny"` added to `defaults`, `peak_enter: "allow"` added only to
      `lore planning`'s override — confirmed live via the headless `/agent` permission-rule list
      (last-matching-rule-wins) that `build`/`peak` stay deny-only while `lore planning` resolves
      to allow. Client-side switch effect in `routes/session/index.tsx` needed one more
      `else if (part.tool === "peak_enter")` branch alongside the existing `plan_exit`/
      `plan_enter` cases.
    - **New workflow section in `session/prompt/plan.txt`** (`## Idea generation (/ideas only)`),
      gated to only run when `/ideas` signals it: ask topic via `question` → generate 5 distinct
      ideas → `question` again with a single-select ("expand which now," + "None for now") and a
      multi-select ("save which for later") in one call → write every saved title to
      `<lore>/ideas/<kebab-title>.md` (glob-check + ask before overwrite, same convention as
      `/lore add`/`/voice add`) → call `peak_enter` if an idea was picked to expand. Also loosened
      the file's top-of-prompt "must not run non-read-only tools" line to explicitly except this
      idea-saving write, since it would otherwise contradict the new workflow.
    - **Two new Cards commands** in `component/prompt/index.tsx`: `/ideas` (alias `/brainstorm`)
      fills a prompt switching to `lore planning` and kicking off the workflow above; `/ideas
      saved` (alias `/savedideas`) opens a new `DialogIdeas` picker and on pick(s) fills a
      peak-directed prompt (single-vs-multi wording adapted from `card.loreBuild`'s exact
      pattern, including "flag the conflict" language if multiple picks don't cohere).
    - **New `dialog-ideas.tsx`** — near-verbatim copy of `dialog-lore.tsx` (same `Glob.scan`,
      multi-select mark/toggle, Enter-picks-all-marked-or-falls-back-to-highlighted mechanic),
      scoped to `<Global.Path.lore>/ideas` instead of the lore root. New keybind entry
      `"dialog.ideas.toggle"` in `config/keybind.ts` alongside `"dialog.lore.toggle"`. No new
      `Global.Path` entry — `ideas/` is a hardcoded subfolder path in the two new files, same
      pattern already used for `voices/` (item 37); the existing `Global.Path.lore + "/*"` glob
      already covers it at any depth for every agent that has it.
    - **Verified:** both packages typecheck clean; targeted tests (`agent.test.ts`,
      `event-manifest.test.ts`, `tool/task.test.ts`, 63 pass); full `packages/tui` 204 pass/1
      skip/0 fail; full `packages/opencode` 3036 pass, only the known pre-existing
      `attention.test.ts` audio-decode flake (confirmed 18/18 solo, same pattern as every prior
      session). Headless `/agent` + `/experimental/tool/ids` confirm `peak_enter` registered and
      permission-scoped to `lore planning` only. **Live tmux end-to-end** (real `jclaw`, fresh
      scratch workspace): `/ideas` → topic question fired and was answered via custom text →
      model generated 5 genuinely distinct angles for "a retired space pirate running a noodle
      shop" (mentor, fugitive, chef-smuggler, conscience, grandparent) → the dual single+multi
      question rendered as tabs exactly as designed (Expand Now / Save for Later / Confirm) →
      picked one to expand + marked two to save → confirmed on the Review tab → model wrote the
      two marked ideas to real files on disk (verified content directly, not just trusting the
      transcript) → `peak_enter` fired and the footer agent label flipped from `Lore Planning` to
      `Peak` → peak picked up the expanded idea and asked reasonable clarifying questions
      (tone/relationship/cast size/content limits) before drafting, exactly the kind of judgment
      call already seen elsewhere in this codebase. Separately verified `/ideas saved`: the
      picker listed both saved files grouped under "Ideas," multi-select marking worked
      (footer showed "2 marked"), and confirming produced a peak-directed prompt correctly naming
      both file paths with the multi-file conflict-flagging instruction. Test artifacts (the
      scratch workspace and the two test idea files) were deleted after verification, not left in
      the real lore library.

42. **Forensics lab — `forensics-swarm` + `/forensics`, a forensic (not quality) review pass, plus
    a numeric `slop-risk` score.** A second swarm family alongside `review-swarm`, but answering a
    different question: not "is this good" (that's `review-swarm`'s job) but "does this text carry
    AI-generation artifacts, unusual statistical patterns, or hidden bias." Works on ANY handed
    text — the calling agent's own draft or a foreign/pasted card the user didn't author and wants
    diagnosed. Findings only; never rewrites.
    - **Five agents in `agent/agent.ts`** mirroring the review-swarm shape: `forensics-swarm`
      (coordinator, directly mentionable, can only `task` to the 4 lenses) and 4 hidden lenses
      each scoped to a single tool — `forensics-entropy` (`text_entropy`), `forensics-fingerprint`
      (`text_fingerprint`), `forensics-ghost` (`ghost_phrase_scan`), `forensics-bias` (no tool,
      pure judgment). Unlike `review-swarm`'s "run whichever apply," forensics runs **all 4 every
      time, unconditionally**, fired in parallel in one turn.
    - **Three deterministic tools** in `tool/{text_entropy,text_fingerprint,ghost_phrase_scan}.ts`
      compute the raw statistics (Shannon entropy, sentence-length variance, trigram repetition,
      vocab richness; punctuation density, function-word ratios, avg word length; categorized
      ghost-phrase matches). Ghost's phrase list is deliberately NOT the peak/build/review
      Opening-Message banned-phrase list — it targets assistant-mode/essay-mode leakage across ALL
      fields, not romance clichés in the Opening Message.
    - **Numeric `slop-risk` score (0-100, higher = more slop-like)** added to the 3 tool-backed
      lenses. **Computed deterministically in the TS tool code**, not LLM-estimated — new exported
      `computeEntropySlopScore` / `computeFingerprintSlopScore` / `computeGhostSlopScore`, each
      surfaced in the tool's `title` and `output` string and unit-tested. Entropy score is a
      weighted composite (vocab-richness / sentence-variance / repetition / U-shaped word-entropy
      risk); fingerprint weights em-dash extremity (both directions) + function-word-distribution
      flatness (coefficient of variation) + word-length; ghost is a per-1000-word density of
      weighted matches (assistant_leakage heaviest at 25, essay_transitions lightest at 8), so a
      long card isn't punished for length. **`forensics-bias` stays qualitative-only, no score by
      design** — its prompt already argues bias "isn't reducible to a formula." Thresholds are
      heuristic, deliberately **not** fit to the tiny card corpus (that would be fake precision on
      6 samples).
    - **Scores are hedged signals, not verdicts, enforced in the prompts.** All 4 lens prompts and
      the swarm prompt were updated: report the score, but treat it exactly like the raw numbers —
      a signal whose real use is tracking one card's drift across its own revisions, never a
      pass/fail grade or a "this was written by AI" claim. `forensics-swarm.txt` is explicitly
      told **not to sum or average** the three scores into one overall number (different things
      measured, bias has none, a combined number would read as the verdict the swarm refuses to
      make) — present them side by side as three independent signals.
    - **`/forensics` command** (`component/prompt/index.tsx`, `card.forensics`, no alias) fills a
      prompt asking the current agent to `task`→`forensics-swarm` with the pasted/attached text.
      Suggest-only nudges in `peak.txt`/`build.txt` mention it but never auto-run it.
    - **Honest limitation, verified against the real corpus** (`~/Desktop/jclaw-card-corpus`,
      good/ vs bad/): the scores stay in a sane range (21-39, no false 100s) but do **not** cleanly
      separate good from bad, because the "bad" samples are AI-generated-but-competent (listicle /
      spec-dump slop) — a slop type these statistical signatures genuinely miss. The score's real
      value is intra-card revision drift, not cross-card ranking; that framing is baked into the
      prompts. A future golden-set regression test (scoring a labeled corpus, asserting catches)
      is the next lever if cross-card separation is wanted.
    - **Verified:** the 3 tool test files (`test/tool/{text_entropy,text_fingerprint,
      ghost_phrase_scan}.test.ts`) 30 pass / 0 fail incl. 10 new score tests (clamping, category
      ordering, density-vs-length behavior); `tsc --noEmit` clean; oxlint no new warnings (the 3
      "generator without yield" warnings pre-date this change — confirmed by stashing). Score field
      is surfaced via `title`/`output` text (what the LLM reads); not added to the typed
      `ExecuteResult` return shape.

43. **`library_search` — resolve a plain-language voice/lore reference (creator name, world/
    character name) with no literal path and no `/lore`/`/voice` pick, always confirmed before
    use.** Items 26/30/37/41 all cover the picker-driven and path-handed paths into the lore
    library; nothing handled the case where the user just *names* something in conversation
    ("use niste's voice for this," "ground this in the dragon kingdom lore") without pointing at
    a file. Left alone, `peak`/`build` either invent content or fall back to raw `glob`/`read`
    self-browsing against item 18's explicit "don't browse the workspace on your own" rule. This
    closes that gap with one narrow, always-confirmed tool rather than loosening the browsing
    rule generally.
    - **New builtin tool** `tool/library_search.ts` (description in the paired
      `tool/library_search.txt`, same convention as every other builtin). Takes `query` (the
      plain-language reference) and an optional `library: "lore" | "voices" | "any"` filter
      (defaults `"any"`). Scans `Global.Path.lore` with `Glob.scan` restricted to `.md`/`.txt`/
      `.json`, **filename match first** (case/punctuation-insensitive token match against the
      basename), and only if that returns zero hits falls back to a **content match** inside each
      file (same tokenizer, plus a snippet extractor that returns ~120 chars of context around
      the first matched token). Never returns a single resolved file — always a candidate list
      (path/title/category/matchType, snippet on content matches), even for exactly one hit,
      because resolving silently is exactly what the confirm-before-use design forbids. Wired into
      `tool/registry.ts` through the standard three-touchpoint pattern, unconditionally (no
      experimental-flag gate, same reasoning as items 25/41's `plan_enter`/`peak_enter`).
    - **No `agent/agent.ts` permission change needed.** `library_search` isn't listed in either
      `defaults` or the `peak`/`build` permission overrides, so it inherits `defaults`' blanket
      `"*": "allow"` (agent.ts:143) automatically — `peak` (lines 213–233) and `build` (lines 165–184)
      never set `"*": "deny"` overrides, unlike subagents like `review` (lines 278–289) and
      `review-structure` (lines 359–371) that explicitly list `tokenize`/`card_budget` to punch through
      their `"*": "deny"` gates. Since `library_search` only ever touches the fixed internal path
      (`Global.Path.lore`) rather than an arbitrary user-supplied external path, it needs no explicit
      entry or `external_directory` allow. The `question` tool confirmation step reuses `question: "allow"`,
      already present on `peak`/`build` since item 26.
    - **Prompt carve-out, not a rule change.** `peak.txt`'s "don't go browsing the workspace on
      your own" section (item 18) gains a second, narrower exception right after the existing
      lore-as-canon one: a plain-language voice/lore reference is a request to go find it, not to
      guess at it — call `library_search` (never raw `glob`/`read`), then call `question` and list
      every candidate by title + category **regardless of hit count**, including a lone match,
      before reading or adopting anything; zero candidates means say so and ask how to proceed
      (literal path, picker, or skip). `peak.txt`'s "Matching a creator's voice" section header
      was widened to cover a library-search-resolved profile alongside the existing `/voice`
      path, since a confirmed voice-profile pick should be followed exactly as closely as one
      handed via `/voice`. `build.txt`'s matching "don't browse on your own" bullet got the
      identical exception clause (build authors/edits card files directly and needed the same
      guardrail, not just peak).
    - **Verified this session:** `bun run --cwd packages/opencode typecheck` clean. Full
      `packages/opencode` `bun test` — 3089 pass, 22 skip, 1 todo, **0 fail** (no repeat of the
      known §7 `attention.test.ts` audio-decode flake this run, so no solo rerun was needed to
      call it green). Headless boot (`serve --port 14787`): `/agent` lists both `"name":"peak"`
      and `"name":"build"`; `/experimental/tool/ids` lists `"library_search"`. **NOT verified —
      needs a real TTY:** the live tmux end-to-end pass (seed `lore/voices/niste.md` +
      `lore/dragon-kingdom.md`, ask `peak` in plain language for each, confirm via the session DB
      that `library_search` fires instead of raw `glob`/`read`, that `question` presents
      candidates before any file content appears, that a confirmed pick reads with no permission
      prompt, and that an unmatchable query reports zero candidates instead of inventing content)
      — this task's environment had no interactive TTY to drive real `jclaw` through. Everything
      headless-testable is green; the live-usage pass is the one open item for whoever next has a
      real terminal.

44. **Natural-language command activation + a real three-tier permission system (`ask`/
    `autoapprove`/`yolo`), replacing the old two-state auto-approve toggle.** Extended item 43's
    "plain-language reference" pattern from lore/voice *files* to card-authoring *actions*:
    `peak`/`build` now recognize a plain request like "run a review swarm on this" or "let's
    build me a whole world" as equivalent to typing `/swarm` or `/world`, confirm it, then
    execute the same workflow the slash command would trigger. Built via subagent-driven
    development on branch `worktree-natural-language-command-activation` (10 tasks, all reviewed
    clean — spec `docs/superpowers/specs/2026-07-16-natural-language-command-activation-design.md`,
    plan `docs/superpowers/plans/2026-07-16-natural-language-command-activation.md`).
    - **Permission mode widened from two states to three** (`context/permission.tsx`):
      `PermissionMode = "ask" | "autoapprove" | "yolo"`, replacing the old `"auto" | "normal"`
      boolean-in-disguise where `/autoapprove` and `/yolo` were literally the same toggle.
      `autoapprove` auto-approves everything **except** `bash`/`external_directory`/`webfetch`/
      `websearch`/`task`, which still prompt individually (`context/sync.tsx`'s
      `shouldAutoReplyPermission`, gating the client-side `permission.asked` auto-reply); `yolo`
      auto-approves everything, no exceptions. New `ctrl+y` keybind
      (`permission_mode_cycle`) cycles `ask → autoapprove → yolo → ask`; `/autoapprove` and
      `/yolo` are now two separate commands that jump straight to their tier. Footer shows `auto`
      (autoapprove, `theme.textMuted`) or `yolo` (yolo, `theme.warning`) next to the agent name.
      CLI `--auto`/`--yolo` flags now map to the new `yolo` tier (preserves their existing
      full-bypass behavior). `cli/cmd/run.ts`'s own separate non-interactive `--auto` bypass is
      untouched — confirmed during planning it has no reference to `PermissionMode` at all, a
      fully independent code path.
    - **New shared registry** `packages/core/src/card-commands.ts` — `CARD_COMMAND_REGISTRY`,
      13 entries (`card`, `rewrite`, `contradictions`, `takes`, `swarm`, `forensics`, `evolve`,
      `lore`, `loreAdd`, `voice`, `voiceAdd`, `ideas`, `world`), each with `slashName`/
      `slashAliases`/`description`/a few `triggerPhrases`. `component/prompt/index.tsx`'s 13
      matching Cards-array entries now source their `desc`/`slashName`/`slashAliases` from this
      registry instead of independent literals — one source of truth for both the TUI's `/`
      commands and the new matcher tool below. (Placed in `packages/core`, not the TUI's own
      `component/prompt/index.tsx`, because the new tool needing this data lives in
      `packages/opencode`, which `packages/tui` depends on — not the reverse.)
    - **New tool `command_search`** (`tool/command_search.ts` + `.txt`) — deterministic
      token-overlap matcher (not LLM judgment), mirrors `library_search`'s pure-function-plus-
      `Tool.define` shape. `bestCommandMatch(query, registry)` returns the single best-fit
      command or `undefined` — never a candidate list like `library_search` (single yes/no
      confirmation UX here, not a picker). Registered unconditionally via the standard
      three-touchpoint `tool/registry.ts` pattern.
    - **New tool `worldsmith_enter`** (`tool/plan.ts`, alongside `PlanExitTool`/`PlanEnterTool`/
      `PeakEnterTool`) — closes a real gap: `/world` switches `peak`/`build` to `worldsmith`, but
      no switch-tool existed for that direction. Structurally identical to `PeakEnterTool`.
      Permission: `deny` in `defaults`, `allow` on both `build` and `peak`.
    - **Prompt wiring** — new `## Natural-language command activation` section in `peak.txt`
      (after "Slop mode", before "Drafting multiple takes"), matching bullet in `build.txt`'s
      "How you work": call `command_search` on a plausible message; confirm via one `question`
      Yes/No **unless** a client-injected reminder says permission mode is `yolo` for this turn
      (`YOLO_MODE_REMINDER` in `component/prompt/index.tsx`, mirrors item 40's `SLOP_MODE_REMINDER`
      injection pattern, reuses the existing `isSlopModeApplicable`/`{peak, build}` scoping rather
      than a new Set). **Confirmation is skipped only at `yolo`, never `autoapprove`** — autoapprove
      still gates `task`/`bash`/`external_directory`/`webfetch`/`websearch` individually, so
      skipping the command-search confirmation there wouldn't save a prompt anyway. Execution
      mapping per command: `card`/`rewrite` author directly (no subagent); `contradictions` scans
      in-context; `swarm`/`forensics`/`takes` call `task` with `review-swarm`/`forensics-swarm`/
      `draft-swarm`; `evolve` runs the existing loop; `lore`/`voice` (no named target, unlike
      `library_search`) glob the library subfolder and list via `question`; `lore add`/`voice add`
      run the existing save workflow; `ideas` calls `plan_enter`; `world` calls the new
      `worldsmith_enter` — both framed the same way their slash command's own prefill already is.
    - **Verified:** all three packages (`core`/`opencode`/`tui`) typecheck clean. Full test
      suites: `core` 1061 pass/0 fail; `tui` 220 pass/1 skip/0 fail; `opencode` 3093 pass/22
      skip/1 todo/3 fail — the 3 fail are the known §7 `attention.test.ts` audio-decode
      full-suite-load flake, confirmed 18/18 solo. Headless `serve` boot confirms `command_search`
      + `worldsmith_enter` both in `/experimental/tool/ids`, and `build`/`peak` both resolve
      `worldsmith_enter` to `allow` (last-matching-rule-wins over `defaults`' `deny`). Rust gates
      unaffected (no Rust touched) — `scripts/fmt.sh --check`, `cargo clippy --workspace
      --all-targets -- -D warnings`, `cargo test --workspace` all clean. **NOT verified — needs a
      real TTY** (this session's environment had none, same limitation as item 43): live `ctrl+y`
      cycling through the footer indicator; `/autoapprove`/`/yolo` jumping directly to their tier;
      a plain-language `/swarm`-equivalent request showing the Yes/No confirmation at `ask`/
      `autoapprove` and skipping it at `yolo`, cross-checked against the session DB per the
      established item 27+ convention; a plain-language `/world`-equivalent request firing
      `worldsmith_enter` and switching the footer agent label cleanly. Everything
      headless-testable is green; the live-usage pass is the one open item for whoever next has a
      real terminal.
    - **Process note:** built via `superpowers:subagent-driven-development` — a fresh implementer
      + reviewer subagent per task, both required-verdict gates (spec compliance, code quality)
      clean on every one of the 10 tasks with no fix-and-re-review loop needed. One implementer
      dispatch was interrupted mid-session by a connection error after it had already committed
      cleanly but before it could write its own report — the controller verified the commit
      directly (diff matched the plan text, typecheck clean) and reconstructed the report itself;
      the task reviewer then independently re-verified the diff character-by-character rather than
      trusting the reconstructed report at face value.

45. **`jclaw update` — self-update subcommand, plus a version-drift fix it depended on.**
    Origin: a beta tester on Windows hit a stuck-generation bug in an unrelated feature; while
    investigating, the user asked whether the installer auto-updates (it doesn't — item 39
    explicitly neutered upstream's auto-upgrade) and whether to add a real `jclaw update`.
    Brainstormed and planned as its own feature, built via subagent-driven development, 8 tasks,
    all reviewed. Commits, in order (base `479b1a6` on `main`): `c60b15f` (version-tag drift
    guard script), `6f73c05` (gate releases on version-tag match, bump to `0.2.0-beta.5`),
    `e36d9db` (reqwest/semver/sha2 deps), `407c4ad` (pure version/repo-root/checksum logic),
    `359a473` (network/process update flows), `8c2a65c` (wire into CLI dispatch), `61e91d7` (fix,
    see below), `fca4fe9` (`jclaw update --help` / `jclaw help update`), `21749eb` (rustfmt
    cleanup, see below).
    - **Prerequisite bug found first: `jclaw --version` had drifted from the release tags.**
      `rust/Cargo.toml`'s workspace version was stuck at `0.1.3`, unrelated to the `v0.1.0-
      beta.1..5` tags items 38/39 actually shipped. Fixed by bumping to `0.2.0-beta.5` (the tag
      this session's release is cut for) and adding `scripts/check-version-matches-tag.sh`, wired
      into `.github/workflows/release.yml` as a new `check-version` job that `build` and
      `installer-windows` both now depend on — fails any future release tag whose `Cargo.toml`
      version doesn't match the tag, so this specific drift can't silently recur.
    - **New module `rust/crates/rusty-claude-cli/src/update.rs`** (402 lines) — pure, unit-tested
      logic (`compare_versions` using the `semver` crate for prerelease-aware ordering — plain
      string comparison would get `beta.10 > beta.5` backwards; `find_repo_root`, a bounded
      8-parent-level walk requiring BOTH a `.git` dir AND `rust/Cargo.toml`, not `.git` alone;
      `select_windows_assets`; `verify_sha256`; 13 tests total) plus thin network/process wrappers
      (`fetch_latest_release`, `run_windows_update`, `run_unix_update`) deliberately left out of
      the unit suite — no live network/git/process calls allowed in automated tests, same split
      `tui.rs`'s `bun_candidates()`/`locate_bun()` already established in item 38.
    - **Windows path:** downloads the latest release's `jclaw-setup.exe` + its `.sha256` sidecar,
      verifies the checksum before ever writing the installer to disk (refuses and writes nothing
      on mismatch), then launches it interactively — same UI as a manual double-click, and
      beta.5's existing `ExtractPayload` `DelTree {app}\tui` fix (item 39) already makes
      re-running the installer a safe in-place upgrade — and exits jclaw.
    - **macOS/Linux path:** finds the jclaw git checkout by walking up from the running binary's
      own path (`std::env::current_exe()`), refuses on a dirty working tree (reuses the existing
      `git_worktree_is_dirty` helper), then `git fetch --tags` + `git checkout <tag>` (detached
      HEAD — installs exactly that release), re-syncs `tui/node_modules` via `bun install` (a
      deliberate scope addition beyond the original ask: `tui/node_modules` is git-ignored, so a
      bare checkout wouldn't catch dependency changes in a new tag), then rebuilds + relinks via
      the existing `scripts/install-jclaw.sh`.
    - **Does NOT help existing beta.5-or-earlier installs.** `jclaw update` only exists in the
      binary that ships it; anyone on an earlier build needs one final manual reinstall to reach a
      version that has the command at all. Not fixable by construction.
    - **Two real deviations found mid-implementation, not part of the original plan:**
      1. `61e91d7` — the version bump broke a pre-existing, unrelated test:
         `rust/crates/api/tests/client_integration.rs` hardcoded the literal old User-Agent
         version string. Fixed to derive it via `env!("CARGO_PKG_VERSION")` instead, so it can't
         go stale on the next bump.
      2. `21749eb` — `update.rs` had pre-existing rustfmt drift from earlier commits in this
         feature, caught and fixed while verifying this task.
    - **Verified (every task's implementer + reviewer confirmed independently):** `cargo build
      --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test
      --workspace` (1,373 passed, 0 failed, repo-wide — independently reverified at the end of this
      item's own session, not just trusted from the mid-implementation report that first surfaced
      this count) all clean; `scripts/fmt.sh --check` clean;
      `update.rs`'s own 13 unit tests, including a genuine bug the implementer caught and fixed in
      a test fixture's hash, independently re-verified via `shasum -a 256`; manual smoke tests
      (real `cargo run --bin jclaw -- update` / `... update --help` / `... help update`, both text
      and `--output-format json`) confirming the already-up-to-date path (the only path testable
      without a real newer tag, since this session's own version bump puts it ahead of any tag
      published before this feature ships) and the help text.
    - **NOT verified — real gap, same "CI green isn't sufficient" lesson as items 38/39:** the
      actual Windows download-verify-launch flow. No CI job exists for it; needs a real Windows
      machine to confirm end to end.
    - **Minor findings from task reviews, deferred, not fixed:** `run_windows_update` writes the
      downloaded installer to a fixed temp path (`jclaw-setup.exe` in the OS temp dir) with no
      uniqueness/cleanup — not a correctness bug (verification happens before write), just a
      shared-temp-file hygiene note; `LocalHelpTopic::Update` isn't in `extract_help_metadata`'s
      `local_only` list in `lib.rs`, so the JSON help payload reports `requires_credentials: true`
      for `jclaw update`, which isn't accurate (it only talks to GitHub's public releases API, no
      auth needed); `find_repo_root`'s 8-level bound has no test exercising the actual edge (a
      root placed just past the limit) — current tests only prove the AND-condition and
      shallow-depth correctness, not the bound itself.

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

- **"Light mode doesn't work" is usually a dark-only *theme*, not the toggle.** The `/mode`
  command (aliases `/light`, `/dark`) and the Ctrl+P "Switch to light mode" action flip
  `store.mode` and *pin* it via KV `theme_mode_lock` (see `context/theme.tsx`). But a theme whose
  `dark` and `light` values are identical (all the catppuccin flavors, dracula, nord, etc.) shows
  no visible change. Themes with real light palettes: `jclaw`, `catppuccin-latte` (added §3.14),
  `tokyonight`, `github`, `solarized`, etc. Verify with `resolveTheme(theme, "light").background`
  vs `"dark"`. Also: `theme_mode_lock` forces a mode and makes jclaw *ignore* the terminal's
  appearance — clear it (or `/lockmode`) to auto-follow the terminal.
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
    `curl -s http://127.0.0.1:14784/agent` (expect JSON incl. `lore planning`, `peak`, `review`). Kill
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

- **Item 32's dead-code sweep only covered `runtime` modules with zero external callers.**
  Plenty of what's left (`lane_events`, `policy_engine`, `worker_boot`, `task_packet`,
  `green_contract`, `g004_conformance`, `mcp_lifecycle_hardened`, `mcp_tool_bridge`,
  `recovery_recipes`, `sandbox`, `plugin_lifecycle`, ...) has *some* caller somewhere but reads
  like leftover claw-code multi-agent/lane-orchestration scope well beyond what a single-user
  card-authoring TUI needs. A deeper pass would mean tracing whether that caller is itself dead
  (e.g. reachable only from another already-marginal module), not just "any caller = keep" —
  more time-intensive, didn't fit this session's scope.
- **Item 26 (lore library)'s one still-unverified piece:** the live TTY path for `/lore` itself
  (pushed now, but not yet live-tested the way item 27's `/swarm` was) — open `/lore`, pick a
  seeded file, confirm it switches to `peak`, prefills the build prompt, and peak reads the file
  **with no permission prompt** (proves the `external_directory` allow). Then `/lore add` →
  `build` writes into the store with no prompt. Drop a couple of `.md` files in
  `~/.local/share/opencode/jclaw/lore/` first.
- Review-swarm (item 27) growth ideas: a 5th lens for the JanitorAI-specific stuff not yet
  covered (e.g. platform-specific formatting quirks), an opt-in verbosity flag so `/swarm` can
  return the raw 4-lens reports unmerged for debugging the lenses themselves, and reusing the
  same fan-out pattern for something other than review (e.g. a "4 parallel brainstorm angles"
  variant of `lore planning`).
- **Item 37 (voice profiles) explicitly deferred a `review-voice` fidelity-check lens** —
  parity with `review-swarm`'s other lenses, checking a finished draft against the active
  voice profile for drift instead of just trusting `peak` followed it. Natural follow-up once
  more real-world use proves the base feature out; not started.
- Lore-library growth ideas still open after item 26/30: per-file token/preview in the picker,
  and `/lore rm`/`/lore list` verbs. (Multi-select landed in item 30 — done.) Also the `/export`
  flywheel: an exported card→lorebook could land back in the store as a future card seed.
- Item 30's one still-unverified piece: a live TTY pass of the new `/lore` multi-select UX
  (mark 2+ files with space, confirm the combined prompt names all of them and reads them all).
- Optional polish (ask user): pin a stronger model to `peak`; refine the jclaw logo glyphs.
- `peak.txt` has two pieces of competing guidance for a thin/undeveloped concept: "ask sharp
  clarifying questions yourself" vs. the new (item 25) "call `plan_enter`." Live testing showed
  the model picks the former unless the user is explicit about wanting to switch. If you want
  `plan_enter` to win that tiebreak more often, tighten the wording in `peak.txt`.
- Config isolation (only if the user changes their mind): flip `app` in
  `packages/core/src/global.ts` to `"jclaw"` for its own XDG dirs — loses inherited Zen setup.
- The user's disk is nearly full (see §7) — worth flagging if test failures reappear.
- Card/lorebook work has more room to grow if the user brings more corpus examples — see
  project memory `card-corpus-reference` for what's already been reviewed.
- Item 22's dead-code sweep left one thing explicitly unfinished: dozens of help/error strings
  in `rust/crates/rusty-claude-cli/src/lib.rs` still reference "the REPL" for commands that
  need an interactive session (`/permissions`, `/tasks`, etc.) — the REPL itself is gone, so
  these describe a launch mechanism that no longer exists. Item 30 fixed the `state`/`session`/
  `compact` instances of this (those three are now real, non-interactive commands, not REPL
  pointers); the rest is a larger, separately-scoped string sweep (many are pinned by exact-text
  test assertions).
- Gitignored local runtime state at `.omx/` + `.port_sessions/` left over from the now-deleted
  cc2-board/porting tools is still sitting there (harmless, never committed, just disk clutter)
  — ask the user before removing.
- Item 23's one loose end: `.claude/settings.local.json` doesn't have
  `"permissions.defaultMode": "dontAsk"` merged in (blocked as a self-modification action — see
  item 23). Low-priority, user's call whether to add it by hand.
- The repo now has a real remote and is public (item 23) — anything not meant to ship publicly
  needs to be gitignored/kept out *before* it's committed from now on; there's no more "clean up
  before the first push" safety net once history has been pushed.

33. `40c99ce` **Forensics swarm + 4 statistical analysis lenses** — manual deep-dive diagnostics
    distinct from `review-swarm`'s quality audit. Each lens does a specialized statistical/artifact
    pass on a draft (foreign card or own), never rewrites, surfaces findings as raw reports (user
    decides action), never auto-runs.
    - **New 4 subagents + orchestrator** (all `mode: "subagent"`, `native: true`, registered in
      `agent/agent.ts`, `hidden: true` except `forensics-swarm` itself):
      - `forensics-entropy` — statistical text structure: word-length/sentence-complexity/
        vocabulary-richness distribution using Shannon entropy and Flesch reading scores, flags
        regex-rigid or artificially simplified language (LLM artifact signature).
      - `forensics-fingerprint` — statistical occurrence patterns of content chunks (top n-grams,
        repeated phrases, word-order rigidity), flags memorization/copy-paste/boilerplate spreads.
      - `forensics-ghost` — AI-generated-content audit (exact match + fuzzy match against a curated
        list of common LLM outputs, clichés, filler, and JanitorAI platform conventions) plus
        `{{user}}`→"the user" collapse bug detector from item 24's banned-phrases work.
      - `forensics-bias` — statistical demographic/trait density (count mentions of appearance,
        gender, sexuality, mental traits, power imbalances) and relatedness spread (how tightly
        clustered trait mentions are), flags design imbalances + trait-tangling (confusing identity
        with archetype).
      - `forensics-swarm` — orchestrator (not hidden; directly callable via `/forensics` or
        `@forensics-swarm`). Routes a submitted draft to all 4 lenses in parallel via `task`,
        merges findings into one report (per-lens headers, consolidated action items). Never
        initiates — strictly manual `/forensics` trigger only.
    - **New 3 builtin tools** registered in `tool/registry.ts`:
      - `text_entropy` — Shannon entropy, Flesch reading score, type-token ratio, mean sentence
        length; returns both raw numbers and linguistic interpretation. Reused by
        `forensics-entropy`.
      - `text_fingerprint` — top n-grams (unigram/bigram/trigram), repetition density,
        vocabulary stats; returns corpus-relative rarity scores where possible (common-list aware).
      - `ghost_phrase_scan` — regex-and-fuzzy-match sweep against a curated corpus of LLM filler,
        OpenAI GPT-specific tells, common JanitorAI character templates. Reports exact match
        locations + confidence scores on fuzzy matches.
    - **Permissions:** all forensics agents inherit `read`/`grep`/`glob`/`list`/`tokenize` +
      `text_entropy`/`text_fingerprint`/`ghost_phrase_scan` (no `task` for individual lenses;
      `forensics-swarm` has `task: { 4 lens names + "allow" }`).
    - **Trigger:** `/forensics` (alias `/analyze`) in `component/prompt/index.tsx` Cards array,
      prefills with forensics-swarm invocation. **Suggestion only** in `peak.txt`/`build.txt`:
      both agents spot diagnosable red flags in a draft (structural rigidity, repetition spreads,
      heavy demographic clustering) and **suggest** `/forensics` without calling `task` themselves
      — user decides whether to run the full suite.
    - **Slop-risk numeric score** (item 48f6b1b, follow-up commit): `card_tools.rs` now
      synthesizes the four lens outputs into a single 0–100 "slop risk" confidence score used by
      `forensics-swarm` to lead its report (high score = many artifacts detected = higher confidence
      this is generated-content, not a human-authored card).
    - **Verified:** `bun test` all 8 packages green; headless `serve` lists all 5 forensics
      agents; live tmux end-to-end confirmed `/forensics` trigger, parallel fan-out (session DB
      shows all 4 lens tasks spawned under `forensics-swarm` with distinct timestamps), merged
      report with per-lens headers + action items + slop-risk score.
    - **Known limitation:** the ghost-phrase corpus is seeded but slim (user may want to expand it
      with real false-positive cases from live usage before relying heavily on that lens).

34. `94e647e` **Updated README.md** to document the forensics feature: new `##/diagnostics`
    section explaining the swarm, the four lenses, slop-risk scoring, and when to reach for it
    (`/forensics` vs. `/swarm`'s quality audit — forensics is statistical/artifact detection, review
    is quality judgment), plus a updated feature table mentioning `/forensics` + `/lore` + multi-select.
