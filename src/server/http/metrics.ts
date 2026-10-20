import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Database } from '../db/database.ts'
import type { JobRunner } from '../modules/jobs/index.ts'
import type { Hub } from '../modules/notifications/index.ts'
import type { Metrics, Sample } from '../observability/metrics.ts'

export interface MetricsSources {
  metrics: Metrics
  /** `CL_METRICS_TOKEN`. Without one the endpoint is off and answers 404. */
  token: string | undefined
  database: Database
  jobs: Pick<JobRunner, 'overview'>
  hub: Pick<Hub, 'size'>
}

const queueStates = ['queued', 'active', 'deferred', 'failed'] as const
const digest = (text: string) => createHash('sha256').update(text).digest()

/**
 * `GET /metrics` for a scraper that presents `Authorization: Bearer <CL_METRICS_TOKEN>`. The
 * counters live in the process; the job, connector, spend, edition and pool numbers are read at
 * scrape time from the same sources as the operations view, summed over people.
 */
export function registerMetricsRoutes(app: FastifyInstance, sources: MetricsSources): void {
  const expected = sources.token === undefined ? undefined : digest(sources.token)
  app.get('/metrics', { logLevel: 'warn' }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!expected) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Metrics are off' })
    const presented = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1]
    // Equal-length digests, so the comparison takes the same time whatever was presented.
    if (!presented || !timingSafeEqual(digest(presented), expected)) {
      reply.header('www-authenticate', 'Bearer')
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'A metrics token is required' })
    }
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
    return sources.metrics.render(await collect(sources))
  })
}

const seconds = (from: Date | null, to: Date) =>
  from === null ? NaN : Math.max(0, (to.getTime() - from.getTime()) / 1000)

async function collect({ database, jobs, hub }: MetricsSources): Promise<Sample[]> {
  const samples: Sample[] = [
    {
      name: 'heed_sse_streams',
      help: 'Open live event streams.',
      type: 'gauge',
      values: [{ value: hub.size }],
    },
  ]
  const pool = database.stats?.()
  if (pool)
    samples.push({
      name: 'heed_db_pool_connections',
      help: 'Connections in the application pool, by state.',
      type: 'gauge',
      values: [
        { labels: { state: 'total' }, value: pool.total },
        { labels: { state: 'idle' }, value: pool.idle },
        { labels: { state: 'waiting' }, value: pool.waiting },
      ],
    })
  let up = 1
  try {
    const [live] = await database.query<{ seq: string; age: number }>(
      `select l.seq::text as seq, extract(epoch from now() - l.set_at)::float8 as age
       from live_edition l`,
    )
    samples.push({
      name: 'heed_live_edition_age_seconds',
      help: 'Seconds since the live edition was set; NaN before the first edition.',
      type: 'gauge',
      values: [{ value: live ? live.age : NaN }],
    })
  } catch {
    up = 0
  }
  try {
    const overview = await jobs.overview()
    const now = overview.checkedAt
    samples.push(
      {
        name: 'heed_job_last_success_age_seconds',
        help: 'Seconds since each scheduled job last succeeded; NaN when it never has.',
        type: 'gauge',
        values: overview.jobs.map((job) => ({
          labels: { job: job.name },
          value: seconds(job.lastSucceededAt, now),
        })),
      },
      {
        name: 'heed_job_overdue',
        help: 'Whether a scheduled job missed its expected run (1) or not (0) (NFR-073).',
        type: 'gauge',
        values: overview.jobs.map((job) => ({
          labels: { job: job.name },
          value: job.status === 'overdue' ? 1 : 0,
        })),
      },
      {
        name: 'heed_job_runs_total',
        help: 'Finished runs of each scheduled job, by outcome.',
        type: 'counter',
        values: overview.jobs.flatMap((job) => [
          { labels: { job: job.name, outcome: 'ok' }, value: job.runsOk },
          { labels: { job: job.name, outcome: 'failed' }, value: job.runsFailed },
        ]),
      },
      {
        name: 'heed_job_queue',
        help: 'Jobs in the queue, by job and state; absent while the runner is stopped.',
        type: 'gauge',
        values: overview.jobs.flatMap((job) =>
          job.queue
            ? queueStates.map((state) => ({
                labels: { job: job.name, state },
                value: job.queue![state],
              }))
            : [],
        ),
      },
      {
        name: 'heed_connector_age_seconds',
        help: 'Age of the data from each connector; NaN before its first good read.',
        type: 'gauge',
        values: overview.connectors.map((connector) => ({
          labels: { connector: connector.id },
          value: connector.ageSeconds ?? NaN,
        })),
      },
      {
        name: 'heed_connector_stale',
        help: 'Whether a connector is out of date (1) or not (0).',
        type: 'gauge',
        values: overview.connectors.map((connector) => ({
          labels: { connector: connector.id },
          value: connector.status === 'stale' ? 1 : 0,
        })),
      },
      {
        name: 'heed_model_spend_usd',
        help: 'Model spending summed over people: today and the current UTC month.',
        type: 'gauge',
        values: [
          { labels: { period: 'today' }, value: overview.spend.todayCostMicros / 1e6 },
          { labels: { period: 'month' }, value: overview.spend.monthCostMicros / 1e6 },
        ],
      },
      {
        name: 'heed_model_spend_month_cap_usd',
        help: 'The monthly model spending cap; NaN when none is set.',
        type: 'gauge',
        values: [
          {
            value:
              overview.spend.monthCapMicros === null ? NaN : overview.spend.monthCapMicros / 1e6,
          },
        ],
      },
    )
  } catch {
    up = 0
  }
  samples.push({
    name: 'heed_metrics_sources_up',
    help: 'Whether every scrape-time source answered (1) or one failed (0).',
    type: 'gauge',
    values: [{ value: up }],
  })
  return samples
}
