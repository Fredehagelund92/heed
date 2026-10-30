import { systemClock, type Clock } from '../../clock.ts'
import type { ScheduledJob } from '../jobs/index.ts'

/**
 * The weekly counts Observability keeps without limit (FR-612, FR-620): each night, before
 * retention, every completed week (Monday to Sunday, UTC) is counted from the deliveries into
 * `obs_weekly`, by domain and answer state, and nothing else. The function runs as
 * the owner and is safe to run twice: a week counted again keeps the same counts, and a week whose
 * deliveries retention may have started to drop is never counted again.
 */
export function weeklyRollupJob({ clock = systemClock() }: { clock?: Clock } = {}): ScheduledJob {
  return {
    name: 'observability.rollup',
    cron: '45 2 * * *',
    expectedEverySeconds: 36 * 60 * 60,
    async run({ database }) {
      const rows = await database.query<{ week: string; kept: string }>(
        'select week::text, kept from cl_obs_weekly_rollup_due($1::date)',
        [clock.today()],
      )
      return {
        weeks: rows.map((r) => r.week),
        rows: rows.reduce((n, r) => n + Number(r.kept), 0),
      }
    },
  }
}
