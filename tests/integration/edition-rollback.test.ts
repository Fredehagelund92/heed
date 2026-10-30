import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type * as z from 'zod/mini'
import type { rollbackPreviewSchema } from '../../src/contract/editions.ts'
import type { Edition } from '../../src/contract/review.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Going back to an earlier edition (FR-217, Editions design G7) over authenticated HTTP, as the
  API keeps it with no screen: an administrator previews what going back would change, and going
  back serves the earlier content again as a new edition, unless a version of it can no longer be
  served.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Preview = z.infer<typeof rollbackPreviewSchema>
type Who = keyof typeof people
type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers: Record<string, Headers> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
async function read<T>(path: string, who: Who = 'owner'): Promise<T> {
  const response = await call('GET', path, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const live = async () => (await read<Edition[]>('/editions?limit=1'))[0]!
const labelOf = async (seq: string) =>
  (await client.query<{ label: string }>('select label from editions where seq=$1', [seq])).rows[0]!
    .label

const e: Record<string, string> = {}
let norway = ''
let spain = ''
let norwaySecond = ''

beforeAll(async () => {
  await foundation(client)
  // Norway's first version, then Spain beside it, then Norway's second: three editions.
  const first = await transaction(client, async () => {
    const made = await version(client, { owner: people.owner, title: 'Norway closure' })
    await accept(client, made.id)
    e.added = await labelOf(await publish(client, made.id))
    const other = await version(client, { owner: people.owner, title: 'Spain launch' })
    await accept(client, other.id)
    e.second = await labelOf(await publish(client, other.id))
    spain = other.item
    return made
  })
  norway = first.item
  const changed = await transaction(client, () =>
    version(client, {
      owner: people.owner,
      title: 'Norway closure',
      summary: 'Orders to Norway stopped for good',
      core: 'core changed',
      item: norway,
      previous: first.id,
    }),
  )
  norwaySecond = changed.id
  // Its words differ from the first version's: the fixture gives every version one digest.
  await client.query('alter table item_versions disable trigger user')
  await client.query("update item_versions set content_digest=sha256('changed') where id=$1", [
    changed.id,
  ])
  await client.query('alter table item_versions enable trigger user')
  await transaction(client, async () => {
    await accept(client, changed.id)
    e.changed = await labelOf(await publish(client, changed.id))
  })
  for (const name of Object.keys(people)) {
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
}, 60_000)
afterAll(async () => {
  await app.close()
})

describe('going back', () => {
  it('previews what going back would change, for an administrator only', async () => {
    const preview = await read<Preview>(`/editions/${e.added!}/rollback-preview`, 'admin')
    expect(preview).toMatchObject({
      live: { label: e.changed!, live: true },
      target: { label: e.added! },
      comparison: {
        backwards: true,
        facets: { change: { changed: 1, removed: 1 } },
      },
      blocked: [],
    })
    expect(preview.comparison.items.map((item) => [item.itemId, item.change]).sort()).toEqual(
      [
        [norway, 'changed'],
        [spain, 'removed'],
      ].sort(),
    )
    for (const who of ['owner', 'author'] as const)
      expect(
        (await call('GET', `/editions/${e.added!}/rollback-preview`, who)).statusCode,
        who,
      ).toBe(403)
  })

  it('serves the earlier content again as a new edition', async () => {
    const back = await call('POST', `/editions/${e.second!}/rollback`, 'admin', {
      note: 'The second version was premature',
    })
    expect(back.statusCode, back.body).toBe(200)
    const edition = back.json<Edition>()
    expect((await live()).label).toBe(edition.label)
    const served = await client.query<{ item_id: string; version_no: number }>(
      `select v.item_id, v.version_no from item_version_service s
         join item_versions v on v.id = s.version_id
         join editions e on e.label = $1
        where s.editions @> e.seq order by v.item_id`,
      [edition.label],
    )
    expect(served.rows).toEqual(
      [
        { item_id: norway, version_no: 1 },
        { item_id: spain, version_no: 1 },
      ].sort((a, b) => a.item_id.localeCompare(b.item_id)),
    )
    // Going back to the edition agents already get is refused.
    expect(
      (await call('POST', `/editions/${edition.label}/rollback`, 'admin', { note: 'Again' }))
        .statusCode,
    ).toBe(409)
  })

  it('names the versions that cannot be served again instead of failing', async () => {
    const before = await live()
    // A check that failed after the second Norway version left service.
    await client.query(
      "insert into check_results(item_version_id,level,outcome) values($1,'format','failed')",
      [norwaySecond],
    )
    const preview = await read<Preview>(`/editions/${e.changed!}/rollback-preview`, 'admin')
    expect(preview.blocked).toEqual([
      {
        itemId: norway,
        title: 'Norway closure',
        version: 2,
        problem: 'a required check has not passed',
      },
    ])
    const refused = await call('POST', `/editions/${e.changed!}/rollback`, 'admin', {
      note: 'Back to the second version',
    })
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json()).toMatchObject({
      message: `You can't go back to edition ${e.changed!}. "Norway closure" (version 2) can't be shared with agents again: a required check has not passed.`,
      data: { blocked: preview.blocked },
    })
    expect((await live()).label).toBe(before.label)
  })
})
