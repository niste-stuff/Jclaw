import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { Global } from "@opencode-ai/core/global"
import { useTheme } from "../context/theme"
import { createLibraryScan, createMarkedSelection, libraryOptions } from "./library-picker"
import path from "node:path"

export interface IdeaPick {
  path: string
  name: string
}

const IDEAS_EXTS = new Set([".md", ".txt"])
const IDEAS_DIR = path.join(Global.Path.lore, "ideas")

// Picker over saved ideas at <lore>/ideas, generated and saved via /ideas.
// Same multi-select-to-act pattern as dialog-lore.tsx: space marks an idea,
// enter builds from all marked (falling back to the highlighted one if none
// are marked). Stays dumb — hands the chosen absolute paths back via onPick.
// Shares the scan / filter / group plumbing with the other two pickers via
// library-picker; unlike lore/voice, every idea groups flat under "Ideas".
export function DialogIdeas(props: { onPick: (picks: IdeaPick[]) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const selection = createMarkedSelection()

  const [files] = createLibraryScan({ dir: IDEAS_DIR, exts: IDEAS_EXTS })

  function confirm(paths: string[]) {
    if (paths.length === 0) return
    props.onPick(paths.map((file) => ({ path: file, name: path.basename(file) })))
    dialog.clear()
  }

  const options = () =>
    libraryOptions({
      files,
      dir: IDEAS_DIR,
      rootCategory: "Ideas",
      emptyTitle: "No saved ideas yet — generate some with /ideas:",
      emptyDescription: IDEAS_DIR,
      flatCategory: true,
      gutter: selection.gutter,
    })

  return (
    <DialogSelect
      title="Saved ideas"
      options={options()}
      actions={[
        {
          command: "dialog.ideas.toggle",
          title: "mark",
          onTrigger: (option) => {
            if (!option.value) return
            selection.toggle(option.value)
          },
        },
      ]}
      footer={
        selection.marked().size > 0 ? (
          <text fg={theme.textMuted}>
            {selection.marked().size} marked — enter to build from all, space to toggle
          </text>
        ) : undefined
      }
      onSelect={(option) => {
        const picked = selection.marked()
        if (picked.size > 0) {
          confirm(Array.from(picked))
          return
        }
        if (!option.value) return
        confirm([option.value])
      }}
    />
  )
}
