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

    // NOTE: "evolve this card" is also no longer hijacked by the bare "card" slashName
    // (pre-fix it matched "card"), but it does not resolve to "evolve" either. All of
    // evolve's registered trigger phrases are 4+ tokens ("run this through evolve",
    // "loop this through review a few times", "auto-refine this card"), so only 2 of
    // those tokens overlapping this 3-token query yields ratio 0.5, below MIN_RATIO
    // (0.6). Meanwhile rewrite's 3-token trigger "rewrite this card" hits 2/3 = 0.667
    // and wins. This is a distinct, pre-existing scoring-threshold limitation of
    // evolve's trigger-phrase wording (in card-commands.ts, out of scope for this fix),
    // not the single-token-hijack bug this change targets. Documented here as a known
    // follow-up rather than silently asserted as fixed.
    test('"evolve this card" is no longer hijacked by the bare "card" slashName (though it still resolves to rewrite, a separate known limitation)', () => {
      const match = bestCommandMatch("evolve this card", CARD_COMMAND_REGISTRY)
      expect(match?.id).not.toBe("card")
      expect(match?.id).toBe("rewrite")
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
