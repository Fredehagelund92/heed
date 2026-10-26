// Connecting an agent, as the page sees it. After a copy or a quick link the page checks every
// 3 seconds whether an agent signed in; after 2 minutes it shows what usually goes wrong, and after
// 10 minutes it stops checking until Check again. In the demo an agent signs in 8 seconds after the
// copy (the mock binding plays it), and its review flag ?connect= shows each state.

export const CHECK_MS = 3_000
export const HINT_MS = 120_000
export const STOP_MS = 600_000
/** When the demo's agent signs in after a copy (the mock binding); the page sees it at the next check. */
export const MOCK_SIGN_IN_MS = 8_000

export type LivePhase = 'idle' | 'waiting' | 'hint' | 'connected' | 'timeout' | 'declined'
export const LIVE_PHASES: LivePhase[] = [
  'idle',
  'waiting',
  'hint',
  'connected',
  'timeout',
  'declined',
]

/** The first check at or after a moment: what the page knows lags what happened by up to one check. */
export const seenAt = (ms: number) => Math.ceil(ms / CHECK_MS) * CHECK_MS

/** Where a wait stands, `elapsed` after it began; `signIn` is when the agent signed in, if it does. */
export function phaseAt(elapsed: number, signIn?: number): Exclude<LivePhase, 'idle' | 'declined'> {
  if (signIn !== undefined && signIn < STOP_MS && elapsed >= seenAt(signIn)) return 'connected'
  if (elapsed >= STOP_MS) return 'timeout'
  if (elapsed >= HINT_MS) return 'hint'
  return 'waiting'
}

/* ---------- The connected agents, shared by the page, the dialog and the live line ---------- */

export type Connected = { agent: string; who: string; since: string; used: string; fresh?: boolean }
