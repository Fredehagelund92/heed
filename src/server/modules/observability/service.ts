import { ORPCError } from '@orpc/client'
import type {
  ObsAgents,
  ObsAgentsInput,
  ObsFeedback,
  ObsTopic,
  ObsUsage,
  ObsView,
  ObsViewFilters,
} from '../../../contract/observability.ts'
import { appFamilyOf, type AppFamily } from '../../../domain/app-family.ts'
import { visibleCount } from '../../../domain/gaps.ts'
import {
  addCounts,
  barsOf,
  answersOf,
  beforeView,
  shownParts,
  sumCounts,
  topicView,
  zeroCounts,
  type StateCounts,
  type TopicCounts,
} from '../../../domain/observability.ts'
import { shiftDate } from '../../../domain/validity.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { readSpendLimits } from '../models/index.ts'

/**
 * Observability's reads (FR-620): what agents asked and how it was answered, from the delivery
 * records (FR-601), which keep a scope, a topic, the answer state and the kind of agent, never
 * the words of a question or who asked (FR-602, FR-613). Administrators read every domain and the
 * calls with no domain; an owner reads the domains they own. Every count goes through
 * src/domain/observability.ts first: a small one is hidden, and no count gives a hidden one away
 * (FR-614). A view runs back from the last full day (yesterday), so a day is never half counted.
 */

const minimumCount = `(select (value #>> '{}')::int from settings_current where key = 'privacy.min_count')`

async function minimum(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ minimum: number | null }>(`select ${minimumCount} as minimum`)
  return row?.minimum ?? 5
}

/** Who reads: an administrator (every domain, and calls with none), or an owner of some. */
async function reader(tx: Queryable, area: string | undefined) {
  const [me] = await tx.query<{ admin: boolean; areas: string[] }>(
    `select cl_is_admin_now() as admin,
            coalesce(array_agg(a.id order by a.id) filter (where cl_is_owner_now(a.id)),'{}') as areas
       from areas a`,
  )
  const admin = !!me?.admin
  const owned = me?.areas ?? []
  if (!admin && !owned.length)
    throw new ORPCError('FORBIDDEN', {
      message: 'Observability is for the owners of a domain and admins.',
    })
  if (area && !admin && !owned.includes(area))
    throw new ORPCError('FORBIDDEN', {
      message: 'You see Observability for the domains you own.',
    })
  /** The domains read: one asked for, an owner's own, or every one (null) for an administrator. */
  const areas = area ? [area] : admin ? null : owned
  return { admin, areas, owned }
}

/** The days of a view: the range back from yesterday, and the same length before it. */
function daysOf(today: string, range: number) {
  const last = shiftDate(today, -1)
  const start = shiftDate(last, -(range - 1))
  const before = shiftDate(start, -range)
  return { last, start, before, end: today }
}

const countsOf = (rows: readonly { state: string; calls: number }[]): StateCounts => {
  const c = zeroCounts()
  for (const r of rows) if (r.state in c) c[r.state as keyof StateCounts] += r.calls
  return c
}

/** The names the definitions give metrics, metric groups, dimensions and values, by key. */
async function vocabularyNames(tx: Queryable): Promise<Map<string, string>> {
  const rows = await tx.query<{ key: string; name: string }>(
    `select distinct on (term_key) term_key as key, name
       from vocab_term_versions order by term_key, version_no desc`,
  )
  return new Map(rows.map((r) => [r.key, r.name]))
}

/** "market/norway" without its dimension, as a last resort for a value with no name. */
const fallbackName = (key: string) => {
  const word = key.split('/').pop() ?? key
  return word.charAt(0).toUpperCase() + word.slice(1).replace(/_/g, ' ')
}

type TopicRow = {
  id: string
  area: string | null
  metrics: string[]
  values: string[]
  dimensions: string[]
  month: string
  state: string
  calls: number
}

/**
 * A topic as people read it: "Orders in Norway"; over every market "Units sold, all markets"; with
 * another value "Discount cost, Black Friday"; with no metric "Norway, no metric named".
 */
function topicName(metrics: string[], values: string[], names: Map<string, string>) {
  const name = (key: string) => names.get(key) ?? fallbackName(key)
  const where = values.map(name).join(', ')
  if (!metrics.length) return `${where || 'Everything'}, no metric named`
  const metric = metrics.map(name).join(', ')
  if (!values.length) return `${metric}, all markets`
  return values.every((v) => v.startsWith('val:market/'))
    ? `${metric} in ${where}`
    : `${metric}, ${where}`
}

/** A topic's scope without its month: the months of one subject read as one row (FR-606). */
const subjectOf = (t: Pick<TopicRow, 'area' | 'metrics' | 'values' | 'dimensions'>) =>
  [t.area ?? '', t.metrics.join(','), t.values.join(','), t.dimensions.join(',')].join('|')

export function createObservabilityService(tx: Queryable, clock: Clock) {
  /** Agent calls per topic and answer state in [from, to), in the domains read. */
  async function topicCounts(
    areas: string[] | null,
    admin: boolean,
    from: string,
    to: string,
    agent?: AppFamily,
  ): Promise<TopicRow[]> {
    return tx.query<TopicRow>(
      `select t.id::text, t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
              t.dimension_keys as dimensions, to_char(t.month, 'YYYY-MM') as month,
              d.answer_state as state, count(*)::int as calls
         from deliveries d join topics t on t.id = d.topic_id
        where d.caller = 'agent' and d.answer_state in ('grounded','partial','conflict','stale','missing')
          and d.delivered_hour >= $1::date and d.delivered_hour < $2::date
          and ($3::text is null or d.app_family = $3)
          and (case when $4::text[] is null then $5 else t.area_id = any($4) end)
        group by 1, 2, 3, 4, 5, 6, 7
        order by 1, 7`,
      [from, to, agent ?? null, areas, admin],
    )
  }

  /** One row per topic, with its counts by answer state. */
  function byTopic(rows: readonly TopicRow[]) {
    const out = new Map<string, Omit<TopicRow, 'state' | 'calls'> & { counts: StateCounts }>()
    for (const r of rows) {
      const t = out.get(r.id) ?? { ...r, counts: zeroCounts() }
      if (r.state in t.counts) t.counts[r.state as keyof StateCounts] += r.calls
      out.set(r.id, t)
    }
    return out
  }

  /** What waits in the Inbox for each scope's gap: a draft, a suggestion, or nothing yet. */
  async function gapsOf(topicIds: string[]) {
    const rows = await tx.query<{
      topic: string
      id: string
      state: 'draft' | 'suggestion' | 'none'
      proposal: string | null
    }>(
      `select t.id::text as topic, g.id::text, coalesce(p.state, 'none') as state, p.proposal
         from topics t
         join lateral (
           select x.id from gaps x join topics xt on xt.id = x.topic_id
            where xt.area_id is not distinct from t.area_id and xt.metric_keys = t.metric_keys
              and xt.value_keys = t.value_keys and xt.dimension_keys = t.dimension_keys
              and x.type = 'missing' and x.status in ('open', 'proposal_made')
            order by x.status_since desc, x.created_at desc limit 1) g on true
         left join lateral (
           -- A draft written from the gap is its draft, as the Inbox's Not found card has it;
           -- anything else linked to it is a suggestion that waits.
           select case when pr.source_gap_id = g.id then 'draft' else 'suggestion' end as state,
                  pr.id::text as proposal
             from gap_proposals gp join proposals pr on pr.id = gp.proposal_id
            where gp.gap_id = g.id and pr.discarded_at is null
              and pr.state in ('draft', 'submitted', 'in_review', 'changes_requested')
            order by pr.source_gap_id = g.id desc, pr.created_at desc limit 1) p on true
        where t.id = any($1::uuid[])`,
      [topicIds],
    )
    return new Map(rows.map((r) => [r.topic, r]))
  }

  /** The topics someone reported an answer about in [from, to). */
  async function reportedTopics(topicIds: string[], from: string, to: string) {
    const rows = await tx.query<{ topic: string }>(
      `select distinct d.topic_id::text as topic
         from feedback f join deliveries d on d.id = f.delivery_id
        where d.topic_id = any($1::uuid[]) and f.created_hour >= $2::date and f.created_hour < $3::date
       union
       select distinct g.topic_id::text
         from gaps g join gap_weekly_counts w on w.gap_id = g.id
        where g.topic_id = any($1::uuid[]) and w.reports > 0
          and w.week >= date_trunc('week', $2::date)::date and w.week < $3::date`,
      [topicIds, from, to],
    )
    return new Set(rows.map((r) => r.topic))
  }

  return {
    /**
     * Overview and Questions (FR-620): a range's days by answer state, its topics and subjects,
     * what found nothing in the last 7 days, what was published, and the kinds of agent that
     * asked. A view narrowed to one kind of agent hides any count that would differ from the
     * whole by a hidden one.
     */
    async agents(input: ObsAgentsInput): Promise<ObsAgents> {
      const { admin, areas } = await reader(tx, input.areaId)
      const agent = admin ? input.agent : undefined
      const least = await minimum(tx)
      const { last, start, before, end } = daysOf(clock.today(), input.range)
      const base = {
        range: input.range,
        last,
        minimumCount: least,
        numbers: {
          asked: null,
          counts: { grounded: null, partial: null, conflict: null, stale: null, missing: null },
          before: { asked: null, missing: null },
        },
        bars: [],
        topics: [],
        subjects: [],
        domains: [],
        notFound: [],
        notFoundTopics: [],
        couldNotRead: null,
        publishes: [],
        agents: [],
      }
      const [asked] = await tx.query<{ ever: boolean }>(
        `select exists (
           select 1 from deliveries d left join topics t on t.id = d.topic_id
            where d.caller = 'agent'
              and (case when $1::text[] is null then $2 else t.area_id = any($1) end)) as ever`,
        [areas, admin],
      )
      if (!asked?.ever) return { ...base, state: 'empty' }

      /** Calls per day and answer state in [from, to), for the view or over every agent. */
      const daysBetween = async (from: string, to: string, kind?: AppFamily) => {
        const rows = await tx.query<{ day: string; state: string; calls: number }>(
          `select (d.delivered_hour at time zone 'UTC')::date::text as day, d.answer_state as state,
                  count(*)::int as calls
             from deliveries d join topics t on t.id = d.topic_id
            where d.caller = 'agent' and d.answer_state in ('grounded','partial','conflict','stale','missing')
              and d.delivered_hour >= $1::date and d.delivered_hour < $2::date
              and ($3::text is null or d.app_family = $3)
              and (case when $4::text[] is null then $5 else t.area_id = any($4) end)
            group by 1, 2`,
          [from, to, kind ?? null, areas, admin],
        )
        const days = []
        for (let day = from; day < to; day = shiftDate(day, 1))
          days.push({ day, counts: countsOf(rows.filter((r) => r.day === day)) })
        return days
      }
      const inRange = await daysBetween(start, end, agent)
      const askedNow = inRange.reduce((n, d) => n + sumCounts(d.counts), 0)
      // Fewer than the minimum in the range: no count at all, not even per day (FR-614).
      if (askedNow < least) return { ...base, state: 'quiet' }
      const wholeDays = agent ? await daysBetween(start, end) : null
      const wholeBars = wholeDays ? barsOf(wholeDays, input.range) : null
      const bars = barsOf(inRange, input.range).map((b, i) => ({
        ...b,
        ...(wholeBars ? { whole: wholeBars[i]!.counts } : {}),
      }))
      const total = (days: { counts: StateCounts }[]) =>
        days.reduce((c, d) => addCounts(c, d.counts), zeroCounts())
      const earlier = beforeView(
        total(await daysBetween(before, start, agent)),
        least,
        agent ? total(await daysBetween(before, start)) : undefined,
      )

      // Topics: every domain the reader may see, whatever domain the numbers are narrowed to, so
      // Questions can filter them; for a view of one agent, beside the same topics over all.
      const all = await reader(tx, undefined)
      const now = byTopic(await topicCounts(all.areas, admin, start, end, agent))
      const whole = agent ? byTopic(await topicCounts(all.areas, admin, start, end)) : null
      const names = await vocabularyNames(tx)
      const counted: TopicCounts[] = [...now.values()].map((t) => ({
        id: t.id,
        domain: t.area,
        subject: subjectOf(t),
        counts: t.counts,
        ...(whole ? { whole: whole.get(t.id)?.counts ?? t.counts } : {}),
      }))
      // The topics, the chart and its numbers in one pass, so none gives a hidden one away.
      const view = topicView(counted, least, {
        bars,
        ...(input.areaId ? { domain: input.areaId } : {}),
      })

      // What found nothing in the last 7 days, counted over its months (FR-606 case 1).
      const weekStart = shiftDate(last, -6)
      const week =
        input.range === 7
          ? now
          : byTopic(await topicCounts(all.areas, admin, weekStart, end, agent))
      const weekCounted: TopicCounts[] = [...week.values()].map((t) => ({
        id: t.id,
        domain: t.area,
        subject: subjectOf(t),
        counts: t.counts,
      }))
      const weekView = input.range === 7 ? view : topicView(weekCounted, least)
      const missingOf = new Map<string, number>()
      for (const t of weekCounted)
        missingOf.set(t.subject, (missingOf.get(t.subject) ?? 0) + t.counts.missing)
      const notFound = weekView.subjects.filter((s) => (missingOf.get(s.key) ?? 0) >= least)

      const subjectMissing = new Map<string, number>()
      for (const t of counted)
        subjectMissing.set(t.subject, (subjectMissing.get(t.subject) ?? 0) + t.counts.missing)
      const ids = [...new Set([...now.keys(), ...week.keys()])]
      const [gaps, reported] = await Promise.all([gapsOf(ids), reportedTopics(ids, start, end)])
      const shownOf = new Map(view.topics.map((t) => [t.id, t]))
      const weekShownOf = new Map(weekView.topics.map((t) => [t.id, t]))
      const subjectsOf = (v: typeof view) => new Map(v.subjects.map((g) => [g.key, g] as const))
      const rangeSubjects = subjectsOf(view)
      const weekSubjects = subjectsOf(weekView)
      const topicOf = (
        t: Omit<TopicRow, 'state' | 'calls'> & { counts: StateCounts },
        shown: { total: number | null; atLeast: number; counts: ObsTopic['counts'] },
        subjects: ReturnType<typeof subjectsOf>,
      ): ObsTopic => {
        const group = t.metrics.some((m) => m.startsWith('group:'))
        const dimension = t.values[0]?.slice(4).split('/')[0] ?? null
        const gap = gaps.get(t.id)
        return {
          id: t.id,
          areaId: t.area,
          subject: subjectOf(t),
          metric: t.metrics.map((m) => names.get(m) ?? fallbackName(m)).join(', '),
          named: !t.metrics.length ? 'none' : group ? 'group' : 'metric',
          values: t.values.map((v) => names.get(v) ?? fallbackName(v)),
          dimension,
          month: t.month,
          total: shown.total,
          atLeast: shown.atLeast,
          counts: shown.counts,
          in: {
            notFound: (subjectMissing.get(subjectOf(t)) ?? 0) >= least,
            reported: reported.has(t.id),
            answers: answersOf(subjects.get(subjectOf(t))!),
          },
          gap: gap ? { id: gap.id, state: gap.state, proposalId: gap.proposal } : null,
        }
      }

      // Calls that could not be read have no topic, so no domain: an administrator's whole view only.
      let couldNotRead: number | null = null
      if (admin && !input.areaId) {
        const [row] = await tx.query<{ calls: number }>(
          `select count(*)::int as calls from deliveries d
            where d.caller = 'agent' and d.status = 'need_more_detail'
              and d.delivered_hour >= $1::date and d.delivered_hour < $2::date
              and ($3::text is null or d.app_family = $3)`,
          [start, end, agent ?? null],
        )
        couldNotRead = visibleCount(row?.calls ?? 0, least)
      }

      const publishes = await tx.query<ObsAgents['publishes'][number]>(
        `select e.created_at::text as at, v.item_id as "itemId", v.title, v.area_id as "areaId",
                p.display_name as by
           from editions e
           join lateral (
             select s.version_id from item_version_service s
              where lower(s.editions) = e.seq order by s.item_id limit 1) s on true
           join item_versions v on v.id = s.version_id
           left join people p on p.id = e.actor_id
          where e.reason = 'proposal_accepted' and e.created_at >= $1::date and e.created_at < $2::date
            and (case when $3::text[] is null then true else v.area_id = any($3) end)
          order by e.created_at desc, e.seq desc limit 50`,
        [start, end, areas],
      )

      // The kinds of agent that asked: an administrator's, over the domains read.
      let agents: ObsAgents['agents'] = []
      if (admin) {
        const rows = await tx.query<{ family: AppFamily; calls: number }>(
          `select d.app_family as family, count(*)::int as calls
             from deliveries d join topics t on t.id = d.topic_id
            where d.caller = 'agent' and d.answer_state in ('grounded','partial','conflict','stale','missing')
              and d.delivered_hour >= $1::date and d.delivered_hour < $2::date
              and (case when $3::text[] is null then true else t.area_id = any($3) end)
            group by 1 order by 2 desc, 1`,
          [start, end, areas],
        )
        const shown = shownParts(
          rows.map((r) => r.calls),
          least,
        )
        agents = rows.map((r, i) => ({ family: r.family, count: shown.parts[i] ?? null }))
      }

      return {
        ...base,
        state: 'normal',
        numbers: {
          asked: view.asked,
          counts: view.counts,
          before: earlier,
        },
        bars: view.bars,
        topics: [...now.values()].map((t) => topicOf(t, shownOf.get(t.id)!, rangeSubjects)),
        subjects: view.subjects.map(({ domain, ...s }) => ({ ...s, areaId: domain })),
        domains: view.domains.map(({ domain, ...d }) => ({ ...d, areaId: domain })),
        notFound: notFound.map(({ domain, ...s }) => ({ ...s, areaId: domain })),
        notFoundTopics: notFound.flatMap((s) =>
          s.topics.map((id) => topicOf(week.get(id)!, weekShownOf.get(id)!, weekSubjects)),
        ),
        couldNotRead,
        publishes,
        agents,
      }
    },

    /**
     * Feedback (FR-620): what agents reported about answers (anonymous, with their kind) and the
     * reports people made from Try it and the assistant (anonymous), in a range, each with where it
     * stands; and the answers people marked good in the assistant, by week (FR-712). The reports run
     * from the range's first day up to now, so one waiting in an Inbox is listed as soon as it is
     * sent.
     */
    async feedback(input: { range: number; areaId?: string }): Promise<ObsFeedback> {
      const { areas, admin } = await reader(tx, input.areaId)
      const least = await minimum(tx)
      const { start, before, end } = daysOf(clock.today(), input.range)
      const reports = await tx.query<{
        id: string
        kind: 'helpful' | 'wrong' | 'missing' | 'unclear'
        area: string | null
        at: string
        note: string | null
        client: string
        item: string | null
        title: string | null
        topic: string | null
        metrics: string[] | null
        values: string[] | null
        closed: boolean
      }>(
        `select f.id::text, f.verdict::text as kind, coalesce(f.area_id, t.area_id) as area,
                f.created_hour::text as at, f.note, f.client_label as client,
                first.id as item, first.title, d.topic_id::text as topic,
                t.metric_keys as metrics, t.value_keys as values,
                exists (select 1 from card_states c where c.card = 'feedback:' || f.id::text) as closed
           from feedback f
           left join deliveries d on d.id = f.delivery_id
           left join topics t on t.id = d.topic_id
           left join lateral (
             select x.id, iv.title from jsonb_to_recordset(d.delivered) as x(id text, v int, rank int)
               join item_versions iv on iv.item_id = x.id and iv.version_no = x.v
              where cl_audience_allows(iv.audience_groups)
              order by x.rank limit 1) first on true
          where f.created_hour >= $1::date
            and (case when $2::text[] is null then $3 else coalesce(f.area_id, t.area_id) = any($2) end)
          order by f.created_hour desc, f.id limit 200`,
        [start, areas, admin],
      )
      const names = await vocabularyNames(tx)
      // Named reports from Ask (FR-622): its sender, the owners of its domain and administrators
      // read one (row security); what the owners did after it says where it stands.
      const named = await tx.query<{
        id: string
        area: string
        at: string
        what: string
        by: string
        item: string
        title: string | null
        outcome: string | null
      }>(
        `select r.id::text, r.area_id as area, r.created_at::text as at, r.what, p.display_name as by,
                r.item_id as item, v.title, o.outcome
           from reports r
           join people p on p.id = r.person_id
           left join v_item_list v on v.id = r.item_id
           left join lateral cl_report_outcome(r.id) o on true
          where r.created_at >= $1::date
            and (case when $2::text[] is null then true else r.area_id = any($2) end)
          order by r.created_at desc, r.id limit 200`,
        [start, areas],
      )
      const people = await tx.query<{
        id: string
        area: string | null
        at: string
        note: string
        source: string
        topic: string
      }>(
        `select n.id::text, t.area_id as area, n.created_hour::text as at, n.note, n.source,
                t.id::text as topic
           from gap_notes n join gaps g on g.id = n.gap_id join topics t on t.id = g.topic_id
          where n.source in ('report_gap', 'person')
            and n.created_hour >= $1::date
            and (case when $2::text[] is null then $3 else t.area_id = any($2) end)
          order by n.created_hour desc, n.id limit 200`,
        [start, areas, admin],
      )
      const ratings = await tx.query<{ week: string; helpful: number }>(
        `select w.week::date::text as week, coalesce(count(r.verdict) filter (where r.verdict = 'helpful'), 0)::int as helpful
           from generate_series(date_trunc('week', $1::date) - interval '13 weeks', date_trunc('week', $1::date), interval '1 week') w(week)
           left join assistant_ratings r
             on date_trunc('week', r.created_hour at time zone 'UTC') = w.week
            and (case when $2::text[] is null then $3 else r.area_id = any($2) end)
          group by w.week order by w.week`,
        [shiftDate(end, -1), areas, admin],
      )
      const [week] = await tx.query<{ good: number; before: number; wrong: number }>(
        `select (count(*) filter (where r.verdict = 'helpful' and r.created_hour >= $2::date))::int as good,
                (count(*) filter (where r.verdict = 'helpful' and r.created_hour < $2::date))::int as before,
                (count(*) filter (where r.verdict = 'wrong' and r.created_hour >= $2::date))::int as wrong
           from assistant_ratings r
          where r.created_hour >= $1::date and r.created_hour < $3::date
            and (case when $4::text[] is null then $5 else r.area_id = any($4) end)`,
        [before, start, end, areas, admin],
      )
      const asked = await tx.query<{ ever: boolean }>(
        `select exists (select 1 from feedback) or exists (select 1 from assistant_ratings)
                or exists (select 1 from gap_notes) or exists (select 1 from reports) as ever`,
      )
      const list: ObsFeedback['reports'] = [
        ...reports.map((r) => ({
          id: `feedback:${r.id}`,
          card:
            (r.kind === 'wrong' || r.kind === 'unclear') && !r.closed && r.area
              ? `feedback:${r.id}`
              : null,
          kind: r.kind,
          areaId: r.area,
          about: r.title ?? (r.metrics ? topicName(r.metrics, r.values ?? [], names) : 'An answer'),
          itemId: r.item,
          topicId: r.topic,
          note: r.note,
          from: 'agent' as const,
          agent: appFamilyOf(r.client),
          by: null,
          at: r.at,
          state:
            r.kind !== 'wrong' && r.kind !== 'unclear'
              ? ('looked' as const)
              : r.closed
                ? ('fine' as const)
                : ('inbox' as const),
        })),
        ...named.map((r) => ({
          id: `report:${r.id}`,
          card: r.outcome ? null : `report:${r.id}`,
          kind: 'named' as const,
          areaId: r.area,
          about: r.title ?? 'A context item',
          itemId: r.item,
          topicId: null,
          note: r.what,
          from: 'person' as const,
          agent: null,
          by: r.by,
          at: r.at,
          state:
            r.outcome === null
              ? ('inbox' as const)
              : r.outcome === 'not_a_problem'
                ? ('fine' as const)
                : ('looked' as const),
        })),
        ...people.map((p) => ({
          id: `gap-note:${p.id}`,
          card: null,
          kind: 'gap' as const,
          areaId: p.area,
          about: 'Nothing written down',
          itemId: null,
          topicId: p.topic,
          note: p.note,
          from: p.source === 'person' ? ('person' as const) : ('agent' as const),
          agent: null,
          by: null,
          at: p.at,
          state: 'looked' as const,
        })),
      ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      return {
        state: asked[0]?.ever ? 'normal' : 'empty',
        minimumCount: least,
        reports: list,
        goodByWeek: ratings.map((r) => ({ week: r.week, count: visibleCount(r.helpful, least) })),
        week: {
          good: visibleCount(week?.good ?? 0, least),
          goodBefore: visibleCount(week?.before ?? 0, least),
          wrong: visibleCount(week?.wrong ?? 0, least),
        },
      }
    },

    /**
     * Usage (FR-620), for administrators: how agents called each tool and how the calls ended,
     * the calls of each kind of agent (FR-410, small counts hidden), how long replies took, and
     * this month's model spend against the caps (NFR-062). No call keeps who made it.
     */
    async usage(input: { range: number }): Promise<ObsUsage> {
      const least = await minimum(tx)
      const today = clock.today()
      const { last, start, before, end } = daysOf(today, input.range)
      const [earlier] = await tx.query<{ calls: number }>(
        `select count(*)::int as calls from mcp_requests r
          where r.tool <> 'protocol' and r.hour >= $1::date and r.hour < $2::date`,
        [before, start],
      )
      const tools = await tx.query<ObsUsage['tools'][number]>(
        `select r.tool, count(*)::int as calls,
                (count(*) filter (where r.status = 'ok' and coalesce(r.result_status, 'matched') = 'matched'))::int as answered,
                (count(*) filter (where r.status = 'ok' and r.result_status = 'need_more_detail'))::int as detail,
                (count(*) filter (where r.status = 'ok' and r.result_status = 'no_match'))::int as nothing,
                (count(*) filter (where r.status <> 'ok'))::int as failed
           from mcp_requests r
          where r.tool <> 'protocol' and r.hour >= $1::date and r.hour < $2::date
          group by r.tool order by 2 desc, 1`,
        [start, end],
      )
      const families = await tx.query<{ family: AppFamily; calls: number; last: string }>(
        `select r.app_family as family, count(*)::int as calls, max(r.hour)::text as last
           from mcp_requests r
          where r.tool <> 'protocol' and r.hour >= $1::date and r.hour < $2::date
          group by 1 order by 2 desc, 1`,
        [start, end],
      )
      // The tool calls add up to every kind of agent's together: no hidden kind may be left over.
      const shown = shownParts(
        families.map((f) => f.calls),
        least,
        { known: true },
      )
      // Per day for a week; per week back from the last day for longer ranges, the oldest week
      // a few days short when the range is.
      const step = input.range === 7 ? 1 : 7
      const speed = await tx.query<ObsUsage['speed'][number]>(
        `select b.start::text as start,
                percentile_disc(0.5) within group (order by r.duration_ms) as median,
                percentile_disc(0.95) within group (order by r.duration_ms) as p95
           from (select greatest($1::date, $2::date - (k * $3 + $3 - 1)) as start, $2::date - k * $3 as stop
                   from generate_series(0, $4 - 1) k) b
           left join mcp_requests r
             on r.tool <> 'protocol' and r.duration_ms is not null
            and r.hour >= b.start and r.hour < b.stop + 1
          group by b.start order by b.start`,
        [start, last, step, Math.ceil(input.range / step)],
      )
      const month = `${today.slice(0, 7)}-01`
      const features = await tx.query<{ feature: string; micros: number }>(
        `select feature, sum(cost_micros)::float8 as micros from llm_spend_monthly
          where month = $1::date group by feature order by 2 desc, 1`,
        [month],
      )
      const [person] = await tx.query<{ micros: number | null }>(
        `select max(s.micros)::float8 as micros from (
           select sum(cost_micros) as micros from llm_spend_daily where day = $1::date group by person_id) s`,
        [today],
      )
      const [assistant, evals] = await Promise.all([
        readSpendLimits(tx, 'assistant'),
        readSpendLimits(tx, 'eval'),
      ])
      const [ever] = await tx.query<{ ever: boolean }>(
        `select exists (select 1 from mcp_requests where tool <> 'protocol') as ever`,
      )
      return {
        state: ever?.ever ? 'normal' : 'empty',
        minimumCount: least,
        last,
        callsBefore: earlier?.calls ?? 0,
        tools,
        agents: families.map((f, i) => ({
          family: f.family,
          calls: shown.parts[i] ?? null,
          // When a kind's calls are hidden, so is when it last called.
          lastAt: shown.parts[i] === null ? null : f.last,
        })),
        speed,
        spend: {
          month,
          totalMicros: features.reduce((n, f) => n + f.micros, 0),
          features,
          caps: {
            monthlyMicros: assistant.monthlyCapMicros,
            featureMicros: { assistant: assistant.featureCapMicros, eval: evals.featureCapMicros },
            dailyPersonMicros: assistant.dailyPersonMicros,
            personTodayMicros: person?.micros ?? 0,
          },
        },
      }
    },

    /** The views people saved on Questions, for everyone in the workspace, oldest first. */
    async views(): Promise<ObsView[]> {
      await reader(tx, undefined)
      return tx.query<ObsView>(
        `select v.id::text, v.name, v.filters, p.display_name as by, v.created_by = cl_person() as mine
           from observability_views v join people p on p.id = v.created_by
          order by v.created_at, v.id`,
      )
    },

    async saveView(input: { name: string; filters: ObsViewFilters }): Promise<ObsView> {
      await reader(tx, undefined)
      const [taken] = await tx.query<{ id: string }>(
        `select id::text from observability_views where lower(btrim(name)) = lower(btrim($1))`,
        [input.name],
      )
      if (taken) throw new ORPCError('CONFLICT')
      const [row] = await tx.query<ObsView>(
        `with saved as (
           insert into observability_views (name, filters, created_by)
           values (btrim($1), $2::jsonb, cl_person()) returning *)
         select s.id::text, s.name, s.filters, p.display_name as by, true as mine
           from saved s join people p on p.id = s.created_by`,
        [input.name, JSON.stringify(input.filters)],
      )
      return row!
    },

    async removeView(input: { id: string }): Promise<{ removed: boolean }> {
      const { admin } = await reader(tx, undefined)
      const rows = await tx.query(
        `delete from observability_views where id = $1 and (created_by = cl_person() or $2) returning id`,
        [input.id, admin],
      )
      if (!rows.length) {
        const [exists] = await tx.query(`select 1 from observability_views where id = $1`, [
          input.id,
        ])
        if (exists)
          throw new ORPCError('FORBIDDEN', {
            message: 'Only whoever saved a view, or an admin, removes it.',
          })
      }
      return { removed: rows.length > 0 }
    },
  }
}

export type ObservabilityService = ReturnType<typeof createObservabilityService>
