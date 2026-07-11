import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createResource, createSignal } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { useTheme } from "../context/theme"
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
export function DialogIdeas(props: { onPick: (picks: IdeaPick[]) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [marked, setMarked] = createSignal<Set<string>>(new Set())

  const [files] = createResource(async () => {
    const found = await Glob.scan("**/*", {
      cwd: IDEAS_DIR,
      absolute: true,
      dot: false,
      symlink: true,
    })
    return found
      .filter((file) => IDEAS_EXTS.has(path.extname(file).toLowerCase()))
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
          title: "No saved ideas yet — generate some with /ideas:",
          value: "",
          disabled: true,
          description: IDEAS_DIR,
        },
      ]
    return found.map((file) => {
      const isMarked = marked().has(file)
      return {
        title: path.basename(file),
        value: file,
        category: "Ideas",
        gutter: () => <text fg={isMarked ? theme.primary : theme.textMuted}>{isMarked ? "[x]" : "[ ]"}</text>,
      }
    })
  }

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
