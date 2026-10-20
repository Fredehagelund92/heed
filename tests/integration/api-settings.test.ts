import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { seedPersonId } from '../../db/seed/bulk.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { JobRunner } from '../../src/server/modules/jobs/index.ts'
import { readConnectors, readSpend } from '../../src/server/modules/jobs/operations.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { createHttpApi } from '../../src/web/api/http-api.ts'
import type { PersonalLists } from '../../src/web/api/client.ts'
import {
  describeContextApiSettings,
  settingsPeople,
  type SettingsSignedIn,
} from '../conformance/context-api-settings.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The http binding's Settings calls against the real service and PostgreSQL 18, signed in as
  five people of the bulk seed. The same suite runs against the mock
  (tests/unit/mock-settings.test.ts). Each binding sends the session cookie and the page's
  origin, as a browser does; the binding adds the CSRF token and the retry key itself.
*/

const { url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
/*
  A runner that is not running and has no jobs, as a service whose runner has not started: the
  operations view still reads the sources and the spending from the database, as the real one does.
*/
const jobs: JobRunner = {
  ...idleJobs(),
  runNow: () => Promise.resolve({ outcome: 'unknown_job' }),
  overview: async () => ({
    checkedAt: new Date(),
    runner: 'stopped',
    jobs: [],
    connectors: await readConnectors(database),
    spend: await readSpend(database),
  }),
}
// Sources added in Settings keep their tokens in a secret store of the test's own.
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-settings-secrets-'))
afterAll(() => rm(secretsDir, { recursive: true, force: true }))
const app = buildApp({
  database,
  jobs,
  workspaceSources: createWorkspaceSources({
    secrets: await openLocalSecretStore(join(secretsDir, 'store')),
    registry: new ConnectorRegistry([]),
  }),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock('2026-10-07'),
  devPeople: settingsPeople.map((person) => ({
    email: `per_${person}@example.test`,
    name: person,
    roles: [],
  })),
})
const personal: PersonalLists = {
  listFavorites: () => [],
  setFavorite: () => [],
  listRecent: () => [],
  recordVisit: () => [],
}
const apis = {} as SettingsSignedIn

beforeAll(async () => {
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  for (const person of settingsPeople) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: address, host: new URL(address).host, 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `per_${person}@example.test` },
    })
    if (response.statusCode !== 200) throw new Error(`Sign-in failed: ${response.body}`)
    const cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    apis[person] = createHttpApi({
      baseUrl: `${address}/api/v1`,
      personal,
      fetch: (request, init) => {
        const headers = new Headers(
          init?.headers ?? (request instanceof Request ? request.headers : undefined),
        )
        headers.set('cookie', cookie)
        headers.set('origin', address)
        return fetch(request, { ...init, headers })
      },
    })
  }
}, 120_000)
afterAll(() => app.close())

describeContextApiSettings('http binding on PostgreSQL', () => apis, { personId: seedPersonId })
