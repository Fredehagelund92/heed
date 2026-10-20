import { afterAll, beforeAll } from 'vitest'
import { seedPersonId } from '../../db/seed/bulk.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { createHttpApi } from '../../src/web/api/http-api.ts'
import type { PersonalLists } from '../../src/web/api/client.ts'
import {
  conformancePeople,
  describeContextApiWrites,
  type SignedIn,
} from '../conformance/context-api-writes.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The http binding's writes against the real service and PostgreSQL 18, signed in as six people
  of the bulk seed. The same suite runs against the mock (tests/unit/mock-writes.test.ts). Each
  binding sends the session cookie and the page's origin, as a browser does; the binding adds
  the CSRF token and the retry key itself.
*/

const { url } = testDatabase({ seeded: true })
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock('2026-10-07'),
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
}, 120_000)
afterAll(() => app.close())

describeContextApiWrites('http binding on PostgreSQL', () => apis, { personId: seedPersonId })
