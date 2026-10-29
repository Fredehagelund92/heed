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
import { demoLoginServer } from '../http/login.ts'
import { demoCube, demoSecrets, inventedToken, seedDemoFigures } from '../http/demo-figures.ts'
import { gitHost, type GitHost } from '../../server/connectors/git-server.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
} from '../../../src/server/modules/connectors/index.ts'

/*
  The app's http binding against the real service and PostgreSQL 18. The conformance suite is the
  one the mock binding passes (tests/app/mock/conformance.test.ts), for the methods wired so far,
  on the mockup's demo week (tests/app/http/demo-week.ts): Jon Abara's Inbox, as in the mock.
*/

// Someone else the demo week signs in, the comments' second voice.
const colleague = { name: 'Tomas Eriksen' }
const { client, url } = testDatabase()
// Cube's figures in the demo week: a stand-in Cube over the demo warehouse, its token invented here.
const cubeToken = inventedToken()
let cube: Awaited<ReturnType<typeof demoCube>> | undefined
// The handbook the connect flow's cases connect: Markdown in Git on this machine, behind a token
// invented here.
const handbookToken = inventedToken()
let handbook: GitHost | undefined
const app = buildApp({
  workspaceSources: createWorkspaceSources({
    secrets: demoSecrets(cubeToken),
    registry: new ConnectorRegistry([]),
  }),
  database: apiDatabase(url),
  // Read again queues the sources' job, which this test never runs.
  jobs: { ...idleJobs(), runNow: () => Promise.resolve({ outcome: 'queued', id: 'conformance' }) },
  logger: createLogger({ level: 'silent' }),
  clock: systemClock(TODAY),
  devPeople: devPeople(),
  // The agents the demo week's people connected sign in with the service's own login server.
  login: await demoLoginServer('http://localhost:3000', 'http://localhost:5173'),
})
let api: HeedApi | undefined
let base = ''
let address = ''
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

beforeAll(async () => {
  await client.query('reset role')
  await seedDemoWeek(url)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  cube = await demoCube(admin.href, cubeToken)
  await seedDemoFigures(url, cube.endpoint)
  handbook = await gitHost({ token: handbookToken })
  await handbook.repository('handbook', {
    'docs/sales/orders.md':
      '# Orders in Germany\n\nOrders in Germany include marketplace orders.\n',
    'docs/marketing/campaigns.md': '# Spring campaigns\n\nThe spring sale runs in April.\n',
  })
  // The conformance suite sends more than the default 600 requests a minute as one person; the
  // request limit is not what this file tests.
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select 'limits.api_rate_per_minute', coalesce(max(version), 0) + 1, '{"person": 10000, "ip": 10000}', 'conformance'
       from settings_versions where key = 'limits.api_rate_per_minute'`,
  )
  address = await app.listen({ host: '127.0.0.1', port: 0 })
  base = `${address}/api/v1`
  api = createHttpApi({ baseUrl: base, fetch: jar })
}, 120_000)
afterAll(async () => {
  await app.close()
  await cube?.drop()
  await handbook?.close()
})

describeHeedApi('http binding on PostgreSQL', () => api!, {
  person: OWNER.name,
  wired: wiredMethods,
  colleague: colleague.name,
  repository: {
    get address() {
      return handbook!.address('handbook')
    },
    token: handbookToken,
  },
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

  it('shows an owner the draft that waits on a Not found topic of their domain, and nobody else', async () => {
    await api!.signIn({ name: OWNER.name, fresh: false })
    const spain = (await api!.askedThisWeek()).rows.find((r) => r.title === 'Orders in Spain')!
    expect(spain).toMatchObject({ state: 'missing', count: '12' })
    expect(spain.next?.label).toBe('Write it')
    expect(spain.next?.href).toMatch(/^\/context\/new\?gap=[0-9a-f-]{36}$/)
    await api!.signIn({ name: 'Ines Duarte', fresh: false })
    const asInes = (await api!.askedThisWeek()).rows.find((r) => r.title === 'Orders in Spain')!
    expect(asInes.next).toBeUndefined()
  })

  it("keeps the person's chats in their browser: no chat is sent to the service", async () => {
    await api!.signIn({ name: OWNER.name, fresh: false })
    const sent: string[] = []
    const watched = createHttpApi({
      baseUrl: base,
      fetch: async (request, init) => {
        const body = request instanceof Request ? await request.clone().text() : ''
        sent.push(`${String(request instanceof Request ? request.url : request)} ${body}`)
        return jar(request, init)
      },
    })
    await watched.getSession()
    await watched.saveChat({ id: 'chat-private', question: 'Is the Quillfeather deal in?' })
    await watched.renameChat({ id: 'chat-private', title: 'Quillfeather in October' })
    const { undo } = await watched.deleteChat({ id: 'chat-private' })
    await watched.undo({ token: undo })
    expect((await watched.listChats()).map((t) => t.title)).toContain('Quillfeather in October')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.join('\n')).not.toContain('Quillfeather')
  })

  it('answers a method it does not offer yet as not available', async () => {
    const unwired = heedApiMethods.filter((m) => !(wiredMethods as readonly string[]).includes(m))
    expect(unwired.length).toBeGreaterThan(0)
    await expect(api!.createAccessKey()).rejects.toMatchObject({ kind: 'not-available' })
  })
})
