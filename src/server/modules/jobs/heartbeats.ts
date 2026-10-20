import type { Database } from '../../db/database.ts'
import type { ScheduledJob } from './scheduled-job.ts'

/** One `job_heartbeats` row per scheduled job: when it last started, succeeded and failed. */
export function createHeartbeats(database: Database) {
  return {
    async register(job: ScheduledJob) {
      await database.query(
        `insert into job_heartbeats (job, expected_every) values ($1, make_interval(secs => $2))
         on conflict (job) do update set expected_every = excluded.expected_every`,
        [job.name, job.expectedEverySeconds],
      )
    },
    async started(name: string) {
      await database.query('update job_heartbeats set last_started = now() where job = $1', [name])
    },
    async succeeded(name: string) {
      await database.query(
        'update job_heartbeats set last_succeeded = now(), runs_ok = runs_ok + 1 where job = $1',
        [name],
      )
    },
    async failed(name: string, message: string) {
      await database.query(
        `update job_heartbeats set last_error_at = now(), last_error = left($2, 500),
         runs_failed = runs_failed + 1 where job = $1`,
        [name, message],
      )
    },
  }
}

export type Heartbeats = ReturnType<typeof createHeartbeats>
