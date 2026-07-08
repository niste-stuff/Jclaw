import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createResource } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "node:path"

export interface LorePick {
  path: string
  name: string
}

const LORE_EXTS = new Set([".md", ".txt", ".json"])

// Picker over the persistent lore library at Global.Path.lore. Stays dumb: it
// only lists files and hands the chosen absolute path back via onPick — the
// prompt component owns what happens next (switch to peak, prefill the build
// prompt). Mirrors dialog-theme-list.tsx.
export function DialogLore(props: { onPick: (pick: LorePick) => void }) {
  const dialog = useDialog()

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
      return {
        title: path.basename(file),
        value: file,
        category: dir === "." ? "Lore" : dir,
      }
    })
  }

  return (
    <DialogSelect
      title="Lore library"
      options={options()}
      onSelect={(opt) => {
        if (!opt.value) return
        props.onPick({ path: opt.value, name: path.basename(opt.value) })
        dialog.clear()
      }}
    />
  )
}
