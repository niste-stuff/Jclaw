import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export const { use: useSlopMode, provider: SlopModeProvider } = createSimpleContext({
  name: "SlopMode",
  init: () => {
    const [store, setStore] = createStore<{ enabled: boolean }>({
      enabled: false,
    })
    return {
      get enabled() {
        return store.enabled
      },
      toggle() {
        setStore("enabled", (enabled) => !enabled)
      },
    }
  },
})
