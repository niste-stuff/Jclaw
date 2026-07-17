import { describe, expect, test } from "bun:test"
import { nextPermissionMode } from "../../src/context/permission"

describe("nextPermissionMode", () => {
  test("ask cycles to autoapprove", () => {
    expect(nextPermissionMode("ask")).toBe("autoapprove")
  })

  test("autoapprove cycles to yolo", () => {
    expect(nextPermissionMode("autoapprove")).toBe("yolo")
  })

  test("yolo cycles back to ask", () => {
    expect(nextPermissionMode("yolo")).toBe("ask")
  })
})
