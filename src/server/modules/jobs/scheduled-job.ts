import type { Logger } from 'pino'
import type { Database } from '../../db/database.ts'

/** What a job handler receives. Handlers stay thin: they call a module service and return. */
export interface JobContext {
  database: Database
  /** Bound to the job's name, id and attempt. */
  logger: Logger
  /** Aborted when the job expires or the service stops. */
  signal: AbortSignal
}

/** A summary of one run, kept on the job record and in the log. Counts and ids, never content. */
export type JobSummary = Record<string, unknown>

/**
 * A job that runs on a schedule, keeps a heartbeat and is watched for missed runs (NFR-073).
 * Every job must be safe to run twice (NFR-047): a retry or a manual run repeats it.
 */
export interface ScheduledJob {
  /** The queue name: `module.action`. */
  name: string
  /** A five-field cron expression, in UTC. */
  cron: string
  /** The watchdog alerts once the last success is older than this. */
  expectedEverySeconds: number
  run(context: JobContext): Promise<JobSummary>
}

export const minute = 60
export const hour = 60 * minute
