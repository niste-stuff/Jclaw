# jclaw

A terminal workshop for writing **JanitorAI character cards** — the way a coding
agent works on code. jclaw drops you into a full-screen TUI with card-authoring
agents that draft, rewrite, and de-slop cards (and their lorebooks) alongside you.

## Run it

```sh
jclaw          # from any project directory
```

Installs to `~/.local/bin/jclaw` via `scripts/install-jclaw.sh`. The binary launches
the vendored front end through Bun, so edits under `tui/` take effect on the next
run with no rebuild.

Dev alternative (needs a real TTY):

```sh
cd rust && cargo run --bin claw -- tui
```

## The agents

- **build** — The default general-purpose assistant: manages your card library,
  handles everyday tasks, routes deep card work to the right specialist.
- **lore planning** — Collaborative brainstorming when you're still figuring out
  who the character is. It plans; it doesn't write files.
- **peak** — The "peak". card author. Turns a finished concept into a top-tier card, or
  rewrites an existing one to cut AI tells and bloat.

Slash commands (`/card`, `/rewrite`, `/contradictions`, `/lorebook`) prefill the
composer for common card jobs.

## Layout

- `rust/` — the Rust workspace and CLI launcher (`claw tui`).
- `tui/` — a vendored Bun/Solid/OpenTUI front end (opencode's), rebranded to jclaw.

## Attribution

jclaw is a derivative of [`ultraworkers/claw-code`](https://github.com/ultraworkers/claw-code)
(MIT) and vendors [opencode](https://github.com/anomalyco/opencode)'s TUI and server.
The upstream MIT license and copyright are preserved in [`LICENSE`](LICENSE).
