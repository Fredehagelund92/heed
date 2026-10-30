import { Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { systemClock } from '../../src/server/clock.ts'
import type { Database } from '../../src/server/db/database.ts'
import { registerApiRoutes, type ApiServices } from '../../src/server/http/api.ts'
import type { Session, SignIn } from '../../src/server/modules/auth/index.ts'
import { INTERFACE_VERSION } from '../../src/server/modules/connectors/index.ts'
import {
  connectorStatus,
  createJobRunner,
  jobStatus,
  type JobRunner,
  type OperationsOverview,
  type RunNowResult,
} from '../../src/server/modules/jobs/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'

const now = new Date('2026-10-07T12:00:00Z')
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000)

describe('job status', () => {
  const job = {
    expectedEverySeconds: 36 * 3600,
    registeredAt: hoursAgo(100),
    lastSucceededAt: hoursAgo(1),
    lastErrorAt: null,
  }

  it('is ok after a recent success', () => {
    expect(jobStatus(job, now)).toBe('ok')
  })

  it('is overdue once the last success is older than the expected interval', () => {
    expect(jobStatus({ ...job, lastSucceededAt: hoursAgo(36.1) }, now)).toBe('overdue')
    expect(jobStatus({ ...job, lastSucceededAt: hoursAgo(35.9) }, now)).toBe('ok')
  })

  it('counts from registration for a job that never succeeded', () => {
    expect(jobStatus({ ...job, registeredAt: hoursAgo(2), lastSucceededAt: null }, now)).toBe(
      'waiting',
    )
    expect(jobStatus({ ...job, registeredAt: hoursAgo(37), lastSucceededAt: null }, now)).toBe(
      'overdue',
    )
  })

  it('is waiting while the runner has not registered the job', () => {
    expect(jobStatus({ ...job, registeredAt: null, lastSucceededAt: null }, now)).toBe('waiting')
  })

  it('is failing when the latest run failed, until a run succeeds', () => {
    expect(jobStatus({ ...job, lastErrorAt: hoursAgo(0.5) }, now)).toBe('failing')
    expect(jobStatus({ ...job, lastErrorAt: hoursAgo(2) }, now)).toBe('ok')
    expect(
      jobStatus(
        { ...job, registeredAt: hoursAgo(1), lastSucceededAt: null, lastErrorAt: now },
        now,
      ),
    ).toBe('failing')
  })

  it('prefers overdue over failing', () => {
    expect(jobStatus({ ...job, lastSucceededAt: hoursAgo(40), lastErrorAt: now }, now)).toBe(
      'overdue',
    )
  })
})

describe('connector status', () => {
  const connector = {
    enabled: true,
    staleAfterSeconds: 6 * 3600,
    createdAt: hoursAgo(100),
    lastSuccessAt: hoursAgo(1),
  }

  it('is ok while the data is younger than stale_after, and stale after', () => {
    expect(connectorStatus(connector, now)).toBe('ok')
    expect(connectorStatus({ ...connector, lastSuccessAt: hoursAgo(7) }, now)).toBe('stale')
  })

  it('counts from creation for a connector that never synced', () => {
    const fresh = { ...connector, createdAt: hoursAgo(1), lastSuccessAt: null }
    expect(connectorStatus(fresh, now)).toBe('waiting')
    expect(connectorStatus({ ...fresh, createdAt: hoursAgo(7) }, now)).toBe('stale')
  })

  it('never calls a disabled connector stale', () => {
    expect(connectorStatus({ ...connector, enabled: false, lastSuccessAt: null }, now)).toBe(
      'disabled',
    )
  })
})

describe('the operations view and manual runs', () => {
  const admin: Session = {
    person: {
      id: 'admin',
      name: 'Admin',
      initials: 'A',
      permissions: { roles: ['administrator' as const], assignments: [] },
    },
    csrfToken: 'csrf',
  }
  const owner: Session = {
    ...admin,
    person: {
      ...admin.person,
      permissions: { roles: [], assignments: [{ areaId: 'commercial', role: 'owner' as const }] },
    },
  }
  const database = {
    transaction: (_: unknown, work: (tx: object) => Promise<unknown>) =>
      work({ query: () => Promise.resolve([]) }),
  } as unknown as Database

  const overview: OperationsOverview = {
    checkedAt: now,
    runner: 'running',
    jobs: [
      {
        name: 'retention.run',
        cron: '15 3 * * *',
        status: 'ok',
        expectedEverySeconds: 129_600,
        registeredAt: hoursAgo(100),
        lastStartedAt: hoursAgo(2),
        lastSucceededAt: hoursAgo(2),
        lastErrorAt: null,
        lastError: null,
        runsOk: 4,
        runsFailed: 0,
        queue: { queued: 0, active: 0, deferred: 0, failed: 0 },
      },
    ],
    connectors: [
      {
        id: 'cube',
        name: 'Cube',
        type: 'cube',
        kind: 'definition_source',
        origin: 'server',
        tool: 'Cube',
        settingKeys: ['sources.cube_model_url'],
        status: 'ok',
        staleAfterSeconds: 21_600,
        lastSuccessAt: hoursAgo(1),
        ageSeconds: 3600,
        sourceVersion: 'abc',
        lastErrorAt: null,
        lastError: null,
        lastRead: { status: 'partial', at: hoursAgo(1), warnings: [{ code: 'x', target: 'y' }] },
        definitions: { current: 3, missing: 0 },
        domainCoverage: { cube: 3, override: 0, none: 0 },
        flaggedItems: 0,
        staleLinks: 0,
        views: [
          {
            name: 'payments',
            metrics: 3,
            dimensions: 0,
            domains: ['finance'],
            withoutDomain: 0,
            fromServer: 0,
            modelFile: 'payments.yml',
          },
        ],
        renames: [],
        recentReads: [
          {
            at: hoursAgo(1),
            status: 'partial',
            durationMs: 1_800,
            definitionsSeen: 3,
            warnings: 1,
            sourceVersion: 'abc',
          },
        ],
      },
    ],
    spend: {
      month: '2026-10',
      monthCostMicros: 0,
      monthCapMicros: null,
      todayCostMicros: 0,
      byFeature: [],
    },
  }

  function app(
    result: RunNowResult,
    options: {
      session?: Session | null
      overview?: () => Promise<OperationsOverview>
      sources?: ApiServices['sources']
    } = {},
  ) {
    const instance = Fastify({ logger: false })
    const runs: string[] = []
    const session = options.session === undefined ? admin : options.session
    registerApiRoutes(instance, {
      database,
      signIn: { currentSession: () => Promise.resolve(session) } as unknown as SignIn,
      clock: systemClock('2026-10-07'),
      origins: ['http://localhost:3000'],
      models: createModelPort({ mode: 'mock' }),
      jobs: {
        overview: options.overview ?? (() => Promise.resolve(overview)),
        runNow: (name) => {
          runs.push(name)
          return Promise.resolve(result)
        },
      },
      sources: options.sources,
    })
    return { instance, runs }
  }
  const own = { origin: 'http://localhost:3000', 'x-heed-csrf': 'csrf' }

  it('serves the operations view under /api/v1, every time in ISO 8601', async () => {
    const { instance } = app({ outcome: 'not_running' })
    const response = await instance.inject({ method: 'GET', url: '/api/v1/operations' })
    expect(response.statusCode).toBe(200)
    const served = JSON.parse(JSON.stringify(overview)) as { connectors: object[] }
    expect(response.json()).toEqual({
      ...served,
      connectors: served.connectors.map((connector) => ({ ...connector, server: null })),
    })
    expect(response.json<{ checkedAt: string }>().checkedAt).toBe(now.toISOString())
  })

  it('says how this server reads a source, from its own sources of the same type', async () => {
    const settings = [
      { key: 'model_folder', variable: 'CUBE_MODEL_DIR', value: '/srv/model' },
      { key: 'domain_overrides', variable: 'CL_DOMAIN_OVERRIDES', value: null },
    ] as const
    const read = async (sources: ApiServices['sources']) => {
      const { instance } = app({ outcome: 'not_running' }, { sources })
      const response = await instance.inject({ url: '/api/v1/operations' })
      return response.json<{ connectors: { server: unknown }[] }>().connectors[0]!.server
    }
    const source = {
      id: 'cube',
      type: 'cube',
      interfaceVersion: INTERFACE_VERSION,
      serverSettings: settings,
    }
    expect(await read({ list: () => [source] as never })).toEqual({ settings })
    // Another server's source by the same id, or a source of another type, is not this one's.
    expect(await read({ list: () => [{ ...source, type: 'demo' }] as never })).toBeNull()
    expect(await read({ list: () => [{ ...source, id: 'demo' }] as never })).toBeNull()
  })

  it('is for administrators only', async () => {
    const owner_ = app({ outcome: 'not_running' }, { session: owner })
    expect((await owner_.instance.inject({ url: '/api/v1/operations' })).statusCode).toBe(403)
    const nobody = app({ outcome: 'not_running' }, { session: null })
    expect((await nobody.instance.inject({ url: '/api/v1/operations' })).statusCode).toBe(401)
    const run = await owner_.instance.inject({
      method: 'POST',
      url: '/api/v1/operations/jobs/retention.run/run',
      headers: own,
    })
    expect(run.statusCode).toBe(403)
    expect(owner_.runs).toEqual([])
  })

  it('refuses a manual run from another site, and allows its own origin', async () => {
    const { instance, runs } = app({ outcome: 'queued', id: 'job-1' })
    const url = '/api/v1/operations/jobs/retention.run/run'
    for (const origin of ['https://evil.example', 'null']) {
      const refused = await instance.inject({
        method: 'POST',
        url,
        headers: { origin, 'x-heed-csrf': 'csrf' },
      })
      expect(refused.statusCode).toBe(403)
    }
    const noToken = await instance.inject({
      method: 'POST',
      url,
      headers: { origin: own.origin },
    })
    expect(noToken.statusCode).toBe(403)
    expect(runs).toEqual([])
    expect((await instance.inject({ method: 'POST', url, headers: own })).statusCode).toBe(202)
  })

  it('answers 503 without the database error when the view cannot be read', async () => {
    const { instance } = app(
      { outcome: 'not_running' },
      { overview: () => Promise.reject(new Error('database "secret_name" does not exist')) },
    )
    const response = await instance.inject({ method: 'GET', url: '/api/v1/operations' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(response.body).not.toContain('secret_name')
  })

  it.each([
    [
      { outcome: 'queued', id: 'job-1' },
      202,
      { job: 'retention.run', status: 'queued', id: 'job-1' },
    ],
    [{ outcome: 'already_queued' }, 409, { code: 'CONFLICT' }],
    [{ outcome: 'unknown_job' }, 404, { code: 'NOT_FOUND' }],
    [{ outcome: 'not_running' }, 503, { code: 'SERVICE_UNAVAILABLE' }],
  ] as const)('answers a manual run of %o with %i', async (result, status, body) => {
    const { instance, runs } = app(result)
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/operations/jobs/retention.run/run',
      headers: own,
    })
    expect(runs).toEqual(['retention.run'])
    expect(response.statusCode).toBe(status)
    expect(response.json()).toMatchObject(body)
  })

  it('refuses a job name that is not one', async () => {
    const { instance, runs } = app({ outcome: 'queued', id: 'job-1' })
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/operations/jobs/Retention%20run/run',
      headers: own,
    })
    expect(response.statusCode).toBe(400)
    expect(runs).toEqual([])
  })
})

describe('the job runner without a database', () => {
  it('keeps retrying, refuses manual runs, and stops promptly', async () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      destination: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString())
          done()
        },
      }),
    })
    const unreachable: Database = {
      transaction: () => Promise.reject(new Error('unreachable')),
      ping: () => Promise.reject(new Error('unreachable')),
      query: () => Promise.reject(new Error('unreachable')),
      close: () => Promise.resolve(),
    }
    const runner: JobRunner = createJobRunner({
      // Port 1 refuses connections at once.
      connectionString: 'postgres://127.0.0.1:1/context_layer_none',
      database: unreachable,
      logger,
      jobs: [],
    })
    const started = runner.start()
    while (!lines.some((line) => line.includes('job runner could not start'))) await sleep(10)
    expect(await runner.runNow('jobs.watchdog')).toEqual({ outcome: 'not_running' })
    expect(await runner.runNow('nothing.here')).toEqual({ outcome: 'unknown_job' })

    const stoppedAt = performance.now()
    await runner.stop()
    await started
    expect(performance.now() - stoppedAt).toBeLessThan(2_000)
  })
})
