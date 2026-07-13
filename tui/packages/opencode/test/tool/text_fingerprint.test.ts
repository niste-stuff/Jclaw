import { describe, expect, test } from "bun:test"
import { computeTextFingerprint, computeFingerprintSlopScore } from "../../src/tool/text_fingerprint"

describe("computeTextFingerprint", () => {
  test("empty text returns zeros for every field", () => {
    const result = computeTextFingerprint("")
    expect(result.punctuation_density).toEqual({ comma: 0, semicolon: 0, em_dash: 0, ellipsis: 0 })
    expect(result.avg_word_length).toBe(0)
    for (const value of Object.values(result.function_word_ratio)) expect(value).toBe(0)
  })

  test("punctuation density counts both — and -- as em-dash, both … and ... as ellipsis, per 1000 chars", () => {
    // 43 chars total: 1 comma, 1 semicolon, 2 em-dash matches ("--" and "—"),
    // 1 ellipsis match ("...").
    const text = "Hello, world; wait--what? Really... yes—no."
    const result = computeTextFingerprint(text)
    expect(text.length).toBe(43)
    expect(result.punctuation_density.comma).toBeCloseTo(23.25581395348837, 10)
    expect(result.punctuation_density.semicolon).toBeCloseTo(23.25581395348837, 10)
    expect(result.punctuation_density.em_dash).toBeCloseTo(46.51162790697674, 10)
    expect(result.punctuation_density.ellipsis).toBeCloseTo(23.25581395348837, 10)
  })

  test("function word ratio and avg word length over a known 8-word sentence", () => {
    // words: the,cat,and,the,dog,are,the,best (8 words) -> the:3, and:1, are:1
    const result = computeTextFingerprint("the cat and the dog are the best")
    expect(result.function_word_ratio.the).toBeCloseTo(375, 10)
    expect(result.function_word_ratio.and).toBeCloseTo(125, 10)
    expect(result.function_word_ratio.are).toBeCloseTo(125, 10)
    expect(result.function_word_ratio.of).toBe(0)
    expect(result.avg_word_length).toBeCloseTo(3.125, 10)
  })

  test("word-boundary match does not count 'the' inside 'there' or 'theme'", () => {
    const result = computeTextFingerprint("there is a theme")
    expect(result.function_word_ratio.the).toBe(0)
  })
})

describe("computeFingerprintSlopScore", () => {
  test("score is always within 0-100", () => {
    for (const text of ["", "the cat and the dog are the best", "Hello, world; wait--what? Really... yes—no."]) {
      const score = computeFingerprintSlopScore(computeTextFingerprint(text))
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  test("natural prose with a moderate em-dash rate and uneven function words scores low", () => {
    const natural =
      "The morning fog clung to the harbor — thick, grey, and cold. Gulls wheeled overhead. Somewhere a bell tolled, and the fishermen who had not yet gone out to sea watched the water with the patience of men who know it well."
    expect(computeFingerprintSlopScore(computeTextFingerprint(natural))).toBeLessThan(50)
  })

  test("total absence of em-dashes in longer prose adds to the score", () => {
    const noEmDash =
      "The morning fog clung to the harbor, thick and grey and cold. Gulls wheeled overhead. Somewhere a bell tolled, and the fishermen watched the water with patience."
    const withEmDash =
      "The morning fog clung to the harbor — thick and grey and cold. Gulls wheeled overhead. Somewhere a bell tolled, and the fishermen watched the water with patience."
    const scoreNo = computeFingerprintSlopScore(computeTextFingerprint(noEmDash))
    const scoreWith = computeFingerprintSlopScore(computeTextFingerprint(withEmDash))
    expect(scoreNo).toBeGreaterThan(scoreWith)
  })
})
