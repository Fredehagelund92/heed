import pg from 'pg'
import { buildApp } from '../../../src/server/app.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import { identifier, localRoles } from '../../../src/server/db/roles.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { idleJobs } from '../../server/idle-jobs.ts'
import { devPeople, TODAY } from '../../app/http/demo-week.ts'

/*
  The service the golden journeys talk to in http mode, one per journey: each starts on its own copy
  of the demo week, as each starts on a fresh mock in mock mode, so what one journey publishes is
  never in the next one's Inbox. A journey that starts as a new install (`?demo=setup`) moves to a
  copy of an empty workspace instead. The copy comes from the template the global setup seeded; the
  service runs in the test's worker, as the integration tests run it, with its jobs idle.
*/

/** Where the global setup said the demo week is, and where the service answers. */
export const harness = () => {
  const env = (name: string) => {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set: run the http journeys with their config`)
    return value
  }
  return {
    admin: env('GOLDEN_ADMIN_URL'),
    template: env('GOLDEN_TEMPLATE'),
    apiPort: Number(env('GOLDEN_API_PORT')),
    webOrigin: env('GOLDEN_WEB_ORIGIN'),
  }
}

/** The working copy of the template: a name of its own, so a run never drops another's database. */
export const workName = (template: string) => `${template}_work`

/** The template of a new install: migrated, and nothing else, as `?demo=setup` starts in the mock. */
export const emptyName = (template: string) => `${template}_empty`

/** The service answering now, so a journey can start again on another workspace. */
let running: { close: () => Promise<void> } | null = null

/** Stops the service a journey ran on. */
export async function stopService() {
  await running?.close()
  running = null
}

/**
 * A fresh copy of a workspace, and the service on it: the demo week, or with `empty` a new
 * install. A service still running stops first.
 */
export async function freshService(
  workspace: 'week' | 'empty' = 'week',
): Promise<{ close: () => Promise<void> }> {
  await stopService()
  const { admin: adminUrl, template: week, apiPort, webOrigin } = harness()
  const template = workspace === 'empty' ? emptyName(week) : week
  const work = workName(week)
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`drop database if exists ${identifier(work)} with (force)`)
    await admin.query(
      `create database ${identifier(work)} template ${identifier(template)} owner ${identifier(localRoles.owner)}`,
    )
  } finally {
    await admin.end()
  }
  const url = new URL(adminUrl)
  url.pathname = `/${work}`
  const pool = new pg.Pool({
    connectionString: url.href,
    max: 4,
    options: `-c role=${localRoles.api}`,
    types: calendarDateTypes,
  })
  // Dropping the copy for the next journey ends any idle connection a closing app still holds.
  pool.on('error', () => undefined)
  const app = buildApp({
    database: databaseFromPool(pool),
    jobs: idleJobs(),
    logger: createLogger({ level: 'silent' }),
    clock: systemClock(TODAY),
    devPeople: devPeople(),
    origins: [webOrigin],
  })
  await app.listen({ host: '127.0.0.1', port: apiPort })
  running = { close: () => app.close() }
  return { close: stopService }
}
