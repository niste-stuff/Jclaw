import { describe, expect, test } from "bun:test"
import { computeTextFingerprint } from "../../src/tool/text_fingerprint"

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
