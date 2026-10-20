import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDatabase } from '../../src/server/db/database.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createJobRunner } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { testDatabase } from './support.ts'

/*
  Source health (CON-104, CON-504, CON-516) and the hourly refresh (CON-506), as the service runs
  them: the `connectors.sync` job on pg-boss under the API role, started by an administrator from
  the operations view, which then shows the last read, its warnings and the domain coverage.
*/

const { client, url } = testDatabase()
const apiUrl = (() => {
  const api = new URL(url)
  api.searchParams.set('options', `-c role=${localRoles.api}`)
  return api.href
})()
const fixture = fileURLToPath(new URL('../fixtures/cube/model.yml', import.meta.url))
let modelDir = ''
const logger = createLogger({ level: 'silent' })
const database = createDatabase(apiUrl, logger)
let app: ReturnType<typeof buildApp>
let auth: Record<string, string> = {}

beforeAll(async () => {
  modelDir = await mkdtemp(join(tmpdir(), 'heed-health-model-'))
  await copyFile(fixture, join(modelDir, 'model.yml'))
  const sources = new ConnectorRegistry([createCubeSource({ modelDir })])
  const jobs = createJobRunner({
    connectionString: apiUrl,
    database,
    logger,
    jobs: [connectorSyncJob(sources)],
    pollingIntervalSeconds: 0.5,
    retryDelaySeconds: 1,
  })
  app = buildApp({
    database,
    logger,
    jobs,
    sources,
    devPeople: [{ email: 'ops@example.test', name: 'Ops', roles: ['administrator'] }],
  })
  await jobs.start()
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'ops@example.test' },
  })
  expect(login.statusCode, login.body).toBe(200)
  auth = {
    cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    origin: 'http://localhost',
    'x-heed-csrf': login.json<{ csrfToken: string }>().csrfToken,
  }
}, 30_000)
afterAll(async () => {
  await app.close()
  await rm(modelDir, { recursive: true, force: true })
}, 30_000)

/** Starts a refresh as an administrator would, and returns the job's summary once it finished. */
async function syncFromOperations(): Promise<Record<string, unknown>> {
  for (;;) {
    const queued = await app.inject({
      method: 'POST',
      url: '/api/v1/operations/jobs/connectors.sync/run',
      headers: auth,
    })
    // A scheduled run may hold the queue for a moment.
    if (queued.statusCode === 409) {
      await sleep(100)
      continue
    }
    expect(queued.statusCode, queued.body).toBe(202)
    const { id } = queued.json<{ id: string }>()
    for (;;) {
      const { rows } = await client.query<{ state: string; output: Record<string, unknown> }>(
        'select state, output from pgboss.job where id = $1',
        [id],
      )
      if (rows[0]?.state === 'completed') return rows[0].output
      expect(rows[0]?.state).not.toBe('failed')
      await sleep(100)
    }
  }
}
async function overview() {
  const response = await app.inject({ method: 'GET', url: '/api/v1/operations', headers: auth })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ jobs: { name: string }[]; connectors: Record<string, unknown>[] }>()
}

it('refreshes from the operations view and shows the health of the source', async () => {
  const jobs = (await overview()).jobs.map((job) => job.name)
  expect(jobs).toContain('connectors.sync')
  const summary = await syncFromOperations()
  expect(summary).toMatchObject({
    connectors: {
      cube: { status: 'ok', definitionsSeen: 7, flags: { raised: 0, cleared: 0 } },
    },
  })
  const [cube] = (await overview()).connectors
  expect(cube).toMatchObject({
    id: 'cube',
    status: 'ok',
    lastError: null,
    lastRead: { status: 'ok' },
    definitions: { current: 7, missing: 0 },
    domainCoverage: { cube: 3, override: 0, none: 2 },
    flaggedItems: 0,
    staleLinks: 0,
  })
  // CON-516: each view without meta.domain is named, so the gap can be closed view by view.
  expect((cube!.lastRead as { warnings: unknown[] }).warnings).toEqual([
    { code: 'missing_domain', target: 'marketing' },
    { code: 'missing_domain', target: 'operations' },
  ])
  // Sources: what the source is, how this server reads it, what it holds by view, its reads.
  expect(cube).toMatchObject({
    kind: 'definition_source',
    tool: 'Cube',
    settingKeys: ['sources.cube_model_url'],
    server: {
      settings: [
        { key: 'model_folder', variable: 'CUBE_MODEL_DIR', value: modelDir },
        { key: 'domain_overrides', variable: 'CL_DOMAIN_OVERRIDES', value: null },
        { key: 'renames', variable: 'CUBE_RENAMES_FILE', value: null },
      ],
    },
    renames: [],
    recentReads: [{ status: 'ok', definitionsSeen: 7, warnings: 2 }],
  })
  const view = (name: string, metrics: number, dimensions: number, domains: string[]) => ({
    name,
    metrics,
    dimensions,
    domains,
    withoutDomain: domains.length ? 0 : metrics,
    fromServer: 0,
    modelFile: 'model.yml',
  })
  // A member's own meta.domain counts for it: sales holds finance twice and commerce once.
  expect(cube!.views).toEqual([
    view('growth', 1, 0, ['marketing']),
    view('marketing', 1, 1, []),
    view('operations', 1, 0, []),
    view('sales', 2, 1, ['finance', 'commerce']),
  ])
}, 60_000)

it('shows a failed read beside the data that is still served', async () => {
  await writeFile(join(modelDir, 'model.yml'), 'cubes: [')
  const summary = await syncFromOperations()
  expect(summary).toMatchObject({ connectors: { cube: { status: 'failed' } } })
  const [cube] = (await overview()).connectors
  expect(cube).toMatchObject({
    status: 'ok',
    lastError: 'Definition source could not be read',
    lastRead: {
      status: 'failed',
      // Why it failed comes first: no file left that the compiler could read.
      warnings: [
        { code: 'no_model_files', target: 'model' },
        { code: 'unreadable_file', target: 'model.yml' },
      ],
    },
    definitions: { current: 7, missing: 0 },
  })
  // The failed read heads the reads, and the views are what the good read left.
  expect((cube!.recentReads as { status: string }[]).map((read) => read.status)).toEqual([
    'failed',
    'ok',
  ])
  expect((cube!.views as unknown[]).length).toBeGreaterThan(0)
}, 60_000)
