import pg from 'pg'
import { buildApp } from '../../../src/server/app.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import { identifier, localRoles } from '../../../src/server/db/roles.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { createEditionSource } from '../../../src/server/modules/editions/index.ts'
import { createAnonymousStore } from '../../../src/server/mcp/store.ts'
import { idleJobs } from '../../server/idle-jobs.ts'
import { devPeople, TODAY } from '../../app/http/demo-week.ts'
import { demoLoginServer } from '../../app/http/login.ts'
import { demoSecrets } from '../../app/http/demo-figures.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
} from '../../../src/server/modules/connectors/index.ts'

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
    cubeToken: env('GOLDEN_CUBE_TOKEN'),
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
  const { admin: adminUrl, template: week, apiPort, webOrigin, cubeToken } = harness()
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
  // What agents read over MCP, on the serving role, as the service reads it (src/server/mcp/runtime.ts).
  const serving = new pg.Pool({
    connectionString: url.href,
    max: 2,
    options: `-c role=${localRoles.serve}`,
    types: calendarDateTypes,
  })
  serving.on('error', () => undefined)
  const issuer = `http://localhost:${apiPort}`
  // An agent signs in with the service's own login server, as a person's agent does (J12). Its
  // address is on the web app's host, as the service requires of the consent page, so the
  // browser's sign-in cookie goes with the consent page's requests.
  const login = await demoLoginServer(issuer, webOrigin)
  const app = buildApp({
    database: databaseFromPool(pool),
    jobs: idleJobs(),
    logger: createLogger({ level: 'silent' }),
    clock: systemClock(TODAY),
    devPeople: devPeople(),
    origins: [webOrigin],
    // Figures in Ask read the stand-in Cube the global setup started, with the token it invented.
    workspaceSources: createWorkspaceSources({
      secrets: demoSecrets(cubeToken),
      registry: new ConnectorRegistry([]),
    }),
    login,
    // An agent that signed in reads over MCP with the login server's tokens.
    mcp: {
      source: createEditionSource(serving),
      store: createAnonymousStore(serving),
      verifier: login.verifier,
      resource: `${issuer}/mcp`,
      authorizationServers: [issuer],
      close: () => serving.end(),
    },
  })
  await app.listen({ host: '127.0.0.1', port: apiPort })
  running = { close: () => app.close() }
  return { close: stopService }
}

/**
 * A check of the saved questions that stopped part way, as the service keeps it: the check job's
 * run over every saved question, failed after `checked` of them (`?quality=failed`).
 */
export async function failedCheck(checked: number) {
  const { admin: adminUrl, template } = harness()
  const url = new URL(adminUrl)
  url.pathname = `/${workName(template)}`
  const client = new pg.Client({ connectionString: url.href })
  await client.connect()
  try {
    await client.query(
      `insert into check_runs (trigger, edition, overlay, day, total, checked, failed_at)
       select 'publish', (select seq from live_edition), coalesce((select seq from serving_overlay), 0),
              current_date, count(*), $1, now()
         from saved_questions where removed_at is null`,
      [checked],
    )
  } finally {
    await client.end()
  }
}
