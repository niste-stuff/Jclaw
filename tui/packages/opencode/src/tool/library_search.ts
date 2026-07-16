import path from "path"

export const LIBRARY_EXTS = new Set([".md", ".txt", ".json"])

export type LibraryFilter = "lore" | "voices" | "any"

export interface LibraryCandidate {
  path: string
  title: string
  category: string
  matchType: "filename" | "content"
  snippet?: string
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = normalizeForMatch(query).split(" ").filter(Boolean)
  if (tokens.length === 0) return false
  const normalizedHaystack = normalizeForMatch(haystack)
  return tokens.every((token) => normalizedHaystack.includes(token))
}

export function titleFromBasename(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

export function deriveCategory(root: string, filePath: string): string {
  const rel = path.relative(root, filePath)
  const dir = path.dirname(rel)
  return dir === "." ? "Lore" : dir
}

export function matchesLibraryFilter(root: string, filePath: string, library: LibraryFilter): boolean {
  if (library === "any") return true
  const rel = path.relative(root, filePath)
  const inVoices = rel.split(path.sep)[0] === "voices"
  return library === "voices" ? inVoices : !inVoices
}

export function buildSnippet(content: string, query: string, radius = 60): string | undefined {
  const lower = content.toLowerCase()
  const tokens = normalizeForMatch(query).split(" ").filter(Boolean)
  for (const token of tokens) {
    const idx = lower.indexOf(token)
    if (idx === -1) continue
    const start = Math.max(0, idx - radius)
    const end = Math.min(content.length, idx + token.length + radius)
    const prefix = start > 0 ? "…" : ""
    const suffix = end < content.length ? "…" : ""
    return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`
  }
  return undefined
}

export function searchFilenames(
  files: string[],
  query: string,
  root: string,
  library: LibraryFilter,
): LibraryCandidate[] {
  return files
    .filter((file) => matchesLibraryFilter(root, file, library))
    .filter((file) => matchesQuery(titleFromBasename(file), query))
    .map((file) => ({
      path: file,
      title: titleFromBasename(file),
      category: deriveCategory(root, file),
      matchType: "filename" as const,
    }))
}

export function searchContent(
  files: { path: string; content: string }[],
  query: string,
  root: string,
  library: LibraryFilter,
): LibraryCandidate[] {
  return files
    .filter((file) => matchesLibraryFilter(root, file.path, library))
    .filter((file) => matchesQuery(file.content, query))
    .map((file) => ({
      path: file.path,
      title: titleFromBasename(file.path),
      category: deriveCategory(root, file.path),
      matchType: "content" as const,
      snippet: buildSnippet(file.content, query),
    }))
}

import { readFile } from "node:fs/promises"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import DESCRIPTION from "./library_search.txt"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The plain-language reference to search for — a creator name, a lore topic, a world/character name.",
  }),
  library: Schema.Literals(["lore", "voices", "any"])
    .annotate({
      description:
        "Narrow the search: 'voices' for a creator's voice profile, 'lore' for a lore/world/character reference, 'any' if unsure (default).",
      default: "any",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("any" as const))),
})

export const LibrarySearchTool = Tool.define(
  "library_search",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const root = Global.Path.lore
        const found = yield* Effect.promise(() =>
          Glob.scan("**/*", { cwd: root, absolute: true, dot: false, symlink: true }),
        )
        const files = found.filter((file) => LIBRARY_EXTS.has(path.extname(file).toLowerCase()))

        let candidates = searchFilenames(files, params.query, root, params.library)
        if (candidates.length === 0) {
          const withContent = yield* Effect.promise(() =>
            Promise.all(files.map(async (file) => ({ path: file, content: await readFile(file, "utf-8") }))),
          )
          candidates = searchContent(withContent, params.query, root, params.library)
        }

        return {
          title: candidates.length === 0 ? "no matches" : `${candidates.length} match(es)`,
          output: JSON.stringify({ query: params.query, library: params.library, candidates }, null, 2),
          metadata: { count: candidates.length, candidates },
        }
      }).pipe(Effect.orDie),
  }),
)
