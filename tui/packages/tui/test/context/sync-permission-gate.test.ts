import { describe, expect, test } from "bun:test"
import { shouldAutoReplyPermission } from "../../src/context/sync"

describe("shouldAutoReplyPermission", () => {
  test("ask tier never auto-replies", () => {
    expect(shouldAutoReplyPermission("ask", "edit")).toBe(false)
    expect(shouldAutoReplyPermission("ask", "bash")).toBe(false)
  })

  test("yolo tier always auto-replies", () => {
    expect(shouldAutoReplyPermission("yolo", "bash")).toBe(true)
    expect(shouldAutoReplyPermission("yolo", "external_directory")).toBe(true)
    expect(shouldAutoReplyPermission("yolo", "task")).toBe(true)
  })

  test("autoapprove auto-replies for unrestricted categories", () => {
    expect(shouldAutoReplyPermission("autoapprove", "edit")).toBe(true)
    expect(shouldAutoReplyPermission("autoapprove", "write")).toBe(true)
    expect(shouldAutoReplyPermission("autoapprove", "question")).toBe(true)
  })

  test("autoapprove still asks for bash/external_directory/webfetch/websearch/task", () => {
    expect(shouldAutoReplyPermission("autoapprove", "bash")).toBe(false)
    expect(shouldAutoReplyPermission("autoapprove", "external_directory")).toBe(false)
    expect(shouldAutoReplyPermission("autoapprove", "webfetch")).toBe(false)
    expect(shouldAutoReplyPermission("autoapprove", "websearch")).toBe(false)
    expect(shouldAutoReplyPermission("autoapprove", "task")).toBe(false)
  })
})
