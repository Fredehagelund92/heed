import { setQuery, useRoute } from "@/lib/router"

// The dock's content lives in the address (?dock=kind.id), so Back closes it and every state has a link.

export type DockKind = "review" | "context" | "def" | "ask" | "try" | "topic" | "share" | "where"
export type DockState = { kind: DockKind; id?: string; width: number }

export function useDock(): DockState | null {
  const { query } = useRoute()
  const raw = query.get("dock")
  if (!raw) return null
  const [kind, id] = raw.split(".") as [DockKind, string | undefined]
  return { kind, id, width: kind === "review" ? 720 : kind === "topic" ? 560 : 480 }
}

export function openDock(kind: DockKind, id?: string, extra?: Record<string, string | undefined>) {
  setQuery({ dock: id ? `${kind}.${id}` : kind, tab: undefined, flag: undefined, ptab: undefined, when: undefined, ...extra })
}

export function closeDock() {
  setQuery({ dock: undefined, tab: undefined, flag: undefined, ptab: undefined, when: undefined })
}
