import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { Global } from "@opencode-ai/core/global"
import { createLibraryScan, libraryOptions } from "./library-picker"
import path from "node:path"

export interface VoicePick {
  path: string
  name: string
}

const VOICE_EXTS = new Set([".md", ".txt", ".json"])
const VOICE_DIR = path.join(Global.Path.lore, "voices")

// Picker over the voices/ subfolder of the lore library. Shares the scan /
// filter / group plumbing with dialog-lore + dialog-ideas via library-picker,
// but stays single-select: unlike lore (which can combine multiple sources
// into one build), only one creator's voice applies to an authoring session
// at a time. Stays dumb otherwise: lists profile files and hands the chosen
// absolute path back via onPick.
export function DialogVoice(props: { onPick: (pick: VoicePick) => void }) {
  const dialog = useDialog()

  const [files] = createLibraryScan({ dir: VOICE_DIR, exts: VOICE_EXTS })

  const options = () =>
    libraryOptions({
      files,
      dir: VOICE_DIR,
      rootCategory: "Voices",
      emptyTitle: "No voice profiles yet — build one with /voice add first:",
      emptyDescription: VOICE_DIR,
    })

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
