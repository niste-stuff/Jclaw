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

// Per-match weights: assistant leakage is the loudest tell (it should
// essentially never appear in in-character prose), formulaic contrast and
// stock openers are strong, essay transitions are the mildest. Score is a
// per-1000-word density, not a raw count, so a long card isn't punished just
// for length. Weights are tuned so a single match in a typical card-length
// text (a few hundred words) lands mid-range rather than saturating the clamp.
const CATEGORY_WEIGHT: Record<string, number> = {
  assistant_leakage: 25,
  formulaic_contrast: 20,
  stock_openers: 15,
  essay_transitions: 8,
}

// 0-100 slop-risk score from ghost-phrase density. Higher = more leftover
// assistant/essay-mode artifacts per 1000 words. Zero matches -> 0.
export function computeGhostSlopScore(metadata: GhostPhraseScanMetadata, text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  if (wordCount === 0 || metadata.match_count === 0) return 0
  const weighted = metadata.matches.reduce((sum, m) => sum + (CATEGORY_WEIGHT[m.category] ?? 12), 0)
  const perThousandWords = (weighted / wordCount) * 1000
  return Math.min(100, Math.round(perThousandWords))
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
        const score = computeGhostSlopScore(metadata, params.text)
        const output =
          metadata.match_count === 0
            ? "no matches found · slop-risk 0/100"
            : `${metadata.matches.map((m) => `"${m.phrase}" (${m.category})`).join("\n")}\nslop-risk ${score}/100`
        return {
          title: `${metadata.match_count} ghost phrase(s) found · slop-risk ${score}/100`,
          output,
          metadata,
        }
      }).pipe(Effect.orDie),
  }),
)
