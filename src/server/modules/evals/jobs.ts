import type { ScheduledJob } from '../jobs/index.ts'
import { workRetrieval } from './retrieval.ts'
import { queueAreaRun, type EvalDeps } from './runs.ts'
import { queueTriggeredRuns } from './triggers.ts'
import { workEvaluations } from './worker.ts'

const minute = 60
const day = 24 * 60 * minute

/**
 * `evals.work` queues due answer tests and works queued runs, for up to ten minutes a time; the
 * next minute continues a longer run (NFR-054: a run starts within a minute). `evals.weekly`
 * queues the full set of every live area (FR-517). `evals.retrieval` gives every sealed edition,
 * and the live edition each day, its retrieval pass without a model, then queues a full run
 * of each area that a change outside the review gate may have affected. Schedules only fire
 * while the service runs: a missed week runs once on start, and the watchdog alerts when a week
 * passes without a run.
 */
export function evalJobs(deps: EvalDeps, sliceSeconds = 10 * minute): ScheduledJob[] {
  return [
    {
      name: 'evals.work',
      cron: '* * * * *',
      expectedEverySeconds: 15 * minute,
      async run({ database, logger, signal }) {
        const summary = await workEvaluations(database, deps, {
          deadline: Date.now() + sliceSeconds * 1000,
          signal,
          logger,
        })
        return { ...summary, runs: summary.runs.length }
      },
    },
    {
      name: 'evals.weekly',
      cron: '0 4 * * 1',
      expectedEverySeconds: 8 * day,
      async run({ database }) {
        const areas = await database.query<{ id: string }>(
          `select a.id from areas a where a.archived_at is null
             and not exists (select 1 from eval_runs r where r.area_id=a.id and r.kind='scheduled'
                               and r.created_at >= date_trunc('week', now()))
           order by a.id`,
        )
        const queued: string[] = []
        for (const area of areas) {
          const run = await database.transaction(null, (tx) =>
            queueAreaRun(tx, deps, area.id, 'scheduled', false),
          )
          if (run) queued.push(run.id)
        }
        return { areas: areas.length, queued: queued.length }
      },
    },
    {
      name: 'evals.retrieval',
      cron: '* * * * *',
      expectedEverySeconds: 15 * minute,
      async run({ database }) {
        const retrieval = await workRetrieval(database, deps.clock)
        return { ...retrieval, queued: await queueTriggeredRuns(database, deps) }
      },
    },
  ]
}
