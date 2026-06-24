# Jclaw — Phase 1 Decisions

## Pinned base commit

- Upstream: [`ultraworkers/claw-code`](https://github.com/ultraworkers/claw-code)
- **Pinned SHA: `d229a9b022d4845d28a728677e6a6b7c22ec5a2e`** (branch `main`, dated 2026-06-08)
- License: MIT. The upstream `LICENSE` and copyright (`Copyright (c) 2026
  UltraWorkers and Claw Code contributors`) are preserved unchanged; a
  derivative notice was added to `README.md`.

We do not float on a moving `main`; the tree was vendored at this exact SHA.

## Decision: A (external dependency) vs B (copy/vendor source) → **B**

We vendored claw-code's source into this repository (a pinned fork). Evidence:

1. **Not consumable as a published dependency.** The workspace sets
   `publish = false` (inherited by every crate via `publish.workspace = true`),
   so nothing is on crates.io. Option A via crates.io is impossible.
2. **Crates are not standalone external deps.** Every crate wires its siblings
   with `path = "../x"`; the graph is internal-only.
3. **The required changes are crate internals.** The tool set is hardcoded in
   `tools/src/lib.rs` (`mvp_tool_specs()` returns a fixed `Vec<ToolSpec>`;
   `execute_tool()` is a name-match), and the agent's identity is embedded in
   Rust at `runtime/src/prompt.rs` (`get_simple_intro_section`). Adding card
   tools and swapping the persona requires editing these — which an external
   dependency cannot do without forking anyway.

We vendored the **entire** tree (not just the needed crates) to keep claw-code's
full surface — agent loop, LLM client, session/config, terminal rendering,
container workflow, and the test/parity scaffolding — so the tool feels like the
real thing. The legacy top-level Python `src/` came along as dead weight and is
unused by the Rust workspace.

## How "drop the code tools" was implemented → **disabled via allowed-tools**

Per direction, the codebase tools (`bash`, `read_file`, `write_file`,
`edit_file`, `glob_search`, `grep_search`) are **not removed** from source. They
remain in `mvp_tool_specs()`/`execute_tool` and continue to work for the `claw`
binary. For `claw-janitor`, when the user has not pinned an explicit tool set,
the allowed-tools default is restricted to `{validate_card, token_budget_check}`
(`LiveCli::new` in `rusty-claude-cli/src/main.rs`), so only the card tools are
offered to the model. The codebase tools are disabled, not deleted.

## Surface audit (code-project assumptions)

Nothing in the runtime/session/container path hard-requires a code project or
git repo to boot or run the loop:

- `GitContext::detect` returns `Option` — absent repo just omits git context.
- `Session.workspace_root` is `Option`; defaults to cwd.
- The workspace jail / sandbox only engages when a `workspace_root` is set, and
  it guards the file tools we disable anyway.
- The only startup refusal is `interactive_only` (stdin not a TTY and no prompt
  piped) — a terminal requirement, not a code-project one.

The only real coupling is **test/parity scaffolding** (out of the runtime path):
`mock_parity_scenarios.json` asserts file-tool behaviors (read/write/grep), and
`crates/compat-harness` hunts ancestor dirs for upstream claw-code TypeScript
source to diff against. These still compile (so `cargo build --workspace` stays
green) but no longer describe `claw-janitor`'s behavior, so they are not treated
as gates for our binary. `claw init` (CLAUDE.md scaffolding) and the
`docker-compose` RAG service are code/workspace-oriented and simply unused by
`claw-janitor`.

## Janitor AI card schema — sources verified (not from memory)

Verified 2026-06-24 against:

- **Official:** Janitor AI help center — "The Basics: The Character Creation
  Page Overview"
  (`https://help.janitorai.com/en/article/the-basics-the-character-creation-page-overview-15xevon/`).
  Confirms required vs optional fields: required — Bot Image, Character Name,
  Personality, Initial Message, and ≥1 Tag (max 10); optional — Character Chat
  Name, Character Bio (user-facing, not sent to the model), Scenario. Personality
  recommended "under 2500 permanent tokens."
- **Community bot-creation tutorial:** `https://jaitutorial.uwu.ai/`. Confirms
  `{{char}}` (character chat name) and `{{user}}` (user persona name) macros —
  only those two are substituted, no spaces inside braces; example-dialogue
  format uses `{{char}}:` / `{{user}}:` turn lines; token budget — personality
  ideal 200–1500, hard max ~2000; stay under ~2k in the personality section.

### Schema targeted by `validate_card`

SillyTavern V2-style JSON object that Janitor imports/exports:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | display/chat name |
| `personality` | yes | bulk of definition; permanent tokens |
| `first_mes` | yes | opening message |
| `tags` | yes (1–10) | discovery tags |
| `description` | no | user-facing bio; **excluded** from token budget |
| `scenario` | no | setting/situation |
| `mes_example` | no (recommended) | example dialogue turns |

### Token budget thresholds (`token_budget_check`)

- `personality`: warn > 1500, flag > 2000 estimated tokens.
- permanent (`personality` + `scenario` + `mes_example`): flag > 2500.
- `description` is reported but excluded (not sent to the model).
- Estimate method: ~4 chars/token heuristic (phase 1; not a model tokenizer) —
  labeled as an estimate in the tool output.

## What runs (Definition of Done)

- `cargo build --workspace` succeeds.
- `claw-janitor` boots the same terminal session as `claw`, with the Janitor
  card-author persona and the two card tools as its default surface.
- `claw-janitor system-prompt` shows the Janitor output-style persona;
  `claw system-prompt` still shows the software-engineering persona.
- With a valid `ANTHROPIC_API_KEY`, `claw-janitor "<request>"` runs the
  draft → self-critique → revise → validate loop (driven by the system prompt)
  and emits one schema-valid card.

## Notable implementation choices

- **One source, two binaries.** `claw-janitor` is a second `[[bin]]` pointing at
  the same `rusty-claude-cli/src/main.rs`; behavior switches on the executable
  name (`janitor_mode()`). This reuses the entire real TUI with minimal churn.
  Cargo emits a benign "present in multiple build targets" warning for this.
- **Persona via output style.** The Janitor prompt is injected through the
  existing `SystemPromptBuilder::with_output_style` extension point rather than
  editing the shared hardcoded intro string.
- **Loop is agent-driven** (system-prompt instructed self-critique), and the
  canonical output format is **JSON (SillyTavern V2-style)**.
