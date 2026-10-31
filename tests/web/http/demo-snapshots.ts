import pg from 'pg'
import { systemClock } from '../../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import type { JobContext } from '../../../src/server/modules/jobs/index.ts'
import { snapshotJob } from '../../../src/server/modules/observability/index.ts'

/*
  Summary's monthly snapshots on the demo week (FR-620): August and September, taken by the
  snapshot job itself on the first of the month after, as the nightly job would have, once the
  week is seeded. The mock keeps the same two months (src/web/api/mock/obs-snapshots.ts).
*/

export async function takeDemoSnapshots(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, types: calendarDateTypes, max: 2 })
  const database = databaseFromPool(pool)
  try {
    for (const day of ['2026-09-01', '2026-10-01'])
      await snapshotJob({ clock: systemClock(day) }).run({ database } as JobContext)
  } finally {
    await pool.end()
  }
}
