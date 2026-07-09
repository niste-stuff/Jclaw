import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createResource, createSignal } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { useTheme } from "../context/theme"
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
// via onPick — the prompt component owns what happens next.
export function DialogLore(props: { onPick: (picks: LorePick[]) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [marked, setMarked] = createSignal<Set<string>>(new Set())

  const [files] = createResource(async () => {
    const found = await Glob.scan("**/*", {
      cwd: Global.Path.lore,
      absolute: true,
      dot: false,
      symlink: true,
    })
    return found
      .filter((file) => LORE_EXTS.has(path.extname(file).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  })

  function toggle(file: string) {
    setMarked((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  function confirm(paths: string[]) {
    if (paths.length === 0) return
    props.onPick(paths.map((file) => ({ path: file, name: path.basename(file) })))
    dialog.clear()
  }

  const options = (): DialogSelectOption<string>[] => {
    if (files.loading) return [{ title: "Loading…", value: "", disabled: true }]
    const found = files() ?? []
    if (found.length === 0)
      return [
        {
          title: "No lore yet — drop .md / .txt / .json files here:",
          value: "",
          disabled: true,
          description: Global.Path.lore,
        },
      ]
    return found.map((file) => {
      const rel = path.relative(Global.Path.lore, file)
      const dir = path.dirname(rel)
      const isMarked = marked().has(file)
      return {
        title: path.basename(file),
        value: file,
        category: dir === "." ? "Lore" : dir,
        gutter: () => <text fg={isMarked ? theme.primary : theme.textMuted}>{isMarked ? "[x]" : "[ ]"}</text>,
      }
    })
  }

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
            toggle(option.value)
          },
        },
      ]}
      footer={
        marked().size > 0 ? (
          <text fg={theme.textMuted}>
            {marked().size} marked — enter to build from all, space to toggle
          </text>
        ) : undefined
      }
      onSelect={(option) => {
        const picked = marked()
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
