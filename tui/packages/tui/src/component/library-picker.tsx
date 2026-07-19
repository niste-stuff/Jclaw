import { type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createSignal, type Accessor } from "solid-js"
import { Glob } from "@opencode-ai/core/util/glob"
import { useTheme } from "../context/theme"
import path from "node:path"

// Shared plumbing for the lore / voice / ideas library pickers, which are
// otherwise ~85% copy-paste: the same Glob.scan over a scoped directory, the
// same extension filter + case-insensitive sort, the same category grouping,
// and the same loading / empty disabled rows. The select-mode differences
// (voice is single-select; lore + ideas are multi-select with a marked
// gutter) stay explicit in each dialog — this file only owns the parts that
// are genuinely identical.

export interface LibraryScanConfig {
  // Directory to scan for library files.
  dir: string
  // Allowed lowercase file extensions (including the leading dot).
  exts: Set<string>
}

// createResource wrapper for a one-shot recursive scan of a library dir,
// returning absolute paths filtered to `exts` and sorted case-insensitively.
export function createLibraryScan(config: LibraryScanConfig) {
  return createResource(async () => {
    const found = await Glob.scan("**/*", {
      cwd: config.dir,
      absolute: true,
      dot: false,
      symlink: true,
    })
    return found
      .filter((file) => config.exts.has(path.extname(file).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  })
}

export interface LibraryOptionsConfig {
  // The scan resource created via createLibraryScan.
  files: ReturnType<typeof createLibraryScan>[0]
  // Root dir the scanned paths are relative to, for category grouping.
  dir: string
  // Category shown for files at the root of `dir`.
  rootCategory: string
  // Title + description shown when the library is empty.
  emptyTitle: string
  emptyDescription: string
  // When set, groups every file under `rootCategory` instead of using the
  // file's subdirectory as its category (matches the ideas picker, which is
  // flat, vs. lore/voice which group by subfolder).
  flatCategory?: boolean
  // Optional per-row gutter (used by the multi-select pickers for the marks).
  gutter?: (file: string) => (() => any) | undefined
}

// Builds the DialogSelect option list for a library picker: a single disabled
// "Loading…" row while scanning, a single disabled empty-state row when there
// are no files, otherwise one row per file grouped by category.
export function libraryOptions(config: LibraryOptionsConfig): DialogSelectOption<string>[] {
  if (config.files.loading) return [{ title: "Loading…", value: "", disabled: true }]
  const found = config.files() ?? []
  if (found.length === 0)
    return [
      {
        title: config.emptyTitle,
        value: "",
        disabled: true,
        description: config.emptyDescription,
      },
    ]
  return found.map((file) => {
    const rel = path.relative(config.dir, file)
    const dir = path.dirname(rel)
    const category = config.flatCategory ? config.rootCategory : dir === "." ? config.rootCategory : dir
    return {
      title: path.basename(file),
      value: file,
      category,
      gutter: config.gutter?.(file),
    }
  })
}

export interface MarkedSelection {
  marked: Accessor<Set<string>>
  toggle: (file: string) => void
  // Renders the [x]/[ ] gutter for a file, tracking its marked state.
  gutter: (file: string) => () => any
}

// Shared marked-set state + toggle + gutter for the multi-select pickers
// (lore + ideas). The toggle mirrors dialog-mcp's space action; the gutter
// reads marked() reactively so marks repaint on toggle.
export function createMarkedSelection(): MarkedSelection {
  const { theme } = useTheme()
  const [marked, setMarked] = createSignal<Set<string>>(new Set())

  function toggle(file: string) {
    setMarked((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  function gutter(file: string) {
    return () => {
      const isMarked = marked().has(file)
      return <text fg={isMarked ? theme.primary : theme.textMuted}>{isMarked ? "[x]" : "[ ]"}</text>
    }
  }

  return { marked, toggle, gutter }
}
