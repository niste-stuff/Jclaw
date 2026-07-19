import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./text_entropy.txt"

export interface TextEntropyMetadata {
  shannon_entropy_char: number
  shannon_entropy_word: number
  avg_sentence_length: number
  sentence_length_variance: number
  repetition_rate: number
  vocabulary_richness: number
}

// Shannon entropy in bits: -sum(p_i * log2(p_i)) over a frequency distribution.
function shannonEntropy(counts: Map<string, number>, total: number): number {
  if (total === 0) return 0
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / total
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function frequency<T>(items: T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

// Split on whitespace, lowercase, strip leading/trailing punctuation per word,
// drop anything that strips down to nothing.
function words(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().replace(/^\W+|\W+$/g, ""))
    .filter((w) => w.length > 0)
}

// Split sentences on . ! ? followed by whitespace or EOF; drop empty sentences.
function sentences(text: string): string[] {
  return text
    .split(/[.!?]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const ZERO_METADATA: TextEntropyMetadata = {
  shannon_entropy_char: 0,
  shannon_entropy_word: 0,
  avg_sentence_length: 0,
  sentence_length_variance: 0,
  repetition_rate: 0,
  vocabulary_richness: 0,
}

export function computeTextEntropy(text: string): TextEntropyMetadata {
  if (text.trim().length === 0) return { ...ZERO_METADATA }

  const chars = Array.from(text)
  const shannon_entropy_char = shannonEntropy(frequency(chars), chars.length)

  const wordList = words(text)
  const shannon_entropy_word = shannonEntropy(frequency(wordList), wordList.length)

  const sentenceList = sentences(text)
  const sentenceLengths = sentenceList.map((s) => s.split(/\s+/).filter(Boolean).length)
  const avg_sentence_length =
    sentenceLengths.length === 0 ? 0 : sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
  const sentence_length_variance =
    sentenceLengths.length === 0
      ? 0
      : sentenceLengths.reduce((sum, len) => sum + (len - avg_sentence_length) ** 2, 0) / sentenceLengths.length

  let repetition_rate = 0
  if (wordList.length >= 3) {
    const trigrams: string[] = []
    for (let i = 0; i <= wordList.length - 3; i++) {
      trigrams.push(`${wordList[i]} ${wordList[i + 1]} ${wordList[i + 2]}`)
    }
    const trigramCounts = frequency(trigrams)
    let repeated = 0
    for (const count of trigramCounts.values()) {
      if (count > 1) repeated++
    }
    repetition_rate = trigrams.length === 0 ? 0 : repeated / trigrams.length
  }

  const vocabulary_richness = wordList.length === 0 ? 0 : new Set(wordList).size / wordList.length

  return {
    shannon_entropy_char,
    shannon_entropy_word,
    avg_sentence_length,
    sentence_length_variance,
    repetition_rate,
    vocabulary_richness,
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// Slop-risk sub-scores, 0-1 each, derived from the reading guidance in
// forensics-entropy.txt: low vocab richness, low sentence-length variance,
// high trigram repetition, and entropy far from a natural range are all
// tells of mechanical/formulaic text. Heuristic thresholds, not corpus-fit
// constants — expect these to move as more real cards get scored.
function vocabRichnessRisk(vocabulary_richness: number): number {
  return clamp01((0.6 - vocabulary_richness) / 0.3)
}

function sentenceVarianceRisk(sentence_length_variance: number): number {
  return clamp01((8 - sentence_length_variance) / 7)
}

function repetitionRisk(repetition_rate: number): number {
  return clamp01(repetition_rate / 0.3)
}

// U-shaped: both very low (repetitive) and very high (garbled) word entropy
// are flagged, matching forensics-entropy.txt's "both directions" guidance.
function wordEntropyRisk(shannon_entropy_word: number): number {
  if (shannon_entropy_word >= 4 && shannon_entropy_word <= 8) return 0
  const distance = shannon_entropy_word < 4 ? 4 - shannon_entropy_word : shannon_entropy_word - 8
  return clamp01(distance / 4)
}

// 0-100 slop-risk score, higher = more mechanical/formulaic-reading. A
// heuristic composite, not a verdict — same "signal, not proof" spirit as
// the forensics-fingerprint hedging rule.
export function computeEntropySlopScore(metadata: TextEntropyMetadata): number {
  const risk =
    0.25 * vocabRichnessRisk(metadata.vocabulary_richness) +
    0.25 * sentenceVarianceRisk(metadata.sentence_length_variance) +
    0.3 * repetitionRisk(metadata.repetition_rate) +
    0.2 * wordEntropyRisk(metadata.shannon_entropy_word)
  return Math.round(risk * 100)
}

export const Parameters = Schema.Struct({
  text: Schema.String.annotate({
    description: "The text to compute entropy/repetition/vocabulary statistics for.",
  }),
})

export const TextEntropyTool = Tool.define(
  "text_entropy",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const metadata = computeTextEntropy(params.text)
        const score = computeEntropySlopScore(metadata)
        return {
          title: `entropy ${metadata.shannon_entropy_word.toFixed(2)} bits/word · slop-risk ${score}/100`,
          output: `${metadata.shannon_entropy_char.toFixed(2)} bits/char · ${metadata.shannon_entropy_word.toFixed(2)} bits/word · ${metadata.avg_sentence_length.toFixed(1)} words/sentence · repetition ${(metadata.repetition_rate * 100).toFixed(1)}% · vocab richness ${metadata.vocabulary_richness.toFixed(2)} · slop-risk ${score}/100`,
          metadata,
        }
      }).pipe(Effect.orDie),
  }),
)
