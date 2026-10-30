import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/catalogue.ts'
import type { GapDetail } from '../../src/contract/gaps.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import { editionDigest } from '../../src/domain/canonical.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  INTERFACE_VERSION,
  type DefinitionSource,
  type SourceSnapshot,
} from '../../src/server/modules/connectors/index.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, people, version } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  One domain rule everywhere (CON-206, FR-136, FR-215, FR-320). The demo's metrics have no area
  in the vocabulary; Cube gives each its domain (OQ-24). Before 0054 only the catalogue read it,
  so a gap about Orders in Norway reached no owner ("Several domains"). The edition now
  carries the source's domains: a sync publishes them, and serving, gap topics, who manages a gap
  and the catalogue read the same pinned map. Every domain is served (FR-320).

  Here: Commercial (owner), Customer value (approver is its owner), Marketing (stranger is its
  owner), and an author who reports gaps, as Maria does in the demo.
*/

const { client, url } = testDatabase()
const pool = servingPool(url)
const editions = createEditionSource(pool)
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock(),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

const mark = (text: string) => createHash('sha256').update(text).digest('hex')
const member = (ref: string, kind: 'metric' | 'dimension', areaHint: string | null) => ({
  ref,
  kind,
  name: ref.slice(5),
  title: null,
  descriptionCopy: null,
  valueType: null,
  visibleGroups: null,
  areaHint,
  domainSource: areaHint ? ('cube' as const) : ('none' as const),
  modelFile: null,
  changeMark: mark(ref),
})
/** What the source reads next; a test changes it to move a domain. */
let read: SourceSnapshot = {
  sourceVersion: 'v1',
  complete: true,
  warnings: [],
  definitions: [
    member('demo:payments.orders', 'metric', 'area_commercial'),
    member('demo:customers.active_customers', 'metric', 'area_customer_value'),
    member('demo:marketing.spend', 'metric', 'area_marketing'),
    member('demo:segments.market', 'dimension', null),
  ],
}
const source: DefinitionSource = {
  id: 'demo',
  type: 'demo',
  name: 'Demo model',
  interfaceVersion: INTERFACE_VERSION,
  serverSettings: [],
  read: () => Promise.resolve(read),
}
const connectors = new ConnectorService(apiDatabase(url), new ConnectorRegistry([source]))

const activePlayers = {
  metrics: ['metric:active_customers'],
  window: { from: '2026-09-01', to: '2026-09-30' },
}
const legacyKey = '|metric:orders|val:market/norway|2026-08'
let legacyGap = ''

/** The live edition as an edition from before 0054 left it: the vocabulary, area states, no domains. */
async function legacyEdition() {
  await client.query(`
    insert into areas (id,name) values ('area_commercial','Commercial'),('area_customer_value','Customer value'),
      ('area_marketing','Marketing');
    insert into vocab_terms (key,kind,parent_key) values ('metric:orders','metric',null),
      ('metric:active_customers','metric',null),('metric:marketing_spend','metric',null),
      ('dim:market','dimension',null),('val:market/norway','dimension_value','dim:market')`)
  for (const [area, person] of [
    ['area_commercial', people.owner],
    ['area_customer_value', people.approver],
    ['area_marketing', people.stranger],
  ] as const)
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ($1,$2,'owner')",
      [area, person],
    )
  await client.query(
    "insert into global_role_grants (person_id,role) values ($1,'administrator')",
    [people.admin],
  )
  // The demo's vocabulary: no area of its own for any metric (CON-206 leaves it to Cube).
  const terms = [
    ['metric:orders', 'Orders', 'demo:payments.orders'],
    ['metric:active_customers', 'Active customers', 'demo:customers.active_customers'],
    ['metric:marketing_spend', 'Marketing spend', 'demo:marketing.spend'],
    ['dim:market', 'Market', 'demo:segments.market'],
    ['val:market/norway', 'Norway', null],
  ]
  const seq = (await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq"))
    .rows[0]!.seq
  for (const [key, name, ref] of terms) {
    const { rows } = await client.query<{ id: string }>(
      `with v as (insert into vocab_term_versions (term_key,version_no,name,content_digest) values($1,1,$2,sha256(convert_to($1::text,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$3 from v where $3::text is not null) select id from v`,
      [key, name, ref],
    )
    await client.query('select edition_serve_vocab_version($1,$2)', [seq, rows[0]!.id])
  }
  // Accepted notes about active customers in Customer value, as the demo has twenty.
  for (let n = 0; n < 2; n += 1) {
    const v = await version(client, {
      area: 'area_customer_value',
      owner: people.approver,
      scope: false,
      title: `Active customers note ${n}`,
      summary: 'Active customers',
      validity: { from: '2026-01-01', until: null },
    })
    await client.query("insert into item_version_metrics values ($1,'metric:active_customers')", [
      v.id,
    ])
    await accept(client, v.id, { actor: people.approver })
    await client.query('select edition_serve_item_version($1,$2)', [seq, v.id])
  }
  await client.query('select edition_seal($1)', [seq])
  await client.query('select edition_publish($1)', [seq])
  // The demo's reported gap from before: Orders in Norway, its topic without an area.
  const topic = await client.query<{ id: string }>(
    `insert into topics (key,area_id,metric_keys,value_keys,month)
     values ($1,null,'{metric:orders}','{val:market/norway}','2026-08-01') returning id`,
    [legacyKey],
  )
  legacyGap = randomUUID()
  await client.query(
    `insert into gaps (id,ref,topic_id,type,status,severity,opened_by_case,first_seen,last_seen,status_since)
     values ($1,'gap_legacy0001',$2,'missing','open',1,2,'2026-10-01','2026-10-01',date_trunc('hour',now(),'UTC'))`,
    [legacyGap, topic.rows[0]!.id],
  )
}

beforeAll(async () => {
  for (const [name, id] of Object.entries(people))
    await client.query('insert into people (id,email,display_name) values ($1,$2,$3)', [
      id,
      `${name}@example.test`,
      name,
    ])
  // The source is read before any edition: the first sync has no live edition to bring up to date.
  expect((await connectors.sync('demo')).domainEdition).toBeNull()
  await transaction(client, legacyEdition)
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})
afterAll(async () => {
  await app.close()
  await pool.end()
})

describe('before a sync pins the domains', () => {
  it('serves the source domains of no metric, as the demo did', async () => {
    expect((await editions.bundle()).metricArea).toEqual({})
  })
})

describe('after a sync pins them', () => {
  let edition = ''
  beforeAll(async () => {
    const synced = await connectors.sync('demo')
    expect(synced.domainEdition).not.toBeNull()
    edition = synced.domainEdition!
  })

  it('publishes one "areas mapped again" edition with the domains, and only when they change', async () => {
    const { rows } = await client.query<{ reason: string; live: boolean; same: boolean }>(
      `select e.reason::text as reason, e.seq = (select seq from live_edition) as live,
              e.digest = edition_content_digest(e.seq) as same
         from editions e where e.label = $1`,
      [edition],
    )
    expect(rows).toEqual([{ reason: 'area_map_changed', live: true, same: true }])
    expect(
      (
        await client.query(
          `select key, area_id from serving_source_domains((select seq from live_edition)) order by key`,
        )
      ).rows,
    ).toEqual([
      { key: 'metric:active_customers', area_id: 'area_customer_value' },
      { key: 'metric:marketing_spend', area_id: 'area_marketing' },
      { key: 'metric:orders', area_id: 'area_commercial' },
    ])
    expect((await connectors.sync('demo')).domainEdition).toBeNull()
  })

  it('seals the domains into the digest, which the export rule recomputes', async () => {
    const lines = await client.query<{ kind: string; key: string; value: string }>(
      `select 'item' as kind, s.item_id as key, encode(v.content_digest,'hex') as value
         from item_version_service s join item_versions v on v.id=s.version_id
        where s.editions @> (select seq from live_edition)
       union all select 'vocab', s.term_key, encode(v.content_digest,'hex')
         from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
        where s.editions @> (select seq from live_edition)
       union all select 'area', area_id, state::text from area_state_service
        where editions @> (select seq from live_edition)
       union all select 'domain', term_key, area_id from source_domain_service
        where editions @> (select seq from live_edition)`,
    )
    const of = (kind: string) => lines.rows.filter((line) => line.kind === kind)
    const recomputed = await editionDigest({
      items: of('item').map((line) => ({ id: line.key, digest: line.value })),
      vocabulary: of('vocab').map((line) => ({ key: line.key, digest: line.value })),
      areas: of('area').map((line) => ({ id: line.key, state: line.value as 'live' })),
      domains: of('domain').map((line) => ({ key: line.key, areaId: line.value })),
    })
    const { rows } = await client.query<{ digest: string }>(
      "select encode(digest,'hex') as digest from editions where seq=(select seq from live_edition)",
    )
    expect(recomputed).toBe(rows[0]!.digest)
  })

  it('gives the topic of the earlier report its domain, so it reaches the owner', async () => {
    const { rows } = await client.query<{ key: string; area_id: string | null }>(
      'select t.key, t.area_id from gaps g join topics t on t.id=g.topic_id where g.id=$1',
      [legacyGap],
    )
    expect(rows).toEqual([{ key: 'area_commercial' + legacyKey, area_id: 'area_commercial' }])
  })

  it('lets the owner manage that gap', async () => {
    const owned = await call('GET', `/gaps/${legacyGap}`, 'owner')
    expect(owned.statusCode, owned.body).toBe(200)
    expect(owned.json<GapDetail>()).toMatchObject({
      canManage: true,
      topic: { areaId: 'area_commercial', areaIds: ['area_commercial'] },
    })
    // Not a manager of another domain's gap.
    const other = await call('GET', `/gaps/${legacyGap}`, 'stranger')
    if (other.statusCode === 200) expect(other.json<GapDetail>().canManage).toBe(false)
  })

  it("serves Active customers from Customer value to agents, and names the metric's domain", async () => {
    await client.query("update areas set summary='Customers over their lifetime.' where id=$1", [
      'area_customer_value',
    ])
    const execute = createToolService(editions, createAnonymousStore(pool))
    const reply = await execute(
      'get_facts',
      { question: 'Active customers in September 2026', ...activePlayers },
      { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
      100000,
      () => {},
    )
    const result = reply.structuredContent as {
      status: string
      items: unknown[]
      domains: { id: string; name: string; summary?: string }[]
    }
    expect(result.status).toBe('matched')
    expect(result.items).toHaveLength(2)
    expect(result.domains).toEqual([
      expect.objectContaining({
        id: 'area_customer_value',
        name: 'Customer value',
        summary: 'Customers over their lifetime.',
      }),
    ])
  })

  it('shows a topic that spans domains to the owners of each, and names them', async () => {
    // A report about two domains' metrics, as report_gap records it: its topic has no one area.
    const topic = await client.query<{ id: string }>(
      `insert into topics (key,area_id,metric_keys,value_keys,month)
       values ('|metric:active_customers,metric:marketing_spend||2026-09',null,
               '{metric:active_customers,metric:marketing_spend}','{}','2026-09-01') returning id`,
    )
    const id = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,1,'Nothing on either','report_gap')::text as id",
        [topic.rows[0]!.id],
      )
    ).rows[0]!.id
    for (const who of ['approver', 'stranger'] as const) {
      const detail = (await call('GET', `/gaps/${id}`, who)).json<GapDetail>()
      expect(detail, who).toMatchObject({
        canManage: true,
        topic: { areaId: null, areaIds: ['area_customer_value', 'area_marketing'] },
      })
      // The owners of each read its notes (FR-611), through the same rule in row security.
      expect(detail.notes?.map((note) => note.note)).toEqual(['Nothing on either'])
    }
    const commercial = await call('GET', `/gaps/${id}`, 'owner')
    if (commercial.statusCode === 200) expect(commercial.json<GapDetail>().canManage).toBe(false)
  })

  it('groups the catalogue by the same map serving reads', async () => {
    const catalogue = (await call('GET', '/catalogue', 'author')).json<Catalogue>()
    const bundle = await editions.bundle()
    const grouped = Object.fromEntries(
      catalogue.terms.flatMap((term) =>
        term.kind === 'metric' && term.domain.areaId ? [[term.key, term.domain.areaId]] : [],
      ),
    )
    expect(grouped).toEqual(bundle.metricArea)
    expect(bundle.metricArea).toEqual({
      'metric:active_customers': 'area_customer_value',
      'metric:orders': 'area_commercial',
      'metric:marketing_spend': 'area_marketing',
    })
  })

  it('delivers an item of a live domain about a metric of a domain not live', async () => {
    // FR-320, option A: Commercial is live, Active customers is Customer value's (starting). Items of
    // live domains about it are delivered, so the review says agents get this one.
    const created = await call('POST', '/proposals', 'author', {
      draft: {
        areaId: 'area_commercial',
        kind: 'event',
        title: 'Norway campaign',
        summary: 'A Commercial campaign in Norway started on 1 September 2026.',
        scope: { metrics: ['metric:active_customers'], dimensions: [], dimensionValues: [] },
        validity: { start: '2026-09-01', end: null },
        evidence: [
          {
            url: 'https://example.test/campaign',
            quote: 'The campaign started',
            date: '2026-09-01',
          },
        ],
      },
    })
    expect(created.statusCode, created.body).toBe(200)
    const p = created.json<ProposalRecord>()
    const submitted = await call('POST', `/proposals/${p.id}/submit`, 'author', {
      revision: p.revision,
    })
    expect(submitted.statusCode, submitted.body).toBe(200)
    const sheet = await call('GET', `/review/${p.id}/sheet`, 'owner')
    expect(sheet.statusCode, sheet.body).toBe(200)
    // With it published, agents asking its own question get it.
    expect(sheet.json<ReviewSheet>().tryIt.after.items.map((item) => item.title)).toContain(
      'Norway campaign',
    )
  })

  it('follows the source when it moves a domain, in a new edition', async () => {
    read = {
      ...read,
      sourceVersion: 'v2',
      definitions: read.definitions.map((definition) =>
        definition.ref === 'demo:marketing.spend' ? { ...definition, areaHint: null } : definition,
      ),
    }
    const moved = await connectors.sync('demo')
    expect(moved.domainEdition).not.toBeNull()
    expect(moved.domainEdition).not.toBe(edition)
    const bundle = await editions.bundle()
    expect(bundle.metricArea['metric:marketing_spend']).toBeUndefined()
    // The earlier edition still serves what it did (FR-327).
    expect((await editions.bundle(edition)).metricArea['metric:marketing_spend']).toBe(
      'area_marketing',
    )
  })
})
