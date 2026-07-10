# jclaw

jclaw is a terminal workshop for writing **JanitorAI character cards and
lorebooks**, built the way a coding agent works on code. It's a Rust CLI
(`jclaw`) that launches a full-screen TUI (vendored from
[opencode](https://github.com/anomalyco/opencode), rebranded) with a set of
purpose-built agents that draft, rewrite, critique, and organize cards
alongside you.

This document covers every user-facing feature: what it does, how to invoke
it, and how it works under the hood.

---

## 0. Why jclaw over a good system prompt

You can get most of the way to "know the schema, avoid clichés, use
`{{user}}`/`{{char}}` macros correctly" by pasting an advanced system prompt
into any chat. That gets you a better single response. It doesn't get you
the rest of what actually makes card-writing reliable over many characters
and many sessions:

- **Schema knowledge that isn't a training-data guess.** Without a prompt
  that spells out the current card/lorebook shape, a model falls back on
  whatever it absorbed in training — which drifts stale as JanitorAI's
  format, macros, and lorebook JSON evolve, and it has no way to know it's
  wrong. jclaw's agents carry the schema explicitly in-prompt, plus a
  reference lorebook example (`agent/prompt/reference/lorebook-example.json`)
  checked against real, currently-working JanitorAI exports — not recalled
  from memory. The rubric itself is cross-checked against multiple sources,
  not one person's read of the platform: the user's own reviewed card/
  lorebook corpus plus four external botmaking guides (NicholasCS's,
  absolutetrash's, `rentry.org/botcreationguide`, `rentry.org/letsmakeabot`),
  reconciled point-by-point rather than merged blindly — points where guides
  disagreed with each other or with the existing rubric were resolved
  explicitly, not averaged. Every rule that landed was then live-tested
  against real `jclaw` runs with deliberately flawed disposable test cards,
  cross-checked against the session database rather than trusting the chat
  transcript — one rule that looked fine on paper turned out not to fire at
  all until it was rewritten with an explicit mechanical trigger, which is
  exactly the kind of gap a prompt alone won't catch itself.
- **Separation of authoring and critique.** `review` and `review-swarm` run
  as genuinely separate subagent calls, not the same conversation asking
  itself "is this good?" A model grading its own in-context output tends to
  rubber-stamp it; a critic that only ever sees the finished draft, with a
  narrower rubric, catches more.
- **Specialist lenses fanned out in parallel, chosen per draft.** `/swarm`
  runs whichever of four critics actually apply to what you handed it —
  prose/AI-tells and structure/token economics by default, lore/cascade
  consistency and macro correctness only when there's actually something to
  cross-reference or a macro to check — concurrently, then merges the
  findings and states up front which lenses ran or were skipped and why. One
  model juggling every rubric at once, including ones that don't apply, tends
  to under-weight the ones that do.
- **Persistent state across sessions.** A system prompt lives inside one
  chat. jclaw's lore library (`~/.local/share/opencode/jclaw/lore/`) is real
  files on disk: worldbuilding survives after the chat ends and feeds future
  cards, instead of being re-explained or lost when the context resets.
- **Tool-backed numbers, not eyeballed ones.** `peak`/`build` call a real BPE
  tokenizer (`tokenize`) to check token budgets against actual counts, not a
  model's guess at "this feels long."
- **Workflow enforced by structure, not by instructions the model has to
  remember.** Brainstorming (`lore planning`), world-authoring
  (`worldsmith`), card-writing (`peak`/`build`), and review are separate
  agents with separate permissions and separate prompts. Routing between
  them is code (`plan_enter`, `task` calls), not a rule buried in a prompt
  that has to survive a long conversation — and long conversations are
  exactly where instruction-following degrades most.
- **Real files in, real files out.** Cards and lorebooks are read, written,
  and exported as actual files (`/lore`, `/lore add`, `/export`), not
  copy-pasted in and out of a chat window.
- **Asks what you want instead of assuming.** A static prompt bakes in one
  fixed idea of what a "good" card is — a mandatory tone, a required
  psychological-depth structure, a fixed dialogue-register spread — and
  applies it to every card whether or not that's what you asked for, because
  it can't ask first. `lore planning` exists to have that conversation before
  `peak`/`build` commit to writing: what tone, how deep, how serious. The
  quality bar (avoid genericness, avoid AI tells) is separate from any one
  template of what depth or tone a card should have.

None of this replaces a good prompt — jclaw's agents *are* advanced system
prompts (§4). The difference is everything built around them: separate
critic contexts, persistent storage, tool-verified numbers, and a workflow
that's structural rather than something the model has to keep remembering
to do.

---

## 1. Install & run

```sh
scripts/install-jclaw.sh
```

Builds `rust/target/release/jclaw` and installs a launcher script to
`~/.local/bin/jclaw` (override with `$JCLAW_BINDIR`). The launcher clears
provider/model environment variables (`ANTHROPIC_MODEL`, `CLAW_MODEL`, API
keys) before exec'ing the release binary, so jclaw always uses its own saved
config instead of whatever your shell happens to have set.

**Run it**, from any project directory:

```sh
jclaw
```

This launches the full-screen TUI. Because the binary execs the vendored
TypeScript front end through Bun rather than embedding it, **edits under
`tui/` take effect on your next `jclaw` run with no rebuild** — only rerun
`install-jclaw.sh` if the Rust launcher itself changes.

**Dev alternative** (needs a real TTY):

```sh
cd rust && cargo run --bin claw -- tui
```

**Prerequisites:** a Rust toolchain, Bun (`~/.bun/bin/bun`), and `bun install`
run once inside `tui/` to materialize vendored dependencies.

### Windows (beta)

A one-click Windows installer is built by CI on the `windows-one-click-installer`
branch (not yet merged to `main`). End users need **no terminal and no
toolchain**:

1. Download `jclaw-setup.exe` from the repo's Releases page (e.g. the
   `v0.1.0-beta.1` pre-release).
2. Double-click it. Windows SmartScreen may warn (the installer is unsigned) —
   **More info → Run anyway**.
3. It installs per-user to `%LOCALAPPDATA%\Programs\jclaw` (no admin), adds a
   Start Menu shortcut, and puts that folder on your user `PATH`. Launch
   **jclaw** from the Start Menu, or open a *new* terminal window and run
   `jclaw` directly (Windows Terminal recommended over the legacy console).

The installer bundles everything — the launcher, Bun, and the vendored front end
— and extracts it at install time, so nothing is downloaded on first run. It is
a ~313 MB download.

**How it's built:** the CI `installer-windows` job (in
`.github/workflows/release.yml`) does a full `bun install`, gates on a headless
boot check, tars the payload into one archive, and compiles
`installer/jclaw.iss` (Inno Setup) around it — the installer ships that single
archive and extracts it with Windows' built-in `tar`, which keeps the compile
fast. Pushing a `v*` tag builds and attaches `jclaw-setup.exe` to a pre-release
automatically. This is beta: the interactive TUI has passed a headless boot
check in CI but is still being validated on real Windows consoles.

**Building from source on Windows** (dev, no installer) works too — install Rust
+ Bun, `bun install` in `tui/`, then `cargo run --release --bin jclaw` from
`rust/`. Use the `windows-one-click-installer` branch: it carries the `locate_bun`
fix that lets `jclaw` find `bun.exe` on native Windows.

---

## 2. File structure

```
Jclaw/
├── rust/                     Rust workspace — the CLI/launcher and its runtime
│   ├── Cargo.toml            Workspace manifest (members = crates/*)
│   ├── crates/
│   │   ├── rusty-claude-cli/ The `jclaw`/`claw` binary: argument parsing, all
│   │   │                     non-TUI subcommands, the TUI launcher (`tui.rs`)
│   │   ├── runtime/          Core runtime: session persistence, permission
│   │   │                     evaluation, prompt assembly
│   │   ├── commands/         Slash-command definitions for the Rust CLI layer
│   │   ├── tools/            Rust-side tool implementations, incl.
│   │   │                     card_tools.rs (card/lorebook validation),
│   │   │                     lane_completion.rs
│   │   ├── api/               HTTP client layer for LLM providers (SSE
│   │   │                     streaming, prompt caching, per-provider clients)
│   │   ├── plugins/          Plugin/hook system for the Rust layer
│   │   ├── telemetry/        Telemetry/observability
│   │   └── mock-anthropic-service/  Mock Anthropic API server, for tests
│   └── scripts/               Rust-side helper scripts
│
├── tui/                       Vendored Bun/Solid/OpenTUI front end (opencode's,
│   │                          rebranded to jclaw) — this is what `jclaw` launches
│   ├── packages/
│   │   ├── opencode/          CLI entry (`src/index.ts`), agents
│   │   │                      (`src/agent/`), tools (`src/tool/`), session
│   │   │                      logic, config loaders — the "backend" half
│   │   ├── tui/                The terminal UI itself: routes, components,
│   │   │                      themes (`src/theme/assets/`), keybindings
│   │   │                      (`src/config/keybind.ts`), feature-plugins
│   │   │                      (sidebar, notifications, home screen)
│   │   ├── core/               Shared primitives: `Global.Path.*` (XDG dirs,
│   │   │                      lore library), config schema, OAuth pages
│   │   ├── server/             The embedded HTTP server
│   │   ├── sdk/, protocol/, schema/   Typed client/wire-format layers
│   │   ├── plugin/             Plugin API surface
│   │   ├── llm/                 Model/provider plumbing
│   │   └── ui/                  Shared web-UI components (used by a separate
│   │                            web surface, not the TUI)
│   │                            (not shipped/user-facing — dev history only)
│   └── patches/                 Patched-dependency overrides for `bun install`
│
├── scripts/
│   ├── install-jclaw.sh        Builds the release binary, installs the
│   │                            `jclaw` launcher to `~/.local/bin`
│   └── fmt.sh                   Repo-root Rust formatting gate
│
├── tests/
│   └── test_pre_push_hook_contract.py   Validates `.github/hooks/pre-push`
│
├── README.md                    This file
└── LICENSE                      MIT (upstream claw-code + opencode attribution)
```

Everything under `tui/` is what actually runs when you use jclaw day to day;
`rust/` is a thin, mostly-diagnostic launcher (see [§11](#11-how-it-works)
and [§12](#12-cli-reference-rust-non-tui-subcommands)) plus a handful of
legacy/support crates inherited from the original fork whose active use
outside the launcher wasn't independently verified for this doc.

---

## 3. Core concept: lore is the source, the card is the render

jclaw's whole design rests on one idea: a **card** is a compiled artifact, not
where a character should originate. You can go straight from a concept to a
card, but the intended flow for anything nontrivial is:

1. **Brainstorm / plan** the character or world (`lore planning`,
   `worldsmith`).
2. **Store** durable worldbuilding in your personal **lore library**
   (`~/.local/share/opencode/jclaw/lore/`) so it survives across sessions and
   across characters.
3. **Author** the actual JanitorAI card from that lore (`peak`, `build`).
4. **Review** the finished card before you ship it (`review`,
   `review-swarm`).

Separately, you can also build a **voice profile** (`/voice add`) from a
specific creator's sample cards — their box-formatting conventions,
macro/pronoun habits, and prose register, extracted once and saved to your
lore library — then hand it to `peak` (`/voice`) to author brand-new,
original content that closely matches that creator's style without copying
their actual phrasing.

A JanitorAI card has exactly four platform-fixed boxes — **Scenario**,
**Personality**, **Opening Messages** (up to 10 slots, only one loads per
chat), and **Example Dialogue** — plus, optionally, an attached **lorebook**
(SillyTavern/Chub "World Info" JSON: entries with keyword triggers, one lean
`constant: true` hub entry plus conditional entries that cascade). jclaw's
agents understand this schema natively and will propose (never silently
create) a lorebook when a card's permanent fields are bloating with
offloadable reference lore.

---

## 4. Agents

Switch agents with `/agents`, `ctrl+p`, or by letting a primary agent route
you there automatically (several jclaw tools let agents switch on your
behalf — see [Agent-initiated switching](#11-how-it-works) below).

### Primary agents (what you talk to directly)

| Agent | Purpose |
|---|---|
| **build** | The default, general-purpose agent. Manages your card library and everyday tasks, and routes deeper work to the right specialist (brainstorming → `lore planning`, full card authorship → `peak`). |
| **lore planning** | Collaborative brainstorming for a character or world concept. Read-only by design — it plans and asks sharp questions, it never edits files or writes a finished card. |
| **peak** | The primary card author. Turns a developed concept into a top-tier card, or rewrites an existing one to strip AI tells, clichés, and bloat. Runs a self-review pass before showing you a finished draft. |
| **worldsmith** | Authors a whole, internally cohesive world (geography, factions, history, characters, rules) from a premise and saves it to your lore library. Silent after saving — it won't auto-build a card unless asked. |

### Subagents (spawned by primary agents, not switched to directly — except `review-swarm`)

| Agent | Hidden from `@`-mentions | Purpose |
|---|---|---|
| **review** | no | Strict critic for a single card/lorebook draft. Reports concrete problems only — never rewrites or proposes fixes itself. Auto-spawned by `peak`/`build` before presenting a finished draft. |
| **review-swarm** | no | Deep audit: fans a draft out to whichever of its four specialist critics actually apply (skips ones with nothing to do, e.g. macro-checking a draft with no macros), in parallel, then merges their findings into one report — stating up front which lenses ran or were skipped and why. Trigger explicitly with `/swarm` or by asking for heavy scrutiny. |
| review-prose | yes | Swarm lens: prose quality, clichés, AI-tells. |
| review-lore | yes | Swarm lens: cross-box and cross-file lore/lorebook consistency. |
| review-macros | yes | Swarm lens: `{{user}}`/`{{char}}` macro correctness (catches the "collapsed to literal 'the user' text" bug). |
| review-structure | yes | Swarm lens: structural correctness and token economics (uses the `tokenize` tool). |
| **draft-swarm** | no | Generates several distinct creative takes on a single card section (not a whole card) in parallel, then presents them for you to pick or modify before moving on. Trigger with `/takes`. |
| section-draft | yes | draft-swarm's worker: writes one variant of one section, given a specific creative angle. |
| voice-profiler | yes | Extracts a specific creator's box-formatting conventions, macro/pronoun habits, and prose register from sample cards handed to it inline, and returns a reusable profile document — never quotes samples at length, never authors content. Spawned by `build` via `/voice add`. |
| **general** | no | General-purpose research/multi-step execution helper. |
| **explore** | no | Fast, read-only codebase/file explorer (file search, grep, architecture questions). |
| compaction / title / summary | yes | Internal housekeeping agents (context compaction, session titling/summarizing) — not user-facing. |

**Model selection:** `peak`, `lore planning`, and `worldsmith` are "preset"
agents that share `build`'s model slot — pick a model once on any of the four
and the rest follow. Free OpenCode Zen models (e.g. `deepseek-v4-flash-free`)
work out of the box; pin a stronger model to any agent by editing its entry
in `agent/agent.ts` if you want.

---

## 5. Slash commands

Type `/` in the composer, or open the command palette with `ctrl+p`.

### Card-authoring commands

| Command | Aliases | What it does |
|---|---|---|
| `/card` | `/newcard` | Prefills a scaffold-a-new-card prompt and switches to `peak`. |
| `/rewrite` | `/deslop` | Prefills a de-slop-the-current-card prompt and switches to `peak`. |
| `/contradictions` | `/contradict` | Scans the current card for internal inconsistencies. Stays on the current agent — a manual, on-demand deep-dive. |
| `/swarm` | `/deepreview` | Fans the current draft out to whichever of `review-swarm`'s 4 lenses apply and shows the merged findings in full (not condensed). |
| `/takes` | `/draftswarm` | Fans out 3 distinct-angle takes on a single card section (not the whole card) via `draft-swarm` and shows them for you to pick or modify — stays on the current agent. |
| `/evolve` | `/refine` | Loops draft → review → auto-fix for up to N generations (default 3, e.g. `/evolve 5`) — fully unattended, ends with one summary line. Stays on the current agent. |
| `/lorebook` | `/worldinfo` | Prefills a propose-then-confirm lorebook-authoring prompt for the current card, switches to `peak`. |
| `/lore` | — | Opens a picker over your lore library, then hands the picked file's path to `peak` to build a card grounded in it. |
| `/lore add` | `/addlore` | Prefills a save-into-the-lore-library prompt on `build`. |
| `/world` | `/worldbuild` | Prefills a generate-a-cohesive-world prompt and switches to `worldsmith`; the world is saved under `worlds/` in your lore library. |
| `/voice add` | `/addvoice` | Prefills a build-a-voice-profile prompt on `build` — point it at a creator's sample cards, it delegates to `voice-profiler` and saves the result under `voices/` in your lore library. |
| `/voice` | — | Opens a picker over saved voice profiles, then hands the picked profile's path to `peak` to author fresh, original content closely matching that creator's formatting/macro/prose patterns. |
| `/move` | — | Move the session to another project directory. |
| `/editor` | — | Open your external `$EDITOR` for composing a longer prompt. |
| `/clearcontext` | — | Remove attached editor/file context from the composer. |
| `/skills` | — | List available skills. |

### General / app commands

| Command | What it does |
|---|---|
| `/sessions` | List and switch between sessions. |
| `/new` | Start a new session. |
| `/models` | List and switch the active model. |
| `/agents` | List and switch the active agent. |
| `/mcps` | List configured MCP servers. |
| `/variants`, `/variantcycle` | List / cycle model variants. |
| `/connect` | Connect a model provider. |
| `/org` | Switch console organization. |
| `/status` | Show runtime status. |
| `/themes` | Switch the color theme (see [Themes](#6-themes)). |
| `/mode` | Toggle light/dark/auto theme mode (aliases `/light`, `/dark`). |
| `/lockmode` | Lock the current theme mode instead of following the terminal. |
| `/help` | Show help. |
| `/docs` | Open this README. |
| `/exit` | Quit. |
| `/terminaltitle` | Toggle whether jclaw sets the terminal window title. |
| `/animations` | Toggle UI animations. |
| `/pastesummary` | Toggle paste-summary behavior. |
| `/autoapprove` | Set the permission auto-approve mode (alias `/yolo`). |

---

## 6. Themes

37 built-in themes, switch with `/themes`:

`aura`, `ayu`, `carbonfox`, `catppuccin`, `catppuccin-frappe`,
`catppuccin-latte`, `catppuccin-macchiato`, `cobalt2`, `cursor`, `dracula`,
`everforest`, `flexoki`, `github`, `gruvbox`, **`jclaw`** (default — teal
primary, amber accent), `kanagawa`, `lucent-orng`, `material`, `matrix`,
`mercury`, `monokai`, `nightowl`, `nord`, `one-dark`, `opencode`, `orng`,
`osaka-jade`, `palenight`, `rosepine`, `solarized`, `synthwave84`,
`tokyonight`, `vercel`, `vesper`, `zenburn`.

**Light mode note:** most themes are dark-only (identical light/dark
palettes), so `/mode` won't visibly change anything on them. Themes with a
real light palette: `jclaw`, `catppuccin-latte`, `tokyonight`, `github`,
`solarized`, and a few others. `/lockmode` pins a mode instead of
auto-following your terminal's appearance.

---

## 7. Typical workflows

**Write a brand-new card from a rough idea:**
`build` → describe the idea → `build` routes you to `lore planning` for a
brainstorm, or you `/card` directly if the concept is already solid → `peak`
drafts → auto self-review fires → finished card.

**Deep-audit a card you're not sure about:**
`/swarm` on the card → `review-swarm` runs whichever of its 4 critics apply
(prose, lore, macros, structure) in parallel and returns one merged report,
noting which ran or were skipped and why → you decide what to fix.

**Build a world first, then a character from it:**
`/world` → `worldsmith` interviews you and authors a cohesive world, saves it
to `worlds/<name>.md` in your lore library → later, `/lore` → pick that file
→ `peak` builds a card grounded in it (asks which character/angle if the
world has more than one).

**Offload bloated permanent-field lore into a lorebook:**
ask `peak` or `build` to look at a card that's grown heavy → they'll propose
(not silently create) a lorebook: one lean `constant: true` hub entry plus
cascading conditional entries, keyed by regex on topic name/aliases.

**Save reusable lore for later:**
`/lore add` on `build` any time you want to bank worldbuilding you've worked
out in conversation, independent of any specific card.

**Break decision paralysis on one section:**
`/takes` on `peak` or `build`, name the section (e.g. Scenario, or one
Opening Message) → `draft-swarm` fans out 3 distinct-angle variants in
parallel and shows them in full → you pick one or ask for a tweak → the agent
locks it in and asks whether to draft the next section.

---

## 8. Configuration

Project-level config lives in `opencode.json` / `opencode.jsonc` (also
checked under `.opencode/`) in your project root, or `~/.config/opencode/`
for global defaults. Relevant top-level keys:

```json
{
  "model": "anthropic/claude-3-5-sonnet-20241022",
  "small_model": "provider/model",
  "provider": { "...": "per-provider auth/endpoint overrides" },
  "mcp": { "...": "MCP server specs, see 7.1" },
  "plugin": ["npm:@scope/plugin-name", ["file:./local-plugin", { "option": "value" }]],
  "skills": { "paths": ["./my-skills"], "urls": ["https://example.com/skill.md"] },
  "permission": { "...": "see 7.4" },
  "attachment": { "image": { "auto_resize": true, "max_width": 2048 } },
  "tool_output": { "max_lines": 2000, "max_bytes": 100000 },
  "compaction": { "auto": true, "preserve_recent_tokens": 20000 }
}
```
(`tui/packages/core/src/v1/config/config.ts`)

### 8.1 MCP servers

Config-only — there's no `/mcps add` wizard. Add a server under the `mcp` key:

```json
{
  "mcp": {
    "local-example": {
      "type": "local",
      "command": ["node", "server.js"],
      "environment": { "VAR": "value" },
      "enabled": true
    },
    "remote-example": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token" },
      "enabled": true
    }
  }
}
```
Inspect what's loaded with `/mcps` in the TUI or `jclaw mcp` on the CLI.
(`tui/packages/core/src/v1/config/mcp.ts`)

### 8.2 Plugins

`/plugin list`, `/plugin install <path>`, `/plugin enable|disable <name>`,
`/plugin uninstall|update <id>` — or the equivalent `jclaw plugins` /
`jclaw marketplace` CLI commands. Plugins auto-load from `.opencode/plugins/`
in a project, or are declared explicitly in config via the `plugin` array
(npm package or local file path, with optional options object).

### 8.3 Skills

Beyond the built-in skills, point jclaw at your own via the `skills` config
key (`paths`: local directories, `urls`: HTTP endpoints). A skill is a
Markdown file (or `**/SKILL.md`) with YAML frontmatter (`name`,
`description`, optionally `slash: true` to expose it as a `/`-command). List
what's loaded with `/skills`.

### 8.4 Permissions

Every tool call an agent makes is gated `ask` (default — blocks with a
confirmation dialog showing the tool/file/diff), `allow` (auto-approved), or
`deny` (auto-rejected). Set rules globally or per-project:

```json
{
  "permission": {
    "bash": "ask",
    "edit": { "*": "ask", "src/generated/*": "allow" },
    "read": "allow",
    "*": "deny"
  }
}
```

`/autoapprove` (alias `/yolo`) flips this at runtime for the current session.
The equivalent at launch is `jclaw tui --auto` (aliases `--yolo`,
`--dangerously-skip-permissions`) — auto-approves anything not explicitly
denied. Use with care: it skips the confirmation dialog entirely.

### 8.5 Connecting a provider

`/connect` walks you through authenticating a model provider. For most
providers this is pasting an API key; for a few that support it (MCP servers,
Codex/ChatGPT, xAI, Snowflake, DigitalOcean) it's a browser-based OAuth flow
against a local loopback callback server jclaw spins up for the exchange
(`tui/packages/core/src/oauth/page.ts`). Either way the result lands in your
provider config, not a separate credentials file.

### 8.6 Keybindings

Customize via the `keybinds` key in TUI config (`$OPENCODE_TUI_CONFIG` or the
same `opencode.json`/`.opencode/` locations as above), keyed by action name
to a key string.

Notable defaults (`tui/packages/tui/src/config/keybind.ts`):

| Action | Default key |
|---|---|
| Leader key (prefix for `<leader>x` binds below) | `ctrl+x` |
| Command palette | `ctrl+p` |
| Exit app | `ctrl+c`, `ctrl+d`, `<leader>q` |
| Undo in input | `ctrl+z`, `ctrl+-`, `super+z` |
| Open external editor | `<leader>e` |
| Theme list | `<leader>t` |
| Toggle sidebar | `<leader>b` |
| Export session | `<leader>x` |
| New / list / compact session | `<leader>n` / `<leader>l` / `<leader>c` |
| Session timeline | `<leader>g` |
| Quick-switch session slots 1–9 | `<leader>1` … `<leader>9` |
| First child session / cycle children | `<leader>down` / left-right arrows |
| Go to parent session | `<leader>up` |

### 8.7 Agent colors

Give any agent a color in the switcher/footer by adding `color` to its
config entry — either a hex value or a theme color token:

```json
{ "agent": { "peak": { "color": "#FFA500" } } }
```
(`tui/packages/opencode/src/agent/agent.ts`)

---

## 9. Session management

- **Session tree.** Spawning a subagent via the `task` tool (self-review,
  `review-swarm`'s four lenses, `general`, etc.) creates a **child session**
  under the one that spawned it — that's what the `<leader>down`/arrow-key/
  `<leader>up` keybinds navigate. This is how you can inspect a
  `review-swarm` run's individual lens sessions after the fact instead of
  only seeing the merged summary.
- **Timeline** (`<leader>g`) shows your message history in reverse
  chronological order so you can jump to an earlier point in a long session.
- **Quick-switch slots** (`<leader>1`–`9`) let you pin up to 9 sessions for
  one-key switching.
- **Revert / checkpoint.** Every session tracks a `revert` pointer at a
  specific message ID, with the file diff at that point recorded
  (`tui/packages/schema/src/revert.ts`). Reverting rolls the conversation
  (and its file-editing effects) back to before a chosen message; unrevert
  restores it. This is your undo for "the last few turns went somewhere
  wrong" — distinct from the `edit` tool's file-level history.

---

## 10. Model variants

Some models expose multiple **variants** (e.g. different reasoning-effort
tiers) reported by the provider's model info. `/variants` lists what the
current model supports, `/variantcycle` steps through them; the chosen
variant is stored per-model and sent as a provider option on requests.
Not every model has variants — if `info.variants` is empty, there's nothing
to cycle.

---

## 11. How it works

- **Launcher:** the Rust binary (`rust/crates/rusty-claude-cli`) is a thin
  launcher — when invoked as `jclaw` with no subcommand it `exec`s
  `bun run --cwd tui/packages/opencode src/index.ts`, handing off entirely to
  the vendored TypeScript TUI + embedded server. Other subcommands
  (`status`, `doctor`, `agents`, `mcp`, `skills`, `plugins`, `config`,
  `model`, `session`, `prompt`, `export`, `init`, `acp`, etc.) run natively in
  Rust without touching Bun.
- **Config is shared with real opencode, on purpose.** The vendored core
  hardcodes `app = "opencode"`, so jclaw reads/writes
  `~/.config/opencode` (config), `~/.local/share/opencode` (data — sessions
  DB, lore library, repos), and `~/.local/state/opencode` (model/theme
  selection). This means your OpenCode Zen free-model access and any prior
  opencode setup carry straight over. `~/.local/share/opencode/jclaw/lore/`
  is jclaw's own namespaced subdirectory inside that shared data root — it
  doesn't touch or rename anything opencode owns.
- **Agent-initiated switching.** `peak`/`build` can call a `plan_enter` tool
  to switch you into `lore planning` themselves (with a Yes/No confirmation),
  and `lore planning` can call `plan_exit` to switch back — you don't have to
  do it manually, though you still can via `/agents`.
- **Self-review is automatic, deep review is opt-in.** `peak`/`build` spawn
  the `review` subagent on their own initiative before showing you a
  finished card or lorebook entry — you'll see it fire mid-response, then get
  one short note ("fixed a stock phrase" / "passed clean"). The heavier
  `review-swarm` (4 parallel critics) only runs when you ask for it
  (`/swarm` or plain-language "really scrutinize this").
- **Tool calls in one turn run in parallel with no concurrency cap** (the
  underlying AI SDK maps tool calls through an unbounded `Promise.all`) —
  this is what lets `review-swarm` fire its applicable critic subagents
  simultaneously rather than one after another, and what `draft-swarm` reuses
  to draft several section variants at once instead of one at a time.
- **The `tokenize` tool** wraps `gpt-tokenizer` (pure JS, no API key, text
  never leaves your machine) so `peak`/`build`/`review-structure` check
  actual token counts against the card/lorebook budget guidance instead of
  guessing.
- **`task` tool** is what lets one agent spawn another as a child session and
  get its result back synchronously — the mechanism behind both self-review
  and the review swarm. It's permission-gated per agent (e.g. `review-swarm`
  can only spawn its four named lenses, nothing else).
- **Sidebar** (`<leader>b`) is a panel of pluggable widgets, not a fixed
  layout: changed-files with +/- diff stats, the session's todo list, active
  MCP servers, LSP status, attached context, and a footer showing your git
  branch and jclaw's version. Individual widgets are plugin hooks
  (`sidebar_content`/`sidebar_footer`), so which ones show up can vary if
  plugins add or remove their own.
- **Embedded HTTP server:** the TUI boots a local server internally (used in
  development for headless checks like `curl localhost:PORT/agent`). It's
  not a documented or stable public API — don't build tooling against it.

---

## 12. CLI reference (Rust, non-TUI subcommands)

Run `jclaw <subcommand>` for these; `jclaw` with no arguments launches the
TUI directly.

| Subcommand | Purpose |
|---|---|
| `help` | Show help. |
| `version` | Print CLI version and build metadata. |
| `status` | Show runtime status/config. |
| `sandbox` | Inspect the resolved sandbox/isolation state for the current directory (namespace, network, filesystem). |
| `doctor` | Local-only health check: auth, config, workspace, sandbox, build metadata. No provider request needed. |
| `state` | Read back the worker-state file (`.claw/worker-state.json`) written by a `prompt` run — model, permissions, session reference. |
| `agents` | List/inspect configured agents. |
| `mcp` | Inspect configured MCP servers and connection status. |
| `skills` | List/inspect available skills. |
| `plugins` | Manage plugin lifecycle (`list`/`show`/`install`/`enable`/`disable`/`uninstall`). |
| `marketplace` | Browse the plugin marketplace. |
| `system-prompt` | Render the resolved system prompt jclaw would send for a given cwd/date — useful for checking exactly what an agent's prompt looks like after template substitution. |
| `dump-manifests` | Emit every skill/agent/tool manifest the resolver would load for the current directory. |
| `bootstrap-plan` | List the ordered startup phases the CLI executes before dispatch. |
| `acp` | Reports ACP/Zed editor-integration status only (see note below) — not a working integration yet. |
| `init` | Create `.claw/settings.json`, `.claw.json`, `.gitignore`, `CLAUDE.md` in the current project. Idempotent. |
| `export` | Export session/data (see [§16](#16-export) for the TUI-vendored `jclaw export`). |
| `prompt` | One-shot, non-interactive prompt mode — the only remaining way this CLI layer produces a live model turn. |
| `resume` | Restore/inspect a saved `.claw/` session without starting a new provider turn. |
| `session` | Manage managed sessions directly: `list` (default), `exists <id>`, `switch <id>`, `fork [branch-name]`, `delete <id> [--force]`. `switch`/`fork` record a pointer so `active` can be used as a session reference anywhere (including `--resume active`). |
| `compact` | Mechanically trim an existing managed session in place (defaults to `latest`) — same algorithm as the `/compact` slash command, no LLM call. |
| `config` | Show effective runtime configuration (model, hooks, plugins, env). Read-only. |
| `model` / `models` | Show model-selection guidance and the current configured model. |
| `settings` | Alias view of `config settings`. Read-only. |
| `diff` | Show the diff relative to the expected base commit. |
| `tui` | Explicitly launch the TUI (same as bare `jclaw`). |

**A bit of history:** this Rust CLI layer predates the vendored TUI and was
originally the interface to a Rust-native interactive REPL. That REPL (and
its `claw-janitor` persona) has since been removed in favor of the TUI, and
`state`/`session`/`compact` were left behind as legacy holdovers that just
pointed back at the removed REPL. They've since been rebuilt as real,
non-interactive subcommands: `state` reads the worker-state file written by
`prompt`, and `session`/`compact` operate directly on the managed session
store (`.claw/sessions/`) — no REPL, no TUI, no provider call required. All
of `agents`/`mcp`/`skills`/`plugins`/`sandbox`/`doctor`/`init`/
`system-prompt`/`config`/`diff`/`dump-manifests`/`bootstrap-plan`/`state`/
`session`/`compact`/`export`/`resume` are real, scriptable, non-interactive
commands. For actual authoring work, use `jclaw` (the TUI) — everything in
sections 1–10 of this doc runs there, not through this CLI layer.

**ACP** (Agent Client Protocol, the protocol Zed and similar editors use for
external agent integration) is scaffolded but not implemented: `jclaw acp
[serve]` only prints a status report confirming no daemon or JSON-RPC
endpoint is running yet.

Rust-side launcher env overrides (not opencode config — these control how
the Rust binary finds Bun/the TUI, see `rust/crates/rusty-claude-cli/src/tui.rs`):

| Variable | Purpose |
|---|---|
| `JCLAW_BUN` | Absolute path to the `bun` executable, if not auto-detected. |
| `JCLAW_TUI_DIR` | Absolute path to the vendored `tui/` directory, if not auto-detected. |
| `JCLAW_BINDIR` | Where `scripts/install-jclaw.sh` installs the launcher (default `~/.local/bin`). |
| `JCLAW_DOCS_URL` | Overrides what `/docs` opens (defaults to this README on disk). |

---

## 13. Environment variables (opencode/TUI layer)

These come from the vendored core and affect config resolution and runtime
behavior; set them in your shell before running `jclaw`
(`tui/packages/core/src/flag/flag.ts`):

| Variable | Purpose |
|---|---|
| `OPENCODE_CONFIG` | Path to a specific config file to load. |
| `OPENCODE_CONFIG_DIR` | Override the config directory (default `~/.config/opencode`). |
| `OPENCODE_TUI_CONFIG` | Override the TUI-specific config file (keybinds, notifications). |
| `OPENCODE_PERMISSION` | Override the permission mode. |
| `OPENCODE_DISABLE_AUTOUPDATE` / `OPENCODE_ALWAYS_NOTIFY_UPDATE` | Control the auto-update check. |
| `OPENCODE_DISABLE_AUTOCOMPACT` | Disable automatic session compaction. |
| `OPENCODE_DISABLE_MOUSE` | Disable mouse input in the TUI. |
| `OPENCODE_DISABLE_TERMINAL_TITLE` | Disable terminal title updates (same as `/terminaltitle`). |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | Ignore project-level `opencode.json`, use global config only. |
| `OPENCODE_EXPERIMENTAL` | Enable all experimental features at once. |
| `OPENCODE_MODELS_PATH` / `OPENCODE_MODELS_URL` | Override the model catalog source. |
| `OPENCODE_DB` | Override the sessions database location. |

---

## 14. Notifications

Desktop/audio notifications fire on session completion, errors, and
permission/question prompts. Configure per-event sounds under `attention` in
TUI config:

```json
{ "attention": { "sounds": { "done": "path/to.mp3", "error": "path/to.mp3", "permission": "path/to.mp3" } } }
```
(`tui/packages/tui/src/feature-plugins/system/notifications.ts`)

---

## 15. Composer: attachments & pasting

- **Paste** file paths (platform clipboard-aware) or drag-and-drop them into
  the composer to attach — images (`.png`, `.jpg`, `.webp`, `.gif`, `.avif`,
  `.svg`) and PDFs are supported.
- **Pasted text** of 3+ lines or 150+ characters is auto-summarized in the
  composer instead of shown in full; toggle with `/pastesummary`.
- `/editor` opens your `$EDITOR` for composing a longer prompt in place.

---

## 16. Export

```sh
jclaw export [sessionID] [--sanitize]
```
Outputs the session as JSON (`{ info, messages }`, including all message
parts — text, file attachments, tool calls, diffs, snapshots). `--sanitize`
redacts file paths/contents/URLs as `[redacted:kind:id]` before you share it.
(`tui/packages/opencode/src/cli/cmd/export.ts`)

---

## 17. Data & config locations

| Path | Holds |
|---|---|
| `~/.config/opencode` | Config files (`opencode.json`, etc). |
| `~/.local/share/opencode` | Data root: sessions DB, repo clones, logs. |
| `~/.local/share/opencode/jclaw/lore/` | Your lore library (flat files or `collection/` subfolders; `.md`/`.txt`/`.json`). Worlds saved by `worldsmith` land in a `worlds/` subfolder here; voice profiles saved via `/voice add` land in a `voices/` subfolder. |
| `~/.local/state/opencode` | Session state: selected model, theme, mode lock (`kv.json`). |

---

## 18. Notes

- Free models come from **OpenCode Zen** (`provider: "opencode"`) — still
  fully supported, just no longer pinned to the top of the provider/model
  pickers (OpenRouter leads instead, since it's natively BYOK).
- The lore-library picker (`/lore`) supports multi-select — mark files with
  `space`, then `enter` to build a card grounded in all of them at once
  (`enter` with nothing marked falls back to just the highlighted file).
- `--auto`/`--yolo`/`--dangerously-skip-permissions` and
  `OPENCODE_DISABLE_PROJECT_CONFIG` are sharp tools — they affect a shared
  config that also drives your real opencode setup if you use both.
- `peak`/`build`/`review*`'s card-authoring rules are cross-checked against
  community botmaking guides, not just one person's read of the platform —
  see NicholasCS's, absolutetrash's, and the `rentry.org/botcreationguide` /
  `letsmakeabot` guides. Live-verified against real `jclaw` runs (disposable
  test cards, session-DB-checked) before landing in the prompts.

---

## 19. Attribution

jclaw is a derivative of [`ultraworkers/claw-code`](https://github.com/ultraworkers/claw-code)
(MIT) and vendors [opencode](https://github.com/anomalyco/opencode)'s TUI and server.
The upstream MIT license and copyright are preserved in [`LICENSE`](LICENSE).
