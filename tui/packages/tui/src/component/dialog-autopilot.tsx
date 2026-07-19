import { TextareaRenderable, TextAttributes, RGBA } from "@opentui/core"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useProject } from "../context/project"
import { useBindings } from "../keymap"
import { createEffect, onCleanup, onMount, Show, For } from "solid-js"
import { createStore } from "solid-js/store"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { Spinner } from "./spinner"
import path from "node:path"

const VOICE_EXTS = new Set([".md", ".txt", ".json"])
const VOICE_DIR = path.join(Global.Path.lore, "voices")

type Step = "inputs" | "contradiction" | "loading" | "voice_select" | "preview"
type Age = "20s" | "30s" | "40s+" | "skip"
type ActiveField = "premise" | "age" | "setting" | "detail" | "submit" | "skipAll" | "explanation" | "explainSubmit"

interface VoiceEntry {
  name: string
  path: string
}

interface VoiceCandidate {
  name: string
  path?: string
  isSuggested: boolean
}

export interface DialogAutopilotProps {
  initialPremise: string
  onGenerate: (prompt: string, agent: string) => void
}

const AGE_OPTIONS: Age[] = ["20s", "30s", "40s+", "skip"]
const INPUT_FIELDS: ActiveField[] = ["premise", "age", "setting", "detail", "submit", "skipAll"]

// Fast-track card builder: user gives a 1-2 word premise plus optional
// age/setting/detail, a background model call fills blanks and flags
// contradictions (looping with the user to resolve them), suggests 2-3
// voices matched against the real voices/ library, then on pick hands off
// to peak via onGenerate — mirroring the fillPrompt(prompt, "peak") pattern
// used by dialog-lore.tsx/dialog-voice.tsx. Background model turns run on a
// disposable session (created here, deleted once the card prompt is handed
// off) so the contradiction back-and-forth never pollutes the user's actual
// chat history — only the final peak generation call does.
export function DialogAutopilot(props: DialogAutopilotProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const local = useLocal()
  const sdk = useSDK()
  const project = useProject()

  let premiseTextarea: TextareaRenderable | undefined
  let settingTextarea: TextareaRenderable | undefined
  let detailTextarea: TextareaRenderable | undefined
  let explanationTextarea: TextareaRenderable | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined

  const [store, setStore] = createStore({
    step: "inputs" as Step,
    premise: props.initialPremise,
    age: "skip" as Age,
    setting: "",
    detail: "",
    active: (props.initialPremise ? "age" : "premise") as ActiveField,

    contradictionText: "",
    explanation: "",
    tempSessionID: undefined as string | undefined,

    filledAge: "",
    filledSetting: "",
    filledDetail: "",
    suggestedVoiceNames: [] as string[],
    chosenVoiceName: "",
    chosenVoicePath: "",

    voicesList: [] as VoiceEntry[],
    activeVoiceIndex: 0,
    busyText: "Working...",
    errorText: "",
  })

  const isLoading = () => store.step === "loading"

  // Fire-and-forget guard for async handlers invoked from keybindings/mouse
  // handlers: surfaces any otherwise-unhandled rejection into errorText instead
  // of dropping it as an unhandled promise rejection.
  function run(promise: Promise<unknown>) {
    void promise.catch((error) => {
      setStore("errorText", error instanceof Error ? error.message : "Something went wrong")
    })
  }

  function voicesToDisplay(): VoiceCandidate[] {
    const list: VoiceCandidate[] = []
    for (const suggested of store.suggestedVoiceNames) {
      const match = store.voicesList.find(
        (v) =>
          v.name.toLowerCase() === suggested.toLowerCase() ||
          v.name.toLowerCase().includes(suggested.toLowerCase()) ||
          suggested.toLowerCase().includes(v.name.toLowerCase()),
      )
      if (match) list.push({ name: match.name, path: match.path, isSuggested: true })
      else list.push({ name: suggested, isSuggested: true })
    }
    for (const voice of store.voicesList) {
      if (!list.some((entry) => entry.name.toLowerCase() === voice.name.toLowerCase())) {
        list.push({ name: voice.name, path: voice.path, isSuggested: false })
      }
    }
    if (list.length === 0) list.push({ name: "Default peak style", isSuggested: false })
    return list
  }

  // Admits a prompt on a disposable session, then polls messages until the
  // last entry is a completed assistant turn. session.prompt is a durable
  // async admit (schedules the agent loop, doesn't block), so there's no
  // synchronous "wait for result" endpoint to call instead.
  async function runModelTurn(sessionID: string, promptText: string): Promise<string> {
    await sdk.client.session.prompt({ sessionID, parts: [{ type: "text", text: promptText }] }, { throwOnError: true })

    const maxAttempts = 120
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const res = await sdk.client.session.messages({ sessionID }, { throwOnError: true })
      const entries = res.data ?? []
      const last = entries.at(-1)
      if (last && last.info.role === "assistant" && last.info.time.completed) {
        if (last.info.error) {
          const message = last.info.error.data.message
          throw new Error(typeof message === "string" && message ? message : "Model turn failed")
        }
        return last.parts
          .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("")
      }
    }
    throw new Error("Model turn timed out")
  }

  function parseModelJSON(responseText: string): {
    contradiction?: string | null
    filled?: { age?: string; setting?: string; detail?: string }
    voices?: string[]
  } {
    const fenced = responseText.match(/```json\s*([\s\S]*?)\s*```/)
    const raw = fenced ? fenced[1] : (responseText.match(/\{[\s\S]*\}/) ?? [])[0]
    if (!raw) throw new Error("No JSON object found in model response")
    return JSON.parse(raw)
  }

  function applyModelResult(responseText: string) {
    try {
      const data = parseModelJSON(responseText)
      if (data.contradiction) {
        setStore("contradictionText", data.contradiction)
        setStore("step", "contradiction")
        setStore("active", "explanation")
        if (focusTimer) clearTimeout(focusTimer)
        focusTimer = setTimeout(() => {
          focusTimer = undefined
          explanationTextarea?.focus()
        }, 1)
        return
      }
      setStore("filledAge", data.filled?.age ?? (store.age === "skip" ? "" : store.age))
      setStore("filledSetting", data.filled?.setting ?? store.setting)
      setStore("filledDetail", data.filled?.detail ?? store.detail)
      setStore("suggestedVoiceNames", data.voices ?? [])
      setStore("activeVoiceIndex", 0)
      setStore("step", "voice_select")
    } catch (error) {
      setStore("errorText", error instanceof Error ? error.message : "Failed to parse model response")
      setStore("step", store.contradictionText ? "contradiction" : "inputs")
    }
  }

  async function cleanupSession() {
    const sessionID = store.tempSessionID
    if (!sessionID) return
    setStore("tempSessionID", undefined)
    await sdk.client.session.delete({ sessionID }).catch(() => {})
  }

  async function handleSubmit(skipAll: boolean) {
    if (isLoading()) return
    const finalPremise = (premiseTextarea?.plainText ?? store.premise).trim()
    if (!finalPremise) {
      setStore("errorText", "Premise is required.")
      setStore("active", "premise")
      return
    }
    const finalAge: Age = skipAll ? "skip" : store.age
    const finalSetting = skipAll ? "" : (settingTextarea?.plainText ?? store.setting).trim()
    const finalDetail = skipAll ? "" : (detailTextarea?.plainText ?? store.detail).trim()

    setStore({
      premise: finalPremise,
      age: finalAge,
      setting: finalSetting,
      detail: finalDetail,
      errorText: "",
      step: "loading",
      busyText: "Checking for contradictions and matching voices...",
    })

    const selectedModel = local.model.current()
    if (!selectedModel) {
      setStore("errorText", "No model selected.")
      setStore("step", "inputs")
      return
    }

    try {
      const createRes = await sdk.client.session.create(
        {
          workspace: project.workspace.current(),
          agent: "peak",
          model: { providerID: selectedModel.providerID, id: selectedModel.modelID },
        },
        { throwOnError: true },
      )
      setStore("tempSessionID", createRes.data.id)

      const voiceNames = store.voicesList.map((v) => v.name)
      const voiceListText =
        voiceNames.length > 0
          ? voiceNames.map((name) => `- ${name}`).join("\n")
          : '(no voice profiles saved yet — suggest 2-3 general voice archetypes that would fit instead, e.g. "blunt and dry", "warm and teasing", "clipped and formal")'

      const turn1Prompt = [
        "You are the background helper for a character card autopilot flow (fast mode: structure + voice, skip self-review overhead).",
        'The user gave a 1-2 word premise plus optional age, setting, and detail. Any of age/setting/detail may be blank or "skip" — that just means the user left it for you to fill.',
        "",
        `Premise: "${finalPremise}"`,
        `Age: "${finalAge}"`,
        `Setting: "${finalSetting || "skipped"}"`,
        `Detail: "${finalDetail || "skipped"}"`,
        "",
        "Do all of this in one pass:",
        '1. Check for a genuine logical contradiction between the premise, age, setting, and detail — e.g. age 15 stated alongside "divorced twice", or age 60+ alongside "high school student". If you find one, do NOT fill fields or suggest voices; just explain the contradiction as a clear question back to the user in the "contradiction" field, and leave "filled" and "voices" empty.',
        "2. If there is no contradiction, fill in whichever of age/setting/detail were left blank or skipped, in a way that's cohesive and interesting with what was given. Keep anything the user actually specified untouched.",
        "3. Suggest 2-3 voice profiles that would suit this character, chosen from the available voices list below if any fit reasonably well.",
        "",
        "Available voices:",
        voiceListText,
        "",
        "Respond with ONLY a JSON object inside a ```json code fence, matching this shape exactly:",
        "{",
        '  "contradiction": string | null,',
        '  "filled": { "age": string, "setting": string, "detail": string },',
        '  "voices": string[]',
        "}",
      ].join("\n")

      const responseText = await runModelTurn(createRes.data.id, turn1Prompt)
      applyModelResult(responseText)
    } catch (error) {
      setStore("errorText", error instanceof Error ? error.message : "Autopilot request failed")
      setStore("step", "inputs")
      await cleanupSession()
    }
  }

  async function handleContradictionSubmit() {
    if (isLoading()) return
    const explanation = (explanationTextarea?.plainText ?? store.explanation).trim()
    if (!explanation) return
    const sessionID = store.tempSessionID
    if (!sessionID) {
      setStore("errorText", "Lost the background session — please resubmit.")
      setStore("step", "inputs")
      return
    }

    setStore({ explanation, errorText: "", step: "loading", busyText: "Re-evaluating with your explanation..." })

    try {
      const turn2Prompt = [
        "The user's explanation for the contradiction you flagged:",
        `"${explanation}"`,
        "",
        "Re-evaluate the premise, age, setting, and detail with this explanation in mind.",
        "If it resolves the contradiction, proceed exactly as your first turn would with no contradiction: fill any still-blank fields and suggest 2-3 matching voices.",
        'If it does not resolve the contradiction, or introduces a new one, explain the remaining contradiction in the "contradiction" field again.',
        "",
        "Respond with ONLY a JSON object inside a ```json code fence, matching this shape exactly:",
        "{",
        '  "contradiction": string | null,',
        '  "filled": { "age": string, "setting": string, "detail": string },',
        '  "voices": string[]',
        "}",
      ].join("\n")

      const responseText = await runModelTurn(sessionID, turn2Prompt)
      applyModelResult(responseText)
    } catch (error) {
      setStore("errorText", error instanceof Error ? error.message : "Re-evaluation failed")
      setStore("step", "contradiction")
    }
  }

  function pickVoice(voice: VoiceCandidate) {
    setStore("chosenVoiceName", voice.name)
    setStore("chosenVoicePath", voice.path ?? "")
    setStore("step", "preview")
  }

  async function generateCard() {
    void cleanupSession().catch(() => {})

    const voiceInstruction = store.chosenVoicePath
      ? `Use the voice profile at ${store.chosenVoicePath}. Read it first, then closely follow its formatting conventions, macro/pronoun habits, and prose register while writing fully original content — never reuse or lift phrasing from the profile itself, match the pattern, not the text.`
      : `Voice/style: ${store.chosenVoiceName}. Write in this register and tone throughout.`

    const promptText = [
      "Build a full character card, fast mode (structure + voice, skip the self-review pass):",
      "",
      `Premise: ${store.premise}`,
      `Age: ${store.filledAge || (store.age === "skip" ? "your judgment" : store.age)}`,
      `Setting: ${store.filledSetting || store.setting || "your judgment"}`,
      `Detail: ${store.filledDetail || store.detail || "your judgment"}`,
      "",
      voiceInstruction,
      "",
      "Author all four boxes — Scenario, Personality, Opening Messages, and Example Dialogue. Keep the character's core intact, sharpen the voice, and never write actions or dialogue for {{user}}.",
    ].join("\n")

    props.onGenerate(promptText, "peak")
  }

  onMount(async () => {
    dialog.setSize("medium")
    try {
      const found = await Glob.scan("**/*", { cwd: VOICE_DIR, absolute: true, dot: false, symlink: true })
      const list = found
        .filter((file) => VOICE_EXTS.has(path.extname(file).toLowerCase()))
        .map((file) => ({ name: path.basename(file, path.extname(file)), path: file }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      setStore("voicesList", list)
    } catch {
      // Voices library may not exist yet — fall back to model-suggested archetypes.
    }
  })

  onCleanup(() => {
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = undefined
    void cleanupSession().catch(() => {})
  })

  createEffect(() => {
    const step = store.step
    const active = store.active
    if (step === "inputs") {
      if (active === "premise") premiseTextarea?.focus()
      else if (active === "setting") settingTextarea?.focus()
      else if (active === "detail") detailTextarea?.focus()
      else {
        premiseTextarea?.blur()
        settingTextarea?.blur()
        detailTextarea?.blur()
      }
    } else if (step === "contradiction") {
      if (active === "explanation") explanationTextarea?.focus()
      else explanationTextarea?.blur()
    } else {
      premiseTextarea?.blur()
      settingTextarea?.blur()
      detailTextarea?.blur()
      explanationTextarea?.blur()
    }
  })

  function cycleField(direction: 1 | -1) {
    if (store.step === "inputs") {
      const idx = INPUT_FIELDS.indexOf(store.active)
      const next = INPUT_FIELDS[(idx + direction + INPUT_FIELDS.length) % INPUT_FIELDS.length]
      setStore("active", next)
    } else if (store.step === "contradiction") {
      setStore("active", store.active === "explanation" ? "explainSubmit" : "explanation")
    }
  }

  function cycleAge(direction: 1 | -1) {
    const idx = AGE_OPTIONS.indexOf(store.age)
    setStore("age", AGE_OPTIONS[(idx + direction + AGE_OPTIONS.length) % AGE_OPTIONS.length])
  }

  function activateSelection() {
    if (store.step === "inputs") {
      if (store.active === "submit") run(handleSubmit(false))
      if (store.active === "skipAll") run(handleSubmit(true))
    } else if (store.step === "contradiction") {
      if (store.active === "explainSubmit") run(handleContradictionSubmit())
    } else if (store.step === "voice_select") {
      const voice = voicesToDisplay()[store.activeVoiceIndex]
      if (voice) pickVoice(voice)
    } else if (store.step === "preview") {
      run(generateCard())
    }
  }

  useBindings(() => ({
    priority: 1,
    bindings: [
      { key: "tab", desc: "Next field", group: "Dialog", cmd: () => cycleField(1) },
      { key: "shift+tab", desc: "Previous field", group: "Dialog", cmd: () => cycleField(-1) },
      {
        key: "left",
        desc: "Previous age option",
        group: "Dialog",
        enabled: () => store.step === "inputs" && store.active === "age",
        cmd: () => cycleAge(-1),
      },
      {
        key: "right",
        desc: "Next age option",
        group: "Dialog",
        enabled: () => store.step === "inputs" && store.active === "age",
        cmd: () => cycleAge(1),
      },
      {
        key: "ctrl+s",
        desc: "Skip all and submit",
        group: "Dialog",
        enabled: () => store.step === "inputs" && !isLoading(),
        cmd: () => run(handleSubmit(true)),
      },
      {
        key: "ctrl+enter",
        desc: "Submit",
        group: "Dialog",
        enabled: () => (store.step === "inputs" || store.step === "contradiction") && !isLoading(),
        cmd: () => (store.step === "inputs" ? run(handleSubmit(false)) : run(handleContradictionSubmit())),
      },
      {
        key: "enter",
        desc: "Select / submit",
        group: "Dialog",
        enabled: () =>
          !isLoading() &&
          ((store.step === "inputs" && (store.active === "submit" || store.active === "skipAll")) ||
            (store.step === "contradiction" && store.active === "explainSubmit") ||
            store.step === "voice_select" ||
            store.step === "preview"),
        cmd: activateSelection,
      },
      {
        key: "space",
        desc: "Select / submit",
        group: "Dialog",
        enabled: () =>
          !isLoading() &&
          ((store.step === "inputs" && (store.active === "submit" || store.active === "skipAll")) ||
            (store.step === "contradiction" && store.active === "explainSubmit") ||
            store.step === "voice_select" ||
            store.step === "preview"),
        cmd: activateSelection,
      },
      {
        key: "up",
        desc: "Move up",
        group: "Dialog",
        enabled: () => store.step === "voice_select",
        cmd: () => {
          const len = voicesToDisplay().length
          if (len > 0) setStore("activeVoiceIndex", (idx) => (idx - 1 + len) % len)
        },
      },
      {
        key: "down",
        desc: "Move down",
        group: "Dialog",
        enabled: () => store.step === "voice_select",
        cmd: () => {
          const len = voicesToDisplay().length
          if (len > 0) setStore("activeVoiceIndex", (idx) => (idx + 1) % len)
        },
      },
    ],
  }))

  const inactiveCursor = RGBA.fromInts(0, 0, 0, 0)

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Autopilot
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={store.errorText}>
        <text fg={theme.error}>{store.errorText}</text>
      </Show>

      <Show when={store.step === "inputs"}>
        <box gap={1}>
          <box>
            <text fg={store.active === "premise" ? theme.primary : theme.text}>Premise (1-2 words):</text>
            <textarea
              height={1}
              ref={(val: TextareaRenderable) => {
                premiseTextarea = val
              }}
              initialValue={store.premise}
              placeholder="e.g. grumpy bartender"
              placeholderColor={theme.textMuted}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={store.active === "premise" ? theme.text : inactiveCursor}
            />
          </box>

          <box gap={1}>
            <text fg={store.active === "age" ? theme.primary : theme.text}>Age:</text>
            <box flexDirection="row" gap={2}>
              <For each={AGE_OPTIONS}>
                {(opt) => {
                  const selected = () => store.age === opt
                  const active = () => store.active === "age"
                  return (
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={selected() ? theme.primary : active() ? theme.backgroundElement : undefined}
                      onMouseUp={() => {
                        setStore("age", opt)
                        setStore("active", "age")
                      }}
                    >
                      <text fg={selected() ? theme.background : theme.text}>{opt}</text>
                    </box>
                  )
                }}
              </For>
            </box>
          </box>

          <box>
            <text fg={store.active === "setting" ? theme.primary : theme.text}>Setting (optional):</text>
            <textarea
              height={3}
              ref={(val: TextareaRenderable) => {
                settingTextarea = val
              }}
              initialValue={store.setting}
              placeholder="e.g. cyberpunk dive bar"
              placeholderColor={theme.textMuted}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={store.active === "setting" ? theme.text : inactiveCursor}
            />
          </box>

          <box>
            <text fg={store.active === "detail" ? theme.primary : theme.text}>Detail (optional):</text>
            <textarea
              height={3}
              ref={(val: TextareaRenderable) => {
                detailTextarea = val
              }}
              initialValue={store.detail}
              placeholder="e.g. mechanical arm, hates chatty customers"
              placeholderColor={theme.textMuted}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={store.active === "detail" ? theme.text : inactiveCursor}
            />
          </box>

          <box flexDirection="row" gap={2} paddingTop={1}>
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={store.active === "submit" ? theme.primary : theme.backgroundElement}
              onMouseUp={() => run(handleSubmit(false))}
            >
              <text fg={store.active === "submit" ? theme.background : theme.text}>Submit</text>
            </box>
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={store.active === "skipAll" ? theme.primary : theme.backgroundElement}
              onMouseUp={() => run(handleSubmit(true))}
            >
              <text fg={store.active === "skipAll" ? theme.background : theme.text}>Skip All</text>
            </box>
          </box>

          <text fg={theme.textMuted}>Tab: cycle fields · Ctrl+Enter: submit · Ctrl+S: skip all & submit</text>
        </box>
      </Show>

      <Show when={store.step === "contradiction"}>
        <box gap={1}>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            Contradiction detected
          </text>
          <box borderStyle="single" borderColor={theme.error} padding={1}>
            <text fg={theme.text} wrapMode="word">
              {store.contradictionText}
            </text>
          </box>

          <box>
            <text fg={store.active === "explanation" ? theme.primary : theme.text}>Explain how/why:</text>
            <textarea
              height={3}
              ref={(val: TextareaRenderable) => {
                explanationTextarea = val
              }}
              placeholder="Explain this contradiction..."
              placeholderColor={theme.textMuted}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={store.active === "explanation" ? theme.text : inactiveCursor}
            />
          </box>

          <box flexDirection="row" gap={2}>
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={store.active === "explainSubmit" ? theme.primary : theme.backgroundElement}
              onMouseUp={() => run(handleContradictionSubmit())}
            >
              <text fg={store.active === "explainSubmit" ? theme.background : theme.text}>Submit explanation</text>
            </box>
          </box>

          <text fg={theme.textMuted}>Tab: cycle fields · Ctrl+Enter: submit explanation</text>
        </box>
      </Show>

      <Show when={store.step === "loading"}>
        <box height={8} justifyContent="center" alignItems="center">
          <Spinner color={theme.primary}>{store.busyText}</Spinner>
        </box>
      </Show>

      <Show when={store.step === "voice_select"}>
        <box gap={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Pick a voice
          </text>
          <text fg={theme.textMuted}>Matched against your voice library where possible:</text>

          <box borderStyle="single" borderColor={theme.backgroundElement} overflow="scroll" height={10}>
            <For each={voicesToDisplay()}>
              {(voice, idx) => {
                const active = () => store.activeVoiceIndex === idx()
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() ? theme.primary : undefined}
                    onMouseUp={() => {
                      setStore("activeVoiceIndex", idx())
                      pickVoice(voice)
                    }}
                  >
                    <text fg={active() ? theme.background : voice.isSuggested ? theme.primary : theme.text}>
                      {voice.isSuggested ? "★ " : "  "}
                      {voice.name}
                      {voice.isSuggested ? " (suggested)" : ""}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>

          <text fg={theme.textMuted}>↑/↓: navigate · Enter/Space: pick voice</text>
        </box>
      </Show>

      <Show when={store.step === "preview"}>
        <box gap={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Preview
          </text>

          <box borderStyle="single" borderColor={theme.backgroundElement} padding={1} gap={1}>
            <box flexDirection="row">
              <text fg={theme.textMuted} width={10}>
                Premise:
              </text>
              <text fg={theme.text}>{store.premise}</text>
            </box>
            <box flexDirection="row">
              <text fg={theme.textMuted} width={10}>
                Age:
              </text>
              <text fg={theme.text}>{store.filledAge || (store.age === "skip" ? "model's judgment" : store.age)}</text>
            </box>
            <box flexDirection="row">
              <text fg={theme.textMuted} width={10}>
                Setting:
              </text>
              <text fg={theme.text} wrapMode="word">
                {store.filledSetting || store.setting || "model's judgment"}
              </text>
            </box>
            <box flexDirection="row">
              <text fg={theme.textMuted} width={10}>
                Detail:
              </text>
              <text fg={theme.text} wrapMode="word">
                {store.filledDetail || store.detail || "model's judgment"}
              </text>
            </box>
            <box flexDirection="row">
              <text fg={theme.textMuted} width={10}>
                Voice:
              </text>
              <text fg={theme.text}>{store.chosenVoiceName}</text>
            </box>
          </box>

          <box flexDirection="row" gap={2}>
            <box paddingLeft={2} paddingRight={2} backgroundColor={theme.primary} onMouseUp={() => run(generateCard())}>
              <text fg={theme.background} attributes={TextAttributes.BOLD}>
                Generate card
              </text>
            </box>
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={theme.backgroundElement}
              onMouseUp={() => setStore("step", "voice_select")}
            >
              <text fg={theme.text}>Back</text>
            </box>
          </box>

          <text fg={theme.textMuted}>Enter/Space: generate card</text>
        </box>
      </Show>
    </box>
  )
}
