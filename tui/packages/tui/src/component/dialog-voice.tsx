import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createResource } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "node:path"

export interface VoicePick {
  path: string
  name: string
}

const VOICE_EXTS = new Set([".md", ".txt", ".json"])
const VOICE_DIR = path.join(Global.Path.lore, "voices")

// Picker over the voices/ subfolder of the lore library — a near-copy of
// dialog-lore.tsx, but single-select: unlike lore (which can combine
// multiple sources into one build), only one creator's voice applies to an
// authoring session at a time. Stays dumb otherwise: lists profile files and
// hands the chosen absolute path back via onPick.
export function DialogVoice(props: { onPick: (pick: VoicePick) => void }) {
  const dialog = useDialog()

  const [files] = createResource(async () => {
    const found = await Glob.scan("**/*", {
      cwd: VOICE_DIR,
      absolute: true,
      dot: false,
      symlink: true,
    })
    return found
      .filter((file) => VOICE_EXTS.has(path.extname(file).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  })

  const options = (): DialogSelectOption<string>[] => {
    if (files.loading) return [{ title: "Loading…", value: "", disabled: true }]
    const found = files() ?? []
    if (found.length === 0)
      return [
        {
          title: "No voice profiles yet — build one with /voice add first:",
          value: "",
          disabled: true,
          description: VOICE_DIR,
        },
      ]
    return found.map((file) => {
      const rel = path.relative(VOICE_DIR, file)
      const dir = path.dirname(rel)
      return {
        title: path.basename(file),
        value: file,
        category: dir === "." ? "Voices" : dir,
      }
    })
  }

  return (
    <DialogSelect
      title="Voice library"
      options={options()}
      onSelect={(option) => {
        if (!option.value) return
        props.onPick({ path: option.value, name: path.basename(option.value) })
        dialog.clear()
      }}
    />
  )
}
