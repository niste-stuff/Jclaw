import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For } from "solid-js"
import { useTheme } from "../../context/theme"
import { SPLASH_TEXTS } from "./splash-texts"

type TextPart = { text: string; highlight: boolean }

const FALLBACK = "Welcome to jclaw."

// Splits a splash line into plain and {highlight}...{/highlight} segments.
function parse(text: string): TextPart[] {
  const parts: TextPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(text.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: text.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < text.length) {
    parts.push({ text: text.slice(state.index), highlight: false })
  }

  return parts
}

// Home-screen splash line. Picks one entry from SPLASH_TEXTS at random each
// time the component mounts (i.e. once per launch). Add your own lines in
// ./splash-texts.ts. `props` is kept for interface compatibility with the
// home-tips slot but is no longer used.
export function Tips(props: { api: TuiPluginApi; connected?: boolean }) {
  void props
  const theme = useTheme().theme
  const pool = SPLASH_TEXTS.length ? SPLASH_TEXTS : [FALLBACK]
  const text = pool[Math.floor(Math.random() * pool.length)] ?? FALLBACK
  const parts = parse(text)

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ●{" "}
      </text>
      <text flexShrink={1} wrapMode="word">
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}
