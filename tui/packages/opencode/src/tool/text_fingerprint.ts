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
        return {
          title: `avg word ${metadata.avg_word_length.toFixed(2)} chars`,
          output: `comma ${comma.toFixed(1)}/1k · semicolon ${semicolon.toFixed(1)}/1k · em dash ${em_dash.toFixed(1)}/1k · ellipsis ${ellipsis.toFixed(1)}/1k · avg word length ${metadata.avg_word_length.toFixed(2)} chars`,
          metadata,
        }
      }).pipe(Effect.orDie),
  }),
)
