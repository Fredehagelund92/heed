import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NamesRead } from '../../src/contract/inbox.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  The views a Cube model on the server is read for (`CUBE_VIEWS_FILE`), an allow list, on the real
  service and PostgreSQL 18, over the invented model whose four views all include the cube
  `orders`: only the listed views become definitions, so the names card in the Inbox names only
  their members; a view taken out of the list goes missing at the next read, and the cube it shared
  stays read through the views still listed; a view the model lacks is named; a list of none reads
  nothing. The source's row keeps the list, as an added source keeps the one an admin chose.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const configDir = await mkdtemp(join(tmpdir(), 'heed-view-list-'))
const viewsFile = join(configDir, 'views.json')
const registry = new ConnectorRegistry([
  createCubeSource({
    modelDir: fileURLToPath(new URL('../fixtures/cube/model/', import.meta.url)),
    viewsFile,
  }),
])
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  logger,
  clock,
  devPeople: [{ name: 'admin', email: 'admin@example.test', roles: [] }],
})
const headers: Record<string, string> = {}

/** Lists these views in the server's file, then reads the source once. */
const readListing = async (views: string[]) => {
  await writeFile(viewsFile, JSON.stringify(views))
  await queueReads(client, ['cube'])
  const result = (await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })) as { connectors: Record<string, { status: string; definitionsSeen: number }> }
  return result.connectors.cube!
}
const current = async () =>
  (
    await client.query<{ ref: string }>(
      `select ref from definitions where connector_id = 'cube' and missing_since_snapshot is null
        order by ref`,
    )
  ).rows.map((row) => row.ref)
const named = async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/inbox/names',
    headers: { ...headers, 'idempotency-key': randomUUID() },
  })
  expect(response.statusCode, response.body).toBe(200)
  return [...new Set(response.json<NamesRead>().names.flatMap((name) => name.definitionRefs))]
}
const viewsOf = (refs: string[]) => [...new Set(refs.map((ref) => ref.slice(5).split('.')[0]))]
const warned = async () =>
  (
    await client.query<{ warnings: { code: string; target: string }[] }>(
      `select warnings from connector_snapshots where connector_id = 'cube'
        order by fetched_at desc limit 1`,
    )
  ).rows[0]!.warnings

beforeAll(async () => {
  await foundation(client)
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'admin@example.test' },
  })
  expect(response.statusCode, response.body).toBe(200)
  headers.origin = 'http://localhost'
  headers.cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  headers['x-heed-csrf'] = response.json<{ csrfToken: string }>().csrfToken
}, 120_000)
afterAll(async () => {
  await app.close()
  await rm(configDir, { recursive: true, force: true })
})

describe('the views a model on the server is read for', () => {
  it('reads only the views listed, and the names card names only their members', async () => {
    expect(await readListing(['sales', 'marketing'])).toMatchObject({
      status: 'ok',
      definitionsSeen: 5,
    })
    expect(viewsOf(await current())).toEqual(['marketing', 'sales'])
    const names = await named()
    expect(names.length).toBeGreaterThan(0)
    expect(viewsOf(names).sort()).toEqual(['marketing', 'sales'])
    // The row keeps the list, as an added source keeps an admin's.
    const [row] = (
      await client.query<{ all_groups: boolean; scopes: { id: string }[] }>(
        "select all_groups, scopes from connectors where id = 'cube'",
      )
    ).rows
    expect(row?.all_groups).toBe(false)
    expect(row?.scopes.map((scope) => scope.id)).toEqual(['sales', 'marketing'])
  }, 120_000)

  it('drops a view taken out of the list, keeping the cube it shared read through another', async () => {
    expect(await readListing(['sales', 'warehouse'])).toMatchObject({
      status: 'ok',
      definitionsSeen: 3,
    })
    expect(await current()).toEqual([
      'cube:sales.count',
      'cube:sales.country',
      'cube:sales.revenue',
    ])
    const [{ missing }] = (
      await client.query<{ missing: string[] }>(
        `select array_agg(ref order by ref) as missing from definitions
          where connector_id = 'cube' and missing_since_snapshot is not null`,
      )
    ).rows as [{ missing: string[] }]
    expect(missing).toEqual(['cube:marketing.orders_country', 'cube:marketing.orders_income'])
    expect(viewsOf(await named())).toEqual(['sales'])
    expect(await warned()).toContainEqual({ code: 'group_not_found', target: 'warehouse' })
  }, 120_000)

  it('reads nothing from a list of none, and every view once the file lists them', async () => {
    expect(await readListing([])).toMatchObject({ status: 'ok', definitionsSeen: 0 })
    expect(await current()).toEqual([])
    expect(await named()).toEqual([])
    expect(await warned()).toContainEqual({ code: 'no_groups_chosen', target: 'groups' })
    expect(await readListing(['growth', 'marketing', 'operations', 'sales'])).toMatchObject({
      status: 'ok',
      definitionsSeen: 7,
    })
    expect(viewsOf(await current())).toEqual(['growth', 'marketing', 'operations', 'sales'])
  }, 120_000)
})
