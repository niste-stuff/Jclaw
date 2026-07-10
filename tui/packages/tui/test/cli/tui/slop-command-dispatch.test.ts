import { describe, expect, test } from "bun:test"

// Regression test for slop mode's toggle title and message-injection condition in
// packages/tui/src/app.tsx (the `/slop` command) and
// packages/tui/src/component/prompt/index.tsx (`submitInner`'s `slopParts`).
//
// Mirrors these standalone (same pattern as evolve-command-dispatch.test.ts) rather
// than importing the real Solid component/context.

const SLOP_MODE_AGENTS = new Set(["peak", "build"])

function isSlopModeApplicable(agentName: string | undefined) {
  return Boolean(agentName && SLOP_MODE_AGENTS.has(agentName))
}

function slopToggleTitle(enabled: boolean) {
  return enabled ? "Disable slop mode" : "Enable slop mode"
}

function shouldInjectSlopReminder(enabled: boolean, agentName: string | undefined) {
  return enabled && isSlopModeApplicable(agentName)
}

describe("slop mode toggle + injection", () => {
  test("toggle title reflects the off state", () => {
    expect(slopToggleTitle(false)).toBe("Enable slop mode")
  })

  test("toggle title reflects the on state", () => {
    expect(slopToggleTitle(true)).toBe("Disable slop mode")
  })

  test("injects the reminder for peak while enabled", () => {
    expect(shouldInjectSlopReminder(true, "peak")).toBe(true)
  })

  test("injects the reminder for build while enabled", () => {
    expect(shouldInjectSlopReminder(true, "build")).toBe(true)
  })

  test("does not inject for an unrelated agent even while enabled", () => {
    expect(shouldInjectSlopReminder(true, "lore planning")).toBe(false)
  })

  test("does not inject while disabled, regardless of agent", () => {
    expect(shouldInjectSlopReminder(false, "peak")).toBe(false)
  })

  test("does not inject with no current agent", () => {
    expect(shouldInjectSlopReminder(true, undefined)).toBe(false)
  })
})
