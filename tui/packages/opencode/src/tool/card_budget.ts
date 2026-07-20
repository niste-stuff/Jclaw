import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { loadEncoder, type Encoding } from "./tokenize"
import DESCRIPTION from "./card_budget.txt"

// Bands from agent/prompt/peak.txt's "Token economics" and "Lorebooks" sections.
// Keep these in sync if that prompt's numbers ever change.
const PERMANENT_SWEET_MIN = 2000
const PERMANENT_SWEET_MAX = 3000
const PERMANENT_LOREPACKED_MAX = 6000
const PERMANENT_BLOATED_MIN = 7000

const HUB_AIM_MAX = 300
const HUB_CEILING = 1000

const ENTRY_SOFT_MAX = 300
const ENTRY_HARD_MAX = 400

function permanentBand(tokens: number): { band: string; flag?: string } {
  if (tokens < PERMANENT_SWEET_MIN) {
    return {
      band: "under_specified",
      flag: `permanent definition (Scenario+Personality) is ~${tokens} tokens — under the 2k-3k sweet spot, usually means the card is under-specified`,
    }
  }
  if (tokens <= PERMANENT_SWEET_MAX) {
    return { band: "sweet_spot" }
  }
  if (tokens <= PERMANENT_LOREPACKED_MAX) {
    return {
      band: "lorepacked_range",
      flag: `permanent definition is ~${tokens} tokens — above the 2k-3k sweet spot; fine if genuinely lorepacked (dense, non-redundant), otherwise trim or move situational lore to a lorebook`,
    }
  }
  if (tokens < PERMANENT_BLOATED_MIN) {
    return {
      band: "approaching_bloat",
      flag: `permanent definition is ~${tokens} tokens — past the healthy band (especially past 6k); consider proposing a lorebook to offload reference lore`,
    }
  }
  return {
    band: "bloated",
    flag: `permanent definition is ~${tokens} tokens — bloated territory (7k+); look for repetition or generic filler, and propose a lorebook for reference lore`,
  }
}

function hubBand(tokens: number): { band: string; flag?: string } {
  if (tokens <= HUB_AIM_MAX) return { band: "within_aim" }
  if (tokens < HUB_CEILING) {
    return {
      band: "above_aim_below_ceiling",
      flag: `lorebook hub is ~${tokens} tokens — above the ~200-300 aim but still under the ~1000 ceiling`,
    }
  }
  return {
    band: "over_ceiling",
    flag: `lorebook hub is ~${tokens} tokens — at or over the ~1000 token ceiling for a hub entry; trim`,
  }
}

function entryBand(tokens: number): { band: string; flag?: string } {
  if (tokens <= ENTRY_SOFT_MAX) return { band: "within_soft" }
  if (tokens <= ENTRY_HARD_MAX) {
    return {
      band: "above_soft_within_hard",
      flag: `lorebook entry is ~${tokens} tokens — above the ~300 soft target, within the ~400 hard cap`,
    }
  }
  return {
    band: "over_hard",
    flag: `lorebook entry is ~${tokens} tokens — over the ~400 hard cap; trim`,
  }
}

export const Parameters = Schema.Struct({
  scenario: Schema.optional(Schema.String).annotate({
    description: "The card's Scenario box text, if checking permanent-field budget.",
  }),
  personality: Schema.optional(Schema.String).annotate({
    description: "The card's Personality box text, if checking permanent-field budget.",
  }),
  lorebook_hub: Schema.optional(Schema.String).annotate({
    description: "A lorebook's constant:true hub entry content, if checking it.",
  }),
  lorebook_entry: Schema.optional(Schema.String).annotate({
    description: "A single lorebook conditional (constant:false) entry's content, if checking it.",
  }),
  encoding: Schema.Literals(["o200k_base", "cl100k_base"])
    .annotate({
      description: "BPE encoding to count with. Omit to use the default (o200k_base).",
      default: "o200k_base",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("o200k_base" as const))),
})

export const CardBudgetTool = Tool.define(
  "card_budget",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const encode = yield* Effect.promise(() => loadEncoder(params.encoding as Encoding))
        const count = (text: string) => encode(text).length

        const flags: string[] = []
        const perField: Record<string, number> = {}

        let permanentTokens: number | undefined
        if (params.scenario !== undefined || params.personality !== undefined) {
          const scenarioTokens = params.scenario !== undefined ? count(params.scenario) : 0
          const personalityTokens = params.personality !== undefined ? count(params.personality) : 0
          if (params.scenario !== undefined) perField.scenario = scenarioTokens
          if (params.personality !== undefined) perField.personality = personalityTokens
          permanentTokens = scenarioTokens + personalityTokens
          const { flag } = permanentBand(permanentTokens)
          if (flag) flags.push(flag)
        }

        let hubTokens: number | undefined
        if (params.lorebook_hub !== undefined) {
          hubTokens = count(params.lorebook_hub)
          perField.lorebook_hub = hubTokens
          const { flag } = hubBand(hubTokens)
          if (flag) flags.push(flag)
        }

        let entryTokens: number | undefined
        if (params.lorebook_entry !== undefined) {
          entryTokens = count(params.lorebook_entry)
          perField.lorebook_entry = entryTokens
          const { flag } = entryBand(entryTokens)
          if (flag) flags.push(flag)
        }

        const withinBudget = flags.length === 0
        const summary = {
          within_budget: withinBudget,
          encoding: params.encoding,
          per_field_tokens: perField,
          flags,
        }

        return {
          title: withinBudget ? "within budget" : `${flags.length} flag(s)`,
          output: JSON.stringify(summary, null, 2),
          metadata: summary,
        }
      }).pipe(Effect.orDie),
  }),
)
