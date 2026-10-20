import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import type { Database } from '../../src/server/db/database.ts'
import type { JobRunner, OperationsOverview } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'

/*
  Structured logs carry a request id (NFR-071), and /metrics serves counters and scrape-time
  numbers in the Prometheus text format, behind a bearer token, with no raw path or person in it.
*/

const token = 'metrics-token-' + 'x'.repeat(32)
const checkedAt = new Date('2026-10-08T12:00:00Z')
const overview: OperationsOverview = {
  checkedAt,
  runner: 'running',
  jobs: [
    {
      name: 'retention.run',
      cron: '0 3 * * *',
      status: 'overdue',
      expectedEverySeconds: 86_400,
      registeredAt: new Date('2026-10-01T00:00:00Z'),
      lastStartedAt: null,
      lastSucceededAt: new Date('2026-10-08T11:00:00Z'),
      lastErrorAt: null,
      lastError: null,
      runsOk: 4,
      runsFailed: 1,
      queue: { queued: 1, active: 0, deferred: 0, failed: 0 },
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
      settingKeys: [],
      status: 'stale',
      staleAfterSeconds: 7_200,
      lastSuccessAt: null,
      ageSeconds: null,
      sourceVersion: null,
      lastErrorAt: null,
      lastError: null,
      lastRead: null,
      definitions: { current: 0, missing: 0 },
      domainCoverage: { cube: 0, override: 0, none: 0 },
      flaggedItems: 0,
      staleLinks: 0,
      views: [],
      renames: [],
      recentReads: [],
    },
  ],
  spend: {
    month: '2026-10',
    monthCostMicros: 2_500_000,
    monthCapMicros: 50_000_000,
    todayCostMicros: 125_000,
    byFeature: [],
  },
}

const maria = { id: '00000000-0000-4000-8000-000000000001', name: 'Maria Lindqvist' }
const database: Database = {
  transaction: (_person, work) => work(database),
  ping: () => Promise.resolve(),
  stats: () => ({ total: 3, idle: 2, waiting: 0 }),
  query: <Row extends object>(text: string) =>
    Promise.resolve(
      (text.includes('from live_edition')
        ? [{ seq: '7', age: 90 }]
        : text.includes('from auth.sessions')
          ? [{ personId: maria.id, csrfToken: 'csrf' }]
          : text.includes('from people')
            ? [maria]
            : []) as Row[],
    ),
  close: () => Promise.resolve(),
}

function jobs(answer: () => Promise<OperationsOverview> = () => Promise.resolve(overview)) {
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    runNow: () => Promise.resolve({ outcome: 'not_running' as const }),
    overview: answer,
  } satisfies JobRunner
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

function app(options: { metricsToken?: string; runner?: JobRunner } = {}) {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().trim().split('\n'))
      done()
    },
  })
  const instance = buildApp({
    database,
    jobs: options.runner ?? jobs(),
    logger: createLogger({ level: 'trace', destination }),
    ...(options.metricsToken ? { metricsToken: options.metricsToken } : {}),
  })
  close = () => instance.close()
  return { instance, lines }
}

const scrape = (instance: ReturnType<typeof app>['instance'], bearer = token) =>
  instance.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: `Bearer ${bearer}` },
  })

describe('request ids', () => {
  it('gives every response its own id, never the one a client sends, and logs it on every line', async () => {
    const { instance, lines } = app()
    const first = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'forged\ninjected' },
    })
    const second = await instance.inject({ method: 'GET', url: '/health' })
    const ids = [first, second].map((response) => String(response.headers['x-request-id']))
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(ids[0]).not.toBe(ids[1])
    const records = lines.map((line) => JSON.parse(line) as { reqId?: string; msg: string })
    const requestLines = records.filter((r) => /request/.test(r.msg))
    expect(requestLines.length).toBeGreaterThanOrEqual(4)
    for (const record of requestLines) expect(ids).toContain(record.reqId)
    expect(lines.join('\n')).not.toContain('forged')
  })

  it('logs a failed API operation with the id of its request', async () => {
    const broken: Database = {
      ...database,
      transaction: () => Promise.reject(new Error('connection reset')),
    }
    const lines: string[] = []
    const instance = buildApp({
      database: broken,
      jobs: jobs(),
      logger: createLogger({
        level: 'info',
        destination: {
          write(line: string) {
            lines.push(line)
          },
        },
      }),
    })
    close = () => instance.close()
    const response = await instance.inject({ method: 'GET', url: '/api/v1/me' })
    expect(response.statusCode).toBe(500)
    const failure = lines
      .map((line) => JSON.parse(line) as { reqId?: string; msg: string })
      .find((r) => r.msg === 'API operation failed')
    expect(failure?.reqId).toBe(response.headers['x-request-id'])
  })
})

describe('/metrics', () => {
  it('is off without a token, and asks for the token when one is set', async () => {
    expect((await scrape(app().instance)).statusCode).toBe(404)
    const { instance } = app({ metricsToken: token })
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: token }]) {
      const response = await instance.inject({ method: 'GET', url: '/metrics', headers })
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
    }
    expect((await scrape(instance)).statusCode).toBe(200)
  })

  it('counts requests by route template or API operation, never by a raw path', async () => {
    const { instance, lines } = app({ metricsToken: token })
    await instance.inject({ method: 'GET', url: '/health?question=who-asked' })
    await instance.inject({ method: 'GET', url: '/api/v1/me' })
    await instance.inject({ method: 'GET', url: '/api/v1/items/itm_marker0001' })
    await instance.inject({ method: 'GET', url: '/api/v1/no-such-marker' })
    await instance.inject({ method: 'GET', url: '/nowhere/person-marker' })
    const response = await scrape(instance)
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    const text = response.body
    expect(text).toContain('heed_http_requests_total{method="GET",route="/health",status="200"} 1')
    expect(text).toContain('heed_http_requests_total{method="GET",route="me.get",status="401"} 1')
    expect(text).toContain(
      'heed_http_requests_total{method="GET",route="items.get",status="401"} 1',
    )
    expect(text).toContain(
      'heed_http_requests_total{method="GET",route="unmatched",status="404"} 2',
    )
    expect(text).toMatch(
      /heed_http_request_duration_seconds_bucket\{le="0\.3",method="GET",route="\/health"\} 1/,
    )
    for (const raw of ['who-asked', 'itm_marker0001', 'no-such-marker', 'person-marker', maria.id])
      expect(text).not.toContain(raw)
    expect(lines.join('\n')).not.toContain(token)
  })

  it('reads jobs, connectors, spending, the live edition and the pool at scrape time', async () => {
    const { instance } = app({ metricsToken: token })
    const text = (await scrape(instance)).body
    for (const line of [
      'heed_job_last_success_age_seconds{job="retention.run"} 3600',
      'heed_job_overdue{job="retention.run"} 1',
      'heed_job_runs_total{job="retention.run",outcome="failed"} 1',
      'heed_job_queue{job="retention.run",state="queued"} 1',
      'heed_connector_age_seconds{connector="cube"} NaN',
      'heed_connector_stale{connector="cube"} 1',
      'heed_model_spend_usd{period="today"} 0.125',
      'heed_model_spend_usd{period="month"} 2.5',
      'heed_model_spend_month_cap_usd 50',
      'heed_live_edition_age_seconds 90',
      'heed_db_pool_connections{state="idle"} 2',
      'heed_sse_streams 0',
      'heed_mcp_records_dropped_total 0',
      'heed_metrics_sources_up 1',
    ])
      expect(text).toContain(line)
  })

  it('still answers when a scrape-time source fails, and says so', async () => {
    const { instance } = app({
      metricsToken: token,
      runner: jobs(() => Promise.reject(new Error('database down'))),
    })
    const response = await scrape(instance)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('heed_metrics_sources_up 0')
    expect(response.body).not.toContain('heed_job_overdue')
  })

  it('writes valid exposition lines: HELP and TYPE once per metric, then samples', async () => {
    const { instance } = app({ metricsToken: token })
    await instance.inject({ method: 'GET', url: '/health' })
    const lines = (await scrape(instance)).body.trimEnd().split('\n')
    const declared = new Set<string>()
    for (const line of lines) {
      const meta = /^# (HELP|TYPE) ([a-z0-9_]+) (.+)$/.exec(line)
      if (meta) {
        if (meta[1] === 'TYPE') {
          expect(declared.has(meta[2]!), meta[2]).toBe(false)
          declared.add(meta[2]!)
          expect(['counter', 'gauge', 'histogram']).toContain(meta[3])
        }
        continue
      }
      expect(line).toMatch(
        /^heed_[a-z0-9_]+(\{[a-z_]+="[^"\\\n]*"(,[a-z_]+="[^"\\\n]*")*\})? (-?[0-9.e+-]+|NaN|\+Inf)$/,
      )
    }
    expect(declared.size).toBeGreaterThan(15)
  })
})
