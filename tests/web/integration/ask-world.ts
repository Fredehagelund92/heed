import { afterAll, beforeAll } from 'vitest'
import { createHttpApi } from '@/api/http'
import type { HeedApi } from '@/api/client'
import type { AskTools, AskTrace } from '../../../src/server/modules/answer/index.ts'
import type { ModelPort } from '../../../src/server/modules/models/index.ts'
import { buildApp } from '../../../src/server/app.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { idleJobs } from '../../server/idle-jobs.ts'
import { apiDatabase, askToolsAs, testDatabase } from '../../integration/support.ts'
import { devPeople, seedDemoWeek, TODAY } from '../http/demo-week.ts'

/*
  The demo week on the real service, for Ask's persona cases and its differential tests: real
  sign-in, row security and the browser's own binding (createHttpApi), one session for each person
  a test asks as. `models` is the mock's scripted planner unless a run passes real ones, and
  `askTrace` hears or replaces what the planner and the words do. `withTools` runs Ask's tools as a
  person, in a transaction of their own with the services a request of theirs has.
*/

export function askWorld(
  options: { models?: ModelPort; askTrace?: AskTrace; assistant?: object } = {},
) {
  const { client, url } = testDatabase()
  const database = apiDatabase(url)
  const clock = systemClock(TODAY)
  const app = buildApp({
    database,
    jobs: idleJobs(),
    logger: createLogger({ level: 'silent' }),
    clock,
    devPeople: devPeople(),
    ...(options.models ? { models: options.models } : {}),
    ...(options.askTrace ? { askTrace: options.askTrace } : {}),
  })
  let address = ''
  const sessions = new Map<string, Promise<HeedApi>>()

  beforeAll(async () => {
    await client.query('reset role')
    await seedDemoWeek(url)
    // A run asks more than the default 600 requests a minute; the limit is not what it tests.
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       select 'limits.api_rate_per_minute', coalesce(max(version), 0) + 1, '{"person": 10000, "ip": 10000}', 'ask world'
         from settings_versions where key = 'limits.api_rate_per_minute'`,
    )
    // A real run names the model it asks.
    if (options.assistant)
      await client.query(
        `insert into settings_versions (key, version, value, reason)
         select 'models.assistant', coalesce(max(version), 0) + 1, $1::jsonb, 'ask world'
           from settings_versions where key = 'models.assistant'`,
        [JSON.stringify(options.assistant)],
      )
    address = await app.listen({ host: '127.0.0.1', port: 0 })
  }, 240_000)
  afterAll(() => app.close())

  /** The app's own binding, signed in as this person, with a cookie jar of its own. */
  const signedIn = async (name: string) => {
    // A browser keeps the session cookie and sends its origin; this jar does both.
    let cookie = ''
    const jar: typeof fetch = async (request, init) => {
      const headers = new Headers(
        init?.headers ?? (request instanceof Request ? request.headers : undefined),
      )
      if (cookie) headers.set('cookie', cookie)
      headers.set('origin', address)
      const response = await fetch(request, { ...init, headers })
      const set = response.headers.getSetCookie()
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
      return response
    }
    const api = createHttpApi({ baseUrl: `${address}/api/v1`, fetch: jar })
    await api.signIn({ name })
    return api
  }

  const tools = askToolsAs(database, clock)
  /** Ask's tools as this person, inside one transaction of theirs, as a request makes it. */
  const withTools = async <T>(name: string, work: (tools: AskTools) => Promise<T>) => {
    const { rows } = await client.query<{ id: string }>(
      'select id::text from people where display_name = $1',
      [name],
    )
    const person = rows[0]?.id
    if (!person) throw new Error(`${name} is not in the demo week`)
    return tools(person, work)
  }

  return {
    client,
    withTools,
    /** The person's session, signed in once. */
    as: (name: string) => {
      const known = sessions.get(name)
      if (known) return known
      const made = signedIn(name)
      sessions.set(name, made)
      return made
    },
  }
}
