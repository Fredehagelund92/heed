import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaRemoved } from '../../src/contract/areas.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

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

type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers: Record<string, Headers> = {}
type Who = keyof typeof people
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  await foundation(client)
  // The live vocabulary: Orders, which the finance domain holds, and the markets.
  await transaction(client, async () => {
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['dim:market', 'Market', null, null],
      ['val:market/norway', 'Norway', null, null],
    ] as const) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,proposer_id,content_digest)
                    values($1,1,$2,$3,$5,sha256(convert_to($1,'UTF8'))) returning id),
              r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v where $4::text is not null)
         select id from v`,
        [key, name, area, ref, people.author],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_pin_source_domains($1)', [seq])
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
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
})
afterAll(async () => {
  await app.close()
})

function draft(areaId: string, title: string, metric: string): Draft {
  return {
    areaId,
    title,
    summary: 'Flour at the north kiosk',
    scope: { metrics: [metric], dimensions: [], dimensionValues: [] },
    validity: { start: '2026-08-04', end: null },
    evidence: [{ url: 'https://example.test/pantry', quote: 'Weighed', date: '2026-08-04' }],
  }
}
/** A low-risk note, published by the owner and live. */
async function acceptedItem(areaId: string, title: string, metric: string) {
  const made = await call('POST', '/proposals', 'author', { draft: draft(areaId, title, metric) })
  expect(made.statusCode, made.body).toBe(200)
  const p = made.json<ProposalRecord>()
  const sent = await call('POST', `/proposals/${p.id}/submit`, 'author', { revision: p.revision })
  expect(sent.statusCode, sent.body).toBe(200)
  const sheet = await call('GET', `/review/${p.id}/sheet`, 'owner')
  const { proposal } = sheet.json<{ proposal: ReviewProposal }>()
  const published = await call('POST', `/review/${p.id}/publish`, 'owner', {
    revision: proposal.revision,
  })
  expect(published.statusCode, published.body).toBe(200)
  return p.itemId!
}

/*
  A domain as a document (FR-815, golden plan P11a): made from its own page with a name and its
  owners alone, renamed and written by its owners, and deleted from its page only while it holds no
  context and no terms, never the sandbox.
*/
describe('a domain from its page', () => {
  const deleteEmpty = (id: string, who: Who = 'admin') =>
    call('POST', `/areas/${id}/delete`, who, {})
  const create = (body: object) => call('POST', '/areas', 'admin', body)

  it('is made with a name and owners alone: the quietest hue, the default review time', async () => {
    const used = (
      await client.query<{ label: string }>('select label from areas where archived_at is null')
    ).rows.map((r) => r.label)
    const response = await create({
      id: 'pantry',
      name: 'Pantry',
      description: 'Flour, sugar and what the kiosks keep.',
      summary: 'Flour, sugar and what the kiosks keep.',
      team: { ownerIds: [people.owner] },
    })
    expect(response.statusCode, response.body).toBe(200)
    const area = response.json<{ label: string; reviewDays: number; chatChannel: null }>()
    expect(used).not.toContain(area.label)
    expect(area).toMatchObject({ reviewDays: 2, chatChannel: null, ownerTeam: null })
  })

  it('is renamed and written by its owners, never to a name another domain has', async () => {
    const read = async () =>
      (await call('GET', '/areas', 'admin'))
        .json<{ id: string; revision: number }[]>()
        .find((a) => a.id === 'pantry')!
    const renamed = await call('PUT', '/areas/pantry/description', 'owner', {
      revision: (await read()).revision,
      name: 'Larder',
      summary: 'What the kiosks keep.',
      description: 'What the kiosks keep.\n\nHouse rules: weigh in grams.',
    })
    expect(renamed.statusCode, renamed.body).toBe(200)
    expect(renamed.json()).toMatchObject({ name: 'Larder', summary: 'What the kiosks keep.' })
    const taken = await call('PUT', '/areas/pantry/description', 'owner', {
      revision: (await read()).revision,
      name: 'Marketing',
      summary: '',
      description: '',
    })
    expect(taken.statusCode).toBe(409)
    // Someone who doesn't own it can't.
    const stranger = await call('PUT', '/areas/pantry/description', 'stranger', {
      revision: (await read()).revision,
      name: 'Mine',
      summary: '',
      description: '',
    })
    expect(stranger.statusCode).toBe(403)
  })

  it('is deleted only by an administrator', async () => {
    for (const who of ['owner', 'author', 'stranger'] as const)
      expect((await deleteEmpty('pantry', who)).statusCode, who).toBe(403)
  })

  it('is not deleted while it holds context or terms, and says what it holds', async () => {
    await acceptedItem('pantry', 'Flour is weighed in grams', 'metric:orders')
    const held = await deleteEmpty('pantry')
    expect(held.statusCode, held.body).toBe(409)
    expect(held.json()).toMatchObject({
      message:
        'Only an empty domain can be deleted. Move its context and terms to another domain first.',
      data: { holdings: { items: 1 } },
    })
    // Finance holds a term only, which counts too.
    const terms = await deleteEmpty('finance')
    expect(terms.statusCode).toBe(409)
    expect(terms.json()).toMatchObject({ data: { holdings: { items: 0 } } })
    expect((await client.query("select 1 from areas where id='pantry'")).rowCount).toBe(1)
  })

  it('never deletes the sandbox', async () => {
    await client.query("insert into areas (id,name,is_demo) values ('sandbox_demo','Sandbox',true)")
    const response = await deleteEmpty('sandbox_demo')
    expect(response.statusCode).toBe(409)
    expect(response.json<{ message: string }>().message).toMatch(/sandbox can't be deleted/)
  })

  it('deletes an empty one, which leaves every list', async () => {
    expect((await create({ id: 'shelf', name: 'Shelf' })).statusCode).toBe(200)
    const response = await deleteEmpty('shelf')
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<AreaRemoved>()).toMatchObject({ edition: null })
    const listed = (await call('GET', '/areas', 'author')).json<{ id: string }[]>()
    expect(listed.map((a) => a.id)).not.toContain('shelf')
    expect((await deleteEmpty('shelf')).statusCode).toBe(404)
  })

  it('deletes one that nothing names for good, with no edition', async () => {
    await client.query("insert into areas (id,name) values ('empty','Empty')")
    const editions = async () =>
      (await client.query<{ n: number }>('select count(*)::int as n from editions')).rows[0]!.n
    const before = await editions()
    const response = await deleteEmpty('empty')
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<AreaRemoved>()).toMatchObject({ outcome: 'deleted', edition: null })
    expect(await editions()).toBe(before)
    expect((await client.query("select 1 from areas where id='empty'")).rowCount).toBe(0)
  })
})
