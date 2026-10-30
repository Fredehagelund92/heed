import {
  coarseOf,
  coarseTotal,
  mondayOf,
  piecesOf,
  summaryPeriod,
  summaryView,
  trendWeeks,
  weekSpan,
} from '@domain/obs-summary'
import { zeroCounts } from '@domain/observability'
import type { ObsSummaryInput } from '@/api/client'
import { HIDE_UNDER, SHOWN } from '@/model/observability'
import type { SummaryData } from '@/model/obs-summary'
import { openSince } from './data/observability'
import { observability as engineOf, type ObsData as Fixture } from './obs-engine'
import type { Reader } from './obs-page'

// Summary as the mock binding reads it: the demo world's days (data/observability.ts), cut into
// the same pieces as the service cuts them and through the same disclosure pass
// (src/domain/obs-summary.ts), so both bindings hide the same counts. The mock keeps every day it
// has, so a whole week and a piece of one both come from its days.

const DAY = 86_400_000
const iso = (at: number) => new Date(at).toISOString().slice(0, 10)
const atOf = (day: string) => Date.parse(`${day}T00:00:00Z`)

export function obsSummary(fixture: Fixture, input: ObsSummaryInput, reader: Reader): SummaryData {
  const today = iso(fixture.last + DAY)
  const { now, before } = summaryPeriod(input.period, today)
  const weeks = trendWeeks(now)
  const period = (s: { start: string; end: string }) => ({ start: atOf(s.start), end: atOf(s.end) })
  const base: SummaryData = {
    state: 'normal',
    period: input.period,
    last: fixture.last,
    now: period(now),
    before: period(before),
    since: null,
    complete: true,
    numbers: { asked: null, checked: null, warned: null, missing: null },
    previous: null,
    notCompared: null,
    weeks: weeks.map((w) => ({ at: atOf(w), counted: false, checked: null })),
    open: { total: 0, spots: [] },
    changes: { total: null, before: null, latest: [] },
    hidden: 0,
  }
  if (fixture.state === 'empty') return { ...base, state: 'empty' }
  const since = fixture.days[0]!.at
  if (fixture.state === 'quiet') return { ...base, state: 'quiet', since }

  const engine = engineOf(fixture)
  // An owner reads one of the domains they own; an admin every one, or the one they chose.
  const domain = reader.admin ? input.domain : (input.domain ?? reader.owns[0])
  const days = engine
    .calendarDays({ domain, scale: fixture.state === 'busy' ? 3.4 : 1 })
    .map((d) => ({ day: iso(d.at), counts: d.counts }))
  const pieces = piecesOf([now, before, ...weeks.map(weekSpan)]).map((p) => {
    const c = zeroCounts()
    for (const d of days)
      if (d.day >= p.start && d.day < p.end) for (const k of SHOWN) c[k] += d.counts[k]
    return { ...p, counts: coarseOf(c) }
  })
  const inside = (p: { start: string; end: string }, s: { start: string; end: string }) =>
    p.start >= s.start && p.end <= s.end
  const asked = pieces.filter((p) => inside(p, now)).reduce((n, p) => n + coarseTotal(p.counts), 0)
  if (asked < HIDE_UNDER) return { ...base, state: 'quiet', since }
  const first = iso(since)
  const notCompared = before.start < first ? ('started' as const) : null
  const drawn = weeks.filter((w) => w >= mondayOf(first))

  // What is still open: the topics with a gap, one per subject, by what found nothing about them
  // in the period: their week's share of it.
  const missingNow = pieces.filter((p) => inside(p, now)).reduce((n, p) => n + p.counts.missing, 0)
  const weekMissing = fixture.topics.reduce((n, t) => n + t.week.missing, 0)
  const mine = (t: Fixture['topics'][number]) =>
    !!t.gap &&
    (domain ? t.domain === domain : reader.admin || (!!t.domain && reader.owns.includes(t.domain)))
  const subjects = new Map<string, { t: Fixture['topics'][number]; missing: number }>()
  for (const t of fixture.topics.filter(mine)) {
    const key = `${t.domain}|${t.metric}|${t.where}`
    const was = subjects.get(key)
    subjects.set(key, { t: was?.t ?? t, missing: (was?.missing ?? 0) + t.week.missing })
  }
  const spots = [...subjects.values()]
    .map((s) => ({ ...s, missing: Math.round((s.missing / weekMissing) * missingNow) }))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 3)

  const publishes = (s: { start: string; end: string }) =>
    fixture.publishes.filter(
      (p) => p.at >= atOf(s.start) && p.at < atOf(s.end) && (!domain || p.domain === domain),
    )

  const view = summaryView(
    {
      pieces,
      now,
      before: notCompared ? null : before,
      weeks: drawn,
      open: spots.map((s) => s.missing),
      since: first,
      changes: { now: publishes(now).length, before: publishes(before).length },
    },
    HIDE_UNDER,
  )
  const byWeek = new Map(view.weeks.map((w) => [w.start, w]))
  return {
    ...base,
    since,
    numbers: view.now,
    previous: view.before,
    notCompared,
    weeks: weeks.map((w) => {
      const shown = byWeek.get(w)
      return shown
        ? { at: atOf(w), counted: true, checked: shown.checked }
        : { at: atOf(w), counted: false, checked: null }
    }),
    open: {
      total: subjects.size,
      spots: spots.map((s, i) => ({
        id: s.t.id,
        title: engine.topicName(s.t),
        ...(s.t.domain ? { domain: s.t.domain } : {}),
        since: atOf(openSince[s.t.id] ?? iso(fixture.last)),
        missing: view.open[i] ?? null,
        label: s.t.gap!.label,
        href: s.t.gap!.href,
      })),
    },
    changes: {
      total: view.changes.now,
      before: view.changes.before,
      latest: publishes(now)
        .slice(0, 5)
        .map((p) => ({ at: p.at, title: p.title, domain: p.domain, by: p.by })),
    },
    hidden: view.hidden,
  }
}
