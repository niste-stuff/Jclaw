import { describe, expect, test } from "bun:test"
import { scanGhostPhrases } from "../../src/tool/ghost_phrase_scan"

describe("scanGhostPhrases", () => {
  test("no matches on ordinary text", () => {
    const result = scanGhostPhrases("This is a perfectly ordinary sentence with nothing suspicious.")
    expect(result.matches).toEqual([])
    expect(result.match_count).toBe(0)
  })

  test("finds assistant_leakage phrases at their exact character offset", () => {
    const result = scanGhostPhrases("Certainly! As an AI, I try my best.")
    expect(result.matches).toContainEqual({ phrase: "certainly!", category: "assistant_leakage", index: 0 })
    expect(result.matches).toContainEqual({ phrase: "as an AI", category: "assistant_leakage", index: 11 })
    expect(result.match_count).toBe(2)
  })

  test("word-boundary match does not fire on a substring inside a longer word", () => {
    // "furthermore" should not match inside "furthermorely" (not a real word,
    // but exercises the boundary check the same way "moreover" would inside
    // "moreoverly").
    const result = scanGhostPhrases("Furthermorely speaking, things happened.")
    expect(result.match_count).toBe(0)
  })

  test("finds a formulaic_contrast sentence and reports the matched text as the phrase", () => {
    const text = "Certainly! As an AI, I would say it's not just a story, it's a journey."
    const result = scanGhostPhrases(text)
    const contrastMatch = result.matches.find((m) => m.category === "formulaic_contrast")
    expect(contrastMatch).toEqual({
      phrase: "it's not just a story, it's a journey",
      category: "formulaic_contrast",
      index: 33,
    })
    expect(result.match_count).toBe(3)
  })

  test("matches are sorted by character index ascending", () => {
    const text = "Certainly! As an AI, I would say it's not just a story, it's a journey."
    const result = scanGhostPhrases(text)
    const indices = result.matches.map((m) => m.index)
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  })

  test("essay_transitions and stock_openers categories are detected", () => {
    const result = scanGhostPhrases("Let's dive into this. Moreover, it's important to note the ending.")
    const categories = result.matches.map((m) => m.category).sort()
    expect(categories).toEqual(["essay_transitions", "essay_transitions", "stock_openers"])
  })
})
