import { Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDatabase } from '../../src/server/db/database.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import {
  createJobRunner,
  maintenanceJobs,
  type JobRunner,
  type ScheduledJob,
} from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { testDatabase } from './support.ts'

/** The job runner end to end, as the service runs it: pg-boss on the API role, no DDL rights. */

const { client, url } = testDatabase()

const apiUrl = (() => {
  const api = new URL(url)
  api.searchParams.set('options', `-c role=${localRoles.api}`)
  return api.href
})()

const lines: string[] = []
const logger = createLogger({
  level: 'info',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().trim().split('\n'))
      done()
    },
  }),
})
const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>)

let release: () => void = () => undefined
const failing: ScheduledJob = {
  name: 'test.fails',
  cron: '0 0 1 1 *',
  expectedEverySeconds: 3600,
  run: () => Promise.reject(new Error('boom')),
}
const blocking: ScheduledJob = {
  name: 'test.blocks',
  cron: '0 0 1 1 *',
  expectedEverySeconds: 3600,
  run: () => new Promise((resolve) => (release = () => resolve({ released: true }))),
}

const database = createDatabase(apiUrl, logger)
const runner: JobRunner = createJobRunner({
  connectionString: apiUrl,
  database,
  logger,
  jobs: [...maintenanceJobs, failing, blocking],
  pollingIntervalSeconds: 0.5,
  retryDelaySeconds: 1,
})
const app = buildApp({
  database,
  jobs: runner,
  logger,
  devPeople: [{ email: 'jobs-admin@example.test', name: 'Jobs admin', roles: ['administrator'] }],
})
let authHeaders: Record<string, string> = {}

beforeAll(async () => {
  await runner.start()
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'jobs-admin@example.test' },
  })
  expect(login.statusCode).toBe(200)
  authHeaders = {
    cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    origin: 'http://localhost',
    'x-heed-csrf': login.json<{ csrfToken: string }>().csrfToken,
  }
}, 30_000)
afterAll(async () => {
  release()
  await app.close()
}, 30_000)

/** Queues a run, waiting out a scheduled run that holds the queue, and returns the finished job. */
async function run(name: string) {
  for (;;) {
    const queued = await runner.runNow(name)
    if (queued.outcome === 'queued') return finished(queued.id)
    expect(queued.outcome).toBe('already_queued')
    await sleep(100)
  }
}

async function finished(id: string) {
  for (;;) {
    const { rows } = await client.query<{ state: string; output: Record<string, unknown> }>(
      'select state, output from pgboss.job where id = $1',
      [id],
    )
    if (rows[0] && ['completed', 'failed'].includes(rows[0].state)) return rows[0]
    await sleep(100)
  }
}

async function heartbeat(job: string) {
  const { rows } = await client.query<{
    last_succeeded: Date | null
    last_error: string | null
    runs_ok: string
    runs_failed: string
  }>('select * from job_heartbeats where job = $1', [job])
  return rows[0]!
}

describe('the job runner', () => {
  it('registers a heartbeat, an exclusive queue and a UTC schedule for every job', async () => {
    const names = ['partitions.ensure', 'retention.run', 'test.fails', 'test.blocks']
    const heartbeats = await client.query<{ job: string; expected: string }>(
      'select job, extract(epoch from expected_every)::int as expected from job_heartbeats order by job',
    )
    expect(heartbeats.rows).toEqual(
      expect.arrayContaining([
        { job: 'jobs.watchdog', expected: 900 },
        { job: 'partitions.ensure', expected: 129_600 },
        { job: 'retention.run', expected: 129_600 },
      ]),
    )
    const schedules = await client.query<{ name: string; cron: string; timezone: string }>(
      'select name, cron, timezone from pgboss.schedule order by name',
    )
    expect(schedules.rows).toEqual(
      expect.arrayContaining([
        { name: 'jobs.watchdog', cron: '*/5 * * * *', timezone: 'UTC' },
        { name: 'partitions.ensure', cron: '0 3 * * *', timezone: 'UTC' },
        { name: 'retention.run', cron: '30 3 * * *', timezone: 'UTC' },
      ]),
    )
    const queues = await client.query<{ name: string; policy: string; retry_limit: number }>(
      'select name, policy, retry_limit from pgboss.queue where name = any($1)',
      [names],
    )
    expect(queues.rows).toHaveLength(names.length)
    for (const queue of queues.rows)
      expect(queue).toMatchObject({ policy: 'exclusive', retry_limit: 3 })
  })

  it('recreates missing partitions, and a second run changes nothing', async () => {
    const month = new Date()
    month.setUTCDate(1)
    month.setUTCMonth(month.getUTCMonth() + 1)
    const next = `${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, '0')}`
    await client.query(`drop table deliveries_${next}, mcp_requests_${next}`)

    const first = await run('partitions.ensure')
    expect(first).toMatchObject({
      state: 'completed',
      output: { partitionsCreated: { deliveries: 1, requests: 1 } },
    })
    const exists = await client.query('select to_regclass($1) as d, to_regclass($2) as r', [
      `deliveries_${next}`,
      `mcp_requests_${next}`,
    ])
    expect(exists.rows[0]).toEqual({ d: `deliveries_${next}`, r: `mcp_requests_${next}` })

    const before = await heartbeat('partitions.ensure')
    const second = await run('partitions.ensure')
    expect(second.output).toEqual({ partitionsCreated: { deliveries: 0, requests: 0 } })
    const after = await heartbeat('partitions.ensure')
    expect(Number(after.runs_ok)).toBe(Number(before.runs_ok) + 1)
    expect(after.last_succeeded!.getTime()).toBeGreaterThan(before.last_succeeded!.getTime())
  })

  it('removes what retention makes due, keeps the rest, and repeats safely', async () => {
    await client.query(`
      insert into topics (id, key, metric_keys, value_keys, month)
        values ('00000000-0000-4000-8000-0000000000aa', 'retention-test', '{}', '{}', '2026-10-01');
      insert into gaps (id, topic_id, type, opened_by_case)
        values ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000aa', 'missing', 1);
      insert into gap_notes (gap_id, source, note, created_hour) values
        ('00000000-0000-4000-8000-0000000000ab', 'owner', 'expired', date_trunc('hour', now() - interval '200 days', 'UTC')),
        ('00000000-0000-4000-8000-0000000000ab', 'owner', 'fresh', date_trunc('hour', now() - interval '1 day', 'UTC'));
      create table deliveries_2020_01 partition of deliveries
        for values from ('2020-01-01 00:00+00') to ('2020-02-01 00:00+00');
      create table mcp_requests_2020_01 partition of mcp_requests
        for values from ('2020-01-01 00:00+00') to ('2020-02-01 00:00+00');`)

    const first = await run('retention.run')
    expect(first).toMatchObject({
      state: 'completed',
      output: { removed: { gap_notes: 1, partitions_dropped: 2 } },
    })
    const notes = await client.query('select note from gap_notes')
    expect(notes.rows).toEqual([{ note: 'fresh' }])
    const old = await client.query(
      "select to_regclass('deliveries_2020_01') as d, to_regclass('mcp_requests_2020_01') as r",
    )
    expect(old.rows[0]).toEqual({ d: null, r: null })
    const current = await client.query<{ n: string }>(
      "select count(*) as n from pg_inherits where inhparent = 'deliveries'::regclass",
    )
    expect(Number(current.rows[0]!.n)).toBe(3)

    const second = await run('retention.run')
    expect(second.output).toMatchObject({ removed: { gap_notes: 0, partitions_dropped: 0 } })
  })

  it('applies the versioned note retention setting when it is lowered or raised', async () => {
    const setNoteDays = (days: number) =>
      client.query(
        `insert into settings_versions (key, version, value, reason)
         select 'retention.note_days', max(version) + 1, $1, 'test' from settings_versions
         where key = 'retention.note_days'`,
        [String(days)],
      )
    await client.query(`
      insert into topics (id, key, metric_keys, value_keys, month)
        values ('00000000-0000-4000-8000-0000000000ba', 'note-retention', '{}', '{}', '2026-10-01');
      insert into gaps (id, topic_id, type, opened_by_case)
        values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000ba', 'missing', 2);
      insert into gap_notes (gap_id, source, note, created_hour) values
        ('00000000-0000-4000-8000-0000000000bb', 'owner', 'age-100', date_trunc('hour', now() - interval '100 days', 'UTC')),
        ('00000000-0000-4000-8000-0000000000bb', 'owner', 'age-10', date_trunc('hour', now() - interval '10 days', 'UTC'))`)
    const remaining = async () =>
      (
        await client.query<{ note: string }>(
          `select note from gap_notes where note like 'age-%' order by note`,
        )
      ).rows.map((r) => r.note)

    await run('retention.run')
    expect(await remaining()).toEqual(['age-10', 'age-100'])

    await setNoteDays(50)
    const lowered = await run('retention.run')
    expect(lowered.output).toMatchObject({ removed: { gap_notes: 1 } })
    expect(await remaining()).toEqual(['age-10'])

    await setNoteDays(5)
    await run('retention.run')
    expect(await remaining()).toEqual([])

    await setNoteDays(180)
  })

  it('retries a failing job with growing waits, then records it and alerts once', async () => {
    const queued = await runner.runNow('test.fails')
    expect(queued.outcome).toBe('queued')
    const job = await finished((queued as { id: string }).id)
    expect(job.state).toBe('failed')

    const row = await heartbeat('test.fails')
    expect(row).toMatchObject({ last_succeeded: null, last_error: 'boom', runs_failed: '4' })
    const failures = records().filter((record) => record.job === 'test.fails')
    expect(failures.filter((record) => record.msg === 'job failed; it will retry')).toHaveLength(3)
    expect(failures.filter((record) => record.alert === 'job_failed')).toEqual([
      expect.objectContaining({ level: 50, attempt: 4, msg: 'job failed after its last retry' }),
    ])
  }, 60_000)

  it('alerts on overdue jobs and out-of-date connectors', async () => {
    await client.query(`
      update job_heartbeats set last_succeeded = now() - interval '3 days' where job = 'retention.run';
      insert into connectors (id, kind, type, name, stale_after) values
        ('cube-stale', 'definition_source', 'cube', 'Stale', interval '1 hour'),
        ('cube-fresh', 'definition_source', 'cube', 'Fresh', interval '1 hour');
      insert into connectors (id, kind, type, name, enabled, created_at) values
        ('cube-off', 'definition_source', 'cube', 'Off', false, now() - interval '1 year');
      insert into connector_snapshots (connector_id, status, fetched_at, source_version) values
        ('cube-stale', 'ok', now() - interval '2 hours', 'v1'),
        ('cube-fresh', 'partial', now() - interval '5 minutes', 'v2');
      insert into connector_snapshots (connector_id, status, fetched_at, error) values
        ('cube-fresh', 'failed', now() - interval '1 minute', 'model folder missing');`)

    const watchdog = await run('jobs.watchdog')
    expect(watchdog.output).toEqual({
      overdueJobs: ['retention.run'],
      staleConnectors: ['cube-stale'],
    })
    const alerts = records().filter((record) => record.job === 'jobs.watchdog' && record.alert)
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 50, alert: 'job_overdue', overdueJob: 'retention.run' }),
        expect.objectContaining({ level: 50, alert: 'connector_stale', connector: 'cube-stale' }),
      ]),
    )
  })
})

describe('the operations endpoints', () => {
  it('show jobs, queues, connectors and spending, with no person', async () => {
    await client.query(`
      insert into people (id, email, display_name)
        values ('00000000-0000-4000-8000-0000000000ff', 'spender@example.test', 'Spender');
      insert into llm_spend_daily (day, person_id, feature, cost_micros) values
        ((now() at time zone 'UTC')::date, '00000000-0000-4000-8000-0000000000ff', 'assistant', 1500);
      insert into llm_spend_monthly (month, feature, provider, calls, cost_micros) values
        (date_trunc('month', now() at time zone 'UTC')::date, 'assistant', 'anthropic', 2, 4000),
        (date_trunc('month', now() at time zone 'UTC')::date, 'assistant', 'vercel-gateway', 1, 500),
        (date_trunc('month', now() at time zone 'UTC')::date, 'evals', 'anthropic', 2, 500),
        ('2020-01-01', 'assistant', 'anthropic', 9, 999999);`)

    const response = await app.inject({
      headers: authHeaders,
      method: 'GET',
      url: '/api/v1/operations',
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<Record<string, unknown>>()
    expect(body.runner).toBe('running')
    expect(body.jobs).toEqual(
      expect.arrayContaining([
        // The watchdog test above moved its last success three days back.
        expect.objectContaining({
          name: 'retention.run',
          status: 'overdue',
          runsOk: 5,
          queue: { queued: 0, active: 0, deferred: 0, failed: 0 },
        }),
        expect.objectContaining({
          name: 'test.fails',
          status: 'failing',
          lastError: 'boom',
          runsFailed: 4,
        }),
      ]),
    )
    expect(body.connectors).toEqual([
      expect.objectContaining({
        id: 'cube-fresh',
        status: 'ok',
        sourceVersion: 'v2',
        lastError: 'model folder missing',
      }),
      expect.objectContaining({
        id: 'cube-off',
        status: 'disabled',
        lastSuccessAt: null,
        ageSeconds: null,
      }),
      expect.objectContaining({ id: 'cube-stale', status: 'stale', sourceVersion: 'v1' }),
    ])
    expect(body.spend).toEqual({
      month: new Date().toISOString().slice(0, 7),
      monthCostMicros: 5000,
      monthCapMicros: 500_000_000,
      todayCostMicros: 1500,
      byFeature: [
        { feature: 'assistant', calls: 3, costMicros: 4500 },
        { feature: 'evals', calls: 2, costMicros: 500 },
      ],
    })
    expect(response.body).not.toContain('00000000-0000-4000-8000-0000000000ff')
    expect(response.body).not.toContain('spender')
  })

  it('queue one manual run at a time and refuse unknown jobs', async () => {
    const first = await app.inject({
      headers: authHeaders,
      method: 'POST',
      url: '/api/v1/operations/jobs/test.blocks/run',
    })
    expect(first.statusCode).toBe(202)
    const second = await app.inject({
      headers: authHeaders,
      method: 'POST',
      url: '/api/v1/operations/jobs/test.blocks/run',
    })
    expect(second.statusCode).toBe(409)
    while ((await heartbeat('test.blocks')).last_succeeded === null) {
      release()
      await sleep(100)
    }
    const unknown = await app.inject({
      headers: authHeaders,
      method: 'POST',
      url: '/api/v1/operations/jobs/nope/run',
    })
    expect(unknown.statusCode).toBe(404)
  })
})
