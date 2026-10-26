import * as React from "react"
import type { Fact } from "@/data/world"

// The context item being written in the editor, so Try it in the dock can ask against it.

let current: Fact | null = null
const listeners = new Set<() => void>()

export function setDraft(fact: Fact | null) {
  current = fact
  listeners.forEach((l) => l())
}

export function useDraft() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}
