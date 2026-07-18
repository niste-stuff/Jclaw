// tui/packages/core/src/card-commands.ts
export type CardCommandId =
  | "card"
  | "rewrite"
  | "contradictions"
  | "takes"
  | "swarm"
  | "forensics"
  | "evolve"
  | "lore"
  | "loreAdd"
  | "voice"
  | "voiceAdd"
  | "ideas"
  | "world"
  | "autopilot"

export interface CardCommandEntry {
  slashName: string
  slashAliases: string[]
  description: string
  triggerPhrases: string[]
}

export const CARD_COMMAND_REGISTRY: Record<CardCommandId, CardCommandEntry> = {
  card: {
    slashName: "card",
    slashAliases: ["newcard"],
    description: "Scaffold a new card and switch to the peak author",
    triggerPhrases: ["write me a new card", "make a new character", "start a new card", "scaffold a card"],
  },
  rewrite: {
    slashName: "rewrite",
    slashAliases: ["deslop"],
    description: "Rewrite the current card to cut AI tells and bloat",
    triggerPhrases: ["rewrite this card", "de-slop this", "clean up this card", "fix the ai tells in this"],
  },
  contradictions: {
    slashName: "contradictions",
    slashAliases: ["contradict"],
    description: "Scan the current card for internal inconsistencies",
    triggerPhrases: [
      "check this for contradictions",
      "does this card contradict itself",
      "find inconsistencies in this card",
    ],
  },
  takes: {
    slashName: "takes",
    slashAliases: ["draftswarm"],
    description: "Draft 3 distinct takes on one card section and pick your favorite",
    triggerPhrases: [
      "give me a few takes on this section",
      "show me some variants of this section",
      "draft a few options for this",
    ],
  },
  swarm: {
    slashName: "swarm",
    slashAliases: ["deepreview"],
    description: "Run a 4-lens audit (prose, lore, macros, structure) on the current card",
    triggerPhrases: ["run a review swarm on this", "give this a deep review", "really scrutinize this card"],
  },
  forensics: {
    slashName: "forensics",
    slashAliases: ["cardforensics"],
    description: "Deep statistical/bias analysis of a draft or a foreign card — not a quality check",
    triggerPhrases: ["run forensics on this", "check if this is ai slop", "analyze this for ai artifacts"],
  },
  evolve: {
    slashName: "evolve",
    slashAliases: ["refine"],
    description: "Loop draft → review → auto-fix for up to N generations, unattended (default 3)",
    triggerPhrases: [
      "run this through evolve",
      "loop this through review a few times",
      "auto-refine this card",
      "evolve this card",
    ],
  },
  lore: {
    slashName: "lore",
    slashAliases: [],
    description: "Pick lore from your library and build a card grounded in it",
    triggerPhrases: [
      "pick something from my lore library",
      "use my lore library for this",
      "grab some lore for this card",
    ],
  },
  world: {
    slashName: "world",
    slashAliases: ["worldbuild"],
    description: "Generate a cohesive world and save it to your lore library",
    triggerPhrases: ["build me a whole world", "generate a cohesive world", "let's world-build this"],
  },
  loreAdd: {
    slashName: "loreadd",
    slashAliases: ["addlore"],
    description: "Save lore into your library so you can build cards from it later",
    triggerPhrases: ["save this to my lore library", "add this lore to my library", "bank this worldbuilding"],
  },
  voiceAdd: {
    slashName: "voiceadd",
    slashAliases: ["addvoice"],
    description: "Analyze sample cards and save a reusable voice profile",
    triggerPhrases: [
      "build a voice profile from these cards",
      "learn this creator's style",
      "profile this writer's voice",
    ],
  },
  voice: {
    slashName: "voice",
    slashAliases: [],
    description: "Pick a voice profile and write new, original content in that style",
    triggerPhrases: ["write this in a saved voice", "use one of my voice profiles", "author this like niste"],
  },
  ideas: {
    slashName: "ideas",
    slashAliases: ["brainstorm"],
    description: "Brainstorm distinct idea concepts for a topic, pick one to expand or save for later",
    triggerPhrases: ["give me some fresh ideas", "brainstorm some concepts", "throw out a few angles for this"],
  },
  autopilot: {
    slashName: "autopilot",
    slashAliases: ["auto", "quick"],
    description: "Fast-track card builder using structured inputs and voice selection",
    triggerPhrases: ["autopilot card creation", "auto card generation", "speed-build a character card"],
  },
}
