import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { FigureRead, FigureSources, FigureSource } from '../../src/contract/figures.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { identifier } from '../../src/server/db/roles.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
  FIGURE_TIMEOUT_MS,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { cubeHost, type CubeHost } from '../server/connectors/cube-server.ts'
import { seedDemoWarehouse } from '../server/connectors/demo-warehouse.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Figures in Ask end to end (FR-716, CON-612), on the real service and PostgreSQL 18, with a
  stand-in Cube on this machine over a seeded demo warehouse (the demo model's tables, in a
  database of their own). An admin sets Cube's data endpoint and a token invented for the test,
  names the data contact and switches figures on; Ask then reads one figure for the metric's
  definition, the days and the market, compared with the days before, within 4 seconds, and keeps
  it nowhere. Off, an answer links into the tool; a metric nobody defines, or one the tool can't
  date or split, gets no figure and says why. A figure someone said doesn't fit a context item
  shows beside it until the data contact or the owners act. The token is in the secret store only:
  in no answer, row, history entry, retry record or log line, and Cube hears no person.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const rawLog: string[] = []
const logger = createLogger({
  level: 'trace',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      rawLog.push(chunk.toString())
      done()
    },
  }),
})
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-figures-secrets-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([], { secrets: store })
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  workspaceSources: createWorkspaceSources({ secrets: store, registry }),
  logger,
  clock: systemClock('2026-10-23'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const bodies: string[] = []

const call = async (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) => {
  const response = await app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
  bodies.push(response.body)
  return response
}
const ok = async <T>(
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
  status = 200,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<T>()
}

/** The warehouse: a database of its own beside the test's, with the demo model's tables. */
const adminUrl = new URL(inject('databaseTemplate'))
adminUrl.pathname = '/postgres'
const warehouseName = `context_layer_test_wh_${randomBytes(4).toString('hex')}`
const warehouseUrl = new URL(adminUrl)
warehouseUrl.pathname = `/${warehouseName}`
const admin = new pg.Client({ connectionString: adminUrl.href })

const refreshed = '2026-10-23T06:00:00.000Z'
let cube: CubeHost
let item = ''

const orders = { metric: 'metric:orders', values: ['val:market/norway'] }
const august = { from: '2026-08-01', to: '2026-08-31' }
const readFigure = (who: Who, input: object) =>
  ok<FigureRead>(call('POST', '/figures/read', who, input))
const setFigures = (who: Who, input: object) => call('PUT', '/figures/cube', who, input)

beforeAll(async () => {
  await admin.connect()
  await admin.query(`create database ${identifier(warehouseName)}`)
  await seedDemoWarehouse(warehouseUrl.href)
  cube = await cubeHost({ warehouse: warehouseUrl.href, lastRefreshTime: refreshed })
  await foundation(client)
  await transaction(client, async () => {
    await client.query(`insert into connectors (id, kind, type, name, interface_version)
      values ('cube', 'definition_source', 'cube', 'Cube', 3)`)
    await client.query(`insert into definitions (ref, connector_id, kind, name, value_type, change_mark) values
      ('cube:orders.orders', 'cube', 'metric', 'orders.orders', 'sum', 'a'),
      ('cube:orders.returns', 'cube', 'metric', 'orders.returns', 'sum', 'a'),
      ('cube:orders.market', 'cube', 'dimension', 'orders.market', 'string', 'a'),
      ('cube:orders.order_day', 'cube', 'dimension', 'orders.order_day', 'time', 'a'),
      ('cube:marketing.discount_cost', 'cube', 'metric', 'marketing.discount_cost', 'sum', 'a'),
      ('cube:marketing.market', 'cube', 'dimension', 'marketing.market', 'string', 'a'),
      ('cube:marketing.marketing_day', 'cube', 'dimension', 'marketing.marketing_day', 'time', 'a'),
      ('cube:revenue.net_revenue', 'cube', 'metric', 'revenue.net_revenue', 'sum', 'a'),
      ('demo:returns', 'demo', 'metric', 'Returns', null, 'a')`)
    await client.query(`insert into vocab_terms (key, kind, parent_key) values
      ('metric:returns', 'metric', null), ('metric:discount_cost', 'metric', null),
      ('metric:net_revenue', 'metric', null), ('metric:support_contacts', 'metric', null),
      ('val:market/spain', 'dimension_value', 'dim:market'), ('dim:product', 'dimension', null),
      ('val:product/footwear', 'dimension_value', 'dim:product')`)
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap', null) as seq")
    ).rows as [{ seq: string }]
    const terms: [string, string, string[], string[]][] = [
      ['metric:orders', 'Orders', [], ['cube:orders.orders']],
      // Returns is defined twice, by two tools: no figure is picked.
      ['metric:returns', 'Returns', [], ['cube:orders.returns', 'demo:returns']],
      ['metric:discount_cost', 'Discount cost', [], ['cube:marketing.discount_cost']],
      ['metric:net_revenue', 'Net revenue', [], ['cube:revenue.net_revenue']],
      ['metric:support_contacts', 'Support contacts', [], []],
      ['dim:market', 'Market', [], ['cube:marketing.market', 'cube:orders.market']],
      ['val:market/norway', 'Norway', ['Norge'], []],
      ['val:market/spain', 'Spain', [], []],
      ['dim:product', 'Product', [], []],
      ['val:product/footwear', 'Footwear', [], []],
    ]
    for (const [key, name, aliases, refs] of terms) {
      const [term] = (
        await client.query<{ id: string }>(
          `insert into vocab_term_versions (term_key, version_no, name, aliases, content_digest)
           values ($1, 1, $2, $3, sha256(convert_to($1, 'UTF8'))) returning id`,
          [key, name, aliases],
        )
      ).rows
      for (const ref of refs)
        await client.query(
          'insert into vocab_term_refs (version_id, definition_ref) values ($1, $2)',
          [term!.id, ref],
        )
      await client.query(
        "insert into vocab_term_service (term_key, version_id, editions) values ($1, $2, int8range($3, null, '[)'))",
        [key, term!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  // A Marketing item an answer about discount cost cites.
  item = await transaction(client, async () => {
    const v = await version(client, {
      area: 'marketing',
      title: 'Regulator paused price promotions in Norway on 9 May 2026',
      summary: 'The Norway regulator paused all price promotions on 9 May 2026.',
    })
    await accept(client, v.id, { actor: people.admin, capacity: 'administrator' })
    await publish(client, v.id)
    return v.item
  })
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
}, 120_000)
afterAll(async () => {
  await app.close()
  await cube.close()
  await admin.query(`drop database if exists ${identifier(warehouseName)} with (force)`)
  await admin.end()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('figures settings (CON-612)', () => {
  it('lists Cube with figures off and nobody to tell, its endpoint only for an admin', async () => {
    const member = await ok<FigureSources>(call('GET', '/figures', 'author'))
    expect(member.sources).toEqual([
      {
        id: 'cube',
        type: 'cube',
        tool: 'Cube',
        name: 'Cube',
        enabled: false,
        dataContact: null,
        connection: null,
      },
    ])
    const seen = await ok<FigureSources>(call('GET', '/figures', 'admin'))
    expect(seen.sources[0]!.connection).toEqual({
      endpoint: null,
      declaredHost: null,
      tokenSet: false,
    })
    // Off, with no endpoint: no figure and no link.
    expect(await readFigure('author', { ...orders, ...august })).toEqual({
      state: 'off',
      source: { id: 'cube', type: 'cube', tool: 'Cube', name: 'Cube' },
      link: null,
    })
  })

  it('is changed by an admin only, and switching on needs an endpoint, its token and a contact', async () => {
    expect((await setFigures('owner', { enabled: true, reason: 'Try it' })).statusCode).toBe(403)
    const early = await setFigures('admin', { enabled: true, reason: 'Show figures' })
    expect(early.statusCode, early.body).toBe(422)
    expect(early.body).toContain('Set the data endpoint and its token first.')
    const set = await ok<FigureSource>(
      setFigures('admin', {
        endpoint: cube.endpoint,
        token: cube.token,
        reason: 'Read figures from our Cube',
      }),
    )
    expect(set.connection).toEqual({
      endpoint: cube.endpoint,
      declaredHost: '127.0.0.1',
      tokenSet: true,
    })
    expect(set.enabled).toBe(false)
    const noContact = await setFigures('admin', { enabled: true, reason: 'Show figures' })
    expect(noContact.statusCode).toBe(422)
    expect(noContact.body).toContain('Name a data contact first')
    // Off with an endpoint, an answer links into the tool for an admin only.
    expect(await readFigure('admin', { ...orders, ...august })).toMatchObject({
      state: 'off',
      link: new URL(cube.endpoint).origin,
    })
    expect(await readFigure('author', { ...orders, ...august })).toMatchObject({
      state: 'off',
      link: null,
    })
    const on = await ok<FigureSource>(
      setFigures('admin', {
        enabled: true,
        dataContactId: people.stranger,
        reason: 'Show figures in Ask',
      }),
    )
    expect(on).toMatchObject({
      enabled: true,
      dataContact: { personId: people.stranger, name: 'stranger' },
    })
    expect(cube.requests).toEqual([])
  })
})

describe('reading a figure (FR-716)', () => {
  it('reads one figure for the definition, the days and the market, and keeps it nowhere', async () => {
    const before = await client.query('select count(*)::int as n from audit_log')
    expect(await readFigure('author', { ...orders, ...august, items: [item] })).toEqual({
      state: 'figure',
      source: { id: 'cube', type: 'cube', tool: 'Cube', name: 'Cube' },
      value: 43600,
      format: { kind: 'currency', currency: 'EUR' },
      from: '2026-08-01',
      to: '2026-08-31',
      comparison: { value: 412600, from: '2026-07-01', to: '2026-07-31' },
      asOf: refreshed,
      queryInWords:
        'Orders, added up for Norway from 1 to 31 Aug 2026, and the same for 1 to 31 Jul 2026 to compare.',
      dataContact: { personId: people.stranger, name: 'stranger' },
      against: null,
    })
    // Two GETs of /v1/load, the days and the days before, each the fixed template with the
    // market's name and its other names, and one of /v1/meta for how Orders is worked out; the
    // token went as it is, and nothing named a person.
    expect(cube.requests.map((r) => r.path).sort()).toEqual([
      '/cubejs-api/v1/load',
      '/cubejs-api/v1/load',
      '/cubejs-api/v1/meta',
    ])
    for (const request of cube.requests) {
      expect(request.authorization).toBe(cube.token)
      // Only what any request carries, and the token: no cookie, no session, no person.
      expect(Object.keys(request.headers).sort()).toEqual([
        'accept',
        'authorization',
        'connection',
        'host',
      ])
      expect(JSON.stringify(request.headers)).not.toMatch(/example\.test|heed_session/)
    }
    const loads = cube.requests.filter((r) => r.path === '/cubejs-api/v1/load')
    expect(loads[0]!.query).toEqual({
      measures: ['orders.orders'],
      timeDimensions: [{ dimension: 'orders.order_day', dateRange: ['2026-08-01', '2026-08-31'] }],
      filters: [{ member: 'orders.market', operator: 'equals', values: ['Norway', 'Norge'] }],
    })
    // Nothing was written: the figure is read when asked and kept nowhere.
    expect((await client.query('select count(*)::int as n from audit_log')).rows).toEqual(
      before.rows,
    )
    const kept = await client.query<{ hit: boolean }>(
      `select exists (select 1 from idempotency_keys where response::text like '%43600%') as hit`,
    )
    expect(kept.rows[0]!.hit).toBe(false)
  })

  it('asks the tool once a minute for the same figure', async () => {
    const asked = cube.requests.length
    await readFigure('owner', { ...orders, ...august })
    expect(cube.requests).toHaveLength(asked)
  })

  it('compares a month so far with the same days of the month before', async () => {
    const read = await readFigure('author', {
      metric: 'metric:orders',
      values: ['val:market/spain'],
      from: '2026-10-01',
      to: '2026-10-22',
    })
    expect(read).toMatchObject({
      state: 'figure',
      value: 143200,
      comparison: { value: 157400, from: '2026-09-01', to: '2026-09-22' },
    })
  })

  it('gets no figure, and says why, when the definition decides there is none', async () => {
    const none = (reason: string) => ({ state: 'none', reason })
    // Nobody defines it.
    expect(
      await readFigure('author', { metric: 'metric:support_contacts', values: [], ...august }),
    ).toMatchObject(none('undefined'))
    // Two tools define it: none is picked.
    expect(
      await readFigure('author', { metric: 'metric:returns', values: [], ...august }),
    ).toMatchObject(none('ambiguous'))
    // Its view has no date.
    expect(
      await readFigure('author', { metric: 'metric:net_revenue', values: [], ...august }),
    ).toMatchObject(none('no_date'))
    // Its view can't be split by product.
    expect(
      await readFigure('author', {
        metric: 'metric:orders',
        values: ['val:product/footwear'],
        ...august,
      }),
    ).toMatchObject(none('no_split'))
    // The warehouse has nothing for those days.
    expect(
      await readFigure('author', { ...orders, from: '2025-01-01', to: '2025-01-31' }),
    ).toMatchObject(none('no_value'))
    const days = await call('POST', '/figures/read', 'author', {
      ...orders,
      from: '2026-08-31',
      to: '2026-08-01',
    })
    expect(days.statusCode).toBe(422)
  })

  it('waits while Cube says Continue wait, and fails within 4 seconds, saying why', async () => {
    cube.continueWait(2)
    expect(
      await readFigure('author', { ...orders, from: '2026-08-02', to: '2026-08-31' }),
    ).toMatchObject({ state: 'figure', value: 30400 })
    cube.fail(401, 401)
    expect(await readFigure('author', { ...orders, from: '2026-08-03', to: '2026-08-31' })).toEqual(
      {
        state: 'none',
        reason: 'failed',
        source: { id: 'cube', type: 'cube', tool: 'Cube', name: 'Cube' },
        failure: 'unauthorized',
      },
    )
    cube.slow(FIGURE_TIMEOUT_MS + 1_000)
    const started = Date.now()
    expect(
      await readFigure('author', { ...orders, from: '2026-08-04', to: '2026-08-31' }),
    ).toMatchObject({ state: 'none', reason: 'failed', failure: 'timed_out' })
    expect(Date.now() - started).toBeLessThan(FIGURE_TIMEOUT_MS + 2_000)
    cube.slow(0)
  }, 20_000)
})

describe('a figure that does not fit a context item', () => {
  const discount = {
    metric: 'metric:discount_cost',
    values: ['val:market/norway'],
    from: '2026-05-09',
    to: '2026-05-31',
  }
  const report = (who: Who, route: string) =>
    call('POST', '/reports', who, {
      question: 'Did discount cost in Norway fall after 9 May?',
      itemId: item,
      part: 'figure',
      what: "The figure doesn't fit this context item.",
      figure: { source: 'cube', ...discount, route },
    })

  it('shows the figure and the item side by side while a report says so, to anyone asking', async () => {
    expect(await readFigure('author', { ...discount, items: [item] })).toMatchObject({
      state: 'figure',
      value: 18400,
      comparison: { value: 17700 },
      against: null,
    })
    expect((await report('author', 'both')).statusCode).toBe(200)
    // Someone who may not read the report still sees which item, never who said it or what.
    const seen = await readFigure('approver', { ...discount, items: [item] })
    expect(seen).toMatchObject({ state: 'figure', against: { itemId: item } })
    expect(JSON.stringify(seen)).not.toMatch(/author|doesn't fit this/)
    // Another market's figure is not the one reported.
    expect(
      await readFigure('approver', {
        ...discount,
        values: ['val:market/spain'],
        items: [item],
      }),
    ).not.toMatchObject({ against: { itemId: item } })
  })

  it('reaches the data contact, who closes it as not a problem', async () => {
    const feed = await ok<{ cards: { id: string; note: string | null }[] }>(
      call('GET', '/inbox/feed', 'stranger'),
    )
    const card = feed.cards.find((c) => c.note === "The figure doesn't fit this context item.")
    expect(card, JSON.stringify(feed.cards)).toBeDefined()
    const closed = await call('POST', '/inbox/cards/decide', 'stranger', {
      card: card!.id,
      action: 'not_a_problem',
    })
    expect(closed.statusCode, closed.body).toBe(200)
    expect(await readFigure('author', { ...discount, items: [item] })).toMatchObject({
      against: null,
    })
  })

  it('goes to the data contact alone when sent to them alone', async () => {
    expect((await report('approver', 'contact')).statusCode).toBe(200)
    const contact = await ok<{ cards: { note: string | null }[] }>(
      call('GET', '/inbox/feed', 'stranger'),
    )
    expect(contact.cards.some((c) => c.note === "The figure doesn't fit this context item.")).toBe(
      true,
    )
    // An admin owns every domain's Inbox, but a report sent to the data contact alone is not theirs.
    const adminFeed = await ok<{ cards: { note: string | null; by: string | null }[] }>(
      call('GET', '/inbox/feed', 'admin'),
    )
    expect(
      adminFeed.cards.some(
        (c) => c.note === "The figure doesn't fit this context item." && c.by === people.approver,
      ),
    ).toBe(false)
  })
})

describe('the token (CON-105, I-4)', () => {
  it('is in the secret store only: in no answer, row, history entry or log line', async () => {
    const token = cube.token
    for (const body of bodies) expect(body).not.toContain(token)
    for (const line of rawLog) expect(line).not.toContain(token)
    const rows = await client.query<{ hit: boolean }>(
      `select exists (select 1 from connectors where capabilities::text like '%' || $1 || '%')
           or exists (select 1 from audit_log where details::text like '%' || $1 || '%')
           or exists (select 1 from idempotency_keys where response::text like '%' || $1 || '%') as hit`,
      [token],
    )
    expect(rows.rows[0]!.hit).toBe(false)
    const history = await client.query<{ details: Record<string, unknown> }>(
      "select details from audit_log where action = 'figures.changed' order by seq",
    )
    expect(history.rows.map((r) => r.details.token).filter(Boolean)).toEqual(['set'])
    const files = await readdir(join(secretsDir, 'store'))
    expect(files).toHaveLength(1)
    expect(await readFile(join(secretsDir, 'store', files[0]!), 'utf8')).toContain(token)
  })

  it('is forgotten when the endpoint moves to another port of the same host', async () => {
    const other = new URL(cube.endpoint)
    other.port = String(Number(other.port) + 1)
    const moved = await ok<FigureSource>(
      setFigures('admin', { endpoint: other.href, enabled: false, reason: 'Another port' }),
    )
    expect(moved.connection).toMatchObject({ declaredHost: '127.0.0.1', tokenSet: false })
    // Back where it was, with its token again, figures go on.
    const back = await ok<FigureSource>(
      setFigures('admin', {
        endpoint: cube.endpoint,
        token: cube.token,
        enabled: true,
        reason: 'Back on our Cube',
      }),
    )
    expect(back).toMatchObject({ enabled: true, connection: { tokenSet: true } })
  })

  it('is forgotten when the endpoint moves to another host, and figures cannot stay on', async () => {
    const moved = await setFigures('admin', {
      endpoint: 'https://cube.example.test/cubejs-api/v1/load',
      reason: 'Our Cube moved',
    })
    expect(moved.statusCode).toBe(422)
    const off = await ok<FigureSource>(
      setFigures('admin', {
        endpoint: 'https://cube.example.test/cubejs-api/v1/load',
        enabled: false,
        reason: 'Our Cube moved',
      }),
    )
    expect(off.connection).toEqual({
      endpoint: 'https://cube.example.test/cubejs-api/v1/load',
      declaredHost: 'cube.example.test',
      tokenSet: false,
    })
    // The old token's file is removed once the change commits.
    expect(await readdir(join(secretsDir, 'store'))).toEqual([])
  })
})
