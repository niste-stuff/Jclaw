import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./ghost_phrase_scan.txt"

// Curated, categorized phrase list for spotting AI-generation "tells" in
// prose. Literal phrases are scanned per-category with a case-insensitive
// word-boundary regex; formulaic_contrast is a shape, not a phrase list, so
// it gets its own pattern regex instead.
const PHRASE_CATEGORIES: Record<string, string[]> = {
  assistant_leakage: ["as an AI", "I cannot and will not", "I'd be happy to", "certainly!", "as a language model"],
  essay_transitions: ["moreover", "furthermore", "in conclusion", "it's important to note"],
  stock_openers: ["let's dive into", "picture this", "imagine a world where"],
}

// "it's not (just|only) X, it's Y" — the formulaic-contrast sentence shape.
const FORMULAIC_CONTRAST_RE = /it'?s not (?:just |only )?[^.!?]+,\s*it'?s\s+[^.!?]+/gi

export interface GhostPhraseMatch {
  phrase: string
  category: string
  index: number
}

export interface GhostPhraseScanMetadata {
  matches: GhostPhraseMatch[]
  match_count: number
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Word-boundary regex for a literal phrase — only anchor `\b` on an edge that
// is actually a word character (e.g. "certainly!" ends in punctuation, so a
// trailing `\b` there would be meaningless).
function phraseRegex(phrase: string): RegExp {
  const escaped = escapeRegExp(phrase)
  const startsWord = /\w/.test(phrase[0] ?? "")
  const endsWord = /\w/.test(phrase[phrase.length - 1] ?? "")
  const pattern = `${startsWord ? "\\b" : ""}${escaped}${endsWord ? "\\b" : ""}`
  return new RegExp(pattern, "gi")
}

export function scanGhostPhrases(text: string): GhostPhraseScanMetadata {
  const matches: GhostPhraseMatch[] = []

  for (const [category, phrases] of Object.entries(PHRASE_CATEGORIES)) {
    for (const phrase of phrases) {
      const re = phraseRegex(phrase)
      for (const m of text.matchAll(re)) {
        matches.push({ phrase, category, index: m.index })
      }
    }
  }

  for (const m of text.matchAll(FORMULAIC_CONTRAST_RE)) {
    matches.push({ phrase: m[0], category: "formulaic_contrast", index: m.index })
  }

  matches.sort((a, b) => a.index - b.index)

  return { matches, match_count: matches.length }
}

export const Parameters = Schema.Struct({
  text: Schema.String.annotate({
    description: "The text to scan for AI-generation \"ghost phrases\" (assistant leakage, stock transitions/openers, formulaic contrast sentences).",
  }),
})

export const GhostPhraseScanTool = Tool.define(
  "ghost_phrase_scan",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const metadata = scanGhostPhrases(params.text)
        const output =
          metadata.match_count === 0
            ? "no matches found"
            : metadata.matches.map((m) => `"${m.phrase}" (${m.category})`).join("\n")
        return {
          title: `${metadata.match_count} ghost phrase(s) found`,
          output,
          metadata,
        }
      }).pipe(Effect.orDie),
  }),
)
