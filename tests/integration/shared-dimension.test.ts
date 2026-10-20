import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  One dimension, many Cube names, end to end (CON-208 to CON-210): Country is a member of the
  sales view and of the traffic view, and one term links both. An item about Revenue (sales) is
  checked against sales.country only, an item about Sessions (traffic) against traffic.country
  only, so a change to Country in one view flags only the items about that view's metrics.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const servePool = servingPool(url)
const refuse = (): Promise<never> => Promise.reject(new Error('not recorded in this test'))
const execute = createToolService(
  createEditionSource(servePool, 0),
  { write: refuse, reportGap: refuse, feedback: refuse },
  () => new Date('2026-10-08T12:00:00Z'),
)

/** A model where Country is in two views; `traffic` and `sales` describe it as given. */
const model = (sales = 'The country of the order.', traffic = 'The country of the visit.') => `
cubes:
  - name: orders
    public: false
    sql: SELECT amount, country FROM example_orders
    measures:
      - name: revenue
        type: sum
        sql: amount
    dimensions:
      - name: country
        type: string
        sql: country
        description: ${sales}
  - name: visits
    public: false
    sql: SELECT country FROM example_visits
    measures:
      - name: sessions
        type: count
    dimensions:
      - name: country
        type: string
        sql: country
        description: ${traffic}
views:
  - name: sales
    meta:
      domain: finance
    cubes:
      - join_path: orders
        includes: '*'
  - name: traffic
    meta:
      domain: finance
    cubes:
      - join_path: visits
        includes: '*'
`
let modelDir = ''
let cube: ConnectorService

type Who = keyof typeof people
const headers: Record<string, Record<string, string>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
function ok<T>(response: Awaited<ReturnType<typeof call>>): T {
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
/** A low-risk note proposed by the author and accepted by the owner, live in a new edition. */
async function accepted(extra: Draft): Promise<string> {
  const created = ok<ProposalRecord>(
    await call('POST', '/proposals', 'author', {
      draft: {
        areaId: 'finance',
        validity: { start: '2026-08-04', end: null },
        evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
        ...extra,
      },
    }),
  )
  const submitted = ok<ProposalRecord>(
    await call('POST', `/proposals/${created.id}/submit`, 'author', {
      revision: created.revision,
    }),
  )
  const review = ok<{ proposal: ReviewProposal }>(
    await call('GET', `/proposals/${submitted.id}/review`, 'owner'),
  )
  ok(
    await call('POST', `/proposals/${submitted.id}/decisions`, 'owner', {
      revision: review.proposal.revision,
      outcome: 'accept',
      reason: 'Reviewed against the evidence',
    }),
  )
  return submitted.itemId!
}
const references = async (item: string) =>
  (
    await client.query<{ ref: string }>(
      `select r.definition_ref as ref from item_version_refs r
         join item_versions v on v.id = r.version_id where v.item_id = $1 order by 1`,
      [item],
    )
  ).rows.map((row) => row.ref)
const flagged = async () =>
  (
    await client.query<{ item_id: string }>(
      "select item_id from v_overlay_on where kind = 'flag_on' order by item_id",
    )
  ).rows.map((row) => row.item_id)
async function countryLink(item: string, metric: string) {
  const result = await execute(
    'get_context',
    { question: '', metrics: [metric], window: { from: '2026-08-10', to: '2026-08-20' } },
    { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    200000,
    () => {},
  )
  const delivered = (
    result.structuredContent as {
      items: { id: string; links: { rel: string; target: { id: string; status: string } }[] }[]
    }
  ).items.find((candidate) => candidate.id === item)
  return delivered?.links.find((link) => link.rel === 'mentions')?.target
}

const items = { sales: '', traffic: '', mention: '' }

beforeAll(async () => {
  modelDir = await mkdtemp(join(tmpdir(), 'heed-shared-dimension-'))
  await writeFile(join(modelDir, 'model.yml'), model())
  cube = new ConnectorService(database, new ConnectorRegistry([createCubeSource({ modelDir })]))
  await foundation(client)
  expect((await cube.sync('cube')).status).toBe('ok')
  await transaction(client, async () => {
    await client.query(`insert into vocab_terms(key,kind) values
      ('metric:revenue','metric'),('metric:sessions','metric'),('dim:country','dimension')`)
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, refs] of [
      ['metric:revenue', 'Revenue', 'finance', ['cube:sales.revenue']],
      ['metric:sessions', 'Sessions', 'finance', ['cube:traffic.sessions']],
      ['dim:country', 'Country', null, ['cube:sales.country', 'cube:traffic.country']],
    ] as const) {
      const { rows } = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values ($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await client.query(
        'insert into vocab_term_refs (version_id,definition_ref) select $1,unnest($2::text[])',
        [rows[0]!.id, refs],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  for (const name of Object.keys(people)) {
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
  items.sales = await accepted({
    title: 'Revenue by country',
    summary: 'Revenue by country leaves out refunds',
    scope: { metrics: ['metric:revenue'], dimensions: ['dim:country'], dimensionValues: [] },
  })
  items.traffic = await accepted({
    title: 'Sessions by country',
    summary: 'Sessions by country count bots',
    scope: { metrics: ['metric:sessions'], dimensions: ['dim:country'], dimensionValues: [] },
  })
  items.mention = await accepted({
    title: 'Revenue note',
    summary: 'Revenue dipped in one @[country](dim:country)',
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
}, 60_000)

afterAll(async () => {
  await app.close()
  await servePool.end()
  await rm(modelDir, { recursive: true, force: true })
})

describe('a dimension in two views', () => {
  it("brings into an item's references only its member in the view of the item's metrics", async () => {
    expect(await references(items.sales)).toEqual(['cube:sales.country', 'cube:sales.revenue'])
    expect(await references(items.traffic)).toEqual([
      'cube:traffic.country',
      'cube:traffic.sessions',
    ])
    // A mention records the member that matters to the item too.
    const mark = await client.query<{ ref: string }>(
      `select m.definition_ref as ref from item_version_mentions m
         join item_versions v on v.id = m.version_id where v.item_id = $1`,
      [items.mention],
    )
    expect(mark.rows).toEqual([{ ref: 'cube:sales.country' }])
  })

  it('flags only the items about the view whose member changed', async () => {
    await writeFile(
      join(modelDir, 'model.yml'),
      model(undefined, 'The country the visit came from.'),
    )
    expect((await cube.sync('cube')).status).toBe('ok')
    expect(await flagged()).toEqual([items.traffic])
    // The mention is about Revenue, whose view's Country did not change.
    expect(await countryLink(items.mention, 'metric:revenue')).toMatchObject({
      id: 'dim:country',
      status: 'current',
    })
    const stale = await client.query('select 1 from v_stale_links where item_id = $1', [
      items.mention,
    ])
    expect(stale.rowCount).toBe(0)

    await writeFile(
      join(modelDir, 'model.yml'),
      model('The country the order shipped to.', 'The country the visit came from.'),
    )
    expect((await cube.sync('cube')).status).toBe('ok')
    expect(await flagged()).toEqual([items.sales, items.traffic].sort())
    expect(await countryLink(items.mention, 'metric:revenue')).toMatchObject({
      status: 'source_changed',
    })
    const changed = await client.query<{ status: string; definition_ref: string }>(
      'select status, definition_ref from v_stale_links where item_id = $1',
      [items.mention],
    )
    expect(changed.rows).toEqual([
      { status: 'source_changed', definition_ref: 'cube:sales.country' },
    ])
  }, 60_000)
})
