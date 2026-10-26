// The shape the real schema gives a context item's dates (item_versions: valid_from, valid_until,
// review_date), and the words people read derived from them by pure functions. The fixtures store
// the dates; the labels ("From 4 Aug 2026, still going on") are never typed by hand, so the port
// to the real data is a change of source, not of every screen.

import type { Validity as ServerValidity } from '@domain/item'

/** When a context item applies: ISO dates, either open. `ongoing` says an open end is still going on. */
export type Validity = { from?: string; until?: string; ongoing?: boolean }

/** The same window in the server's words: `from` is its start and `until` its end; both stay open when absent. */
export const toServerValidity = (v: Validity): Partial<ServerValidity> => ({
  ...(v.from ? { start: v.from } : {}),
  ...(v.until ? { end: v.until } : {}),
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return { d, m: MONTHS[m! - 1], y }
}

/** "4 Aug 2026". */
export const dateLabel = (iso: string) => {
  const p = parts(iso)
  return `${p.d} ${p.m} ${p.y}`
}

/** The When people read: "Always", "From 4 Aug 2026, still going on", "12 to 19 May 2026", "Until 19 Jan 2026", "4 Aug 2026". */
export function whenLabel(v: Validity): string {
  if (v.from && v.until) {
    if (v.from === v.until) return dateLabel(v.from)
    const a = parts(v.from)
    const b = parts(v.until)
    if (a.y !== b.y) return `${dateLabel(v.from)} to ${dateLabel(v.until)}`
    if (a.m !== b.m) return `${a.d} ${a.m} to ${b.d} ${b.m} ${b.y}`
    return `${a.d} to ${b.d} ${b.m} ${b.y}`
  }
  if (v.from) return `From ${dateLabel(v.from)}${v.ongoing ? ', still going on' : ''}`
  if (v.until) return `Until ${dateLabel(v.until)}`
  return v.ongoing ? 'Still going on' : 'Always'
}

/** Whether a check date has passed: an item past it reads "Needs checking". */
export const checkDue = (reviewDate: string, today: string) => reviewDate < today
