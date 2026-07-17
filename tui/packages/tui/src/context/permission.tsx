import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

export type PermissionMode = "ask" | "autoapprove" | "yolo"

const CYCLE_ORDER: PermissionMode[] = ["ask", "autoapprove", "yolo"]

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const index = CYCLE_ORDER.indexOf(mode)
  return CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length]
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: args.auto ? "yolo" : "ask",
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
      },
      cycle() {
        setStore("mode", nextPermissionMode(store.mode))
      },
    }
  },
})
