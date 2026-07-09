import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./tokenize.txt"

export type Encoder = (text: string) => number[]
export type Encoding = "o200k_base" | "cl100k_base"

// The BPE rank tables are a few MB per encoding, so load them lazily on first
// use and cache — this keeps them off the startup path when nobody counts tokens.
const encoders = new Map<Encoding, Encoder>()

export const loadEncoder = (encoding: Encoding): Promise<Encoder> => {
  const cached = encoders.get(encoding)
  if (cached) return Promise.resolve(cached)
  const load =
    encoding === "cl100k_base"
      ? import("gpt-tokenizer/encoding/cl100k_base")
      : import("gpt-tokenizer/encoding/o200k_base")
  return load.then((mod) => {
    const encode = mod.encode as Encoder
    encoders.set(encoding, encode)
    return encode
  })
}

export const Parameters = Schema.Struct({
  text: Schema.String.annotate({
    description: "The text to count tokens for — a card section, a full card, a lorebook entry, etc.",
  }),
  encoding: Schema.Literals(["o200k_base", "cl100k_base"])
    .annotate({
      description:
        "BPE encoding: o200k_base (GPT-4o and newer, the default) or cl100k_base (GPT-3.5 / GPT-4-era). Omit to use the default.",
      default: "o200k_base",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("o200k_base" as const))),
})

export const TokenizeTool = Tool.define(
  "tokenize",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const encode = yield* Effect.promise(() => loadEncoder(params.encoding))
        const tokens = encode(params.text).length
        const characters = params.text.length
        return {
          title: `${tokens} tokens (${params.encoding})`,
          output: `${tokens} tokens · ${characters} characters · encoding ${params.encoding}`,
          metadata: { tokens, characters, encoding: params.encoding },
        }
      }).pipe(Effect.orDie),
  }),
)
