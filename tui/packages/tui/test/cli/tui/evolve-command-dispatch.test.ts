import { describe, expect, test } from "bun:test"

// Regression test for the `/evolve` / `/refine` direct-Enter dispatch branch in
// packages/tui/src/component/prompt/index.tsx (`submitInner`).
//
// Cards commands (the `/card`, `/swarm`, `/takes`, etc. family) normally only fire
// via the `/` popup, which hides itself the instant a space follows the command
// word — so a Cards command can never carry a typed trailing argument through the
// popup. `/evolve N` needs the generation count to survive being typed directly
// and Enter'd without ever opening the popup, so `submitInner` has its own small
// regex match+resolve step ahead of the Cards/backend-command dispatch branches.
//
// This mirrors that regex/resolve logic standalone (same pattern as
// prompt-submit-race.test.ts) rather than importing the real Solid component.

const DEFAULT_EVOLVE_GENERATIONS = 3
const MAX_EVOLVE_GENERATIONS = 10

function resolveEvolveGenerations(raw?: string) {
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n) || n < 1) return DEFAULT_EVOLVE_GENERATIONS
  return Math.min(n, MAX_EVOLVE_GENERATIONS)
}

function matchEvolveCommand(trimmed: string) {
  return trimmed.match(/^\/(?:evolve|refine)(?:\s+(\d+))?$/i)
}

describe("/evolve command dispatch", () => {
  test("bare /evolve defaults to 3 generations", () => {
    const match = matchEvolveCommand("/evolve")
    expect(match).not.toBeNull()
    expect(resolveEvolveGenerations(match?.[1])).toBe(3)
  })

  test("/evolve 5 resolves to 5 generations", () => {
    const match = matchEvolveCommand("/evolve 5")
    expect(match).not.toBeNull()
    expect(resolveEvolveGenerations(match?.[1])).toBe(5)
  })

  test("/evolve 99 clamps to the hard cap of 10", () => {
    const match = matchEvolveCommand("/evolve 99")
    expect(match).not.toBeNull()
    expect(resolveEvolveGenerations(match?.[1])).toBe(MAX_EVOLVE_GENERATIONS)
  })

  test("/refine 2 (alias) resolves to 2 generations", () => {
    const match = matchEvolveCommand("/refine 2")
    expect(match).not.toBeNull()
    expect(resolveEvolveGenerations(match?.[1])).toBe(2)
  })

  test("/evolve abc does not match — falls through to normal dispatch", () => {
    expect(matchEvolveCommand("/evolve abc")).toBeNull()
  })

  test("/evolve 0 is not a valid generation count, falls back to the default", () => {
    const match = matchEvolveCommand("/evolve 0")
    expect(match).not.toBeNull()
    expect(resolveEvolveGenerations(match?.[1])).toBe(DEFAULT_EVOLVE_GENERATIONS)
  })
})
