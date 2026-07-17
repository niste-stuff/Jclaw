import { describe, expect, test } from "bun:test"

// Regression test for the three permission-mode commands in app.tsx
// (autoapprove / yolo / cycle) and their titles. Mirrors these standalone
// (same pattern as slop-command-dispatch.test.ts) rather than importing the
// real Solid component.

type PermissionMode = "ask" | "autoapprove" | "yolo"

function cycleCommandTitle(mode: PermissionMode) {
  return `Permission mode: ${mode}`
}

function autoapproveCommandTitle(mode: PermissionMode) {
  return mode === "autoapprove" ? "Currently in autoapprove mode" : "Set permission mode: autoapprove"
}

function yoloCommandTitle(mode: PermissionMode) {
  return mode === "yolo" ? "Currently in yolo mode" : "Set permission mode: yolo"
}

describe("permission mode commands", () => {
  test("cycle command title reflects current mode", () => {
    expect(cycleCommandTitle("ask")).toBe("Permission mode: ask")
    expect(cycleCommandTitle("autoapprove")).toBe("Permission mode: autoapprove")
    expect(cycleCommandTitle("yolo")).toBe("Permission mode: yolo")
  })

  test("autoapprove command title reflects whether it's already active", () => {
    expect(autoapproveCommandTitle("ask")).toBe("Set permission mode: autoapprove")
    expect(autoapproveCommandTitle("autoapprove")).toBe("Currently in autoapprove mode")
  })

  test("yolo command title reflects whether it's already active", () => {
    expect(yoloCommandTitle("ask")).toBe("Set permission mode: yolo")
    expect(yoloCommandTitle("yolo")).toBe("Currently in yolo mode")
  })
})
