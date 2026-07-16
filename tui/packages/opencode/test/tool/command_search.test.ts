import { describe, expect, test } from "bun:test"
import { normalizeForMatch, bestCommandMatch } from "../../src/tool/command_search"
import { CARD_COMMAND_REGISTRY } from "@opencode-ai/core/card-commands"

describe("normalizeForMatch", () => {
  test("lowercases and collapses punctuation", () => {
    expect(normalizeForMatch("Run a Review-Swarm!")).toBe("run a review swarm")
  })
})

describe("bestCommandMatch", () => {
  test("matches a clear review-swarm request", () => {
    const match = bestCommandMatch("can you run a review swarm on this", CARD_COMMAND_REGISTRY)
    expect(match?.id).toBe("swarm")
  })

  test("matches an evolve-loop request", () => {
    const match = bestCommandMatch("loop this through review a few times", CARD_COMMAND_REGISTRY)
    expect(match?.id).toBe("evolve")
  })

  test("matches a forensics request", () => {
    const match = bestCommandMatch("can you check if this is ai slop", CARD_COMMAND_REGISTRY)
    expect(match?.id).toBe("forensics")
  })

  test("matches a world-building request", () => {
    const match = bestCommandMatch("let's build me a whole world for this", CARD_COMMAND_REGISTRY)
    expect(match?.id).toBe("world")
  })

  test("returns undefined for an unrelated message", () => {
    const match = bestCommandMatch("what's the weather like today", CARD_COMMAND_REGISTRY)
    expect(match).toBeUndefined()
  })

  test("returns undefined for a short generic message with no strong overlap", () => {
    const match = bestCommandMatch("ok thanks", CARD_COMMAND_REGISTRY)
    expect(match).toBeUndefined()
  })
})
