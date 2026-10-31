import * as React from "react"

// Connecting an agent, as the page sees it. After a copy or a quick link the page checks every
// 3 seconds whether an agent signed in; after 2 minutes it shows what usually goes wrong, and after
// 10 minutes it stops checking until Check again. In the demo an agent signs in 8 seconds after the
// copy. The review flag ?connect=idle|waiting|hint|connected|timeout|declined shows each state.

export const CHECK_MS = 3_000
export const HINT_MS = 120_000
export const STOP_MS = 600_000
/** When the demo's agent signs in after a copy; the page sees it at the next check. */
export const MOCK_SIGN_IN_MS = 8_000

export type LivePhase = "idle" | "waiting" | "hint" | "connected" | "timeout" | "declined"
export const LIVE_PHASES: LivePhase[] = ["idle", "waiting", "hint", "connected", "timeout", "declined"]

/** The first check at or after a moment: what the page knows lags what happened by up to one check. */
export const seenAt = (ms: number) => Math.ceil(ms / CHECK_MS) * CHECK_MS

/** Where a wait stands, `elapsed` after it began; `signIn` is when the agent signed in, if it does. */
export function phaseAt(elapsed: number, signIn?: number): Exclude<LivePhase, "idle" | "declined"> {
  if (signIn !== undefined && signIn < STOP_MS && elapsed >= seenAt(signIn)) return "connected"
  if (elapsed >= STOP_MS) return "timeout"
  if (elapsed >= HINT_MS) return "hint"
  return "waiting"
}

/* ---------- The connected agents, shared by the page, the dialog and the live line ---------- */

/** How many of its tools an agent may call (FR-420); every one when not set. */
export type AgentMay = "All 6 tools" | "All 5 tools" | "5 of 6 tools" | "Off"
export type Connected = { agent: string; who: string; since: string; used: string; fresh?: boolean; may?: AgentMay }

let rows: Connected[] = [
  { agent: "Claude", who: "Maria Lindqvist", since: "2 Oct 2026", used: "Today" },
  { agent: "Cursor", who: "Jon Abara", since: "12 Sep 2026", used: "Yesterday", may: "All 5 tools" },
  { agent: "Claude Code", who: "Kofi Mensah", since: "20 Oct 2026", used: "Yesterday" },
  { agent: "Claude", who: "Ines Duarte", since: "1 Oct 2026", used: "Today", may: "5 of 6 tools" },
]
const listeners = new Set<() => void>()
const changed = () => {
  for (const l of listeners) l()
}

/** The connected agents as they stand, newest sign-in first. */
export const connectedNow = () => rows

export function useConnected() {
  return React.useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, connectedNow)
}

/** A sign-in adds the agent on top, marked new; the same agent for the same person replaces its row. */
export function addConnected(agent: string, who: string) {
  const row: Connected = { agent, who, since: "23 Oct 2026", used: "Just now", fresh: true }
  rows = [row, ...rows.filter((r) => !(r.agent === agent && r.who === who)).map((r) => (r.fresh ? { ...r, fresh: false } : r))]
  changed()
}

export function revokeConnected(row: Connected) {
  rows = rows.filter((r) => r !== row)
  changed()
}
