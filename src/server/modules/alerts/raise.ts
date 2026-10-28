import { topicScope, topicWords } from '../../../domain/answer.ts'
import {
  alertRuleIds,
  dueHour,
  lookTitle,
  shareFires,
  spendReached,
  timesWords,
  twoDaysRunning,
  type AlertRuleId,
  type RaiseSubject,
} from '../../../domain/alerts.ts'
import { fullDayWords, monthWords } from '../../../domain/dates.ts'
import { cardKey } from '../../../domain/inbox.ts'
import type { Clock } from '../../clock.ts'
import type { Database, Queryable } from '../../db/database.ts'
import type { BundleCache } from '../answer/index.ts'
import type { ServingBundle } from '../editions/index.ts'
import { readSpendLimits } from '../models/index.ts'

/*
  The alert job's rules (FR-621, src/domain/alerts.ts): each reads the records it is about, as no
  person, and raises once for each thing it finds, through cl_alert_raise, which keeps the raise
  and its outbox event together and refuses a key it raised before. So a second run, or a run
  after a failure, raises nothing twice. A rule that is off raises nothing. Every count a title
  says is a count from agents already hidden under the minimum (FR-614), and no title keeps
  anyone's words.
*/

type Raise = { key: string; areas: string[]; title: string; subject: RaiseSubject }

type Context = {
  tx: Queryable
  clock: Clock
  bundle: ServingBundle | null
  minimum: number
  threshold: number | null
}

type Topic = {
  id: string
  area: string | null
  areas: string[]
  metrics: string[]
  values: string[]
  dimensions: string[]
  month: string | null
  calls: number
}

/** A topic in words, with its month: "Orders in Spain, October 2026". */
function topicTitle(bundle: ServingBundle | null, t: Topic, fallback: string) {
  if (!bundle || !t.month) return fallback
  return `${topicWords(bundle, topicScope({ metrics: t.metrics, values: t.values, dimensions: t.dimensions, month: t.month }))}, ${monthWords(t.month)}`
}

const topicFields = `t.area_id as area, cl_topic_domains(t.area_id, t.metric_keys) as areas,
  t.metric_keys as metrics, t.value_keys as values, t.dimension_keys as dimensions,
  t.month::text as month`

/** The Monday of a day's week, as the week a raise belongs to. */
function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const rules: Record<AlertRuleId, (c: Context) => Raise[] | Promise<Raise[]>> = {
  /** Not found: a gap opened on a topic agents keep finding nothing for; its card is the Inbox's. */
  async gap({ tx, bundle, minimum }) {
    const rows = await tx.query<Topic & { ref: string }>(
      `select g.id::text, g.ref, ${topicFields},
              coalesce((select w.reports - w.human_reports + w.no_item_calls from gap_weekly_counts w
                         where w.gap_id = g.id and w.week = date_trunc('week', now() at time zone 'UTC')::date), 0)::int as calls
         from gaps g join topics t on t.id = g.topic_id
        where g.status in ('open', 'proposal_made')
        order by g.status_since, g.id`,
    )
    return rows.map((g) => ({
      key: g.id,
      areas: g.area ? [g.area] : g.areas,
      title: `${topicTitle(bundle, g, g.ref)}: not found, ${timesWords(g.calls, minimum)}`,
      subject: { card: cardKey.gap(g.id) },
    }))
  },

  /** A saved question needs a look: once a domain has one that came to need one since its last raise. */
  async saved({ tx }) {
    const rows = await tx.query<{ area: string; n: number; since: string; last: string | null }>(
      `select l.area_id as area, count(*)::int as n, max(l.since)::text as since,
              (select max(r.raised_at)::text from alert_raises r
                where r.rule = 'saved' and r.area_ids = array[l.area_id]) as last
         from cl_saved_looks() l group by l.area_id order by l.area_id`,
    )
    return rows
      .filter((r) => !r.last || new Date(r.since) > new Date(r.last))
      .map((r) => ({
        key: `${r.area}:${new Date(r.since).toISOString()}`,
        areas: [r.area],
        title: lookTitle(r.n),
        subject: { card: cardKey.look(r.area) },
      }))
  },

  /** Conflict: agents got two items that disagree on one topic, often enough in 7 days; once a week. */
  async disagree({ tx, clock, bundle, minimum, threshold }) {
    const rows = await tx.query<Topic>(
      `select t.id::text, ${topicFields}, count(*)::int as calls
         from deliveries d join topics t on t.id = d.topic_id
        where d.caller = 'agent' and d.answer_state = 'conflict'
          and d.delivered_hour >= $1::date - 6 and d.delivered_hour < $1::date + 1
        group by t.id having count(*) >= $2
        order by t.id`,
      [clock.today(), threshold ?? 3],
    )
    const week = mondayOf(clock.today())
    return rows.map((t) => ({
      key: `${t.id}:${week}`,
      areas: t.area ? [t.area] : t.areas,
      title: `${topicTitle(bundle, t, 'A topic')}: conflict, ${timesWords(t.calls, minimum)}`,
      subject: { topic: t.id },
    }))
  },

  /** More questions not found: more than a share of a full day's questions, two days running. */
  async share({ tx, clock, minimum, threshold }) {
    const today = clock.today()
    const percent = threshold ?? 20
    const days = await tx.query<{ day: string; total: number; part: number }>(
      `select (d.delivered_hour at time zone 'UTC')::date::text as day, count(*)::int as total,
              (count(*) filter (where d.answer_state = 'missing'))::int as part
         from deliveries d
        where d.caller = 'agent' and d.answer_state in ('grounded','partial','conflict','stale','missing')
          and d.delivered_hour >= $1::date and d.delivered_hour < $2::date
        group by 1`,
      [daysBefore(today, 2), today],
    )
    const day = twoDaysRunning(days, percent, minimum)
    if (!day) return []
    return [
      {
        key: day,
        areas: [],
        title: `More than ${percent}% of questions found nothing on ${fullDayWords(daysBefore(day, 1))} and ${fullDayWords(day)}`,
        subject: { page: 'overview' },
      },
    ]
  },

  /** Calls fail: more than a share of yesterday's calls failed or could not be read. */
  async fail({ tx, clock, minimum, threshold }) {
    const day = daysBefore(clock.today(), 1)
    const percent = threshold ?? 5
    const [row] = await tx.query<{ total: number; part: number }>(
      `select count(*)::int as total,
              (count(*) filter (where r.status <> 'ok' or r.result_status = 'need_more_detail'))::int as part
         from mcp_requests r
        where r.tool <> 'protocol' and r.hour >= $1::date and r.hour < $1::date + 1`,
      [day],
    )
    if (!row || !shareFires({ day, ...row }, percent, minimum)) return []
    return [
      {
        key: day,
        areas: [],
        title: `More than ${percent}% of calls failed or could not be read on ${fullDayWords(day)}`,
        subject: { page: 'usage' },
      },
    ]
  },

  /** Model spend: this month's spend reached a share of the monthly cap; once a month for each share. */
  async spend({ tx, clock, threshold }) {
    const percent = threshold ?? 80
    const month = `${clock.today().slice(0, 7)}-01`
    const [row] = await tx.query<{ micros: number }>(
      `select coalesce(sum(cost_micros), 0)::float8 as micros from llm_spend_monthly where month = $1::date`,
      [month],
    )
    const { monthlyCapMicros } = await readSpendLimits(tx, 'assistant')
    if (!spendReached(row?.micros ?? 0, monthlyCapMicros, percent)) return []
    return [
      {
        key: `${month}:${percent}`,
        areas: [],
        title: `Model spend reached ${percent}% of the monthly cap`,
        subject: { page: 'usage' },
      },
    ]
  },

  /** A connected tool did not sync: its last read failed, or it has not read for too long. */
  async sync({ tx }) {
    const rows = await tx.query<{
      id: string
      name: string
      failed: string | null
      stale: string | null
      areas: string[]
    }>(
      `select c.id, c.name,
              case when last.status = 'failed' then last.fetched_at::text end as failed,
              case when coalesce(good.fetched_at, c.created_at) < now() - c.stale_after
                   then coalesce(good.fetched_at, c.created_at)::text end as stale,
              cl_connector_domains(c.id) as areas
         from connectors c
         left join lateral (select s.status, s.fetched_at from connector_snapshots s
                             where s.connector_id = c.id order by s.fetched_at desc limit 1) last on true
         left join lateral (select s.fetched_at from connector_snapshots s
                             where s.connector_id = c.id and s.status in ('ok', 'partial')
                             order by s.fetched_at desc limit 1) good on true
        where c.enabled
        order by c.id`,
    )
    return rows.flatMap((c) => {
      const why = c.failed
        ? `failed:${new Date(c.failed).toISOString()}`
        : c.stale
          ? `stale:${new Date(c.stale).toISOString()}`
          : null
      return why
        ? [
            {
              key: `${c.id}:${why}`,
              areas: c.areas,
              title: `${c.name} did not sync`,
              subject: { connector: c.id },
            },
          ]
        : []
    })
  },

  /** A check is due: a live item's check date passed; the reminder goes from 07:00, UTC. */
  due({ clock, bundle }) {
    if (!bundle || clock.now().getUTCHours() < dueHour) return []
    const today = clock.today()
    return bundle.items
      .filter((item) => item.reviewDate !== null && item.reviewDate < today)
      .map((item) => ({
        key: `${item.id}:${item.reviewDate!}`,
        areas: [item.areaId],
        title: `${item.title}: its check date passed`,
        subject: { card: cardKey.check(item.id) },
      }))
  },
}

/**
 * One run of the alert job: every rule that is on, each in a transaction of its own as no person,
 * so a rule that fails does not hold back the others. Returns how many each raised; when a rule
 * failed, it throws once the others ran, naming it, so the job retries (raising nothing twice).
 */
export async function raiseAlerts(
  database: Database,
  clock: Clock,
  cache: BundleCache,
): Promise<Partial<Record<AlertRuleId, number>>> {
  const raised: Partial<Record<AlertRuleId, number>> = {}
  const failed: { rule: AlertRuleId; error: unknown }[] = []
  const settings = await database.transaction(null, (tx) =>
    tx.query<{ rule: AlertRuleId; enabled: boolean; threshold: number | null }>(
      'select rule, enabled, threshold from alert_rules',
    ),
  )
  for (const rule of alertRuleIds) {
    const set = settings.find((s) => s.rule === rule)
    if (!set?.enabled) continue
    try {
      raised[rule] = await database.transaction(null, async (tx) => {
        const [head] = await tx.query<{ seq: string; label: string; overlay: string }>(
          `select e.seq::text, e.label, coalesce((select seq::text from serving_overlay),'0') as overlay
             from editions e join live_edition l on l.seq = e.seq`,
        )
        const [min] = await tx.query<{ minimum: number | null }>(
          `select (value #>> '{}')::int as minimum from settings_current where key = 'privacy.min_count'`,
        )
        const found = await rules[rule]({
          tx,
          clock,
          bundle: head ? await cache.bundle(tx, head) : null,
          minimum: min?.minimum ?? 5,
          threshold: set.threshold,
        })
        let n = 0
        for (const r of found) {
          const [row] = await tx.query<{ id: string | null }>(
            'select cl_alert_raise($1, $2, $3, $4, $5)::text as id',
            [rule, r.key, r.areas, r.title.slice(0, 300), JSON.stringify(r.subject)],
          )
          if (row?.id) n++
        }
        return n
      })
    } catch (error) {
      failed.push({ rule, error })
    }
  }
  if (failed.length)
    throw new AggregateError(
      failed.map((f) => f.error),
      `Alert rules failed: ${failed.map((f) => f.rule).join(', ')}`,
    )
  return raised
}
