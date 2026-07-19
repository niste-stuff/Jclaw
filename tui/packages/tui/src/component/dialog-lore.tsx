import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { Global } from "@opencode-ai/core/global"
import { useTheme } from "../context/theme"
import { createLibraryScan, createMarkedSelection, libraryOptions } from "./library-picker"
import path from "node:path"

export interface LorePick {
  path: string
  name: string
}

const LORE_EXTS = new Set([".md", ".txt", ".json"])

// Picker over the persistent lore library at Global.Path.lore. Supports
// marking multiple files (space, mirroring dialog-mcp.tsx's toggle action)
// so a card build can be grounded in more than one lore file at once; Enter
// with no marks falls back to picking just the highlighted item. Stays dumb
// otherwise: it only lists files and hands the chosen absolute paths back
// via onPick — the prompt component owns what happens next. Shares the scan /
// filter / group plumbing with dialog-voice + dialog-ideas via library-picker.
export function DialogLore(props: { onPick: (picks: LorePick[]) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const selection = createMarkedSelection()

  const [files] = createLibraryScan({ dir: Global.Path.lore, exts: LORE_EXTS })

  function confirm(paths: string[]) {
    if (paths.length === 0) return
    props.onPick(paths.map((file) => ({ path: file, name: path.basename(file) })))
    dialog.clear()
  }

  const options = () =>
    libraryOptions({
      files,
      dir: Global.Path.lore,
      rootCategory: "Lore",
      emptyTitle: "No lore yet — drop .md / .txt / .json files here:",
      emptyDescription: Global.Path.lore,
      gutter: selection.gutter,
    })

  return (
    <DialogSelect
      title="Lore library"
      options={options()}
      actions={[
        {
          command: "dialog.lore.toggle",
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
