import {
  answersOf,
  barsOf,
  beforeView,
  shownParts,
  topicView,
  zeroCounts,
  type ShownGroup,
  type StateCounts,
  type TopicCounts,
} from '@domain/observability'
import { visibleCount } from '@domain/gaps'
import type { DomainId } from '@/model/items'
import {
  dateLabel,
  dayLabel,
  HIDE_UNDER,
  SHOWN,
  type Counts,
  type ObsData,
  type ObsState,
  type Range,
  type Topic,
  type View,
} from '@/model/observability'
import {
  observability as engineOf,
  total,
  type ObsData as Fixture,
  type Topic as FixtureTopic,
} from './obs-engine'

// An Observability page as the mock binding reads it: the demo world's fixtures (data/observability.ts)
// counted for the view by the fixture engine (obs-engine.ts), then through the same disclosure as
// the service (src/domain/observability.ts), so both bindings hide the same counts and never give a
// hidden one away.

/** Who reads: an admin sees every domain and the calls with none; an owner their own domains. */
export type Reader = { admin: boolean; owns: DomainId[] }

const min = HIDE_UNDER
const iso = (at: number) => new Date(at).toISOString().slice(0, 10)
const atOf = (day: string) => Date.parse(`${day}T00:00:00Z`)
/** A subject: the scope without its month, as the service keys it. */
const subjectOf = (t: FixtureTopic) =>
  [t.domain ?? '', t.named ?? 'metric', t.metric, t.where].join('|')
const counts = (c: StateCounts): Counts => ({ ...c })

function empty(state: ObsState, range: Range, last: number): ObsData {
  const none = { grounded: null, partial: null, conflict: null, stale: null, missing: null }
  return {
    state,
    range,
    last,
    numbers: { asked: null, counts: none, before: { asked: null, missing: null, grounded: null } },
    bars: [],
    topics: [],
    subjects: [],
    domains: [],
    notFound: { subjects: [], topics: [] },
    couldNotRead: null,
    markets: [],
    publishes: [],
    agents: [],
    feedback: null,
    usage: null,
  }
}

/** How a range and the review flag scale the week the board draws, for what has no days. */
const scaleOf = (range: number, state: ObsState) =>
  (range === 7 ? 1 : range === 30 ? 4.3 : 12.9) * (state === 'busy' ? 3.4 : 1)

/** An Observability page's data for a view, as the reader may see it. */
export function obsPage(fixture: Fixture, view: View, reader: Reader): ObsData {
  const { state } = fixture
  const range = view.range
  if (state === 'empty' || state === 'quiet') return empty(state, range, fixture.last)
  const engine = engineOf(fixture)
  const scale = state === 'busy' ? 3.4 : undefined
  const mine = (t: Pick<FixtureTopic, 'domain'>) =>
    reader.admin || (!!t.domain && reader.owns.includes(t.domain))
  // An owner reads one of the domains they own; an admin every one, or the one they chose.
  const domain = reader.admin ? view.domain : (view.domain ?? reader.owns[0])
  const agent = reader.admin ? view.agent : undefined

  const rowsOf = (r: Range, kind?: string) =>
    engine.topicsOf({ range: r, agent: kind, scale }).filter(mine)
  const toCounts = (rows: ReturnType<typeof rowsOf>, whole?: ReturnType<typeof rowsOf>) =>
    rows.map((t): TopicCounts => ({
      id: t.id,
      domain: t.domain ?? null,
      subject: subjectOf(t),
      counts: t.counts,
      ...(whole ? { whole: whole.find((w) => w.id === t.id)!.counts } : {}),
    }))
  const rows = rowsOf(range, agent)
  const daysOf = (kind?: string, back = 0) =>
    engine
      .daysOf({ range, domain, agent: kind, scale }, back)
      .map((d) => ({ day: iso(d.at), counts: d.counts }))
  const wholeBars = agent ? barsOf(daysOf(), range) : null
  const bars = barsOf(daysOf(agent), range).map((b, i) => ({
    ...b,
    ...(wholeBars ? { whole: wholeBars[i]!.counts } : {}),
  }))
  const shown = topicView(toCounts(rows, agent ? rowsOf(range) : undefined), min, {
    bars,
    ...(domain ? { domain } : {}),
  })
  const sum = (days: { counts: StateCounts }[]) => {
    const c = zeroCounts()
    for (const d of days) for (const s of SHOWN) c[s] += d.counts[s]
    return c
  }
  const before = beforeView(
    sum(daysOf(agent, 1)),
    min,
    agent ? sum(daysOf(undefined, 1)) : undefined,
  )

  // The subjects that found nothing at least the minimum times in the range.
  const missingOf = new Map<string, number>()
  for (const t of rows)
    missingOf.set(subjectOf(t), (missingOf.get(subjectOf(t)) ?? 0) + t.counts.missing)

  const byId = new Map(shown.topics.map((t) => [t.id, t]))
  const topicOf = (
    t: FixtureTopic & { counts: StateCounts },
    seen: { total: number | null; atLeast: number; counts: Counts },
    subjects: Map<string, ShownGroup>,
  ): Topic => {
    const asked = total(t.counts)
    const shares = fixture.agents.map((a) => Math.round((a.week / fixture.weekTotal) * asked))
    const agents = shownParts(shares, min).parts
    return {
      id: t.id,
      metric: t.metric,
      where: t.where,
      domain: t.domain,
      month: t.month,
      subject: subjectOf(t),
      named: t.named,
      total: seen.total,
      atLeast: seen.atLeast,
      counts: seen.counts,
      in: {
        notFound: (missingOf.get(subjectOf(t)) ?? 0) >= min,
        reported: !!t.reported,
        answers: answersOf(subjects.get(subjectOf(t))!),
      },
      gap: t.gap,
      disagree: t.disagree === undefined ? undefined : visibleCount(t.disagree, min),
      spark: engine.sparkOf(t, { range, agent, scale }),
      agents: fixture.agents
        .slice(0, 3)
        .map((a, i) => ({ name: a.name, count: agents[i] ?? null })),
    }
  }

  // What found nothing in the last 7 days, its months counted together (FR-606 case 1).
  const week = rowsOf(7, agent)
  const weekShown = range === 7 ? shown : topicView(toCounts(week), min)
  const weekMissing = new Map<string, number>()
  for (const t of week)
    weekMissing.set(subjectOf(t), (weekMissing.get(subjectOf(t)) ?? 0) + t.counts.missing)
  const notFound = weekShown.subjects.filter((s) => (weekMissing.get(s.key) ?? 0) >= min)
  const weekById = new Map(weekShown.topics.map((t) => [t.id, t]))

  const agentCounts = engine.agentsOf({ range, domain, scale })
  const agentShown = shownParts(
    agentCounts.map((a) => a.count),
    min,
  ).parts

  const k = scaleOf(range, state)
  const n = (v: number) => Math.round(v * k)
  const calls = fixture.agentCalls.map((a) => n(a.calls))
  // The tool calls add up to every kind of agent's together, as on the service.
  const callsShown = shownParts(calls, min, { known: true }).parts
  const speed = engine.speedOf(range)

  return {
    state,
    range,
    last: fixture.last,
    numbers: { asked: shown.asked, counts: shown.counts, before },
    bars: shown.bars.map((b) => ({
      label: range === 90 ? dateLabel(atOf(b.start)) : dayLabel(atOf(b.start)),
      at: atOf(b.start),
      counts: b.counts,
    })),
    topics: rows.map((t) =>
      topicOf(t, byId.get(t.id)!, new Map(shown.subjects.map((g) => [g.key, g]))),
    ),
    subjects: shown.subjects.map((s) => ({ ...s, domain: s.domain ?? undefined })),
    domains: shown.domains.map((d) => ({ ...d, domain: d.domain ?? undefined })),
    notFound: {
      subjects: notFound.map((s) => ({ ...s, domain: s.domain ?? undefined })),
      topics: notFound.flatMap((s) =>
        s.topics.map((id) =>
          topicOf(
            week.find((t) => t.id === id)!,
            weekById.get(id)!,
            new Map(weekShown.subjects.map((g) => [g.key, g])),
          ),
        ),
      ),
    },
    couldNotRead:
      reader.admin && !domain
        ? visibleCount(engine.couldNotRead({ range, agent, scale }), min)
        : null,
    markets: fixture.markets,
    publishes: engine.publishesIn({ range, domain }),
    agents: reader.admin
      ? agentCounts.map((a, i) => ({ name: a.name, count: agentShown[i] ?? null }))
      : [],
    feedback: {
      reports: fixture.reports.filter((r) => mine(r)),
      goodByWeek: {
        labels: fixture.goodByWeek.labels,
        values: fixture.goodByWeek.values.map((v) => visibleCount(v, min)),
      },
      week: {
        good: visibleCount(Math.round(fixture.feedbackWeek.good * k), min),
        goodBefore:
          range === 7
            ? visibleCount(fixture.feedbackWeek.good - fixture.feedbackWeek.goodChange, min)
            : null,
        wrong: visibleCount(Math.round(fixture.feedbackWeek.wrong * k), min),
      },
    },
    usage: reader.admin
      ? {
          tools: fixture.toolCalls.map((t) => ({
            name: t.name,
            calls: n(t.calls),
            answered: n(t.answered),
            detail: n(t.detail),
            nothing: n(t.nothing),
            failed: n(t.failed),
          })),
          before: range === 7 && state === 'normal' ? 289 : null,
          couldNotRead: n(2),
          agents: fixture.agentCalls
            .map((a, i) => ({ name: a.name, calls: callsShown[i] ?? null, last: a.last }))
            .filter((_, i) => calls[i]! > 0),
          speed: {
            median: speed.median,
            p95: speed.p95,
            labels: speed.labels,
            per: speed.per as 'day' | 'week',
          },
          spend: fixture.spend,
        }
      : null,
  }
}

export { counts as countsOf }
