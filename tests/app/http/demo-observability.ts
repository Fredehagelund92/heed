import type pg from 'pg'
import { daySeed, obsData, topicSeed } from '@/api/mock/data/observability'
import type { Topic as FixtureTopic } from '@/api/mock/obs-engine'
import { vocabulary } from '../../../db/seed/fixtures/reference-data.ts'

/*
  The mockup's Observability on the real service, for the http journeys and the http binding's
  conformance: what agents asked over the 27 weeks the mock counts, as delivery records with their
  topic, answer state and kind of agent (never a question or who asked, FR-602); their tool calls
  with how they ended and how long they took; what agents reported about answers; the answers
  people marked good in Ask; and this month's model spend against a $50 cap.

  The last 7 days are the mock's exactly: 142 asked, by answer state and by topic, and by kind of
  agent. The weeks before follow the mock's days; their calls go to the same topics in the same
  proportions, so a longer range counts more than the mock's scaled week, by design. The service's
  own disclosure decides what a page may show, as it does for any workspace.
*/

const DAY = 86_400_000
const iso = (at: number) => new Date(at).toISOString().slice(0, 10)
type State = 'grounded' | 'partial' | 'conflict' | 'stale' | 'missing'
const STATES: State[] = ['grounded', 'partial', 'conflict', 'stale', 'missing']

/** A metric the mock names, by the vocabulary's id; the mock's "Repeat purchases" is its rate. */
function metricKeys(t: FixtureTopic): string[] {
  if (t.named === 'none' || !t.metric) return []
  if (t.named === 'group') return [`group:${t.metric.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`]
  const name = t.metric === 'Repeat purchases' ? 'Repeat purchase rate' : t.metric
  const metric = vocabulary.metrics.find((m) => m.name === name)
  if (!metric) throw new Error(`No metric ${t.metric} in the demo vocabulary`)
  return [`metric:${metric.id}`]
}
/** A market as a value; every market, or an event the vocabulary has no value for, as none. */
function valueKeys(t: FixtureTopic): string[] {
  const market = vocabulary.dimensions
    .find((d) => d.id === 'market')!
    .values.find((v) => v.name === t.where)
  return market ? [`val:market/${market.id}`] : []
}

/** Hands calls out in turn, as many to each as it has: a day's calls to topics, a call to an agent. */
function dealer<T>(stock: { key: T; n: number }[]) {
  const deck = stock.flatMap((s) => Array.from({ length: s.n }, () => s.key))
  let at = 0
  return () => deck[at++ % deck.length]!
}

/** Seeds it; returns each mock topic's id on the service, by the mock's id. */
export async function seedObservability(client: pg.Client): Promise<Map<string, string>> {
  const fixture = obsData('normal')
  const days = daySeed.map((d) => ({ day: iso(d.at), counts: d.counts }))
  const last = days.at(-1)!.day
  const week = new Set(days.slice(-7).map((d) => d.day))

  // Partitions for every month the records reach, the oldest first.
  const months = [...new Set(days.map((d) => d.day.slice(0, 7)))]
  for (const month of [...months, '2026-11'])
    for (const table of ['deliveries', 'mcp_requests']) {
      const start = `${month}-01`
      const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
      await client.query(
        `create table if not exists ${table}_${month.replace('-', '_')} partition of ${table}
           for values from ('${start} 00:00Z') to ('${iso(next.getTime())} 00:00Z')`,
      )
    }

  // The topics, keyed as the service keys them (FR-604).
  const ids = new Map<string, string>()
  for (const t of topicSeed) {
    const area = t.domain ? `area_${t.domain}` : null
    const metrics = metricKeys(t)
    const values = valueKeys(t)
    const key = [area ?? '', metrics.join(','), values.join(','), t.month].join('|')
    const { rows } = await client.query<{ id: string }>(
      `with made as (
         insert into topics (key, area_id, metric_keys, value_keys, month)
         values ($1, $2, $3, $4, $5) on conflict (key) do nothing returning id)
       select id::text from made union all select id::text from topics where key = $1 limit 1`,
      [key, area, metrics, values, `${t.month}-01`],
    )
    ids.set(t.id, rows[0]!.id)
  }

  // Each state's calls go to its topics in turn: the week exactly, earlier weeks in proportion.
  const topicOf = Object.fromEntries(
    STATES.map((s) => [
      s,
      dealer(topicSeed.filter((t) => t.week[s] > 0).map((t) => ({ key: t.id, n: t.week[s] }))),
    ]),
  ) as Record<State, () => string>
  const families = {
    'Claude Code': 'claude_code',
    'Claude app': 'claude_ai',
    Cursor: 'cursor',
    ChatGPT: 'chatgpt',
    'Other agents': 'other',
  } as const
  const familyOf = dealer(
    fixture.agents.map((a) => ({ key: families[a.name as keyof typeof families], n: a.week })),
  )
  const [live] = (await client.query<{ seq: string }>('select seq::text from live_edition')).rows
  const deliveries: object[] = []
  for (const { day, counts } of days) {
    let hour = 0
    for (const s of STATES)
      for (let i = 0; i < counts[s]; i++)
        deliveries.push({
          hour: `${day}T${String(8 + (hour++ % 12)).padStart(2, '0')}:00:00Z`,
          topic: ids.get(topicOf[s]())!,
          status: s === 'missing' ? 'no_match' : s === 'conflict' ? 'conflict' : 'matched',
          state: s,
          family: familyOf(),
        })
    // Calls that could not be read: no metric and no market, so no topic (9 this week).
    const unread = week.has(day) ? [2, 1, 1, 1, 2, 1, 1][[...week].indexOf(day)]! : 1
    for (let i = 0; i < unread; i++)
      deliveries.push({
        hour: `${day}T07:00:00Z`,
        topic: null,
        status: 'need_more_detail',
        state: null,
        family: 'claude_ai',
      })
  }
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, topic_id, scope, status, answer_state, app_family)
     select d.hour, 'demo', 'agent', $2, 0, 'demo-week', d.topic, '{}', d.status::delivery_status,
            d.state, d.family
       from jsonb_to_recordset($1) as d(hour timestamptz, topic uuid, status text, state text, family text)`,
    [JSON.stringify(deliveries), live!.seq],
  )
  // Ask's Asked this week reads the week's counts the demo week seeds for it (seedAskedThisWeek):
  // these records are Observability's own, so they leave those counts as they are.
  await client.query('delete from topic_week_counts where topic_id = any($1::uuid[])', [
    [...ids.values()],
  ])

  // Tool calls: the week the mock draws, by tool, how they ended and kind of agent, each day's
  // reply times; earlier weeks as many as the mock's weeks back say.
  const familyOfCall = dealer(
    fixture.agentCalls.map((a) => ({ key: families[a.name as keyof typeof families], n: a.calls })),
  )
  const requests: object[] = []
  const back = [1, 1.03, 0.95, 0.99, 0.91, 0.88, 0.92, 0.86, 0.81, 0.85, 0.78, 0.76, 0.73]
  const weekDays = [...week]
  for (let w = 0; w <= back.length; w++) {
    const scale = w === 0 ? 1 : back[w - 1]!
    const weekStart = Date.parse(`${weekDays[0]}T00:00:00Z`) - w * 7 * DAY
    let k = 0
    for (const tool of fixture.toolCalls) {
      const ended = [
        ...Array.from({ length: Math.round(tool.answered * scale) }, () => ['ok', 'matched']),
        ...Array.from({ length: Math.round(tool.detail * scale) }, () => [
          'ok',
          'need_more_detail',
        ]),
        ...Array.from({ length: Math.round(tool.nothing * scale) }, () => ['ok', 'no_match']),
        ...Array.from({ length: Math.round(tool.failed * scale) }, () => ['error', null]),
      ]
      const reads = ['get_context', 'find_context', 'read_context']
      for (const [status, result] of ended) {
        const d = k++ % 7
        const speed = w === 0 ? fixture.speedDays : fixture.speedWeeks
        const at = w === 0 ? d : speed.median.length - 1 - w
        const median = speed.median[Math.max(0, at)]!
        const p95 = speed.p95[Math.max(0, at)]!
        requests.push({
          hour: `${iso(weekStart + d * DAY)}T${String(8 + (k % 10)).padStart(2, '0')}:00:00Z`,
          tool: tool.name,
          status,
          result: reads.includes(tool.name) || tool.name === 'get_context' ? result : null,
          duration: k % 10 === 0 ? p95 : median,
          family: w === 0 ? familyOfCall() : 'claude_code',
        })
      }
    }
  }
  await client.query(
    `insert into mcp_requests (hour, client_label, app_family, tool, status, result_status, duration_ms)
     select r.hour, 'demo', r.family, r.tool, r.status, r.result, r.duration
       from jsonb_to_recordset($1) as r(hour timestamptz, family text, tool text, status text, result text, duration int)`,
    [JSON.stringify(requests)],
  )

  // What agents reported about answers this week, by their kind, never a name: none of these
  // waits in an Inbox (the Reported card the journeys open is Maria's named report, the demo
  // week's own).
  const reports: [string, string, string, string][] = [
    ['claude', 'missing', 'orders-poland', '2026-10-16'],
    ['claude-code', 'missing', 'orders-spain', '2026-10-21'],
    ['cursor', 'missing', 'discount-black-friday', '2026-10-20'],
    ['openai-mcp', 'missing', 'roas-sweden', '2026-10-19'],
    ['some-agent', 'helpful', 'repeat-purchases-all', '2026-10-17'],
  ]
  for (const [client_label, verdict, topic, day] of reports) {
    // Each on an answer about its topic that week, as an agent reports on the reply it got.
    const fixture = topicSeed.find((t) => t.id === topic)!
    await client.query(
      `insert into feedback (verdict, client_label, area_id, delivery_id, created_hour)
       select $1, $2, $3, d.id, $5::date + interval '10 hours'
         from deliveries d
        where d.topic_id = $4 and d.delivered_hour >= $6::date
        order by d.delivered_hour, d.id limit 1`,
      [verdict, client_label, `area_${fixture.domain}`, ids.get(topic), day, [...week][0]],
    )
  }

  // Answers people marked good in Ask, each week of the 14 the mock draws; this week 38, 32 the
  // week before, and something wrong 3 times.
  const mondays = Array.from({ length: 14 }, (_, i) =>
    iso(
      Date.parse(`${last}T00:00:00Z`) -
        ((new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7) * DAY -
        (13 - i) * 7 * DAY,
    ),
  )
  for (const [i, monday] of mondays.slice(0, -2).entries())
    await client.query(
      `insert into assistant_ratings (verdict, area_id, created_hour)
       select 'helpful', 'area_sales', $1::date + interval '10 hours' from generate_series(1, $2)`,
      [monday, fixture.goodByWeek.values[i]],
    )
  for (const [from, n] of [
    [iso(Date.parse(`${last}T00:00:00Z`) - 13 * DAY), 32],
    [iso(Date.parse(`${last}T00:00:00Z`) - 6 * DAY), 38],
  ] as const)
    await client.query(
      `insert into assistant_ratings (verdict, area_id, created_hour)
       select 'helpful', 'area_sales', $1::date + (g % 7) * interval '1 day' + interval '11 hours'
         from generate_series(1, $2) g`,
      [from, n],
    )
  await client.query(
    `insert into assistant_ratings (verdict, area_id, created_hour)
     select 'wrong', 'area_sales', $1::date + interval '12 hours' from generate_series(1, 3)`,
    [last],
  )

  // This month's model spend, and the caps the mock shows.
  await client.query(
    `insert into llm_spend_monthly (month, feature, calls, cost_micros, provider)
     values ($1::date, 'assistant', 112, 11200000, 'mock'), ($1::date, 'eval', 1, 6100000, 'mock')`,
    [`${last.slice(0, 7)}-01`],
  )
  for (const [key, value] of [
    ['limits.llm_monthly_cap_micros', 50_000_000],
    ['limits.llm_feature_monthly_micros', { assistant: 50_000_000, eval: 20_000_000 }],
  ] as const)
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       select $1, coalesce(max(version), 0) + 1, $2::jsonb, 'The demo week: the caps the mock shows.'
         from settings_versions where key = $1`,
      [key, JSON.stringify(value)],
    )
  return ids
}
