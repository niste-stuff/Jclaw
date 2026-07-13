import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./text_fingerprint.txt"

const FUNCTION_WORDS = [
  "the",
  "and",
  "of",
  "to",
  "a",
  "in",
  "is",
  "that",
  "it",
  "with",
  "for",
  "as",
  "was",
  "on",
  "are",
] as const

export interface TextFingerprintMetadata {
  punctuation_density: {
    comma: number
    semicolon: number
    em_dash: number
    ellipsis: number
  }
  function_word_ratio: Record<(typeof FUNCTION_WORDS)[number], number>
  avg_word_length: number
}

// Split on whitespace, lowercase, strip leading/trailing punctuation per word,
// drop anything that strips down to nothing. Mirrors text_entropy.ts's
// tokenization so the two tools agree on what counts as a "word" — kept as a
// local copy (rather than a shared import) so each tool file stays self-contained.
function words(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().replace(/^\W+|\W+$/g, ""))
    .filter((w) => w.length > 0)
}

function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0
}

function perThousand(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 1000
}

export function computeTextFingerprint(text: string): TextFingerprintMetadata {
  const totalChars = text.length

  const commaCount = countMatches(text, /,/g)
  const semicolonCount = countMatches(text, /;/g)
  const emDashCount = countMatches(text, /—|--/g)
  const ellipsisCount = countMatches(text, /…|\.\.\./g)

  const punctuation_density = {
    comma: perThousand(commaCount, totalChars),
    semicolon: perThousand(semicolonCount, totalChars),
    em_dash: perThousand(emDashCount, totalChars),
    ellipsis: perThousand(ellipsisCount, totalChars),
  }

  const wordList = words(text)
  const totalWords = wordList.length

  const function_word_ratio = Object.fromEntries(
    FUNCTION_WORDS.map((word) => {
      const re = new RegExp(`\\b${word}\\b`, "gi")
      const count = countMatches(text, re)
      return [word, perThousand(count, totalWords)]
    }),
  ) as TextFingerprintMetadata["function_word_ratio"]

  const avg_word_length =
    totalWords === 0 ? 0 : wordList.reduce((sum, w) => sum + w.length, 0) / totalWords

  return { punctuation_density, function_word_ratio, avg_word_length }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// Em-dash density is a widely-noted LLM signature at BOTH extremes
// (forensics-fingerprint.txt): heavy use is the classic tell, but near-total
// absence in longer prose is also flagged. Natural em-dash density sits
// roughly 0.5-3 per 1000 chars; risk climbs outside that band.
function emDashRisk(em_dash: number): number {
  if (em_dash >= 0.5 && em_dash <= 3) return 0
  const distance = em_dash < 0.5 ? 0.5 - em_dash : em_dash - 3
  const scale = em_dash < 0.5 ? 0.5 : 5
  return clamp01(distance / scale)
}

// A flat/uniform function-word distribution reads as mechanical; natural
// language has an uneven spread. Use the coefficient of variation of the
// function-word ratios — low spread means high risk.
function functionWordFlatnessRisk(ratios: Record<string, number>): number {
  const values = Object.values(ratios)
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  const coefficientOfVariation = Math.sqrt(variance) / mean
  // A healthy natural spread has CV around 1.0+; flatter than ~0.6 is a tell.
  return clamp01((0.6 - coefficientOfVariation) / 0.6)
}

// Average word length far from natural conversational prose (~4-5.5 chars)
// in either direction — unusually formal or unusually simple — is a mention.
function wordLengthRisk(avg_word_length: number): number {
  if (avg_word_length >= 4 && avg_word_length <= 5.5) return 0
  const distance = avg_word_length < 4 ? 4 - avg_word_length : avg_word_length - 5.5
  return clamp01(distance / 2)
}

// 0-100 slop-risk score, higher = more mechanically uniform stylistic
// fingerprint. Heuristic composite, never a "this was written by AI" verdict
// — one signal, hedged, per the forensics-fingerprint rule.
export function computeFingerprintSlopScore(metadata: TextFingerprintMetadata): number {
  const risk =
    0.4 * emDashRisk(metadata.punctuation_density.em_dash) +
    0.4 * functionWordFlatnessRisk(metadata.function_word_ratio) +
    0.2 * wordLengthRisk(metadata.avg_word_length)
  return Math.round(risk * 100)
}

export const Parameters = Schema.Struct({
  text: Schema.String.annotate({
    description: "The text to compute punctuation-density, function-word, and word-length statistics for.",
  }),
})

export const TextFingerprintTool = Tool.define(
  "text_fingerprint",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const metadata = computeTextFingerprint(params.text)
        const { comma, semicolon, em_dash, ellipsis } = metadata.punctuation_density
        const score = computeFingerprintSlopScore(metadata)
        return {
          title: `avg word ${metadata.avg_word_length.toFixed(2)} chars · slop-risk ${score}/100`,
          output: `comma ${comma.toFixed(1)}/1k · semicolon ${semicolon.toFixed(1)}/1k · em dash ${em_dash.toFixed(1)}/1k · ellipsis ${ellipsis.toFixed(1)}/1k · avg word length ${metadata.avg_word_length.toFixed(2)} chars · slop-risk ${score}/100`,
          metadata,
        }
      }).pipe(Effect.orDie),
  }),
)
