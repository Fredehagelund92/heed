import { hour, type ScheduledJob } from './scheduled-job.ts'

/**
 * The database's own upkeep. Both jobs call functions that run as the schema owner and are safe
 * to repeat: a second run finds nothing left to do. The partitions come first each night, so the
 * month ahead always exists before retention drops the oldest one.
 */

/** Monthly partitions of the delivery records and the MCP request log, two months ahead. */
export const partitionsJob: ScheduledJob = {
  name: 'partitions.ensure',
  cron: '0 3 * * *',
  expectedEverySeconds: 36 * hour,
  async run({ database }) {
    const [created] = await database.query<{ deliveries: number; requests: number }>(
      'select cl_ensure_delivery_partitions(2) as deliveries, cl_ensure_request_partitions(2) as requests',
    )
    return { partitionsCreated: created }
  },
}

/**
 * Retention (FR-612, NFR-034): drops expired delivery and request-log partitions and deletes
 * expired notes, idempotency keys, per-person spend, archived inbox items and relayed outbox
 * events. The periods are versioned settings.
 */
export const retentionJob: ScheduledJob = {
  name: 'retention.run',
  cron: '30 3 * * *',
  expectedEverySeconds: 36 * hour,
  async run({ database }) {
    const rows = await database.query<{ what: string; n: string }>(
      'select what, n from cl_retention_run()',
    )
    return { removed: Object.fromEntries(rows.map((row) => [row.what, Number(row.n)])) }
  },
}

export const maintenanceJobs: ScheduledJob[] = [partitionsJob, retentionJob]
