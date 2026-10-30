import pg from 'pg'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import { raiseAlerts } from '../../../src/server/modules/alerts/index.ts'
import { createBundleCache } from '../../../src/server/modules/answer/index.ts'
import { relayOutbox } from '../../../src/server/modules/notifications/index.ts'

/*
  What the alert rules raise on the demo week (FR-621), raised by the alert job itself once the
  week is seeded, at 08:00 on its day, so a check that is due has sent its reminder, and delivered
  to the Inbox by the outbox relay: the mockup's Raised lately, with the service's own words.
*/

export async function raiseDemoAlerts(databaseUrl: string, today: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, types: calendarDateTypes, max: 2 })
  const database = databaseFromPool(pool)
  try {
    const clock = { now: () => new Date(`${today}T08:00:00Z`), today: () => today }
    await raiseAlerts(database, clock, createBundleCache())
    await relayOutbox(database)
  } finally {
    await pool.end()
  }
}
