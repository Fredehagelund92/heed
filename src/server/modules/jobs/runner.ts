import { setTimeout as sleep } from 'node:timers/promises'
import { PgBoss, type Job } from 'pg-boss'
import type { Logger } from 'pino'
import type { Database } from '../../db/database.ts'
import { createHeartbeats } from './heartbeats.ts'
import {
  readConnectors,
  readJobs,
  readSpend,
  type OperationsOverview,
  type QueueCounts,
  type RunnerState,
} from './operations.ts'
import { minute, type JobSummary, type ScheduledJob } from './scheduled-job.ts'

/**
 * The job runner: pg-boss on the service's own database, under the API role. The queue schema is
 * part of the baseline migration, so pg-boss never changes the schema itself.
 *
 * Every scheduled job gets its own queue. `exclusive` keeps at most one job queued or running per
 * queue, so a manual run, a retry and the next scheduled run never overlap. A failed run retries
 * with growing waits and then raises an alert (NFR-047). A schedule that came due while the
 * service was down runs once when it is back. The watchdog runs every five minutes and alerts on
 * every overdue job and out-of-date connector (NFR-072, NFR-073).
 *
 * Alerts are error log lines with an `alert` field (`job_failed`, `job_overdue`,
 * `connector_stale`); the hosting stage turns them into alarms.
 */

export interface JobRunnerOptions {
  /** The API role's connection string. pg-boss keeps its own small pool. */
  connectionString: string
  database: Database
  logger: Logger
  jobs: ScheduledJob[]
  /** How often an idle worker asks for work. Tests shorten it. */
  pollingIntervalSeconds?: number
  /** Seconds before the first retry of a failed run; later retries wait longer. */
  retryDelaySeconds?: number
}

export type RunNowResult =
  | { outcome: 'queued'; id: string }
  | { outcome: 'already_queued' }
  | { outcome: 'unknown_job' }
  | { outcome: 'not_running' }

export interface JobRunner {
  /** Starts the runner, retrying with growing waits while the database is unreachable. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Queues a run of a scheduled job now, unless one is already queued or running. */
  runNow(name: string): Promise<RunNowResult>
  overview(): Promise<OperationsOverview>
}

const retryLimit = 3

export const watchdogName = 'jobs.watchdog'

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { database, logger } = options
  const heartbeats = createHeartbeats(database)
  const stopping = new AbortController()
  let boss: PgBoss | undefined
  let state: RunnerState = 'stopped'
  let starting: Promise<void> | undefined

  const watchdog: ScheduledJob = {
    name: watchdogName,
    cron: '*/5 * * * *',
    expectedEverySeconds: 15 * minute,
    async run({ logger: log }) {
      const { jobs } = await readJobs(database, all, null)
      const connectors = await readConnectors(database)
      const overdue = jobs.filter((job) => job.status === 'overdue')
      const stale = connectors.filter((connector) => connector.status === 'stale')
      for (const job of overdue)
        log.error(
          {
            alert: 'job_overdue',
            overdueJob: job.name,
            lastSucceededAt: job.lastSucceededAt,
            expectedEverySeconds: job.expectedEverySeconds,
          },
          'scheduled job overdue',
        )
      for (const connector of stale)
        log.error(
          {
            alert: 'connector_stale',
            connector: connector.id,
            lastSuccessAt: connector.lastSuccessAt,
            staleAfterSeconds: connector.staleAfterSeconds,
          },
          'connector data out of date',
        )
      return {
        overdueJobs: overdue.map((job) => job.name),
        staleConnectors: stale.map((connector) => connector.id),
      }
    },
  }
  const all = [...options.jobs, watchdog]
  const names = new Set(all.map((job) => job.name))
  if (names.size !== all.length) throw new Error('Scheduled job names must be unique')

  async function handle(job: ScheduledJob, queued: Job<unknown>): Promise<JobSummary> {
    const log = logger.child({ job: job.name, jobId: queued.id, attempt: queued.retryCount + 1 })
    const startedAt = performance.now()
    await heartbeats.started(job.name)
    try {
      const summary = await job.run({ database, logger: log, signal: queued.signal })
      await heartbeats.succeeded(job.name)
      log.info({ summary, durationMs: Math.round(performance.now() - startedAt) }, 'job succeeded')
      return summary
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await heartbeats.failed(job.name, message).catch((cause: unknown) => {
        log.error({ err: cause }, 'could not record the failed run')
      })
      if (queued.retryCount >= retryLimit)
        log.error({ err: error, alert: 'job_failed' }, 'job failed after its last retry')
      else log.warn({ err: error }, 'job failed; it will retry')
      throw error
    }
  }

  async function startOnce(): Promise<void> {
    const instance = new PgBoss({
      connectionString: options.connectionString,
      application_name: 'heed-jobs',
      max: 4,
      connectionTimeoutMillis: 2_000,
      schema: 'pgboss',
      migrate: false,
      createSchema: false,
      // REINDEX needs the table owner; the API role only reads and writes rows.
      reindex: false,
    })
    instance.on('error', (error) => logger.error({ err: error }, 'job queue error'))
    instance.on('warning', (warning) => logger.warn({ warning }, 'job queue warning'))
    boss = instance
    await instance.start()
    const queue = {
      retryLimit,
      retryDelay: options.retryDelaySeconds ?? 60,
      retryBackoff: true,
      retryDelayMax: 60 * minute,
      expireInSeconds: 15 * minute,
    }
    for (const job of all) {
      if (await instance.getQueue(job.name)) await instance.updateQueue(job.name, queue)
      else await instance.createQueue(job.name, { ...queue, policy: 'exclusive' })
      await heartbeats.register(job)
      await instance.schedule(job.name, job.cron, null, { tz: 'UTC', missed: 'once' })
      await instance.work(
        job.name,
        { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 5 },
        async ([queued]) => (queued ? handle(job, queued) : undefined),
      )
    }
    // A job that is no longer defined must not keep filling a queue nobody works.
    for (const schedule of await instance.getSchedules())
      if (!names.has(schedule.name)) await instance.unschedule(schedule.name, schedule.key)
  }

  async function startLoop(): Promise<void> {
    let wait = 1_000
    state = 'starting'
    while (!stopping.signal.aborted) {
      try {
        await startOnce()
        state = 'running'
        logger.info({ jobs: [...names] }, 'job runner started')
        return
      } catch (error) {
        const failed = boss
        boss = undefined
        await failed?.stop({ graceful: false, timeout: 1_000 }).catch(() => undefined)
        if (stopping.signal.aborted) break
        logger.error({ err: error, retryInSeconds: wait / 1000 }, 'job runner could not start')
        await sleep(wait, undefined, { signal: stopping.signal }).catch(() => undefined)
        wait = Math.min(wait * 2, 60_000)
      }
    }
    state = 'stopped'
  }

  async function queueCounts(): Promise<Map<string, QueueCounts> | null> {
    if (state !== 'running' || !boss) return null
    const queues = await boss.getQueues([...names])
    return new Map(
      queues.map((queue) => [
        queue.name,
        {
          queued: queue.queuedCount,
          active: queue.activeCount,
          deferred: queue.deferredCount,
          failed: queue.failedCount,
        },
      ]),
    )
  }

  return {
    start() {
      starting ??= startLoop()
      return starting
    },

    async stop() {
      stopping.abort()
      await starting
      const running = boss
      boss = undefined
      state = 'stopped'
      await running?.stop({ graceful: true, timeout: 10_000 })
    },

    async runNow(name) {
      if (!names.has(name)) return { outcome: 'unknown_job' }
      if (state !== 'running' || !boss) return { outcome: 'not_running' }
      const id = await boss.send(name, {})
      return id ? { outcome: 'queued', id } : { outcome: 'already_queued' }
    },

    async overview() {
      const { checkedAt, jobs } = await readJobs(database, all, await queueCounts())
      return {
        checkedAt,
        runner: state,
        jobs,
        connectors: await readConnectors(database),
        spend: await readSpend(database),
      }
    },
  }
}
