import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import {
  ConnectorRegistry,
  ConnectorService,
  createCubeSource,
  createDemoSource,
  type DefinitionSource,
  type SourceSnapshot,
} from '../../src/server/modules/connectors/index.ts'
import { databaseFromPool } from '../../src/server/db/database.ts'
import { ignoreTeardownDisconnects, testDatabase } from './support.ts'

const { client, url } = testDatabase()
const pool = ignoreTeardownDisconnects(
  new pg.Pool({ connectionString: url, options: '-c role=context_layer_api', max: 4 }),
)
const database = databaseFromPool(pool)
afterAll(async () => {
  await pool.end()
})

it('compiles and stores real metadata through the API role, without editing vocabulary or editions', async () => {
  const source = createCubeSource({
    modelDir: fileURLToPath(new URL('../fixtures/cube/', import.meta.url)),
  })
  const service = new ConnectorService(database, new ConnectorRegistry([source]))
  const result = await service.sync('cube')
  expect(result).toMatchObject({
    status: 'ok',
    definitionsSeen: 7,
    coverage: { cube: 3, override: 0, none: 2 },
  })
  expect(await service.exists('cube:sales.revenue')).toBe(true)
  expect(
    (await service.list('cube')).find((entry) => entry.ref === 'cube:sales.revenue'),
  ).toMatchObject({
    areaHint: 'finance',
    domainSource: 'cube',
    visibleGroups: null,
    missingSinceSnapshot: null,
  })
  expect(await service.changesSince('cube', result.snapshotId)).toEqual({
    changed: [],
    missing: [],
  })
  await expect(service.changesSince('demo', result.snapshotId)).rejects.toThrow(
    'Unknown successful connector snapshot',
  )
  const persisted = await client.query<{ data: string }>(
    `select row_to_json(d)::text as data from definitions d`,
  )
  expect(JSON.stringify(persisted.rows)).not.toContain('SELECT amount')
  expect((await client.query('select * from vocab_terms')).rowCount).toBe(0)
  expect((await client.query('select * from editions')).rowCount).toBe(0)
  expect((await client.query('select * from overlay_events')).rowCount).toBe(0)
}, 20_000)

it('keeps marks across failures and partial reads, records changes and removals, and revives returned members', async () => {
  let snapshot: SourceSnapshot = await createDemoSource().read()
  let fail = false
  const source: DefinitionSource = {
    ...createDemoSource(),
    read: () =>
      fail
        ? Promise.reject(new Error('SELECT private_calculation FROM secret_table'))
        : Promise.resolve(structuredClone(snapshot)),
  }
  const service = new ConnectorService(database, new ConnectorRegistry([source]))
  const initial = await service.sync('demo')
  const before = await service.list('demo')
  const unchanged = await service.sync('demo')
  expect(await service.changesSince('demo', initial.snapshotId)).toEqual({
    changed: [],
    missing: [],
  })
  expect(
    (
      await client.query('select * from definition_marks where snapshot_id=$1', [
        unchanged.snapshotId,
      ])
    ).rowCount,
  ).toBe(0)
  fail = true
  const failed = await service.sync('demo')
  expect(failed.status).toBe('failed')
  expect(await service.list('demo')).toEqual(before)
  const failedRow = await client.query<{ error: string }>(
    'select error from connector_snapshots where id=$1',
    [failed.snapshotId],
  )
  expect(failedRow.rows[0]!.error).toBe('Definition source could not be read')
  await expect(service.changesSince('demo', failed.snapshotId)).rejects.toThrow()
  fail = false
  snapshot = {
    ...snapshot,
    complete: false,
    definitions: [snapshot.definitions[0]!],
    warnings: [{ code: 'unreadable_file', target: 'extra.yml' }],
  }
  expect((await service.sync('demo')).status).toBe('partial')
  expect(await service.exists('semlayer:country')).toBe(true)
  snapshot = {
    ...snapshot,
    complete: true,
    warnings: [{ code: 'domain_override', target: 'semlayer:revenue' }],
    definitions: [
      {
        ...snapshot.definitions[0]!,
        changeMark: 'a'.repeat(64),
        areaHint: 'finance',
        domainSource: 'override',
      },
    ],
  }
  const changed = await service.sync('demo')
  expect(await service.changesSince('demo', initial.snapshotId)).toEqual({
    changed: ['semlayer:revenue'],
    missing: ['semlayer:country'],
  })
  expect(await service.exists('semlayer:country')).toBe(false)
  expect(
    (await service.list('demo')).find((entry) => entry.ref === 'semlayer:revenue')?.domainSource,
  ).toBe('override')
  const missing = (await service.list('demo')).find((entry) => entry.ref === 'semlayer:country')!
  expect(missing.missingSinceSnapshot).toBe(changed.snapshotId)
  await service.sync('demo')
  expect(
    (await service.list('demo')).find((entry) => entry.ref === 'semlayer:country')
      ?.missingSinceSnapshot,
  ).toBe(changed.snapshotId)
  snapshot = await createDemoSource().read()
  await service.sync('demo')
  expect(await service.exists('semlayer:country')).toBe(true)
  expect(await service.changesSince('demo', changed.snapshotId)).toEqual({
    changed: ['semlayer:country', 'semlayer:revenue'],
    missing: [],
  })
  expect((await client.query('select * from overlay_events')).rowCount).toBe(0)
})

it('serializes refreshes for a connector and leaves members another source reads with it', async () => {
  let active = 0
  let maximum = 0
  const demo = createDemoSource()
  const source: DefinitionSource = {
    ...demo,
    read: async () => {
      maximum = Math.max(maximum, ++active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const snapshot = await demo.read()
      active--
      return snapshot
    },
  }
  const service = new ConnectorService(database, new ConnectorRegistry([source]))
  await Promise.all([service.sync('demo'), service.sync('demo')])
  expect(maximum).toBe(1)
  // A ref belongs to one source for good: a second source reading the same members leaves them
  // with the first, says so, and reads in part, so it marks nothing missing.
  const other: DefinitionSource = { ...source, id: 'other' }
  const conflicting = new ConnectorService(database, new ConnectorRegistry([other]))
  await expect(conflicting.sync('other')).resolves.toMatchObject({
    status: 'partial',
    definitionsSeen: 0,
  })
  const [read] = (
    await client.query<{ warnings: unknown }>(
      "select warnings from connector_snapshots where connector_id='other'",
    )
  ).rows
  expect(read?.warnings).toEqual([
    { code: 'taken', target: 'semlayer:country' },
    { code: 'taken', target: 'semlayer:revenue' },
  ])
  expect(
    (await client.query("select 1 from definitions where connector_id='other'")).rowCount,
  ).toBe(0)
  expect(
    (
      await client.query(
        "select 1 from definitions where connector_id='demo' and missing_since_snapshot is null",
      )
    ).rowCount,
  ).toBe(2)
  await client.query("update connectors set enabled=false where id='demo'")
  await expect(service.sync('demo')).rejects.toThrow('disabled')
})

it('runs the local refresh command with configured Cube and override paths', async () => {
  const cliUrl = new URL(url)
  cliUrl.searchParams.set('options', '-c role=context_layer_api')
  const directory = await mkdtemp(join(tmpdir(), 'heed-sync-'))
  try {
    const overrides = join(directory, 'domains.json')
    await writeFile(overrides, JSON.stringify({ marketing: 'paid_media' }))
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../../src/server/sync-definitions.ts', import.meta.url))],
      {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CL_AUTH: 'dev',
          MODELS: 'mock',
          DATABASE_URL: cliUrl.href,
          CUBE_MODEL_DIR: fileURLToPath(new URL('../fixtures/cube/', import.meta.url)),
          CL_DOMAIN_OVERRIDES: overrides,
        },
        timeout: 15_000,
      },
    )
    const output: unknown = JSON.parse(stdout)
    expect(output).toMatchObject({
      status: 'ok',
      definitionsSeen: 7,
      coverage: { cube: 3, override: 1, none: 1 },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

it('records per-file warnings on failed compiles without changing stored definitions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heed-broken-model-'))
  try {
    await writeFile(join(directory, 'bad.yml'), 'cubes: [')
    const service = new ConnectorService(
      database,
      new ConnectorRegistry([createCubeSource({ modelDir: directory })]),
    )
    const before = await service.list('cube')
    const result = await service.sync('cube')
    expect(result.status).toBe('failed')
    expect(await service.list('cube')).toEqual(before)
    const saved = await client.query<{ warnings: unknown }>(
      'select warnings from connector_snapshots where id=$1',
      [result.snapshotId],
    )
    // Why it failed first (no file the compiler could read), then each file's own warning.
    expect(saved.rows[0]!.warnings).toEqual([
      { code: 'no_model_files', target: 'model' },
      { code: 'unreadable_file', target: 'bad.yml' },
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("never lets concurrent connectors overwrite each other's definition references", async () => {
  const demo = createDemoSource()
  const snapshot = await demo.read()
  const sources: DefinitionSource[] = ['race_a', 'race_b'].map((id) => ({
    ...demo,
    id,
    read: () =>
      Promise.resolve({
        ...snapshot,
        definitions: [{ ...snapshot.definitions[0]!, ref: 'semlayer:race' }],
      }),
  }))
  const service = new ConnectorService(database, new ConnectorRegistry(sources))
  const results = await Promise.allSettled(sources.map((source) => service.sync(source.id)))
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  const rows = await client.query("select 1 from connectors where id in ('race_a','race_b')")
  expect(rows.rowCount).toBe(1)
})

it('refuses a rename that does not lead from a member that is gone to one that is here', async () => {
  const demo = createDemoSource()
  const snapshot = await demo.read()
  const source: DefinitionSource = {
    ...demo,
    id: 'renames',
    read: () =>
      Promise.resolve({
        ...snapshot,
        definitions: [{ ...snapshot.definitions[0]!, ref: 'semlayer:renamed_revenue' }],
        renames: [{ from: 'semlayer:renamed_revenue', to: 'semlayer:nowhere' }],
      }),
  }
  const result = await new ConnectorService(database, new ConnectorRegistry([source])).sync(
    'renames',
  )
  expect(result).toMatchObject({ status: 'failed', definitionsSeen: 0 })
  expect(
    (await client.query("select 1 from definitions where ref='semlayer:renamed_revenue'")).rowCount,
  ).toBe(0)
})
