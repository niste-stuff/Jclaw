import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./card_macro_check.txt"

// Macros recognized by agent/prompt/peak.txt: {{user}}/{user}, {{char}}/{char},
// and the double-brace-only pronoun case set.
const KNOWN_DOUBLE_BRACE = new Set(["user", "char", "sub", "obj", "poss", "ref"])

interface Finding {
  type: string
  message: string
  match?: string
}

function checkText(text: string): Finding[] {
  const findings: Finding[] = []

  // Spaced double-brace macros, e.g. `{{ user }}` — not substituted by Janitor.
  const spacedRe = /\{\{\s+[^{}]*?\s+\}\}/g
  for (const m of text.matchAll(spacedRe)) {
    findings.push({
      type: "spaced_macro",
      message: "spaced placeholder — Janitor only substitutes tight `{{name}}` with no internal spaces",
      match: m[0],
    })
  }

  // Tight double-brace macros — check the name against the known set.
  const tightRe = /\{\{([a-zA-Z_]+)\}\}/g
  for (const m of text.matchAll(tightRe)) {
    const name = m[1]
    if (!KNOWN_DOUBLE_BRACE.has(name)) {
      findings.push({
        type: "unknown_macro",
        message: `unknown placeholder \`{{${name}}}\` — Janitor recognises {{user}}, {{char}}, {{sub}}, {{obj}}, {{poss}}, {{ref}}`,
        match: m[0],
      })
    }
  }

  // Single-brace macros (`{user}`/`{char}`) are a documented valid style per
  // peak.txt, so they're not flagged. Other single-brace text is left alone —
  // ordinary prose can contain `{...}` without it being a macro attempt.

  // The {{user}} -> "the user" collapse tell (peak.txt: a functional bug, not
  // a style nit — that prose won't get substituted at runtime).
  const usesUserMacro = /\{\{user\}\}|\{user\}/.test(text)
  const collapsesToProse = /\bthe user\b/i.test(text)
  if (usesUserMacro && collapsesToProse) {
    findings.push({
      type: "user_collapse",
      message:
        'uses the {{user}}/{user} macro elsewhere but also spells out "the user" as literal prose — this is a functional bug (that text will not get substituted at runtime), not just a style nit',
    })
  }

  return findings
}

export const Parameters = Schema.Struct({
  text: Schema.String.annotate({
    description: "The card or lorebook field text to check for macro issues.",
  }),
  box: Schema.optional(Schema.String).annotate({
    description: 'Optional label for the field being checked (e.g. "Scenario", "Opening Message 1"), echoed back in the report.',
  }),
})

export const CardMacroCheckTool = Tool.define(
  "card_macro_check",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const findings = checkText(params.text)
        const clean = findings.length === 0
        const summary = {
          clean,
          box: params.box,
          findings,
        }
        return {
          title: clean ? "macros clean" : `${findings.length} issue(s)`,
          output: JSON.stringify(summary, null, 2),
          metadata: summary,
        }
      }).pipe(Effect.orDie),
  }),
)
