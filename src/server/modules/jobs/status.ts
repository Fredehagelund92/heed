import type { connectorStatuses, jobStatuses } from '../../../contract/operations.ts'

/**
 * The rules behind the operations view and the watchdog's alerts. Pure: the database's clock comes
 * in as `now`, so a laptop's clock never disagrees with the times stored beside it.
 *
 * - `ok`       the last run succeeded and is recent enough
 * - `waiting`  never succeeded yet, but not expected to have run by now
 * - `failing`  the most recent run failed; retries may still put it right
 * - `overdue`  no success within the expected interval: the watchdog alerts (NFR-073)
 */
export type JobStatus = (typeof jobStatuses)[number]

export interface JobTimes {
  expectedEverySeconds: number
  /** Null until the job runner has registered the job. */
  registeredAt: Date | null
  lastSucceededAt: Date | null
  lastErrorAt: Date | null
}

export function jobStatus(job: JobTimes, now: Date): JobStatus {
  const since = job.lastSucceededAt ?? job.registeredAt
  if (!since) return 'waiting'
  if (now.getTime() - since.getTime() > job.expectedEverySeconds * 1000) return 'overdue'
  if (job.lastErrorAt && (!job.lastSucceededAt || job.lastErrorAt > job.lastSucceededAt))
    return 'failing'
  return job.lastSucceededAt ? 'ok' : 'waiting'
}

/**
 * A connector's data is `stale` once its last good snapshot is older than the connector's own
 * `stale_after` (CON-104), counting from its creation when it has never synced. Disabled
 * connectors are never stale.
 */
export type ConnectorStatus = (typeof connectorStatuses)[number]

export interface ConnectorTimes {
  enabled: boolean
  staleAfterSeconds: number
  createdAt: Date
  lastSuccessAt: Date | null
}

export function connectorStatus(connector: ConnectorTimes, now: Date): ConnectorStatus {
  if (!connector.enabled) return 'disabled'
  const since = connector.lastSuccessAt ?? connector.createdAt
  if (now.getTime() - since.getTime() > connector.staleAfterSeconds * 1000) return 'stale'
  return connector.lastSuccessAt ? 'ok' : 'waiting'
}
