import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import {
  apiDatabase,
  contractOperations,
  testDatabase,
  transaction,
  type Operation,
} from './support.ts'

/*
  The small-count rule on every surface (FR-614): a topic asked about fewer times than the
  minimum (default five) must not show up anywhere a reader can look. The sweep walks every
  reading API operation the contract has, the outbox-fed inbox and activity, /metrics and the
  analytics role's views, so a surface added later is covered without a new test. A topic at
  the minimum is the positive control: the sweep must be able to see it.
*/

const { client, url } = testDatabase()
const origin = 'http://localhost:5173'
const metricsToken = randomBytes(24).toString('hex')
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  origins: [origin],
  metricsToken,
})
const rare = `metric:rare_${randomBytes(4).toString('hex')}`
const common = `metric:common_${randomBytes(4).toString('hex')}`
const ids: Record<string, string> = {}

async function signIn(name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return { cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '), origin }
}

/** One topic with `calls` agent calls this hour, none delivering an item, and a reported gap. */
async function asked(metric: string, calls: number, edition: string) {
  const { rows } = await client.query<{ id: string }>(
    `insert into topics (key,area_id,metric_keys,value_keys,month)
     values ($1,'finance',$2,'{}',date_trunc('month', now() at time zone 'UTC')::date) returning id`,
    [`test|${metric}`, [metric]],
  )
  const topic = rows[0]!.id
  for (let i = 0; i < calls; i++)
    await client.query(
      `insert into deliveries (delivered_hour,client_label,caller,edition_seq,overlay_seq,tool_schema_digest,topic_id,scope,status,delivered)
       values (date_trunc('hour', now(), 'UTC'),'claude-code','agent',$1,0,'digest',$2,'{}','no_match','[]')`,
      [edition, topic],
    )
  const gap = await client.query<{ id: string }>(
    "select cl_gap_touch($1,'missing',2::smallint,now(),null,0) as id",
    [topic],
  )
  return { topic, gap: gap.rows[0]!.id }
}

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    // The stranger owners another area; the author holds no role at all.
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
    // The sweep reads every reading operation eight times per person, more than the default
    // 600 requests a minute; the request limit is not what this file tests.
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       select 'limits.api_rate_per_minute', max(version) + 1, '{"person": 10000, "ip": 10000}', 'sweep'
         from settings_versions where key = 'limits.api_rate_per_minute'`,
    )
    const { edition } = await servingEdition(client)
    const hidden = await asked(rare, 4, edition)
    const shown = await asked(common, 5, edition)
    ids.rareGap = hidden.gap
    ids.commonGap = shown.gap
    ids.rareTopic = hidden.topic
  })
  // Gap events reach inboxes and the activity feed through the outbox relay.
  await client.query('select cl_outbox_relay(1000)')
})
afterAll(() => app.close())

const fill = (op: Operation, values: Record<string, string>) =>
  op.path.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? 'x')

async function sweep(headers: Record<string, string>, gap: string) {
  const bodies: { surface: string; body: string }[] = []
  const values = { id: gap, areaId: 'finance', label: 'x', key: 'privacy.min_count', tool: 'x' }
  for (const op of contractOperations()) {
    // Reading operations only; the live stream is read through the inbox and activity it feeds.
    if (op.method !== 'GET' || op.name === 'events.stream') continue
    for (const query of ['', '?areaId=finance', '?weeks=12', '?areaId=finance&weeks=12']) {
      const response = await app.inject({
        method: 'GET',
        url: fill(op, values) + query,
        headers,
      })
      bodies.push({ surface: `${op.name}${query}`, body: response.body })
    }
  }
  return bodies
}

it(
  'shows a topic under the minimum on no surface a reader can reach, and one at the minimum on some',
  { timeout: 120_000 },
  async () => {
    for (const name of ['author', 'stranger']) {
      const headers = await signIn(name)
      const bodies = [
        ...(await sweep(headers, ids.rareGap!)),
        ...(await sweep(headers, ids.commonGap!)),
      ]
      expect(bodies.length).toBeGreaterThan(200)
      expect(
        bodies
          .filter((b) => b.body.includes(rare) || b.body.includes(ids.rareTopic!))
          .map((b) => b.surface),
        `${name} sees the rare topic`,
      ).toEqual([])
      expect(
        bodies.filter((b) => b.body.includes(common)).length,
        `${name} sees the topic at the minimum`,
      ).toBeGreaterThan(0)
    }
  },
)

it('lets the area owner and administrators see the small topic, as designed', async () => {
  for (const name of ['owner', 'admin']) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/gaps/${ids.rareGap}`,
      headers: await signIn(name),
    })
    expect(response.statusCode, name).toBe(200)
    expect(response.body).toContain(rare)
  }
})

it('keeps it out of /metrics and the analytics views', async () => {
  const metrics = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: `Bearer ${metricsToken}` },
  })
  expect(metrics.statusCode).toBe(200)
  expect(metrics.body).not.toContain('rare_')
  expect(metrics.body).not.toContain('common_')
  await client.query(`set role ${identifier(localRoles.readonly)}`)
  try {
    const views = JSON.stringify([
      ...(await client.query<object>('select * from v_topic_counts_public')).rows,
      ...(await client.query<object>('select * from v_gap_totals')).rows,
    ])
    expect(views).not.toContain(rare)
    expect(views).toContain(common)
  } finally {
    await client.query(`set role ${identifier(localRoles.owner)}`)
  }
})

it('answers a test link on a gap under the minimum as if the gap did not exist', async () => {
  // The stranger owners another area, so the maintain operations reach the gap service.
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'stranger@example.test' },
  })
  const headers = {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  }
  for (const url of [
    `/api/v1/gaps/${ids.rareGap}/tests`,
    `/api/v1/gaps/${ids.rareGap}/tests/finance-question/unlink`,
  ]) {
    const refused = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { question: 'finance-question' },
    })
    expect(refused.statusCode, url).toBe(404)
    expect(refused.body).not.toContain(rare)
    expect(refused.body).not.toContain(ids.rareTopic!)
  }
})
