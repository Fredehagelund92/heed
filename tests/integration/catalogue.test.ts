import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bulkSeed } from '../../db/seed/bulk.ts'
import type { LookupEvent } from '../../src/contract/answer.ts'
import type { Catalogue } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { generateItems } from '../../db/seed/fixtures/items.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The catalogue read model (FR-136) on PostgreSQL 18: what the conformance suite cannot show with
  the fixtures alone. The bulk seed stores the demo Cube read; each test changes what the
  connector or the gap detection would change, and reads the catalogue as Maria over HTTP.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock('2026-10-07'),
  devPeople: [{ email: 'per_maria@example.test', name: 'Maria Lindqvist', roles: [] }],
})
let cookie = ''
let csrf = ''

beforeAll(async () => {
  await client.query('reset role')
  await bulkSeed(client, generateItems(150))
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { host: 'localhost', origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'per_maria@example.test' },
  })
  expect(response.statusCode).toBe(200)
  cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  csrf = response.json<{ csrfToken: string }>().csrfToken
}, 120_000)
afterAll(() => app.close())

async function get<T>(path: string, headers: Record<string, string> = { cookie }) {
  const response = await app.inject({ method: 'GET', url: `/api/v1${path}`, headers })
  return { status: response.statusCode, body: response.json<T>() }
}
const catalogue = async () => (await get<Catalogue>('/catalogue')).body
const term = async (key: string) => (await catalogue()).terms.find((t) => t.key === key)

describe('the catalogue on PostgreSQL', () => {
  it('needs a signed-in person, as the library does', async () => {
    expect((await get('/catalogue', {})).status).toBe(401)
  })

  it('keeps every flag and copy when the demo model is read again', async () => {
    const before = await catalogue()
    const service = new ConnectorService(
      database,
      new ConnectorRegistry([
        createCubeSource({
          modelDir: fileURLToPath(new URL('../../db/seed/cube/', import.meta.url)),
        }),
      ]),
    )
    const marks = (await client.query('select 1 from definition_marks')).rowCount
    const result = await service.sync('cube')
    expect(result).toMatchObject({
      status: 'ok',
      definitionsSeen: 31,
      flags: { raised: 0, cleared: 0 },
      staleLinkNotices: 0,
      domainNotices: 0,
    })
    expect((await client.query('select 1 from definition_marks')).rowCount).toBe(marks)
    // The read names the file each member's view is in, as the seed stored it.
    expect(
      (
        await client.query<{ model_file: string }>(
          "select model_file from definitions where ref = 'cube:orders.orders'",
        )
      ).rows,
    ).toEqual([{ model_file: 'orders.yml' }])
    // The legacy members stay gone; the copies are read again, so only the read time moves.
    expect(
      (
        await client.query(
          "select 1 from definitions where ref like 'cube:legacy.%' and missing_since_snapshot is null",
        )
      ).rowCount,
    ).toBe(0)
    const after = await catalogue()
    const readAt = after.sources[0]!.readAt
    expect(readAt! > before.sources[0]!.readAt!).toBe(true)
    expect(after).toEqual({
      ...before,
      sources: [{ ...before.sources[0], readAt }],
      terms: before.terms.map((t) => ({
        ...t,
        definition: t.definition && { ...t.definition, readAt },
        definitions: t.definitions.map((definition) => ({ ...definition, readAt })),
      })),
    })
  }, 60_000)

  it('counts open gaps whose topic names a metric, or a value of a dimension', async () => {
    const before = (await term('metric:orders'))!.shelf.gaps
    await client.query(
      `with topic as (insert into topics (key,area_id,metric_keys,value_keys,month)
         values ('catalogue-test','area_sales','{metric:orders}','{val:market/norway,val:market/poland}','2026-10-01')
         returning id)
       insert into gaps (topic_id,type,status,opened_by_case)
       select id, t.type::gap_type, t.status::gap_status, 2 from topic,
         (values ('missing','open'),('outdated','proposal_made'),('incorrect','resolved')) as t(type,status)`,
    )
    expect((await term('metric:orders'))!.shelf.gaps).toBe(before + 2)
    // One gap names two markets: it counts once for Market.
    expect((await term('dim:market'))!.shelf.gaps).toBe(2)
    expect((await term('dim:product'))!.shelf.gaps).toBe(0)
  })

  it('shows a definition that is gone with its new id, and the last copy kept', async () => {
    await client.query(
      `update definitions set missing_since_snapshot = last_seen_snapshot,
         renamed_to = 'cube:basket.units_per_order' where ref = 'cube:basket.gross_margin'`,
    )
    expect(await term('metric:gross_margin')).toMatchObject({
      status: 'gone',
      definition: {
        state: 'missing',
        renamedTo: 'cube:basket.units_per_order',
        descriptionCopy:
          'Net revenue minus what the goods cost us, as a share of net revenue, for orders shipped.',
        sourceId: 'cube',
      },
    })
  })

  it('keeps the last good read while the source fails (CON-213)', async () => {
    const { readAt, sourceVersion } = (await catalogue()).sources[0]!
    await client.query(
      `insert into connector_snapshots (connector_id,status,fetched_at,error)
       values ('cube','failed',now(),'Definition source could not be read')`,
    )
    expect((await catalogue()).sources).toEqual([
      { id: 'cube', name: 'Cube local model', tool: 'Cube', readAt, sourceVersion, failing: true },
    ])
  })

  it('leaves out a term whose definition only some groups may see (CON-509)', async () => {
    await client.query(
      "update definitions set visible_groups = '{finance}' where ref = 'cube:orders.returns'",
    )
    const listed = await catalogue()
    expect(listed.terms.some((t) => t.key === 'metric:returns')).toBe(false)
    expect(listed.coverage.metrics).toBe(21)
    await client.query(
      "update definitions set visible_groups = null where ref = 'cube:orders.returns'",
    )
    expect((await term('metric:returns'))?.definition?.ref).toBe('cube:orders.returns')
  })

  it('answers Ask from the catalogue as the person sees it, and counts only which question it was (CON-509, FR-718)', async () => {
    const records = async (question: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ask/lookup',
        headers: { cookie, 'x-heed-csrf': csrf, host: 'localhost', origin: 'http://localhost' },
        payload: { question },
      })
      expect(response.statusCode, response.body).toBe(200)
      const event = response.body
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)) as LookupEvent)
        .find((e) => e.type === 'records')
      if (!event || event.type !== 'records' || event.records.refused)
        throw new Error(`"${question}" got no records answer`)
      return event.records
    }
    await client.query('delete from records_asked_weekly')
    const shown = await catalogue()
    const metrics = shown.terms.filter((t) => t.kind === 'metric').length
    expect((await records('how many metrics are there?')).total).toBe(metrics)
    expect((await records('list 10 dimensions')).total).toBe(
      shown.terms.filter((t) => t.kind === 'dimension').length,
    )
    expect((await records('what markets are there')).intent).toBe('values')
    const salesBefore = (await records('list metrics in Sales')).total
    // A term whose definition only some groups may see is counted for nobody without them.
    await client.query(
      "update definitions set visible_groups = '{finance}' where ref = 'cube:orders.returns'",
    )
    try {
      const hidden = await records('how many metrics are there?')
      expect(hidden.total).toBe(metrics - 1)
      expect(hidden.sentence).toBe(`The workspace has ${metrics - 1} metrics.`)
      const sales = await records('list metrics in Sales')
      expect(sales.total).toBe(salesBefore - 1)
      expect(sales.sentence).toContain(String(salesBefore - 1))
      expect((await records('how many definitions are there?')).sentence).toMatch(
        new RegExp(`: ${metrics - 1} metrics and`),
      )
    } finally {
      await client.query(
        "update definitions set visible_groups = null where ref = 'cube:orders.returns'",
      )
    }
    // Only the question's id is counted, by week: never the words.
    const { rows } = await client.query<{ intent: string; asks: number }>(
      'select intent, asks from records_asked_weekly order by intent',
    )
    expect(rows).toEqual([
      { intent: 'count', asks: 1 },
      { intent: 'terms', asks: 5 },
      { intent: 'values', asks: 1 },
    ])
  })

  it('shows a term that names no definition as not linked, with no domain from a source', async () => {
    await client.query('begin')
    await client.query('alter table vocab_term_refs disable trigger user')
    await client.query(
      `delete from vocab_term_refs where version_id in
         (select id from vocab_term_versions where term_key = 'metric:units_sold')`,
    )
    await client.query('alter table vocab_term_refs enable trigger user')
    // An edition pins no source domain for a term without a definition (0054).
    await client.query('alter table source_domain_service disable trigger user')
    await client.query("delete from source_domain_service where term_key = 'metric:units_sold'")
    await client.query('alter table source_domain_service enable trigger user')
    await client.query('commit')
    expect(await term('metric:units_sold')).toMatchObject({
      definition: null,
      domain: { areaId: null, source: 'none' },
      status: 'not_linked',
    })
    expect((await catalogue()).coverage.withoutDomain).toBe(2)
  })

  it('lists no disconnected source, though what it read still names it', async () => {
    await client.query(
      `update connectors set origin = 'workspace', enabled = false, secret_ref = null,
         removed_at = now(), removed_by = (select id from people order by id limit 1)
       where id = 'cube'`,
    )
    expect((await catalogue()).sources).toEqual([])
    expect(await term('metric:returns')).toMatchObject({
      definition: { ref: 'cube:orders.returns', sourceId: 'cube', tool: 'Cube' },
    })
  })
})
