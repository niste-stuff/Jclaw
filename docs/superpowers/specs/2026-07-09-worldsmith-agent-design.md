# worldsmith agent + `/world` command — design

**Date:** 2026-07-09
**Status:** Approved design, pre-implementation

## Purpose

jclaw's thesis is "lore is the source, card is the render." Item 26 built the *consumption*
half — `/lore` picks a lore file and `peak` renders a card from it — plus a *passive* save
(`/lore add`, which stores lore you hand it). What's missing is an *active authoring front*:
a way to have the model generate a **cohesive, self-consistent world** from a seed premise and
drop it in the lore store, where later sessions build cards from it.

This spec adds that: a dedicated `worldsmith` agent and a `/world` command.

## What already exists (do not rebuild)

- **Lore store:** `~/.local/share/opencode/jclaw/lore/` via `Global.Path.lore`
  (`packages/core/src/global.ts`). Auto-created at boot. Supports nested subfolders.
- **`/lore` picker** (`component/dialog-lore.tsx`): scans `**/*`, groups by parent subdir,
  routes the picked file's absolute path into `peak` via `fillPrompt`.
- **`/lore add`:** prefills `build` to save handed-over lore into the store.
- **Permission matcher:** `Wildcard.match` compiles `*` to `.*` with the dotall (`s`) flag, so
  the existing `external_directory` allow `path.join(Global.Path.lore, "*")` on `peak`/`build`
  already matches nested paths at any depth (`lore/worlds/foo.md`). **Verified.** No new
  permission glob is needed to reach the `worlds/` subfolder.
- **`task` tool** spawns any agent by name (`agent.get(subagent_type)`, no `mode` filter), so a
  primary agent like `peak` is spawnable from another agent when permission allows.

## Design decisions (locked with the user)

| Decision | Choice |
|---|---|
| Author mode | **Both** — one-shot draft from a seed premise, then refine in-session before saving |
| World doc shape | **Freeform prose `.md`** — no forced section template |
| Driver | **New dedicated `worldsmith` agent** (domain expertise, mirrors how `peak` owns cards) |
| Storage | **`lore/worlds/<kebab-name>.md`** — subfolder of the existing lore store |
| Consumption | **Reuse `/lore` picker unchanged** — worlds show under a "worlds" category |
| After save | **Silent** — no unprompted "go build a card" nudge |
| Card handoff | **On request only** — `worldsmith` can spawn `peak` via `task` to draft a card |
| Self-review | **None** — the `review`/swarm rubric is card-specific; `worldsmith` does its own cohesion pass |

## Components

### 1. `worldsmith` agent

**File:** `packages/opencode/src/agent/prompt/worldsmith.txt` (new).
**Registration:** `packages/opencode/src/agent/agent.ts`, `mode: "primary"`, `native: true`,
entry added alongside `build`/`peak`/`lore planning`.

**Prompt content (freeform world authoring):**
- Domain: build **cohesive, internally consistent** worlds — geography, factions/powers,
  history/timeline, key characters, the rules that make the setting hang together. Interlock
  the pieces (a faction's motive traces to a historical event; geography shapes conflict) so
  the world reads as one place, not a list of disconnected facts.
- Same **no-slop bar** as `peak`/`build`: no generic-fantasy filler, no adjective-list
  worldbuilding, no AI tells. Specifics and tension over decoration.
- **Workflow:** (a) from a seed premise, produce a full first draft in **freeform prose `.md`**
  — the model chooses the structure that fits the world; (b) **refine** against the user's notes
  in-session; (c) **save on explicit user confirmation** to
  `<lore>/worlds/<kebab-name>.md`. Ask before overwriting an existing file; confirm the saved
  path (same contract as `/lore add`).
- **Cohesion pass:** before presenting a draft, self-check for internal contradictions
  (timeline conflicts, orphan factions, geography that fights the plot). Report/fix silently;
  no `review` subagent.
- **Card handoff:** after saving, stay silent about card-building by default. **If the user
  asks** to build a card from the world, call `task` with `subagent_type: "peak"`, handing peak
  the saved world's path and which character/angle to render. For interactive card refinement,
  point the user at `/lore` instead.
- **Do not self-browse the workspace** (same rule `peak`/`build` carry, item 18): work only
  from the premise/notes the user gives, not a self-directed search.

**Permission** (merged over `defaults`, mirroring `peak`):
```
question: "allow",
plan_enter: "allow",
external_directory: { [path.join(Global.Path.lore, "*")]: "allow" },
task: { "*": "deny", peak: "allow" },
```
The `external_directory` allow covers both the world write (into `worlds/`) and any lore reads,
at any depth, via the dotall matcher. `task` is scoped to `peak` only — `worldsmith` cannot
spawn any other agent type.

**Model preset:** add `"worldsmith"` to `PRESET_AGENTS`
(`packages/tui/src/context/local.tsx:55`) so it shares the `build` model slot like
`peak`/`lore planning` — switching to `worldsmith` keeps the current model and a model change
applies across the set.

### 2. `/world` command

**File:** `packages/tui/src/component/prompt/index.tsx`, Cards command array (~line 634),
following the exact `fillPrompt` pattern of `/card`/`/lorebook`/`/lore`.

```
title: "Build a world",
desc: "Generate a cohesive world and save it to your lore library",
name: "card.world",
category: "Cards",
slashName: "world",
slashAliases: ["worldbuild"],
run: () => fillPrompt(<generate-refine-save prompt>, "worldsmith"),
```

The `.map` at the end of the array auto-applies `namespace: "palette"`, so the command reaches
both the `/` popup and the `ctrl+p` palette. No keybind wiring (Cards commands aren't
key-bound). The prefilled prompt: switch to `worldsmith`, take the user's premise, draft a
cohesive world in freeform prose, refine on request, and save to `<lore>/worlds/` (kebab
`.md`, ask before overwrite, confirm path) once the user confirms.

### 3. `/lore` consumption nudge (one line)

A world doc holds **multiple** characters, unlike the single-character lore `/lore` was built
for. Add one line to the existing `/lore` `fillPrompt` (index.tsx ~line 646): if the picked
lore reads as a multi-character world, `peak` should ask **which character/angle** to render
before authoring, rather than assuming a single subject.

## Data flow

```
/world  → worldsmith (premise → draft → refine → confirm)
                         │
                         └─ save → ~/.local/share/opencode/jclaw/lore/worlds/<name>.md
                                        │
/lore   → picker lists worlds/ under "worlds" category
                         │
                         └─ pick → peak (asks which character) → renders card

worldsmith --(user asks)--> task subagent_type:peak --> card draft returned inline
```

## Out of scope (YAGNI)

- No `worlds/`-specific picker or `Global.Path.worlds` — the subfolder rides the existing
  `/lore` store and picker.
- No `review`/swarm self-review for worlds.
- No world-versioning, world-diffing, or multi-world merging (separate future ideas).
- No forced section template or world linter (freeform was chosen).

## Verification plan

- **Typecheck:** `bun run --cwd packages/opencode typecheck` and
  `bun run --cwd packages/tui typecheck` clean.
- **Tests:** `test/agent/*` (agent registry + permissions), `event-manifest`, and the
  `packages/tui` suite green. Full `bun test` across packages (watch for the known
  `httpapi-v2-pty` disk-pressure flake, §7 of HANDOFF — reproduces solo, not a regression).
- **Headless boot:** `serve` + `curl /agent` lists `worldsmith` with `mode: "primary"` and the
  scoped `task`/`external_directory` permissions.
- **Live TTY (real Terminal):** `/world` opens on `worldsmith`; generate a throwaway world;
  refine it; confirm save writes to `lore/worlds/` **with no permission prompt** (proves the
  `external_directory` allow); then `/lore` lists it under "worlds", pick it, confirm `peak`
  asks which character and reads the file with no prompt; finally ask `worldsmith` to "build a
  card from this" and confirm it spawns `peak` via `task` and returns a draft inline.
