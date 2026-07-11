import { describe, expect, test } from "bun:test"
import { computeTextEntropy } from "../../src/tool/text_entropy"

describe("computeTextEntropy", () => {
  test("empty text returns zeros for every field", () => {
    expect(computeTextEntropy("")).toEqual({
      shannon_entropy_char: 0,
      shannon_entropy_word: 0,
      avg_sentence_length: 0,
      sentence_length_variance: 0,
      repetition_rate: 0,
      vocabulary_richness: 0,
    })
  })

  test("whitespace-only text returns zeros for every field", () => {
    expect(computeTextEntropy("   \n\t  ")).toEqual({
      shannon_entropy_char: 0,
      shannon_entropy_word: 0,
      avg_sentence_length: 0,
      sentence_length_variance: 0,
      repetition_rate: 0,
      vocabulary_richness: 0,
    })
  })

  test("'ab' has 1 bit of character entropy (two equiprobable symbols)", () => {
    const result = computeTextEntropy("ab")
    expect(result.shannon_entropy_char).toBeCloseTo(1, 10)
  })

  test("'cat dog cat dog' has 1 bit of word entropy and matches hand-computed char entropy", () => {
    const result = computeTextEntropy("cat dog cat dog")
    // 15 chars: c,a,t,d,o,g each appear twice (2/15) and space appears three
    // times (3/15) -> -(6 * (2/15)*log2(2/15) + (3/15)*log2(3/15))
    expect(result.shannon_entropy_char).toBeCloseTo(2.789898095464288, 10)
    // words "cat","dog" each 2/4 -> -(2 * 0.5*log2(0.5)) = 1
    expect(result.shannon_entropy_word).toBeCloseTo(1, 10)
  })

  test("sentence length average and variance over three sentences of 3/2/4 words", () => {
    const result = computeTextEntropy("One two three. Four five. Six seven eight nine.")
    expect(result.avg_sentence_length).toBeCloseTo(3, 10)
    expect(result.sentence_length_variance).toBeCloseTo(0.6666666666666666, 10)
  })

  test("9 unique words: no trigram repetition and full vocabulary richness", () => {
    const result = computeTextEntropy("One two three. Four five. Six seven eight nine.")
    expect(result.repetition_rate).toBe(0)
    expect(result.vocabulary_richness).toBeCloseTo(1, 10)
  })

  test("'the cat sat' repeated 3x: all 7 trigrams repeat, vocab richness 1/3", () => {
    const result = computeTextEntropy("the cat sat the cat sat the cat sat")
    expect(result.repetition_rate).toBeCloseTo(1, 10)
    expect(result.vocabulary_richness).toBeCloseTo(0.3333333333333333, 10)
  })

  test("fewer than 3 words total gives 0 repetition_rate", () => {
    const result = computeTextEntropy("hello world")
    expect(result.repetition_rate).toBe(0)
  })

  test("no sentence punctuation still counts one sentence", () => {
    const result = computeTextEntropy("aaaa")
    expect(result.avg_sentence_length).toBe(1)
    expect(result.sentence_length_variance).toBe(0)
    expect(result.shannon_entropy_word).toBe(0)
  })
})
