import { afterAll, beforeAll } from 'vitest'
import { seedGaps } from '../../db/seed/gaps.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { createHttpApi } from '../../src/web/api/http-api.ts'
import type { PersonalLists } from '../../src/web/api/client.ts'
import { describeContextApiGaps, gapPeople, type GapApis } from '../conformance/context-api-gaps.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The http binding's gap reads and changes against the real service and PostgreSQL 18, on the
  bulk seed plus the fixture gaps of src/web/mocks/gaps.ts written straight into the tables the
  gateway and the detection job fill. The same suite runs against the mock
  (tests/unit/mock-gaps.test.ts), so the mock keeps the service's privacy rule.
*/

const { client, url } = testDatabase({ seeded: true })
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock('2026-10-07'),
  devPeople: gapPeople.map((person) => ({
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
const apis = {} as GapApis

beforeAll(async () => {
  await client.query('reset role')
  await seedGaps(client)
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  for (const person of gapPeople) {
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

describeContextApiGaps('http binding on PostgreSQL', () => apis)
