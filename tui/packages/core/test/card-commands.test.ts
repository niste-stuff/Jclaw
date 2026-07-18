// tui/packages/core/test/card-commands.test.ts
import { describe, expect, test } from "bun:test"
import { CARD_COMMAND_REGISTRY } from "../src/card-commands"

describe("CARD_COMMAND_REGISTRY", () => {
  test("has exactly the 14 target command ids", () => {
    const ids = Object.keys(CARD_COMMAND_REGISTRY).toSorted()
    expect(ids).toEqual(
      [
        "autopilot",
        "card",
        "contradictions",
        "evolve",
        "forensics",
        "ideas",
        "lore",
        "loreAdd",
        "rewrite",
        "swarm",
        "takes",
        "voice",
        "voiceAdd",
        "world",
      ].toSorted(),
    )
  })

  test("every entry has a non-empty slashName, description, and at least one trigger phrase", () => {
    for (const [id, entry] of Object.entries(CARD_COMMAND_REGISTRY)) {
      expect(entry.slashName.length, `${id} slashName`).toBeGreaterThan(0)
      expect(entry.description.length, `${id} description`).toBeGreaterThan(0)
      expect(entry.triggerPhrases.length, `${id} triggerPhrases`).toBeGreaterThan(0)
    }
  })

  test("slashNames match the real /-commands already shipped in the TUI", () => {
    expect(CARD_COMMAND_REGISTRY.card.slashName).toBe("card")
    expect(CARD_COMMAND_REGISTRY.rewrite.slashName).toBe("rewrite")
    expect(CARD_COMMAND_REGISTRY.contradictions.slashName).toBe("contradictions")
    expect(CARD_COMMAND_REGISTRY.takes.slashName).toBe("takes")
    expect(CARD_COMMAND_REGISTRY.swarm.slashName).toBe("swarm")
    expect(CARD_COMMAND_REGISTRY.forensics.slashName).toBe("forensics")
    expect(CARD_COMMAND_REGISTRY.evolve.slashName).toBe("evolve")
    expect(CARD_COMMAND_REGISTRY.lore.slashName).toBe("lore")
    expect(CARD_COMMAND_REGISTRY.world.slashName).toBe("world")
    expect(CARD_COMMAND_REGISTRY.loreAdd.slashName).toBe("loreadd")
    expect(CARD_COMMAND_REGISTRY.voiceAdd.slashName).toBe("voiceadd")
    expect(CARD_COMMAND_REGISTRY.voice.slashName).toBe("voice")
    expect(CARD_COMMAND_REGISTRY.ideas.slashName).toBe("ideas")
    expect(CARD_COMMAND_REGISTRY.autopilot.slashName).toBe("autopilot")
  })
})
