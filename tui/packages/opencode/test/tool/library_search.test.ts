// tui/packages/opencode/test/tool/library_search.test.ts
import { describe, expect, test } from "bun:test"
import {
  normalizeForMatch,
  matchesQuery,
  titleFromBasename,
  deriveCategory,
  matchesLibraryFilter,
  buildSnippet,
  searchFilenames,
  searchContent,
} from "../../src/tool/library_search"

describe("normalizeForMatch", () => {
  test("lowercases and collapses punctuation to single spaces", () => {
    expect(normalizeForMatch("Dragon-Kingdom_Lore.md")).toBe("dragon kingdom lore md")
  })

  test("trims leading/trailing whitespace", () => {
    expect(normalizeForMatch("  Niste  ")).toBe("niste")
  })
})

describe("matchesQuery", () => {
  test("matches when every query token appears in the haystack", () => {
    expect(matchesQuery("dragon-kingdom", "dragon kingdom")).toBe(true)
  })

  test("does not match when a query token is missing", () => {
    expect(matchesQuery("dragon-kingdom", "dragon empire")).toBe(false)
  })

  test("is case-insensitive", () => {
    expect(matchesQuery("Niste Voice Profile", "niste")).toBe(true)
  })

  test("empty query never matches", () => {
    expect(matchesQuery("anything", "")).toBe(false)
  })
})

describe("titleFromBasename", () => {
  test("strips the extension", () => {
    expect(titleFromBasename("/a/b/niste.md")).toBe("niste")
  })

  test("handles files with no extension", () => {
    expect(titleFromBasename("/a/b/readme")).toBe("readme")
  })
})

describe("deriveCategory", () => {
  test("root-level file categorizes as Lore", () => {
    expect(deriveCategory("/lore", "/lore/dragon-kingdom.md")).toBe("Lore")
  })

  test("nested file categorizes by its parent dir", () => {
    expect(deriveCategory("/lore", "/lore/voices/niste.md")).toBe("voices")
  })

  test("deeply nested file categorizes by its immediate parent dir", () => {
    expect(deriveCategory("/lore", "/lore/worlds/valdris/factions.md")).toBe("worlds/valdris")
  })
})

describe("matchesLibraryFilter", () => {
  test("'any' matches everything", () => {
    expect(matchesLibraryFilter("/lore", "/lore/voices/niste.md", "any")).toBe(true)
    expect(matchesLibraryFilter("/lore", "/lore/dragon-kingdom.md", "any")).toBe(true)
  })

  test("'voices' matches only files under voices/", () => {
    expect(matchesLibraryFilter("/lore", "/lore/voices/niste.md", "voices")).toBe(true)
    expect(matchesLibraryFilter("/lore", "/lore/dragon-kingdom.md", "voices")).toBe(false)
  })

  test("'lore' matches everything except voices/", () => {
    expect(matchesLibraryFilter("/lore", "/lore/dragon-kingdom.md", "lore")).toBe(true)
    expect(matchesLibraryFilter("/lore", "/lore/worlds/valdris.md", "lore")).toBe(true)
    expect(matchesLibraryFilter("/lore", "/lore/voices/niste.md", "lore")).toBe(false)
  })
})

describe("buildSnippet", () => {
  test("returns undefined when no query token is found", () => {
    expect(buildSnippet("some unrelated content", "zzzznotfound")).toBeUndefined()
  })

  test("returns a window of context around the first matched token", () => {
    const content = "This is a long passage that eventually mentions niste somewhere in the middle of it."
    const snippet = buildSnippet(content, "niste", 10)
    expect(snippet).toContain("niste")
  })

  test("adds ellipsis markers when the window is truncated on either side", () => {
    const content = "x".repeat(200) + " niste " + "y".repeat(200)
    const snippet = buildSnippet(content, "niste", 10)
    expect(snippet?.startsWith("…")).toBe(true)
    expect(snippet?.endsWith("…")).toBe(true)
  })
})

describe("searchFilenames", () => {
  const root = "/lore"
  const files = ["/lore/dragon-kingdom.md", "/lore/voices/niste.md", "/lore/voices/other-creator.md"]

  test("matches by normalized basename", () => {
    const result = searchFilenames(files, "niste", root, "any")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      path: "/lore/voices/niste.md",
      title: "niste",
      category: "voices",
      matchType: "filename",
    })
  })

  test("respects the library filter", () => {
    const result = searchFilenames(files, "niste", root, "lore")
    expect(result).toHaveLength(0)
  })

  test("returns empty array when nothing matches", () => {
    expect(searchFilenames(files, "zzznotfound", root, "any")).toEqual([])
  })
})

describe("searchContent", () => {
  const root = "/lore"
  const files = [
    { path: "/lore/kingdom-notes.md", content: "# Kingdom Notes\nRuled by the dragon queen Niste for a century." },
    { path: "/lore/voices/other-creator.md", content: "# Other creator\nTerse fragments, bracketed traits." },
  ]

  test("matches by content when filename didn't match", () => {
    const result = searchContent(files, "niste", root, "any")
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe("/lore/kingdom-notes.md")
    expect(result[0].matchType).toBe("content")
    expect(result[0].snippet).toContain("Niste")
  })

  test("respects the library filter", () => {
    expect(searchContent(files, "niste", root, "voices")).toEqual([])
  })
})
