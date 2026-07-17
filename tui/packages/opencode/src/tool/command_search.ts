import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { CARD_COMMAND_REGISTRY, type CardCommandId, type CardCommandEntry } from "@opencode-ai/core/card-commands"
import DESCRIPTION from "./command_search.txt"

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export interface CommandMatch {
  id: CardCommandId
  slashName: string
  score: number
  matchedPhrase: string
}

const MIN_MATCHED_TOKENS = 2
const MIN_RATIO = 0.6

export function bestCommandMatch(
  query: string,
  registry: Record<CardCommandId, CardCommandEntry>,
): CommandMatch | undefined {
  const queryTokens = new Set(normalizeForMatch(query).split(" ").filter(Boolean))
  let best: CommandMatch | undefined

  for (const [id, entry] of Object.entries(registry) as [CardCommandId, CardCommandEntry][]) {
    const phrases = [entry.slashName, ...entry.slashAliases, entry.description, ...entry.triggerPhrases]
    for (const phrase of phrases) {
      const phraseTokens = normalizeForMatch(phrase).split(" ").filter(Boolean)
      if (phraseTokens.length === 0) continue
      const matched = phraseTokens.filter((token) => queryTokens.has(token))
      if (matched.length < MIN_MATCHED_TOKENS) continue
      const ratio = matched.length / phraseTokens.length
      if (ratio < MIN_RATIO) continue
      if (!best || ratio > best.score) {
        best = { id, slashName: entry.slashName, score: ratio, matchedPhrase: phrase }
      }
    }
  }

  return best
}

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The user's raw message, to check against the 13 known Cards-family commands.",
  }),
})

export const CommandSearchTool = Tool.define(
  "command_search",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const match = bestCommandMatch(params.query, CARD_COMMAND_REGISTRY)
        return {
          title: match ? `matched /${match.slashName}` : "no match",
          output: JSON.stringify({ query: params.query, match: match ?? null }, null, 2),
          metadata: { match: match ?? null },
        }
      }).pipe(Effect.orDie),
  }),
)
