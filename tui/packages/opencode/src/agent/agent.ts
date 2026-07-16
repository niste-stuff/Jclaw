import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Config } from "@/config/config"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Provider } from "@/provider/provider"

import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_PEAK from "./prompt/peak.txt"
import PROMPT_BUILD from "./prompt/build.txt"
import PROMPT_WORLDSMITH from "./prompt/worldsmith.txt"
import PROMPT_REVIEW from "./prompt/review.txt"
import PROMPT_REVIEW_PROSE from "./prompt/review-prose.txt"
import PROMPT_REVIEW_LORE from "./prompt/review-lore.txt"
import PROMPT_REVIEW_MACROS from "./prompt/review-macros.txt"
import PROMPT_REVIEW_STRUCTURE from "./prompt/review-structure.txt"
import PROMPT_REVIEW_SWARM from "./prompt/review-swarm.txt"
import PROMPT_FORENSICS_ENTROPY from "./prompt/forensics-entropy.txt"
import PROMPT_FORENSICS_FINGERPRINT from "./prompt/forensics-fingerprint.txt"
import PROMPT_FORENSICS_GHOST from "./prompt/forensics-ghost.txt"
import PROMPT_FORENSICS_BIAS from "./prompt/forensics-bias.txt"
import PROMPT_FORENSICS_SWARM from "./prompt/forensics-swarm.txt"
import PROMPT_SECTION_DRAFT from "./prompt/section-draft.txt"
import PROMPT_DRAFT_SWARM from "./prompt/draft-swarm.txt"
import PROMPT_VOICE_PROFILER from "./prompt/voice-profiler.txt"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { fileURLToPath } from "url"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { AbsolutePath, type DeepMutable } from "@opencode-ai/core/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Reference } from "@opencode-ai/core/reference"
import { Location } from "@opencode-ai/core/location"
import { PluginV2 } from "@opencode-ai/core/plugin"

// Confirmed-working reference lorebook (constant hub + cascading entries),
// read on demand by peak/build rather than embedded in their prompts — keeps
// the ~5k-token example out of the permanent per-turn cost.
const LOREBOOK_EXAMPLE_PATH = fileURLToPath(new URL("./prompt/reference/lorebook-example.json", import.meta.url))

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: PermissionV1.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelV2.ID,
      providerID: ProviderV2.ID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
}).annotate({ identifier: "Agent" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String,
  whenToUse: Schema.String,
  systemPrompt: Schema.String,
})

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultInfo: () => Effect.Effect<Info>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  }) => Effect.Effect<
    {
      identifier: string
      whenToUse: string
      systemPrompt: string
    },
    Provider.DefaultModelError
  >
}

type State = Omit<Interface, "generate">

export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service
    const locations = yield* LocationServiceMap.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const referenceDirs = Object.keys(cfg.references ?? cfg.reference ?? {}).length
          ? yield* Effect.gen(function* () {
              yield* (yield* PluginV2.Service).wait(PluginV2.ID.make("core/config-reference"))
              return (yield* (yield* Reference.Service).list()).map((reference) => reference.path)
            }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
          : []
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
          ...referenceDirs.map((dir) => path.join(dir, "*")),
        ]
        const readonlyExternalDirectory = {
          "*": "ask",
          ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
        } satisfies Record<string, "allow" | "ask" | "deny">

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          peak_enter: "deny",
          worldsmith_enter: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          build: {
            name: "build",
            description: "The default agent. Manages your card library and handles everyday tasks.",
            options: {},
            prompt: PROMPT_BUILD.replaceAll("{{LOREBOOK_EXAMPLE_PATH}}", LOREBOOK_EXAMPLE_PATH),
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                worldsmith_enter: "allow",
                external_directory: {
                  [path.join(Global.Path.lore, "*")]: "allow",
                  [LOREBOOK_EXAMPLE_PATH]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          "lore planning": {
            name: "lore planning",
            description: "Lore planning mode. Brainstorm character lore, personality, and appearance. Disallows edits.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                peak_enter: "allow",
                task: {
                  general: "deny",
                },
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                  [path.join(Global.Path.lore, "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".opencode", "plans", "*.md")]: "allow",
                  [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          peak: {
            name: "peak",
            description:
              "Write peak character cards — no AI tells, no clichés, with a strong hook that pulls the user into the scene.",
            options: {},
            prompt: PROMPT_PEAK.replaceAll("{{LOREBOOK_EXAMPLE_PATH}}", LOREBOOK_EXAMPLE_PATH),
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                worldsmith_enter: "allow",
                external_directory: {
                  [path.join(Global.Path.lore, "*")]: "allow",
                  [LOREBOOK_EXAMPLE_PATH]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          worldsmith: {
            name: "worldsmith",
            description:
              "Author cohesive, internally consistent worlds and save them to your lore library for cards to be built from.",
            options: {},
            prompt: PROMPT_WORLDSMITH,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                external_directory: {
                  [path.join(Global.Path.lore, "*")]: "allow",
                },
                task: {
                  "*": "deny",
                  peak: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          review: {
            name: "review",
            description: `Independent critic for character cards and lorebook entries. Hand it a finished draft (a full card, one box, or a lorebook entry/hub) and it reports concrete problems against jclaw's card-quality bar — it never rewrites or edits, only reports findings.`,
            prompt: PROMPT_REVIEW,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                tokenize: "allow",
                card_budget: "allow",
                card_macro_check: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          "review-prose": {
            name: "review-prose",
            description: `Review-swarm lens: prose/craft quality and AI-tells. Findings only, no rewrites.`,
            prompt: PROMPT_REVIEW_PROSE,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "review-lore": {
            name: "review-lore",
            description: `Review-swarm lens: cross-box and cross-file lore/lorebook consistency. Findings only, no rewrites.`,
            prompt: PROMPT_REVIEW_LORE,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "review-macros": {
            name: "review-macros",
            description: `Review-swarm lens: {{user}}/{{char}} macro correctness. Findings only, no rewrites.`,
            prompt: PROMPT_REVIEW_MACROS,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                card_macro_check: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "review-structure": {
            name: "review-structure",
            description: `Review-swarm lens: structural correctness and token economics. Findings only, no rewrites.`,
            prompt: PROMPT_REVIEW_STRUCTURE,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                tokenize: "allow",
                card_budget: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "review-swarm": {
            name: "review-swarm",
            description: `Deep multi-lens review pass for character cards and lorebook entries. Fans a draft out to whichever specialist critics apply (prose, lore, macros, structure) in parallel and merges their findings into one report. Findings only, no rewrites. Use for an explicit deep-audit request; use "review" for the routine quick self-check.`,
            prompt: PROMPT_REVIEW_SWARM,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                task: {
                  "*": "deny",
                  "review-prose": "allow",
                  "review-lore": "allow",
                  "review-macros": "allow",
                  "review-structure": "allow",
                },
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          "forensics-entropy": {
            name: "forensics-entropy",
            description: `Forensics-swarm lens: statistical entropy signature (Shannon entropy, sentence-length variance, repetition rate, vocabulary richness). Findings only, no rewrites.`,
            prompt: PROMPT_FORENSICS_ENTROPY,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                text_entropy: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "forensics-fingerprint": {
            name: "forensics-fingerprint",
            description: `Forensics-swarm lens: stylistic fingerprint (punctuation density, function-word distribution, average word length). Findings only, no rewrites.`,
            prompt: PROMPT_FORENSICS_FINGERPRINT,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                text_fingerprint: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "forensics-ghost": {
            name: "forensics-ghost",
            description: `Forensics-swarm lens: leftover training-data patterns and assistant-mode/essay-mode leakage. Findings only, no rewrites.`,
            prompt: PROMPT_FORENSICS_GHOST,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                ghost_phrase_scan: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "forensics-bias": {
            name: "forensics-bias",
            description: `Forensics-swarm lens: demographic/stereotype/ideological bias observations, no tool call. Findings only, no rewrites.`,
            prompt: PROMPT_FORENSICS_BIAS,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "forensics-swarm": {
            name: "forensics-swarm",
            description: `Forensic (not quality) analysis pass for text — a card draft or a foreign/pasted card. Fans out to 4 fixed lenses in parallel (entropy, stylistic fingerprint, ghost/leftover-training-data content, bias) and reports each lens's findings under its own heading. Findings only, no rewrites. Works on the calling agent's own draft or on any text/foreign card the user hands over for diagnosis.`,
            prompt: PROMPT_FORENSICS_SWARM,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                task: {
                  "*": "deny",
                  "forensics-entropy": "allow",
                  "forensics-fingerprint": "allow",
                  "forensics-ghost": "allow",
                  "forensics-bias": "allow",
                },
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          "section-draft": {
            name: "section-draft",
            description: `Draft-swarm worker: writes one distinct-angle variant of a single card section (not a whole card). One variant per call, no self-critique, no rewrites of anything else.`,
            prompt: PROMPT_SECTION_DRAFT,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          "draft-swarm": {
            name: "draft-swarm",
            description: `Multiple-takes drafting pass for a single card section (Scenario, Personality, one Opening Message, or Example Dialogue). Fans out to parallel section-draft workers, each given a distinct creative angle, and shows every variant in full so the user can pick or modify one. Use for "give me a few options for X" — not a whole-card rewrite.`,
            prompt: PROMPT_DRAFT_SWARM,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                task: {
                  "*": "deny",
                  "section-draft": "allow",
                },
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          "voice-profiler": {
            name: "voice-profiler",
            description: `Extracts a creator's writing voice (box-formatting conventions, macro/pronoun habits, prose register) from sample cards handed to it inline, and returns a reusable profile document. Never authors content, never quotes samples at length.`,
            prompt: PROMPT_VOICE_PROFILER,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            hidden: true,
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[agent]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultInfo = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            const agent = agents[c.default_agent]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent
          }
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          return (yield* defaultInfo()).name
        })

        return {
          get,
          list,
          defaultInfo,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultInfo: Effect.fn("Agent.defaultInfo")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultInfo())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(GeneratedAgent),
            Schema.toStandardJSONSchemaV1(GeneratedAgent),
          ),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, Auth.node, Plugin.node, Skill.node, Provider.node, locationServiceMapNode],
})

export * as Agent from "./agent"
