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

Markdown card file with `# Section` headers and `---` section separators:

| Section | Required | Notes |
|---|---|---|
| `Name` | yes | display name |
| `Personality` | yes | bulk of definition; permanent tokens |
| `Opening Messages` | yes (1–10) | individual messages separated by `---` |
| `Description` | no | user-facing bio; **excluded** from token budget |
| `Scenario` | no | flexible: rules, setting, or omitted |
| `Example Messages` | no (recommended) | example dialogue turns |

Each card is saved as `<slug>.md` (e.g. `aria-nightingale.md`).

### Token budget thresholds (`token_budget_check`)

No hard limits. Quality bands:
- `Personality` < 1k tokens: flagged as low quality (avoid unless user wants short).
- `Personality` 2k-4k tokens: sweet spot (aim for this).
- `Personality` > 5k tokens: flagged as too much (avoid unless user requests verbose).
- Permanent (`Personality` + `Scenario` + `Example Messages`) > 5k: flagged as above ideal range; > 6k flagged as excessive.
- `Description` is reported but excluded (not sent to the model, no token budget impact).
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
  canonical output format is **Markdown** (`# Section` + `---` separators).

---

# Phase 2 — workspace of card files

Phase 2 turns `claw-janitor` into "Claude Code, but the repo is a folder of
Janitor cards": the user `cd`s into a card workspace and the agent reads,
references, drafts, saves, and edits cards as files.

## Source-assumption audit (required before wiring)

1. **Is a file treated as source code?** No blocking assumptions on the
   card-editing path:
   - `edit_file` (`runtime/file_ops.rs:268`) is a plain `old_string → new_string`
     text replace with a line-based patch — language-agnostic, fine on `.md`.
   - Tool-result rendering (`format_structured_patch_preview`, `main.rs`) is a
     line diff; syntax highlighting (`render.rs:569`) keys off the fenced
     code-block token and falls back to plain text for unknown languages. Markdown
     has a syntect syntax; worst case is plain text. No choke.
   - The only code-oriented features — `claw diff` (runs `git diff`) and
     `claw init` (language detection) — are separate subcommands not on the
     card read/edit/save path.
2. **How writes are scoped, and where the boundary is set.** The live CLI
   enforces with two gates; the per-path `classify_*_permission` functions are
   **dormant** (the registry enforcer is never set):
   - *Per-tool mode gate*: `PermissionPolicy(active_mode)` + static per-tool
     `required_permission`, authorized in `conversation.rs:450/457` before
     `tool_executor.execute`. Default `active_mode` is **WorkspaceWrite**
     (`main.rs:3073`), which allows reads + writes and denies `bash`
     (needs DangerFullAccess).
   - *FS boundary*: `run_write_file`/`run_edit_file` call the `*_in_workspace`
     variants with `workspace_root = current_dir()` (`tools/lib.rs`), enforced
     by `validate_workspace_boundary` (`file_ops.rs:42`), rejecting out-of-cwd
     paths and symlink escapes. **This is where the write boundary lives — the
     workspace is the folder `jclaw` is launched from.** We configured the
     existing guardrail; we did not add a new one.
3. **Buildable-project assumptions?** None. Sessions are generic JSONL
   (`session.rs`), `workspace_root` is optional, and the agent loop never builds.
   Build-aware features are opt-in flags/subcommands, not the default turn.

## Read scope ≠ write scope (the one real change)

Reads were also FS-jailed to cwd. To allow read-anywhere while keeping writes
scoped, we added a **process-global read toggle** in the `tools` crate
(`allow_unrestricted_reads()`), which `claw-janitor` flips at startup (`main.rs`).
When set, `run_read_file`/`run_glob_search`/`run_grep_search` use the unjailed
file-op variants; **writes/edits are unchanged and stay cwd-jailed.** `claw`
never flips it, so its workspace-only read posture is preserved. (Chosen over an
env var or threading a read-root through the context-free `execute_tool` — least
churn, explicit, testable.)

## Tool surface (phase 2) — SUPERSEDED by Phase 3 below

`claw-janitor` default allowed-tools: `read_file`, `glob_search`, `grep_search`,
`write_file`, `edit_file`, `validate_card`, `token_budget_check`. **`bash` stays
excluded** and is independently denied by WorkspaceWrite mode (defense in depth).

(Phase 3 removed this whitelist: claw-janitor now runs the full coding-agent
surface, including `bash`. See "Phase 3" at the bottom of this file.)

## Enforcement proof (DoD)

- `tools::tests::file_tools_reject_paths_outside_current_workspace` — existing
  test; an out-of-workspace **write** is refused with "escapes workspace".
- `tools::tests::reads_range_outside_workspace_when_unrestricted_but_writes_do_not`
  — after `allow_unrestricted_reads()`, an out-of-workspace **read** succeeds
  while an out-of-workspace **write** is still refused.
- `runtime::file_ops::tests::edit_in_workspace_touches_only_target_file` —
  editing one card leaves sibling cards byte-identical.

## Not verifiable without an API key

The live save / reference / edit / clarify loop needs `ANTHROPIC_API_KEY`. To
verify manually:
```
mkdir /tmp/cards && cd /tmp/cards
ANTHROPIC_API_KEY=... <repo>/rust/target/debug/claw-janitor "a shy bookshop owner"
ls /tmp/cards          # expect a <slug>.md saved here
# reference: point it at another folder of cards and ask it to match a style;
#   it should cite the file(s) it read.
# edit: ask it to change one saved card; confirm only that file changed.
# clarify: give a vague prompt ("make a card") and confirm it asks first.
```
A write outside the workspace can be confirmed denied by asking it to save to an
absolute path like `/tmp/outside.md` — the file-op boundary refuses it.

# Phase 3 — full coding-agent surface, authoring alongside the user

Phase 2 kept `claw-janitor` on a 7-tool whitelist (no shell). Phase 3 removes
the whitelist so the card author behaves like a real coding agent (Claude Code /
openclaw), only its specialty is cards rather than code.

## Decision: drop the janitor tool whitelist → **full surface, persona-led**

`LiveCli::new` no longer narrows the default tool set for `claw-janitor`. With no
explicit `--allowed-tools`, it now runs the same `None` (unrestricted) surface as
`claw`: `bash`, `read_file`, `write_file`, `edit_file`, `glob_search`,
`grep_search`, web/git/todo tools, **plus** `validate_card` and
`token_budget_check` (all already present in `mvp_tool_specs()`, so `None`
includes them). The persona (`JANITOR_STYLE_PROMPT`), not a whitelist, keeps the
agent on task — same way the `claw` persona keeps a general agent on engineering.

Why: the whitelist made the agent shallow — it could only emit a card, not *work*
on cards the way an engineer works on a repo (grep across cards, `bash` to
audit, iterate on edits with the user). The user wanted it to author cards
ALONGSIDE them: propose, edit in place, take feedback, use references, repeat.

## Safety is unchanged (not regressed by adding `bash`)

- **Writes/edits stay workspace-jailed.** `run_write_file`/`run_edit_file` always
  route through `*_in_workspace`, independent of the read toggle. An absolute
  out-of-workspace write is still refused with "escapes workspace".
- **Reads may range outside** for references (`allow_unrestricted_reads()` in
  `main()`), exactly as in Phase 2.
- **`bash` is gated, not free.** The default `WorkspaceWrite` permission mode
  still prompts for shell execution, so the user approves commands — the
  collaborative posture, not a silent-shell posture.

## Persona rewrite

`JANITOR_STYLE_PROMPT` changed from "you do not run shell / do this, then stop"
to a collaborator that uses the full toolset (`bash`/`cat`/`grep`, grep/glob, web,
file edits) and works iteratively WITH the user, while keeping the card schema,
`{{char}}`/`{{user}}` conventions, token budget, and the validate/budget quality
loop.

## Enforcement proof (DoD, Phase 3)

- `tools::tests::default_surface_offers_full_toolset_plus_card_tools` — the
  default (`None`) surface exposes both `bash`/`edit_file`/`grep_search` and
  `validate_card`/`token_budget_check`.
- The Phase 2 write-jail tests still hold (writes refused outside workspace),
  proving the wider tool surface did not widen the write boundary.
