import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import PEAK_ENTER_DESCRIPTION from "./peak-enter.txt"
import WORLDSMITH_ENTER_DESCRIPTION from "./worldsmith-enter.txt"

export const Parameters = Schema.Struct({})

interface SwitchToolConfig {
  /** Tool id passed to Tool.define */
  id: string
  /** Description text loaded from the sibling .txt file */
  description: string
  /** Target agent name written to the synthetic user message */
  targetAgent: string
  /** Question header shown in the Yes/No prompt */
  header: string
  /**
   * Builds the question prompt. `plan` is the worktree-relative plan path,
   * only resolved when `needsPlan` is true (undefined otherwise).
   */
  question: (plan: string | undefined) => string
  /** Description for the "Yes" option */
  yesDescription: string
  /** Description for the "No" option */
  noDescription: string
  /**
   * Builds the synthetic message text. `plan` is only defined when
   * `needsPlan` is true.
   */
  text: (plan: string | undefined) => string
  /** Title returned from a successful switch */
  title: string
  /** Output returned from a successful switch */
  output: string
  /** When true, resolve the worktree-relative plan path before asking */
  needsPlan?: boolean
}

const makeSwitchTool = (config: SwitchToolConfig) =>
  Tool.define(
    config.id,
    Effect.gen(function* () {
      const session = yield* Session.Service
      const question = yield* Question.Service
      const provider = yield* Provider.Service

      return {
        description: config.description,
        parameters: Parameters,
        execute: (_params: {}, ctx: Tool.Context) =>
          Effect.gen(function* () {
            let plan: string | undefined
            if (config.needsPlan) {
              const instance = yield* InstanceState.context
              const info = yield* session.get(ctx.sessionID)
              plan = path.relative(instance.worktree, Session.plan(info, instance))
            }

            const answers = yield* question.ask({
              sessionID: ctx.sessionID,
              questions: [
                {
                  question: config.question(plan),
                  header: config.header,
                  custom: false,
                  options: [
                    { label: "Yes", description: config.yesDescription },
                    { label: "No", description: config.noDescription },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })

            if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

            const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
            const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
            const model =
              lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

            const msg: SessionV1.User = {
              id: MessageID.ascending(),
              sessionID: ctx.sessionID,
              role: "user",
              time: { created: Date.now() },
              agent: config.targetAgent,
              model,
            }
            yield* session.updateMessage(msg)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: ctx.sessionID,
              type: "text",
              text: config.text(plan),
              synthetic: true,
            } satisfies SessionV1.TextPart)

            return {
              title: config.title,
              output: config.output,
              metadata: {},
            }
          }).pipe(Effect.orDie),
      }
    }),
  )

export const PlanExitTool = makeSwitchTool({
  id: "plan_exit",
  description: EXIT_DESCRIPTION,
  targetAgent: "build",
  header: "Build Agent",
  question: (plan) => `Character plan at ${plan} is complete. Switch to the build agent to start writing the card?`,
  yesDescription: "Switch to build agent and start writing the card",
  noDescription: "Stay in lore planning to keep refining the plan",
  text: (plan) => `The plan at ${plan} has been approved, you can now edit files. Write the card from the plan`,
  title: "Switching to build agent",
  output: "User approved switching to build agent. Wait for further instructions.",
  needsPlan: true,
})

export const PlanEnterTool = makeSwitchTool({
  id: "plan_enter",
  description: ENTER_DESCRIPTION,
  targetAgent: "lore planning",
  header: "Lore Planning",
  question: () => "Switch to the lore planning agent to brainstorm and develop this character before writing the card?",
  yesDescription: "Switch to lore planning to brainstorm the character",
  noDescription: "Stay here and keep working",
  text: () => "Let's brainstorm and develop this character before writing the card.",
  title: "Switching to lore planning agent",
  output: "User approved switching to lore planning agent. Wait for further instructions.",
})

export const PeakEnterTool = makeSwitchTool({
  id: "peak_enter",
  description: PEAK_ENTER_DESCRIPTION,
  targetAgent: "peak",
  header: "Peak Agent",
  question: () => "Ready to build a card from this idea? Switch to the peak agent?",
  yesDescription: "Switch to peak and start drafting the card",
  noDescription: "Stay here for now",
  text: () => "Let's develop a card from this idea.",
  title: "Switching to peak agent",
  output: "User approved switching to peak agent. Wait for further instructions.",
})

export const WorldsmithEnterTool = makeSwitchTool({
  id: "worldsmith_enter",
  description: WORLDSMITH_ENTER_DESCRIPTION,
  targetAgent: "worldsmith",
  header: "Worldsmith Agent",
  question: () => "Sounds like a whole world, not just one character. Switch to the worldsmith agent?",
  yesDescription: "Switch to worldsmith and start authoring the world",
  noDescription: "Stay here for now",
  text: () => "Let's build this out as a whole world.",
  title: "Switching to worldsmith agent",
  output: "User approved switching to worldsmith agent. Wait for further instructions.",
})
