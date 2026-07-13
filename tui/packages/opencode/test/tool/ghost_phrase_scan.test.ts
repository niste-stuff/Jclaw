import { describe, expect, test } from "bun:test"
import { scanGhostPhrases, computeGhostSlopScore } from "../../src/tool/ghost_phrase_scan"

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

describe("computeGhostSlopScore", () => {
  // Neutral card-length filler with no ghost phrases in it, so a single
  // injected phrase drives the whole score. ~300 words, matching a realistic
  // card body — the density metric is meaningless on tiny fragments.
  const filler = (words: number) => Array.from({ length: words }, (_, i) => `neutral${i % 40}`).join(" ")

  test("clean text with no matches scores 0", () => {
    const text = filler(300)
    expect(computeGhostSlopScore(scanGhostPhrases(text), text)).toBe(0)
  })

  test("empty text scores 0", () => {
    expect(computeGhostSlopScore(scanGhostPhrases(""), "")).toBe(0)
  })

  test("assistant_leakage is weighted heavier than an essay_transition at equal density", () => {
    // Same-length bodies, one match each; assistant leakage (weight 25) must
    // outscore an essay transition (weight 8).
    const leak = `As an AI, ${filler(300)}`
    const essay = `Moreover, ${filler(300)}`
    const leakScore = computeGhostSlopScore(scanGhostPhrases(leak), leak)
    const essayScore = computeGhostSlopScore(scanGhostPhrases(essay), essay)
    expect(leakScore).toBeGreaterThan(essayScore)
    expect(leakScore).toBeLessThanOrEqual(100)
  })

  test("score is a density: the same match in a longer text scores lower", () => {
    const short = `Moreover, ${filler(200)}`
    const long = `Moreover, ${filler(600)}`
    const shortScore = computeGhostSlopScore(scanGhostPhrases(short), short)
    const longScore = computeGhostSlopScore(scanGhostPhrases(long), long)
    expect(shortScore).toBeGreaterThan(longScore)
  })

  test("score is clamped to a 0-100 range even with dense leakage", () => {
    const dense = "As an AI. As an AI. Certainly! As an AI."
    const score = computeGhostSlopScore(scanGhostPhrases(dense), dense)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})
