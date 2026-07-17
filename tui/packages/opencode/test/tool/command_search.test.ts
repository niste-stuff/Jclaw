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

  // Final-review finding: a single-token phrase (bare slashName like "card" or "lore")
  // used to trivially score ratio=1.0 whenever that one word appeared anywhere in the
  // query, hijacking almost every request that merely mentioned "card" or "lore" and
  // beating out the correct multi-token trigger-phrase match. These cases were verified
  // to wrongly match "card"/"lore" before the fix that applies MIN_MATCHED_TOKENS
  // uniformly regardless of phrase length.
  describe("single-token slashName no longer hijacks matches", () => {
    test('"rewrite this card" matches rewrite, not the bare "card" slashName', () => {
      const match = bestCommandMatch("rewrite this card", CARD_COMMAND_REGISTRY)
      expect(match?.id).toBe("rewrite")
    })

    test('"run a review swarm on this card" matches swarm, not the bare "card" slashName', () => {
      const match = bestCommandMatch("run a review swarm on this card", CARD_COMMAND_REGISTRY)
      expect(match?.id).toBe("swarm")
    })

    test('"find contradictions in this card" matches contradictions, not the bare "card" slashName', () => {
      const match = bestCommandMatch("find contradictions in this card", CARD_COMMAND_REGISTRY)
      expect(match?.id).toBe("contradictions")
    })

    test('"de-slop this card" matches rewrite, not the bare "card" slashName', () => {
      const match = bestCommandMatch("de-slop this card", CARD_COMMAND_REGISTRY)
      expect(match?.id).toBe("rewrite")
    })

    test('"save this to my lore library" matches loreAdd, not the bare "lore" slashName', () => {
      const match = bestCommandMatch("save this to my lore library", CARD_COMMAND_REGISTRY)
      expect(match?.id).toBe("loreAdd")
    })

    test('"add this lore to my library" matches loreAdd, not the bare "lore" slashName', () => {
      const match = bestCommandMatch("add this lore to my library", CARD_COMMAND_REGISTRY)
      expect(match?.id).toBe("loreAdd")
    })

    // Follow-up fix: "evolve this card" was no longer hijacked by the bare "card"
    // slashName after the single-token-hijack fix, but it also failed to resolve to
    // "evolve" itself. All of evolve's registered trigger phrases were 4+ tokens
    // ("run this through evolve", "loop this through review a few times",
    // "auto-refine this card"), so only 2 of those tokens overlapping this 3-token
    // query yielded ratio 0.5, below MIN_RATIO (0.6) — while rewrite's 3-token trigger
    // "rewrite this card" hit 2/3 = 0.667 and won by default. Fixed by adding the
    // literal "evolve this card" trigger phrase to evolve's entry in card-commands.ts,
    // which scores a full 3/3 = 1.0 match.
    test('"evolve this card" now resolves to evolve, not rewrite', () => {
      const match = bestCommandMatch("evolve this card", CARD_COMMAND_REGISTRY)
      expect(match?.id).not.toBe("card")
      expect(match?.id).toBe("evolve")
    })
  })

  // Reachability regression guard: every command must still be reachable via each of
  // its OWN registered trigger phrases. This protects against any future change (to
  // the matcher OR the registry) silently breaking a command's natural-language path.
  describe("every registry entry is reachable via its own trigger phrases", () => {
    for (const [id, entry] of Object.entries(CARD_COMMAND_REGISTRY) as [
      keyof typeof CARD_COMMAND_REGISTRY,
      (typeof CARD_COMMAND_REGISTRY)[keyof typeof CARD_COMMAND_REGISTRY],
    ][]) {
      for (const phrase of entry.triggerPhrases) {
        test(`"${phrase}" -> ${id}`, () => {
          const match = bestCommandMatch(phrase, CARD_COMMAND_REGISTRY)
          expect(match?.id).toBe(id)
        })
      }
    }
  })
})
