import { afterAll, beforeAll } from 'vitest'
import { seedPersonId } from '../../db/seed/bulk.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import {
  createHub,
  createRelay,
  relayOutbox,
} from '../../src/server/modules/notifications/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { createHttpApi } from '../../src/web/api/http-api.ts'
import type { PersonalLists } from '../../src/web/api/client.ts'
import { describeContextApiLive } from '../conformance/context-api-live.ts'
import { conformancePeople, type SignedIn } from '../conformance/context-api-writes.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The http binding's inbox and live stream against the real service: the relay on LISTEN/NOTIFY,
  the event stream over a listening HTTP server (server-sent events read by the browser client),
  and PostgreSQL 18, signed in as people of the bulk seed. The same suite runs against the mock
  (tests/unit/mock-live.test.ts).
*/

const { url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const hub = createHub(database, { pollMs: 200 })
const relay = createRelay({
  // As the service listens: under the API role.
  connectionString: `${url}?options=${encodeURIComponent(`-c role=${localRoles.api}`)}`,
  database,
  hub,
  logger,
  pollMs: 200,
})
const app = buildApp({
  database,
  jobs: idleJobs(),
  logger,
  clock: systemClock('2026-10-07'),
  notifications: hub,
  devPeople: conformancePeople.map((person) => ({
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
const apis = {} as SignedIn

beforeAll(async () => {
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  for (const person of conformancePeople) {
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
  relay.start()
}, 120_000)
// Closing waits for the relay's pass and the open streams to end, which is slow on a busy machine.
afterAll(async () => {
  await relay.stop()
  await app.close()
}, 120_000)

describeContextApiLive('http binding on PostgreSQL', () => apis, {
  personId: seedPersonId,
  // The relay runs on its own; relaying here as well makes the inbox current before a read.
  settle: async () => {
    await relayOutbox(database)
    hub.wake()
  },
})
