import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ObsView } from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, openEdition, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Overview's saved views by keys (FR-620): a view keeps a dimension's chip by its values' keys, up
  to 20 chips, and reads back as it was saved. The old Value chips, kept by name, move to their
  dimension's chip once (migration 0046) when each name is one value of one dimension; any other is
  kept and flagged, never merged into one of the values it could mean. The move can be undone, and
  run again to the same result.
*/

const { client, url } = testDatabase()
const devPeople: DevPerson[] = ['owner', 'admin'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock: systemClock('2026-10-23'),
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
async function api(name: string, method: 'GET' | 'POST', path: string, payload?: object) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
}

beforeAll(async () => {
  await foundation(client)
  // The definitions: Market and Store, Channel; "Alder" is a value of both Store and Channel, and
  // Norway is also "Norge".
  const terms: [string, string, string | null, string, string[]][] = [
    ['dim:market', 'dimension', null, 'Market', []],
    ['val:market/norway', 'dimension_value', 'dim:market', 'Norway', ['Norge']],
    ['val:market/spain', 'dimension_value', 'dim:market', 'Spain', []],
    ['dim:store', 'dimension', null, 'Store', []],
    ['val:store/alder', 'dimension_value', 'dim:store', 'Alder', []],
    ['val:store/birch_quay', 'dimension_value', 'dim:store', 'Birch Quay', []],
    ['dim:channel', 'dimension', null, 'Channel', []],
    ['val:channel/alder', 'dimension_value', 'dim:channel', 'Alder', []],
    ['val:channel/webshop', 'dimension_value', 'dim:channel', 'Webshop', []],
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
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('a saved view by keys', () => {
  it('reads back every chip as it was saved: fields, dimensions by keys, any value, in order', async () => {
    const chips = [
      { key: 'dim:store', not: true, values: ['val:store/alder', 'val:store/birch_quay'] },
      { key: 'answer', values: ['missing'] },
      { key: 'dim:channel', values: ['*'] },
      ...Array.from({ length: 17 }, (_, i) => ({ key: `dim:d${i}`, values: [`val:d${i}/v`] })),
    ]
    const saved = await api('owner', 'POST', '/observability/views', {
      name: 'Twenty chips',
      filters: { chips },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const listed = await api('admin', 'GET', '/observability/views')
    expect(listed.json<ObsView[]>().find((v) => v.name === 'Twenty chips')!.filters).toEqual({
      chips,
    })
  })

  it('refuses a 21st chip, a dimension twice, and a value of another dimension', async () => {
    const save = (name: string, chips: object[]) =>
      api('owner', 'POST', '/observability/views', { name, filters: { chips } })
    const many = Array.from({ length: 21 }, (_, i) => ({ key: `dim:d${i}`, values: ['*'] }))
    expect((await save('Too many', many)).statusCode).toBe(400)
    const store = { key: 'dim:store', values: ['val:store/alder'] }
    expect((await save('Twice', [store, store])).statusCode).toBe(400)
    expect(
      (await save('Not its own', [{ key: 'dim:store', values: ['val:channel/alder'] }])).statusCode,
    ).toBe(400)
  })
})

describe("the old Value chips' move to keys (observability_views_to_keys)", () => {
  const old: Record<string, object> = {
    'Two markets': { chips: [{ key: 'market', not: true, values: ['Norway', 'Spain'] }] },
    'By another name': {
      chips: [
        { key: 'answer', values: ['missing'] },
        { key: 'market', values: ['Norge'] },
      ],
    },
    'Two values': { chips: [{ key: 'market', values: ['Alder'] }] },
    'Two dimensions': { chips: [{ key: 'market', values: ['Norway', 'Webshop'] }] },
    Nothing: { chips: [{ key: 'market', values: ['Narnia'] }] },
    Taken: {
      chips: [
        { key: 'market', values: ['Spain'] },
        { key: 'dim:market', values: ['val:market/norway'] },
      ],
    },
    'No value chip': { chips: [{ key: 'answer', values: ['missing'] }] },
    'Before chips': { answer: ['missing'], domain: 'finance' },
  }
  const read = async () =>
    Object.fromEntries(
      (
        await client.query<{ name: string; filters: object; before: object | null }>(
          `select name, filters, filters_before_keys as before from observability_views
            where name = any($1)`,
          [Object.keys(old)],
        )
      ).rows.map((r) => [r.name, { filters: r.filters, before: r.before }]),
    )

  it('moves a chip whose names are one value each, flags any other, and keeps what it changed', async () => {
    for (const [name, filters] of Object.entries(old))
      await client.query(
        `insert into observability_views (name, filters, created_by) values ($1, $2, $3)`,
        [name, JSON.stringify(filters), people.owner],
      )
    const { rows } = await client.query<{ n: number }>('select observability_views_to_keys() as n')
    expect(rows[0]!.n).toBe(6)
    const now = await read()
    const chips = (name: string) => (now[name]!.filters as { chips: object[] }).chips
    expect(chips('Two markets')).toEqual([
      { key: 'dim:market', not: true, values: ['val:market/norway', 'val:market/spain'] },
    ])
    expect(chips('By another name')).toEqual([
      { key: 'answer', values: ['missing'] },
      { key: 'dim:market', values: ['val:market/norway'] },
    ])
    // A name two values share, names of two dimensions, a name of none, a dimension filtered
    // already: kept as they were, and flagged.
    expect(chips('Two values')).toEqual([{ key: 'market', values: ['Alder'], flag: 'shared' }])
    expect(chips('Two dimensions')).toEqual([
      { key: 'market', values: ['Norway', 'Webshop'], flag: 'shared' },
    ])
    expect(chips('Nothing')).toEqual([{ key: 'market', values: ['Narnia'], flag: 'unknown' }])
    expect(chips('Taken')[0]).toEqual({ key: 'market', values: ['Spain'], flag: 'taken' })
    for (const name of ['No value chip', 'Before chips'])
      expect(now[name]).toEqual({ filters: old[name], before: null })
    for (const name of ['Two markets', 'Two values', 'Taken'])
      expect(now[name]!.before).toEqual(old[name])
    // A flagged chip still reads through the API, as the views list shows it.
    const listed = (await api('owner', 'GET', '/observability/views')).json<ObsView[]>()
    expect(listed.find((v) => v.name === 'Two values')!.filters.chips).toEqual([
      { key: 'market', values: ['Alder'], flag: 'shared' },
    ])
  })

  it('is undone to the very filters before it, and done again to the same result', async () => {
    const moved = await read()
    const back = await client.query<{ n: number }>('select observability_views_from_keys() as n')
    expect(back.rows[0]!.n).toBe(6)
    for (const [name, filters] of Object.entries(old))
      expect(await read().then((r) => r[name])).toEqual({ filters, before: null })
    await client.query('select observability_views_to_keys()')
    expect(await read()).toEqual(moved)
    // Done once: running it again moves nothing more.
    const again = await client.query<{ n: number }>('select observability_views_to_keys() as n')
    expect(again.rows[0]!.n).toBe(0)
  })
})
