import type { Fact } from '@/data/world'

// When a context item holds and how fresh its check is, in the fixed vocabulary of the
// list columns' design B: five time frames (Always, Ongoing, Since X, Until X, X to Y),
// a short date for each, and one freshness level for the dot: fresh up to 30 days, ageing up to
// 90, overdue after that or when a definition changed.

export const TODAY = Date.UTC(2026, 9, 23) // 23 Oct 2026, the demo world's today
const DAY = 86400000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type TimeFrame = {
  t: 'always' | 'ongoing' | 'since' | 'until' | 'range'
  from?: number
  to?: number
}

/** "4 Aug 2026", "4 August 2026" or "4 Aug" (with a year to fall back on) as a UTC day. */
function day(s: string, year?: number): number | undefined {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s*(\d{4})?$/)
  if (!m) return undefined
  const mon = MON.indexOf(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase())
  const y = m[3] ? Number(m[3]) : year
  return mon < 0 || !y ? undefined : Date.UTC(y, mon, Number(m[1]))
}

/** Reads the free text the editor writes ("From 4 Aug 2026, still going on", "12 to 19 May 2026"). */
export function parseWhen(when: string): TimeFrame {
  const w = when.trim()
  if (/^always$/i.test(w)) return { t: 'always' }
  if (/^still going on$/i.test(w)) return { t: 'ongoing' }
  let m = w.match(/^from (.+?)(, still going on)?$/i)
  if (m) return { t: 'since', from: day(m[1]) }
  m = w.match(/^until (.+)$/i)
  if (m) return { t: 'until', to: day(m[1]) }
  m = w.match(/^(.+?) to (.+)$/)
  if (m) {
    const to = day(m[2])
    const year = to ? new Date(to).getUTCFullYear() : undefined
    // "12 to 19 May 2026": the start borrows the end's month and year.
    const from =
      day(m[1], year) ??
      (to && /^\d{1,2}$/.test(m[1].trim())
        ? Date.UTC(year!, new Date(to).getUTCMonth(), Number(m[1]))
        : undefined)
    return { t: 'range', from, to }
  }
  return { t: 'ongoing' }
}

const dm = (t: number) => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`
const yr = (t: number) => new Date(t).getUTCFullYear()
const yy = (t: number) => String(yr(t)).slice(2)
const dmy = (t: number) => `${dm(t)} ${yr(t)}`
const withYear = (t: number) => `${dm(t)}${yr(t) !== 2026 ? ' ' + yy(t) : ''}`

/** The short phrase: Always, Ongoing, Since 4 Aug, Until 19 Jan 26, 12–19 May. */
export function timeShort(t: TimeFrame) {
  if (t.t === 'always') return 'Always'
  if (t.t === 'ongoing') return 'Ongoing'
  if (t.t === 'since') return t.from ? `Since ${withYear(t.from)}` : 'Ongoing'
  if (t.t === 'until') return t.to ? `Until ${withYear(t.to)}` : 'Until'
  if (!t.from || !t.to) return 'A while'
  const a = new Date(t.from)
  const b = new Date(t.to)
  if (yr(t.from) === yr(t.to) && a.getUTCMonth() === b.getUTCMonth())
    return `${a.getUTCDate()}–${withYear(t.to)}`
  if (yr(t.from) === yr(t.to)) return `${dm(t.from)} – ${withYear(t.to)}`
  return `${dm(t.from)} ${yy(t.from)} – ${dm(t.to)} ${yy(t.to)}`
}

/** The date part only, for design B's glyph label: the glyph already says since, until or a range. */
export function timeDate(t: TimeFrame) {
  if (t.t === 'since') return t.from ? withYear(t.from) : 'Ongoing'
  if (t.t === 'until') return t.to ? withYear(t.to) : 'Until'
  return timeShort(t)
}

/** The full phrase for the tooltip, and whether it holds today. */
export function timeLong(t: TimeFrame) {
  if (t.t === 'always') return 'Always'
  if (t.t === 'ongoing') return 'Still going on'
  if (t.t === 'since') return t.from ? `From ${dmy(t.from)}, still going on` : 'Still going on'
  if (t.t === 'until') return t.to ? `Until ${dmy(t.to)}` : 'Until a date'
  return t.from && t.to ? `${dmy(t.from)} to ${dmy(t.to)}` : 'For a while'
}
export function inForce(t: TimeFrame) {
  if (t.t === 'since') return !t.from || t.from <= TODAY
  if (t.t === 'until') return !t.to || t.to >= TODAY
  if (t.t === 'range') return !!t.from && !!t.to && t.from <= TODAY && t.to >= TODAY
  return true
}
export const timeNow = (t: TimeFrame) =>
  inForce(t)
    ? 'In force now'
    : t.t === 'since' && t.from && t.from > TODAY
      ? `Starts ${dmy(t.from)}`
      : 'Over'

export type Trust = 'fresh' | 'ageing' | 'due' | 'draft' | 'retired'

export function ageDays(checkedOn: string) {
  const d = day(checkedOn)
  return d ? Math.max(0, Math.round((TODAY - d) / DAY)) : undefined
}

export function trustOf(f: Fact): Trust {
  if (f.status === 'Archived') return 'retired'
  const age = ageDays(f.checkedOn)
  if (age === undefined) return 'draft'
  if (f.status === 'Needs checking' || age > 90) return 'due'
  return age > 30 ? 'ageing' : 'fresh'
}

/** The dot's tooltip: the exact check, by whom, and what the dot means. */
export function checkedTip(f: Fact) {
  const trust = trustOf(f)
  if (f.status === 'Draft')
    return `A draft${f.by ? ` by ${f.by}` : ''}: checked when it is published.`
  const age = ageDays(f.checkedOn)
  const lines = [
    `Checked ${f.checkedOn} by ${f.checkedBy}${age !== undefined ? `, ${age} days ago` : ''}`,
  ]
  if (trust === 'retired') lines.push('No longer checked')
  else if (trust === 'due')
    lines.push(f.outOfDate ? 'A definition it relies on changed since' : 'Its check is due')
  else if (trust === 'ageing') lines.push('A check is due after 90 days')
  else lines.push('Checked in the last 30 days')
  return lines.join('. ') + '.'
}
