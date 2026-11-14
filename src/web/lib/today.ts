// The web has no day of its own. The service names it with every library read (a demo pins it),
// and until a read has, it is the demo world's day, which the mock lives on.

/** The demo world's today: the mock's day, and what every screen reads before the service answers. */
export const DEMO_TODAY = '2026-10-23'

let current = DEMO_TODAY

/** The service's UTC day, as an ISO date. */
export const today = () => current

/** The service's day as a UTC time. */
export const todayMs = () => Date.parse(current)

/** Keeps the day an index read named. */
export const setToday = (iso: string) => {
  current = iso
}
