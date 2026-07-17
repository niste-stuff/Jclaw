import { describe, expect, test } from "bun:test"

// Regression test for the yolo-tier reminder injection condition in
// component/prompt/index.tsx's submitInner(). Mirrors this standalone (same
// pattern as slop-command-dispatch.test.ts) rather than importing the real
// Solid component.

const NL_COMMAND_AGENTS = new Set(["peak", "build"])

function isNlCommandApplicable(agentName: string | undefined) {
  return Boolean(agentName && NL_COMMAND_AGENTS.has(agentName))
}

type PermissionMode = "ask" | "autoapprove" | "yolo"

function shouldInjectYoloReminder(mode: PermissionMode, agentName: string | undefined) {
  return mode === "yolo" && isNlCommandApplicable(agentName)
}

describe("yolo-tier reminder injection", () => {
  test("injects for peak at yolo tier", () => {
    expect(shouldInjectYoloReminder("yolo", "peak")).toBe(true)
  })

  test("injects for build at yolo tier", () => {
    expect(shouldInjectYoloReminder("yolo", "build")).toBe(true)
  })

  test("does not inject at autoapprove tier", () => {
    expect(shouldInjectYoloReminder("autoapprove", "peak")).toBe(false)
  })

  test("does not inject at ask tier", () => {
    expect(shouldInjectYoloReminder("ask", "peak")).toBe(false)
  })

  test("does not inject for an unrelated agent even at yolo", () => {
    expect(shouldInjectYoloReminder("yolo", "lore planning")).toBe(false)
  })

  test("does not inject with no current agent", () => {
    expect(shouldInjectYoloReminder("yolo", undefined)).toBe(false)
  })
})
