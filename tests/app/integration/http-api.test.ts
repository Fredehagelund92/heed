import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../../src/server/app.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { heedApiMethods, type HeedApi } from '@/api/client'
import { createHttpApi, wiredMethods } from '@/api/http'
import { describeHeedApi } from '../conformance/heed-api'
import { idleJobs } from '../../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from '../../integration/support.ts'
import { devPeople, OWNER, seedDemoWeek, TODAY } from '../http/demo-week.ts'

/*
  The app's http binding against the real service and PostgreSQL 18. The conformance suite is the
  one the mock binding passes (tests/app/mock/conformance.test.ts), for the methods wired so far,
  on the mockup's demo week (tests/app/http/demo-week.ts): Jon Abara's Inbox, as in the mock.
*/

// Someone else the demo week signs in, the comments' second voice.
const colleague = { name: 'Tomas Eriksen' }
const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock(TODAY),
  devPeople: devPeople(),
})
let api: HeedApi | undefined

beforeAll(async () => {
  await client.query('reset role')
  await seedDemoWeek(url)
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  // A browser keeps the session cookie and sends its origin; this jar does both.
  let cookie = ''
  api = createHttpApi({
    baseUrl: `${address}/api/v1`,
    fetch: async (request, init) => {
      const headers = new Headers(
        init?.headers ?? (request instanceof Request ? request.headers : undefined),
      )
      if (cookie) headers.set('cookie', cookie)
      headers.set('origin', address)
      const response = await fetch(request, { ...init, headers })
      const set = response.headers.getSetCookie()
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
      return response
    },
  })
}, 120_000)
afterAll(() => app.close())

describeHeedApi('http binding on PostgreSQL', () => api!, {
  person: OWNER.name,
  wired: wiredMethods,
  colleague: colleague.name,
})

describe('the http binding', () => {
  it('answers the reads it offers as signed out without a session', async () => {
    await api!.signOut().catch(() => undefined)
    for (const read of [
      () => api!.getLibrary(),
      () => api!.getDefinitions(),
      () => api!.searchAll({ q: 'orders' }),
    ])
      await expect(read()).rejects.toMatchObject({ kind: 'signed-out' })
  })

  it('answers a method it does not offer yet as not available', async () => {
    const unwired = heedApiMethods.filter((m) => !(wiredMethods as readonly string[]).includes(m))
    expect(unwired.length).toBeGreaterThan(0)
    await expect(api!.getObservability()).rejects.toMatchObject({ kind: 'not-available' })
  })
})
