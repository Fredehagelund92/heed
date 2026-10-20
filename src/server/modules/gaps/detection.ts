import type { ScheduledJob } from '../jobs/index.ts'

/**
 * FR-606 cases 1, 3 and 4: topics whose agent calls keep finding nothing, negative feedback, and
 * source definitions that changed under recent topics. Case 2 (report_gap) is counted as it
 * arrives. The function runs as the owner, never reopens a wont_fix gap and is safe to repeat.
 */
export const gapDetectionJob: ScheduledJob = {
  name: 'gaps.detect',
  cron: '*/15 * * * *',
  expectedEverySeconds: 60 * 60,
  async run({ database }) {
    const rows = await database.query<{ what: string; n: string }>(
      'select what, n from cl_gaps_detect()',
    )
    return { detected: Object.fromEntries(rows.map((row) => [row.what, Number(row.n)])) }
  },
}
