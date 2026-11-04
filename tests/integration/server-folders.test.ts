import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  ConnectorRegistry,
  ConnectorService,
  configuredSources,
} from '../../src/server/modules/connectors/index.ts'
import { legacyManifest, withChangedRevenue } from '../server/connectors/dbt-metricflow-fixture.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  A folder on the server (CON-119), end to end on PostgreSQL 18: whoever runs the server names a
  folder for dbt MetricFlow, and the same connector reads the file there as one of the server's
  own sources, through the definitions pipeline, with no repository, token or settings.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
let folder = ''
let domains = ''
const manifestFile = () => join(folder, 'semantic_manifest.json')

const service = () =>
  new ConnectorService(
    database,
    new ConnectorRegistry(
      configuredSources({
        cubeModelDir: undefined,
        domainOverridesFile: domains,
        renamesFile: undefined,
        serverFolders: { 'dbt-metricflow': folder },
      }),
    ),
  )

const stored = async () =>
  (
    await client.query<{ ref: string; change_mark: string; area_hint: string | null }>(
      `select ref, change_mark, area_hint from definitions
        where connector_id = 'dbt-metricflow' order by ref`,
    )
  ).rows

beforeAll(async () => {
  await foundation(client)
  folder = await mkdtemp(join(tmpdir(), 'heed-server-folder-'))
  domains = join(folder, 'domains.json')
  await writeFile(domains, JSON.stringify({ customers: 'finance' }))
  await writeFile(manifestFile(), JSON.stringify(legacyManifest))
}, 60_000)
afterAll(async () => {
  await rm(folder, { recursive: true, force: true })
})

it('reads dbt’s file from the folder, as a source of the server’s own', async () => {
  expect(await service().sync('dbt-metricflow')).toMatchObject({ status: 'ok' })
  const read = await stored()
  expect(read).toHaveLength(19)
  // The server's domains fill what the file leaves empty.
  expect(read.find((d) => d.ref === 'dbt:customers.region')?.area_hint).toBe('finance')
  const [row] = (
    await client.query<{ origin: string; type: string }>(
      "select origin, type from connectors where id = 'dbt-metricflow'",
    )
  ).rows
  expect(row).toEqual({ origin: 'server', type: 'dbt-metricflow' })
}, 60_000)

it('sees a change in the file at its next read', async () => {
  const before = await stored()
  await writeFile(manifestFile(), JSON.stringify(withChangedRevenue(legacyManifest)))
  expect(await service().sync('dbt-metricflow')).toMatchObject({ status: 'ok' })
  const after = await stored()
  expect(
    after.filter((d, index) => d.change_mark !== before[index]!.change_mark).map((d) => d.ref),
  ).toContain('dbt:orders.revenue')
}, 60_000)

it('changes nothing when the file is gone', async () => {
  const before = await stored()
  await rm(manifestFile())
  expect(await service().sync('dbt-metricflow')).toMatchObject({ status: 'failed' })
  expect(await stored()).toEqual(before)
}, 60_000)
