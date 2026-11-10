import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  ObsAgents,
  ObsDimensions,
  ObsFilterInput,
  ObsValues,
} from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, openEdition, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Observability's filter by dimension on the service (FR-620): topics carry their values by
  dimension, `obs.agents` narrows its topics by filters, and `obs.dimensions` and `obs.values` count
  the dimensions and values agents asked about in a range. Every count there is the topics' shown
  counts added up, so a count with a filter on and the same count with it off never give a hidden
  count away by subtraction (FR-614). The week counted is 16 to 22 October 2026.
*/

const { client, url } = testDatabase()
const today = '2026-10-23'
const quietOwner = '00000000-0000-4000-8000-000000000011'
const devPeople: DevPerson[] = ['author', 'owner', 'admin', 'quiet'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock: systemClock(today),
})
const origin = 'http://localhost'
const sessions: Record<string, Record<string, string>> = {}

async function login(name: string) {
  if (sessions[name]) return sessions[name]
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return (sessions[name] = {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  })
}

/** A read's address: the filters as the client sends them, `filters[0][key]=...`. */
function address(
  path: string,
  params: Record<string, string> = {},
  filters: ObsFilterInput[] = [],
) {
  const q = new URLSearchParams(params)
  filters.forEach((f, i) => {
    q.set(`filters[${i}][key]`, f.key)
    if (f.not) q.set(`filters[${i}][not]`, 'true')
    f.values.forEach((v, j) => q.set(`filters[${i}][values][${j}]`, v))
  })
  return `/api/v1${path}?${q.toString()}`
}
async function get(
  name: string,
  path: string,
  params?: Record<string, string>,
  filters?: ObsFilterInput[],
) {
  return app.inject({
    method: 'GET',
    url: address(path, params, filters),
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
  })
}
async function ok<T>(
  name: string,
  path: string,
  params?: Record<string, string>,
  filters?: ObsFilterInput[],
) {
  const response = await get(name, path, params, filters)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

const topics: Record<string, string> = {}
let edition: string

async function topic(
  name: string,
  area: string,
  values: string[],
  calls: number,
  dimensions: string[] = [],
) {
  const { rows } = await client.query<{ id: string }>(
    `insert into topics (key, area_id, metric_keys, value_keys, dimension_keys, month)
     values ($1, $2, '{metric:orders}', $3, $4, '2026-10-01') returning id::text`,
    [
      `${area}|orders|${values.join(',')}|${dimensions.join(',')}|2026-10`,
      area,
      values,
      dimensions,
    ],
  )
  topics[name] = rows[0]!.id
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, topic_id, scope, status, answer_state, app_family)
     select '2026-10-20T10:00:00Z', 'claude-code', 'agent', $1, 0, 'digest', $2, '{}', 'matched',
            'grounded', 'claude_code'
       from generate_series(1, $3)`,
    [edition, rows[0]!.id, calls],
  )
}

const stores = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    edition = (await servingEdition(client)).edition
  })
  await client.query(
    `create table if not exists deliveries_2026_10 partition of deliveries
       for values from ('2026-10-01 00:00Z') to ('2026-11-01 00:00Z')`,
  )
  await client.query(
    `insert into people (id, email, display_name) values ($1, 'quiet@example.test', 'quiet')`,
    [quietOwner],
  )
  await client.query(`insert into areas (id, name) values ('tiny', 'Tiny')`)
  await client.query(
    `insert into area_assignments (area_id, person_id, role) values ('tiny', $1, 'owner')`,
    [quietOwner],
  )
  // The definitions: Market and Channel with values (Norway is also "Norge"), Campaign with none,
  // and Store with 60.
  const terms: [string, string, string | null, string, string[]][] = [
    ['dim:market', 'dimension', null, 'Market', []],
    ['val:market/norway', 'dimension_value', 'dim:market', 'Norway', ['Norge']],
    ['val:market/sweden', 'dimension_value', 'dim:market', 'Sweden', []],
    ['val:market/denmark', 'dimension_value', 'dim:market', 'Denmark', []],
    ['dim:channel', 'dimension', null, 'Channel', []],
    ['val:channel/webshop', 'dimension_value', 'dim:channel', 'Webshop', []],
    ['val:channel/stores', 'dimension_value', 'dim:channel', 'Stores', []],
    ['dim:campaign', 'dimension', null, 'Campaign', []],
    ['dim:store', 'dimension', null, 'Store', []],
    ...stores.map((s): [string, string, string, string, string[]] => [
      `val:store/s${s}`,
      'dimension_value',
      'dim:store',
      `Store ${s}`,
      [],
    ]),
  ]
  await client.query(
    `insert into vocab_terms (key, kind, parent_key)
     select key, kind::term_kind, parent from unnest($1::text[], $2::text[], $3::text[]) t(key, kind, parent)
     on conflict do nothing`,
    [terms.map((t) => t[0]), terms.map((t) => t[1]), terms.map((t) => t[2])],
  )
  const versions = await client.query<{ id: string }>(
    `insert into vocab_term_versions (term_key, version_no, name, aliases, area_id, content_digest)
     select key, 1, name, array(select jsonb_array_elements_text(aliases)), 'finance',
            sha256(convert_to(key, 'UTF8'))
       from unnest($1::text[], $2::text[], $3::jsonb[]) t(key, name, aliases)
     returning id::text`,
    [terms.map((t) => t[0]), terms.map((t) => t[3]), terms.map((t) => JSON.stringify(t[4]))],
  )
  const ids = versions.rows.map((r) => r.id)
  const proposals = await client.query<{ id: string; version: string }>(
    `insert into proposals (subject, action, state, area_id, vocab_version_id, proposer_id, channel)
     select 'vocabulary', 'create', 'submitted', 'finance', id, $2, 'form' from unnest($1::uuid[]) id
     returning id::text, vocab_version_id::text as version`,
    [ids, people.author],
  )
  await client.query(
    `insert into decisions (proposal_id, vocab_version_id, area_id, decided_by, capacity, outcome, reason)
     select p, v, 'finance', $3, 'owner', 'accept', 'The filter values'
       from unnest($1::uuid[], $2::uuid[]) t(p, v)`,
    [proposals.rows.map((r) => r.id), proposals.rows.map((r) => r.version), people.owner],
  )
  const seq = await openEdition(client)
  await client.query('select edition_serve_vocab_version($1, id) from unnest($2::uuid[]) id', [
    seq,
    ids,
  ])
  await client.query('select edition_seal($1)', [seq])
  await client.query('select edition_publish($1)', [seq])

  // Finance: Norway asked 20 times on the webshop and 3 times in the stores, Sweden 12 times, and
  // Orders by campaign 15 times. Marketing: 55 of the 60 stores, from 5 to 59 times each.
  await topic('norway-webshop', 'finance', ['val:market/norway', 'val:channel/webshop'], 20)
  await topic('norway-stores', 'finance', ['val:market/norway', 'val:channel/stores'], 3)
  await topic('sweden', 'finance', ['val:market/sweden'], 12)
  await topic('by-campaign', 'finance', [], 15, ['dim:campaign'])
  for (const [i, s] of stores.slice(0, 55).entries())
    await topic(`store-${s}`, 'marketing', [`val:store/s${s}`], 5 + i)
  await topic('tiny', 'tiny', ['val:market/norway'], 2)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

/** Every count in a read, for the privacy check: none from one to just under the minimum. */
function expectNoSmallCount(read: unknown, least = 5) {
  const walk = (node: unknown, where: string) => {
    if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${where}[${i}]`))
    else if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) {
        if (k === 'total' && typeof v === 'number')
          expect(v === 0 || v >= least, `${where}.${k} is ${v}`).toBe(true)
        walk(v, `${where}.${k}`)
      }
  }
  walk(read, 'read')
}

const webshop: ObsFilterInput = { key: 'dim:channel', values: ['val:channel/webshop'] }

describe('topics by dimension (obs.agents)', () => {
  it('carries each value with its dimension, and the dimensions named with no value', async () => {
    const view = await ok<ObsAgents>('admin', '/observability/agents', { range: '7' })
    const topic = (name: string) => view.topics.find((t) => t.id === topics[name])!
    expect(topic('norway-webshop').values).toEqual([
      { dimension: 'dim:market', value: 'val:market/norway', name: 'Norway' },
      { dimension: 'dim:channel', value: 'val:channel/webshop', name: 'Webshop' },
    ])
    expect(topic('norway-webshop').dimensions).toEqual([])
    // The metric's key beside its name, as a filter takes it.
    expect(topic('norway-webshop').metrics).toEqual(['metric:orders'])
    expect(topic('by-campaign')).toMatchObject({
      values: [],
      dimensions: [{ dimension: 'dim:campaign', name: 'Campaign' }],
    })
    // Without filters, every topic, and nothing narrowed.
    expect(view.topics).toHaveLength(60)
    expect(view.narrowed).toBeNull()
  })

  it('narrows the topics by a value, by any value and by "is not", and adds them up from shown counts', async () => {
    const ids = async (...filters: ObsFilterInput[]) =>
      (await ok<ObsAgents>('admin', '/observability/agents', { range: '7' }, filters)).topics
        .map((t) => t.id)
        .sort()
    const by = (...names: string[]) => names.map((n) => topics[n]!).sort()
    expect(await ids(webshop)).toEqual(by('norway-webshop'))
    expect(await ids({ key: 'dim:campaign', values: ['*'] })).toEqual(by('by-campaign'))
    expect(
      await ids(
        { key: 'domain', values: ['finance'] },
        { key: 'dim:market', not: true, values: ['*'] },
      ),
    ).toEqual(by('by-campaign'))
    expect(
      await ids(
        { key: 'dim:market', values: ['val:market/norway'] },
        { key: 'domain', values: ['finance'] },
      ),
    ).toEqual(by('norway-webshop', 'norway-stores'))

    const norway = await ok<ObsAgents>('admin', '/observability/agents', { range: '7' }, [
      { key: 'dim:market', values: ['val:market/norway'] },
    ])
    // Norway was asked 25 times, but its stores' 3 and the tiny domain's 2 are hidden: what the
    // filter keeps is "20+".
    expect(norway.narrowed!.asked).toEqual({ topics: 3, total: null, atLeast: 20 })
    // The numbers and the chart stay the view's own; only the topics narrow.
    const all = await ok<ObsAgents>('admin', '/observability/agents', { range: '7' })
    expect(norway.numbers).toEqual(all.numbers)
    expect(
      norway.subjects
        .map((s) => s.topics)
        .flat()
        .sort(),
    ).toEqual(by('norway-webshop', 'norway-stores', 'tiny'))
    expectNoSmallCount(norway)
  })

  it('refuses a filter whose values are not its own, an unknown field and a field twice', async () => {
    const bad = async (...filters: ObsFilterInput[]) =>
      (await get('admin', '/observability/agents', { range: '7' }, filters)).statusCode
    expect(await bad({ key: 'dim:channel', values: ['val:market/norway'] })).toBe(400)
    expect(await bad({ key: 'market', values: ['Norway'] })).toBe(400)
    expect(await bad({ key: 'answer', values: ['failed'] })).toBe(400)
    expect(await bad(webshop, { key: 'dim:channel', values: ['*'] })).toBe(400)
  })
})

describe('the filter by dimension (obs.dimensions, obs.values)', () => {
  it('never gives a hidden count away by subtracting a filtered count from an unfiltered one', async () => {
    // The case itself: Norway's own count is 23, and 20 of them on the webshop; 23 less 20 would
    // be the stores' 3, a count under the minimum.
    const [real] = (
      await client.query<{ all: number; webshop: number }>(
        `select count(*)::int as all,
                count(*) filter (where 'val:channel/webshop' = any(t.value_keys))::int as webshop
           from deliveries d join topics t on t.id = d.topic_id
          where 'val:market/norway' = any(t.value_keys) and t.area_id = 'finance'`,
      )
    ).rows
    expect(real).toEqual({ all: 23, webshop: 20 })

    const norway = async (filters: ObsFilterInput[]) =>
      (
        await ok<ObsValues>(
          'admin',
          '/observability/values',
          { range: '7', dimension: 'dim:market' },
          filters,
        )
      ).groups[0]!.values.find((v) => v.key === 'val:market/norway')!.asked
    const off = await norway([])
    const on = await norway([webshop])
    expect(on).toEqual({ topics: 1, total: 20, atLeast: 20 })
    expect(off).toEqual({ topics: 3, total: null, atLeast: 20 })

    // The same on the first step: Market's own count with and without the channel filter.
    const market = async (filters: ObsFilterInput[]) =>
      (
        await ok<ObsDimensions>('admin', '/observability/dimensions', { range: '7' }, filters)
      ).dimensions.find((d) => d.key === 'dim:market')!.asked!
    const whole = await market([])
    const narrow = await market([webshop])
    expect(narrow.total).toBe(20)
    // A total with and without the filter is never 1 to 4 apart.
    expect(whole.total).toBeNull()
    expect(whole.atLeast).toBeGreaterThanOrEqual(narrow.total!)
  })

  it('lists every dimension, the most asked first, each counted without its own filter', async () => {
    const read = await ok<ObsDimensions>('admin', '/observability/dimensions', { range: '7' })
    expect(read).toMatchObject({ state: 'normal', range: 7, last: '2026-10-22', minimumCount: 5 })
    expect(read.dimensions.map((d) => [d.name, d.values, d.asked!.topics])).toEqual([
      ['Store', 60, 55],
      // Market "32+" (the stores' 3 and the tiny domain's 2 hidden), Channel "20+", Campaign 15.
      ['Market', 3, 4],
      ['Channel', 2, 2],
      ['Campaign', 0, 1],
    ])
    const narrowed = await ok<ObsDimensions>('admin', '/observability/dimensions', { range: '7' }, [
      webshop,
    ])
    const asked = (key: string) => narrowed.dimensions.find((d) => d.key === key)!.asked!
    // Channel's own filter is left out of its count, so its other value stays in sight.
    expect(asked('dim:channel').topics).toBe(2)
    expect(asked('dim:market').topics).toBe(1)
    expect(asked('dim:store').topics).toBe(0)
    expectNoSmallCount(read)
    expectNoSmallCount(narrowed)
  })

  it("pages a dimension's values 50 at a time, the most asked first or A to Z", async () => {
    const page = await ok<ObsValues>('admin', '/observability/values', {
      range: '7',
      dimension: 'dim:store',
    })
    const store = page.groups[0]!
    expect(store.values).toHaveLength(50)
    expect(store.values[0]).toEqual({
      key: 'val:store/s54',
      name: 'Store 54',
      asked: { topics: 1, total: 59, atLeast: 59 },
    })
    // 55 stores were asked about, 5 were not.
    expect(store).toMatchObject({ matched: 55, notAsked: 5, nextCursor: '50' })
    const next = await ok<ObsValues>('admin', '/observability/values', {
      range: '7',
      dimension: 'dim:store',
      cursor: '50',
    })
    expect(next.groups[0]!.values.map((v) => v.name)).toEqual([
      'Store 04',
      'Store 03',
      'Store 02',
      'Store 01',
      'Store 00',
    ])
    expect(next.groups[0]!.nextCursor).toBeNull()
    const az = await ok<ObsValues>('admin', '/observability/values', {
      range: '7',
      dimension: 'dim:store',
      sort: 'name',
    })
    expect(az.sort).toBe('name')
    expect(az.groups[0]!.values[0]!.name).toBe('Store 00')
    expectNoSmallCount(page)
  })

  it('finds a value by another name, and says what matches but was not asked about', async () => {
    const norge = await ok<ObsValues>('admin', '/observability/values', {
      range: '7',
      dimension: 'dim:market',
      q: 'norge',
    })
    expect(norge.groups[0]!.values.map((v) => v.name)).toEqual(['Norway'])
    const denmark = await ok<ObsValues>('admin', '/observability/values', {
      range: '7',
      dimension: 'dim:market',
      q: 'den',
    })
    expect(denmark.groups[0]).toMatchObject({ values: [], matched: 0, notAsked: 1 })
  })

  it('searches every dimension and answers by dimension, the first few values of each', async () => {
    const found = await ok<ObsValues>('admin', '/observability/values', { range: '7', q: 'stor' })
    // The Stores channel and Store's values: each dimension a group of its own.
    expect(found.groups.map((g) => [g.dimension.name, g.values.length, g.matched])).toEqual([
      ['Store', 3, 55],
      ['Channel', 1, 1],
    ])
    expect(found.groups[0]!.nextCursor).toBe('3')
    expect(found.notAsked).toBe(5)
    expect((await get('admin', '/observability/values', { range: '7', q: 's' })).statusCode).toBe(
      400,
    )
  })

  it('answers "any value" alone for a dimension with no values, and refuses one that is not there', async () => {
    const campaign = await ok<ObsValues>('admin', '/observability/values', {
      range: '7',
      dimension: 'dim:campaign',
    })
    expect(campaign.groups).toEqual([
      {
        dimension: { key: 'dim:campaign', name: 'Campaign' },
        asked: { topics: 1, total: 15, atLeast: 15 },
        values: [],
        matched: 0,
        notAsked: 0,
        nextCursor: null,
      },
    ])
    expect(
      (await get('admin', '/observability/values', { range: '7', dimension: 'dim:nothing' }))
        .statusCode,
    ).toBe(404)
  })

  it('counts only the domains a reader sees, and refuses those who see no Observability', async () => {
    // The owner of finance: the stores are marketing's, so none of them was asked about here.
    const store = await ok<ObsValues>('owner', '/observability/values', {
      range: '7',
      dimension: 'dim:store',
    })
    expect(store.groups[0]).toMatchObject({ values: [], matched: 0, notAsked: 60 })
    expect(store.groups[0]!.asked.topics).toBe(0)
    const dims = await ok<ObsDimensions>('owner', '/observability/dimensions', { range: '7' })
    expect(dims.dimensions.find((d) => d.key === 'dim:store')!.asked!.topics).toBe(0)
    expect(
      (
        await get('owner', '/observability/values', {
          range: '7',
          dimension: 'dim:store',
          areaId: 'marketing',
        })
      ).statusCode,
    ).toBe(403)
    expect((await get('author', '/observability/dimensions', { range: '7' })).statusCode).toBe(403)
    expect(
      (await get('author', '/observability/values', { range: '7', dimension: 'dim:market' }))
        .statusCode,
    ).toBe(403)
  })

  it('gives no count at all for a range with fewer asked than the minimum', async () => {
    const dims = await ok<ObsDimensions>('quiet', '/observability/dimensions', { range: '7' })
    expect(dims.state).toBe('quiet')
    expect(dims.dimensions.every((d) => d.asked === null)).toBe(true)
    expect(
      await ok<ObsValues>('quiet', '/observability/values', {
        range: '7',
        dimension: 'dim:market',
      }),
    ).toMatchObject({ state: 'quiet', groups: [], notAsked: 0 })
  })
})

describe('the dimensions an admin pins (observability.pinned_dimensions)', () => {
  const pin = async (name: string, value: unknown, version: number) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/settings/observability.pinned_dimensions',
      headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
      payload: { version, value, reason: 'Pinned on Overview.' },
    })

  it('start with none, and are read with the dimensions by whoever sees Observability', async () => {
    const dims = await ok<ObsDimensions>('owner', '/observability/dimensions', { range: '7' })
    expect(dims.pinned).toEqual([])
  })

  it('are pinned by an admin alone, as a new version of the setting with its reason, in the history log', async () => {
    expect((await pin('owner', ['dim:store'], 1)).statusCode).toBe(403)
    const saved = await pin('admin', ['dim:store', 'dim:market'], 1)
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json()).toMatchObject({ key: 'observability.pinned_dimensions', version: 2 })
    const { rows } = await client.query<{ details: { value: unknown; reason: string } }>(
      `select details from audit_log
        where action = 'setting.changed' and subject_id = 'observability.pinned_dimensions'`,
    )
    expect(rows.map((r) => r.details)).toMatchObject([
      { value: ['dim:store', 'dim:market'], reason: 'Pinned on Overview.' },
    ])
    // In their order, for an owner too; a dimension the definitions no longer have is left out.
    expect(
      (await ok<ObsDimensions>('owner', '/observability/dimensions', { range: '7' })).pinned,
    ).toEqual(['dim:store', 'dim:market'])
    expect((await pin('admin', ['dim:gone', 'dim:channel'], 2)).statusCode).toBe(200)
    expect(
      (await ok<ObsDimensions>('admin', '/observability/dimensions', { range: '7' })).pinned,
    ).toEqual(['dim:channel'])
  })

  it('take dimension keys only, each once, at most eight', async () => {
    for (const value of [
      ['val:market/norway'],
      ['dim:market', 'dim:market'],
      'dim:market',
      Array.from({ length: 9 }, (_, i) => `dim:d${i}`),
    ])
      expect((await pin('admin', value, 3)).statusCode, JSON.stringify(value)).toBe(422)
  })
})
