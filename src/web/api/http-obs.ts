/**
 * Observability on the http binding: the service's reads (src/contract/observability.ts) as the
 * pages read them (model/observability.ts). The service has disclosed every count already (FR-614):
 * nothing here adds a count up into one the service did not give.
 */
import type { Replay as ServiceReplay } from '@contract/answer'
import type {
  ObsAgents,
  ObsFeedback,
  ObsSnapshot,
  ObsSnapshotItem,
  ObsSnapshotTake,
  ObsSummary,
  ObsTopic,
  ObsUsage,
  ObsView,
} from '@contract/observability'
import { appFamilies, appFamilyNames, type AppFamily } from '@domain/app-family'
import type { Answer } from '@/model/ask'
import { stateLabel } from '@/model/ask'
import type { SavedView } from '@/lib/obs-views'
import {
  dateLabel,
  dayLabel,
  monthName,
  monthShort,
  type ObsData,
  type Range,
  type Report,
  type Topic,
} from '@/model/observability'
import type { Snapshot, SnapshotItem, SummaryData } from '@/model/obs-summary'
import { NEXT, type Replay, type ReplayStep } from '@/model/replay'

const none = { grounded: null, partial: null, conflict: null, stale: null, missing: null }

/** A page with nothing on it, for a view: what the service sends before anything was asked. */
export const emptyObs = (range: Range, state: ObsData['state'] = 'normal'): ObsData => ({
  state,
  range,
  last: Date.now(),
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
})

/** A kind of agent as the pages name it: FR-410's fixed list, "Other agents" for the rest. */
export const agentName = (family: AppFamily) =>
  family === 'other' ? 'Other agents' : appFamilyNames[family]
/** The kind of agent a name on the page stands for. */
export const familyOf = (name: string): AppFamily | undefined =>
  appFamilies.find((f) => agentName(f) === name)

const atOf = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`)

/** Where a topic's "found nothing" went in the Inbox: its draft, a suggestion, or its card. */
function gapOf(gap: ObsTopic['gap']): Topic['gap'] {
  if (!gap) return undefined
  if (gap.state === 'draft' && gap.proposalId)
    return { label: 'Draft ready', href: `/inbox?card=${gap.proposalId}` }
  if (gap.state === 'suggestion' && gap.proposalId)
    return { label: 'A suggestion waits', href: `/inbox/${gap.proposalId}/review` }
  return { label: 'No draft yet', href: `/inbox?card=gap:${gap.id}` }
}

/** Summary's page from the service's read: days as UTC timestamps, where an open spot waits. */
export function obsSummaryOf(s: ObsSummary): SummaryData {
  const period = (p: ObsSummary['now']) => ({ start: atOf(p.start), end: atOf(p.end) })
  return {
    state: s.state,
    period: s.period,
    last: atOf(s.last),
    now: period(s.now),
    before: period(s.before),
    since: s.since ? atOf(s.since) : null,
    complete: s.complete,
    numbers: s.numbers,
    previous: s.previous,
    notCompared: s.notCompared,
    weeks: s.weeks.map((w) => ({
      at: atOf(w.start),
      counted: w.counted,
      checked: w.checked,
    })),
    open: {
      total: s.open.total,
      spots: s.open.spots.map((o) => {
        const gap = gapOf({ id: o.id, state: o.state, proposalId: o.proposalId })!
        return {
          id: o.id,
          title: o.title,
          ...(o.areaId ? { domain: o.areaId } : {}),
          since: atOf(o.firstSeen),
          missing: o.missing,
          label: gap.label,
          href: gap.href,
        }
      }),
    },
    changes: {
      total: s.changes.total,
      before: s.changes.before,
      latest: s.changes.latest.map((c) => ({
        at: Date.parse(c.at),
        title: c.title,
        ...(c.areaId ? { domain: c.areaId } : {}),
        by: c.by ?? 'Someone',
        href: `/context/${c.itemId}`,
      })),
    },
    hidden: s.hidden,
  }
}

/** A monthly snapshot as a list shows it. */
export function obsSnapshotItemOf(s: ObsSnapshotItem): SnapshotItem {
  return {
    id: s.id,
    ...(s.areaId ? { domain: s.areaId } : {}),
    now: { start: atOf(s.now.start), end: atOf(s.now.end) },
    takenOn: atOf(s.takenOn),
    state: s.state,
  }
}

/** A snapshot as its digest reads it: the Summary's counts, with no list kept, and its words. */
export function obsSnapshotOf(s: ObsSnapshot): Snapshot {
  const { open, changes } = s.summary
  return {
    ...obsSnapshotItemOf(s),
    data: obsSummaryOf({
      ...s.summary,
      open: { total: open.total, spots: [] },
      changes: { ...changes, latest: [] },
    }),
    words: s.words,
  }
}

/** The month a snapshot was taken of, and how many scopes it was taken for. */
export const obsSnapshotTakeOf = (t: ObsSnapshotTake) => ({
  now: { start: atOf(t.now.start), end: atOf(t.now.end) },
  taken: t.taken,
})

export function topicOf(t: ObsTopic): Topic {
  return {
    id: t.id,
    metric: t.metric,
    where: t.values.length ? t.values.join(', ') : 'All markets',
    ...(t.areaId ? { domain: t.areaId } : {}),
    month: t.month,
    subject: t.subject,
    ...(t.named === 'metric' ? {} : { named: t.named }),
    total: t.total,
    atLeast: t.atLeast,
    counts: t.counts,
    in: t.in,
    ...(t.gap ? { gap: gapOf(t.gap) } : {}),
  }
}

const subjectOf = (s: ObsAgents['subjects'][number]) => ({
  key: s.key,
  ...(s.areaId ? { domain: s.areaId } : {}),
  topics: s.topics,
  total: s.total,
  atLeast: s.atLeast,
  counts: s.counts,
})

/** Overview's and Questions' page from the service's read. */
export function obsAgentsOf(view: ObsAgents, range: Range): ObsData {
  const base = emptyObs(range, view.state)
  const markets = [
    ...new Set(
      [...view.topics, ...view.notFoundTopics]
        .filter((t) => t.dimension === 'market')
        .flatMap((t) => t.values),
    ),
  ]
  return {
    ...base,
    last: atOf(view.last),
    numbers: view.numbers,
    bars: view.bars.map((b) => ({
      label: range === 90 ? dateLabel(atOf(b.start)) : dayLabel(atOf(b.start)),
      at: atOf(b.start),
      counts: b.counts,
    })),
    topics: view.topics.map(topicOf),
    subjects: view.subjects.map(subjectOf),
    domains: view.domains.map((d) => ({
      ...(d.areaId ? { domain: d.areaId } : {}),
      total: d.total,
      atLeast: d.atLeast,
    })),
    notFound: {
      subjects: view.notFound.map(subjectOf),
      topics: view.notFoundTopics.map(topicOf),
    },
    couldNotRead: view.couldNotRead,
    markets,
    publishes: view.publishes.map((p) => ({
      at: Date.parse(p.at),
      title: p.title,
      by: p.by ?? 'Someone',
      ...(p.areaId ? { domain: p.areaId } : {}),
    })),
    agents: view.agents.map((a) => ({ name: agentName(a.family), count: a.count })),
  }
}

/** When something happened, as the pages say it: "Today", "Yesterday", "Tue 20 Oct". */
export function whenOf(at: string, now: Date) {
  const day = at.slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  return `${dayLabel(atOf(day))} ${dateLabel(atOf(day)).split(' ')[1]}`
}

const lines: Record<ObsFeedback['reports'][number]['kind'], string> = {
  helpful: 'From an agent: gave feedback that the answer helped.',
  wrong: 'From an agent: reported the answer as wrong.',
  missing: 'From an agent: reported that something was missing.',
  unclear: 'From an agent: reported the answer as unclear.',
  gap: 'Reported a gap. No name is kept.',
  named: 'Reported from Ask.',
}

/** Feedback's page from the service's read: an agent's report by its kind, never a person. */
export function obsFeedbackOf(f: ObsFeedback, range: Range, now: Date): ObsData {
  const reports = f.reports.map((r): Report => ({
    id: r.id,
    title: r.about,
    line: r.note ? `${lines[r.kind].replace(/\.$/, '')}: “${r.note}”` : lines[r.kind],
    state: r.state,
    ...(r.areaId ? { domain: r.areaId } : {}),
    // A person's report from Try it or the assistant keeps no name (FR-606 case 5); a named
    // report from Ask is sent with one, on purpose (FR-622).
    from:
      r.from === 'agent' && r.agent
        ? agentName(r.agent as AppFamily)
        : r.by
          ? `${r.by}, from Ask`
          : 'A person, no name kept',
    agent: r.from === 'agent',
    when: whenOf(r.at, now),
    href: r.card
      ? `/inbox?card=${r.card}`
      : r.itemId
        ? `/context/${r.itemId}`
        : r.topicId
          ? `/observability/questions?dock=topic.${r.topicId}`
          : '/observability/feedback',
  }))
  return {
    ...emptyObs(range, f.state),
    feedback: {
      reports,
      goodByWeek: {
        labels: f.goodByWeek.map((w) => dateLabel(atOf(w.week))),
        values: f.goodByWeek.map((w) => w.count),
      },
      week: f.week,
    },
  }
}

const featureNames: Record<string, string> = { assistant: 'Ask', eval: 'Answer tests' }

/** Usage's page from the service's read, for admins. */
export function obsUsageOf(u: ObsUsage, range: Range, now: Date): ObsData {
  const usd = (micros: number) => micros / 1_000_000
  const last = (at: string | null) => {
    if (at === null) return '-'
    const when = whenOf(at, now)
    return when === 'Today' ? `Today, ${at.slice(11, 16)}` : when
  }
  return {
    ...emptyObs(range, u.state),
    last: atOf(u.last),
    usage: {
      tools: u.tools.map((t) => ({ name: t.tool, ...t })),
      before: u.callsBefore || null,
      // Calls whose question could not be read, as the tools count them.
      couldNotRead: u.tools.reduce((n, t) => n + t.detail, 0),
      agents: u.agents.map((a) => ({
        name: agentName(a.family),
        calls: a.calls,
        last: last(a.lastAt),
      })),
      speed: {
        median: u.speed.map((s) => s.median),
        p95: u.speed.map((s) => s.p95),
        labels: u.speed.map((s) =>
          range === 7 ? dayLabel(atOf(s.start)) : dateLabel(atOf(s.start)),
        ),
        per: range === 7 ? 'day' : 'week',
      },
      spend: {
        total: usd(u.spend.totalMicros),
        cap: usd(u.spend.caps.monthlyMicros),
        parts: u.spend.features.map((f) => ({
          name: featureNames[f.feature] ?? f.feature,
          amount: usd(f.micros),
        })),
        limits: [
          {
            name: 'Each month, all model use',
            used: usd(u.spend.totalMicros),
            cap: usd(u.spend.caps.monthlyMicros),
          },
          {
            name: 'Each person, each day',
            used: usd(u.spend.caps.personTodayMicros),
            cap: usd(u.spend.caps.dailyPersonMicros),
          },
          {
            name: 'Answer tests, each month',
            used: usd(u.spend.features.find((f) => f.feature === 'eval')?.micros ?? 0),
            cap: usd(u.spend.caps.featureMicros.eval ?? 0),
          },
        ],
      },
    },
  }
}

/** A view saved on Questions, as the tabs read it. */
export const savedViewOf = (v: ObsView): SavedView => ({
  id: v.id,
  name: v.name,
  filters: {
    ...(v.filters.answer?.length ? { answer: v.filters.answer } : {}),
    ...(v.filters.domain ? { domain: v.filters.domain } : {}),
    ...(v.filters.agent ? { agent: v.filters.agent } : {}),
    ...(v.filters.gap?.length ? { gap: v.filters.gap } : {}),
    ...(v.filters.month ? { month: v.filters.month } : {}),
  },
  by: v.by,
  custom: true,
})

const why: Record<string, string> = {
  source_visibility: 'is not shared with agents',
  stopped: 'is stopped',
  high_risk_unverified: 'needs a check before agents get it',
  cut: 'did not fit the reply',
  replaced: 'was replaced',
  dates: 'is for other dates',
  values: 'is about another market',
  dimension: 'is about another breakdown',
}

/** A topic as the answer panel names it, from the page that listed it. */
export type ReplayTopic = Pick<Topic, 'metric' | 'where' | 'month'> & { name: string }

/** A month as the dates read from a question: "1 to 30 Sep 2026". */
function monthDays(m: string) {
  const [y = 0, mo = 0] = m.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const [name, year] = monthShort(m).split(' ')
  return `1 to ${last} ${name} ${year}`
}

/** A replay as the answer panel reads it: the engine's own steps, in the panel's words. */
export function replayOf(
  run: ServiceReplay,
  topic: ReplayTopic,
  before: ServiceReplay | null,
  /** The live edition's label, such as 2026-10-20.3: the day of the last publish. */
  live: string,
): Replay {
  const a = run.answer
  const n = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`
  const month = monthName(topic.month)
  const stepsOf = (r: ServiceReplay): ReplayStep[] => {
    const ms = (step: string) => r.answer.steps.find((s) => s.step === step)?.ms ?? 0
    const used = r.answer.items
    return [
      {
        key: 'scope',
        title: 'Read the scope',
        ms: ms('read_scope'),
        text: 'The dates were read from the question, and kept as a scope. The words are not kept.',
        scope: [
          ...(topic.metric ? [{ label: topic.metric, kind: 'metric' as const }] : []),
          { label: topic.where, kind: 'market' as const },
          { label: monthDays(topic.month), kind: 'dates' as const },
        ],
      },
      {
        key: 'looked',
        title: 'Looked for context',
        ms: ms('looked_up'),
        text: `${n(used.length, 'context item')} ${used.length === 1 ? 'applies' : 'apply'} to ${topic.name} in ${month}.`,
        items: used.map((i) => ({ id: i.id, title: i.title })),
      },
      {
        key: 'left',
        title: 'Left out',
        ms: ms('left_out'),
        text: r.answer.leftOut.length
          ? `${n(r.answer.leftOut.length, 'item')} did not reach the agent.`
          : 'Nothing about it was left out.',
        items: r.answer.leftOut.map((l) => ({
          id: l.id,
          title: l.title,
          why: why[l.reason] ?? '',
        })),
      },
      { key: 'checked', title: 'Checked', ms: ms('checked'), text: stateLabel[r.answer.state] },
      { key: 'said', title: 'Said', ms: ms('said'), text: r.answer.say },
      {
        key: 'next',
        title: 'Told the agent what to do next',
        ms: 0,
        text: r.answer.next ?? NEXT[r.answer.state],
      },
    ]
  }
  const steps = stepsOf(run)
  const was = before ? stepsOf(before) : steps
  const answer: Answer = {
    id: `replay:${run.when}`,
    question: `What should I know about ${topic.name} in ${month}?`,
    metric: topic.metric,
    markets: topic.where === 'All markets' ? [] : [topic.where],
    state: a.state,
    text: a.say,
    sources: a.items.map((i) => i.id),
    said: a.say,
  }
  // What it is compared with is what agents got before the last publish, on that day.
  const published = live.slice(0, 10)
  return {
    answer,
    steps,
    ms: steps.reduce((t, s) => t + (s.ms ?? 0), 0),
    changed: steps
      .filter(
        (s, i) =>
          s.text !== was[i]!.text || JSON.stringify(s.items) !== JSON.stringify(was[i]!.items),
      )
      .map((s) => s.key),
    before: { label: `Before ${dateLabel(atOf(published))}`, title: '' },
  }
}
