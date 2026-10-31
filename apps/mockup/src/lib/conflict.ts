import type { ConflictPair } from "@/data/conflicts"

/** Where the two columns stop fitting side by side: a 480 dock and a phone get one pile per item. */
export const SIDE_BY_SIDE = 560

/** The keys of the Conflict scope. One key, one command: a test fails if two claim the same key. */
export const CONFLICT_KEYS = [
  { key: "ArrowLeft", command: "first", label: "The first item" },
  { key: "ArrowRight", command: "second", label: "The second item" },
  { key: "1", command: "keepFirst", label: "Keep the first one" },
  { key: "2", command: "keepSecond", label: "Keep the second one" },
  { key: "e", command: "edit", label: "Edit the item in focus" },
  { key: "b", command: "both", label: "Keep both" },
  { key: "n", command: "notConflict", label: "Not a conflict" },
  { key: "o", command: "ask", label: "Ask the owner" },
  { key: "j", command: "next", label: "Next conflict" },
  { key: "k", command: "previous", label: "Previous conflict" },
] as const

export type ConflictCommand = (typeof CONFLICT_KEYS)[number]["command"]

/** A pair's own page. */
export const conflictHref = (p: Pick<ConflictPair, "key">) => `/context/conflicts/${p.key}`
