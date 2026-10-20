import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type * as z from 'zod/mini'
import type {
  editionComparisonSchema,
  editionFeedSchema,
  itemComparisonSchema,
  rollbackPreviewSchema,
} from '../../src/contract/editions.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Edition, ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Seeing what changed between editions (Editions design G1, G2, G3 and G7) over authenticated
  HTTP: a contributor proposes, an owner accepts, changes, checks and retires, an administrator
  goes back; the feed, the comparison of two editions, one item in depth and the preview of going
  back all read the same history, with who did each change and why.
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

type Feed = z.infer<typeof editionFeedSchema>
type Comparison = z.infer<typeof editionComparisonSchema>
type ItemComparison = z.infer<typeof itemComparisonSchema>
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
async function write<T>(path: string, who: Who, payload: object): Promise<T> {
  const response = await call('POST', path, who, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

function draft(extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    title: 'Norway closure',
    summary: 'Online sales to Norway stopped',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: null },
    evidence: [
      { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
    ],
    ...extra,
  }
}
/** A proposal by the author, accepted by the owner: the edition it published. */
async function accepted(extra: Draft, itemId?: string, reason = 'Reviewed against the evidence') {
  const created = await write<ProposalRecord>('/proposals', 'author', {
    draft: draft(extra),
    ...(itemId ? { itemId } : {}),
  })
  const submitted = await write<ProposalRecord>(`/proposals/${created.id}/submit`, 'author', {
    revision: created.revision,
  })
  const decided = await write<{ proposal: ReviewProposal; edition: Edition }>(
    `/proposals/${submitted.id}/decisions`,
    'owner',
    { revision: submitted.revision, outcome: 'accept', reason },
  )
  return { proposal: submitted, itemId: submitted.itemId!, edition: decided.edition }
}

const e: Record<string, Edition> = {}
let norway = ''
let spain = ''
let norwayProposal: ProposalRecord

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(`insert into vocab_terms(key,kind,parent_key) values
      ('val:market/spain','dimension_value','dim:market')`)
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
      ['val:market/spain', 'Spain', null],
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions(term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
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
  e.bootstrap = (await read<Edition[]>('/editions?limit=1'))[0]!

  const first = await accepted({})
  norway = first.itemId
  norwayProposal = first.proposal
  e.added = first.edition
  const second = await accepted({
    title: 'Spain launch',
    summary: 'Online sales to Spain started',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
    },
  })
  spain = second.itemId
  e.second = second.edition
  e.changed = (
    await accepted(
      // A review date of its own, so the owner's check moves it.
      { summary: 'Online sales to Norway stopped for good', reviewDate: '2026-12-01' },
      norway,
      'The law is final',
    )
  ).edition
  e.checked = (
    await write<{ edition: Edition }>(`/items/${norway}/recheck`, 'owner', {
      reason: 'Checked against the law again',
    })
  ).edition
  e.retired = await write<Edition>(`/items/${spain}/retire`, 'owner', {
    reason: 'Spain closed again',
  }).then(async () => (await read<Edition[]>('/editions?limit=1'))[0]!)
  e.back = await write<Edition>(`/editions/${e.changed.label}/rollback`, 'admin', {
    note: 'The check was premature',
  })
}, 60_000)
afterAll(async () => {
  await app.close()
})

describe('the editions feed', () => {
  it('says what each edition changed, who did it and why, newest first', async () => {
    const feed = await read<Feed>('/editions/feed')
    expect(feed.next).toBeNull()
    expect(feed.entries.map((entry) => entry.edition.label)).toEqual(
      [e.back, e.retired, e.checked, e.changed, e.second, e.added, e.bootstrap].map(
        (edition) => edition!.label,
      ),
    )
    const [back, retired, checked, changed, second, added, bootstrap] = feed.entries

    expect(added).toMatchObject({
      counts: { added: 1, changed: 0, checked: 0, resaved: 0, retired: 0, removed: 0 },
      areas: ['finance'],
      highestRisk: 'low',
      vocabulary: 0,
      actorId: people.owner,
      why: 'Reviewed against the evidence',
      more: 0,
    })
    expect(added!.sentence).toBe(
      '"Norway closure" was added to Finance. Proposed by author, accepted by owner. Why: Reviewed against the evidence.',
    )
    expect(added!.items).toEqual([
      {
        itemId: norway,
        change: 'added',
        title: 'Norway closure',
        areaId: 'finance',
        kind: 'note',
        riskLevel: 'low',
        from: null,
        to: { version: 1, versionId: expect.any(String) as string },
        why: {
          proposal: { id: norwayProposal.id, number: norwayProposal.number },
          proposerId: people.author,
          channel: 'form',
          editedBy: null,
          decisions: [
            {
              decidedBy: people.owner,
              capacity: 'owner',
              outcome: 'accept',
              reason: 'Reviewed against the evidence',
              decidedAt: expect.any(String) as string,
            },
          ],
        },
      },
    ])
    expect(second!.sentence).toMatch(/^"Spain launch" was added to Finance\./)
    expect(changed).toMatchObject({ counts: { changed: 1 }, why: 'The law is final' })
    expect(changed!.sentence).toBe(
      '"Norway closure" changed in Finance. Proposed by author, accepted by owner. Why: The law is final.',
    )
    expect(checked).toMatchObject({ counts: { checked: 1 } })
    expect(checked!.sentence).toMatch(
      /^"Norway closure" in Finance was checked and is still correct\. Checked by owner\./,
    )
    expect(retired).toMatchObject({
      counts: { retired: 1 },
      why: 'Spain closed again',
      items: [
        {
          itemId: spain,
          change: 'retired',
          to: null,
          why: { decisions: [{ outcome: 'retire' }] },
        },
      ],
    })
    expect(retired!.sentence).toBe(
      '"Spain launch" in Finance was archived. Archived by owner. Why: Spain closed again.',
    )
    // Going back: the recheck goes, Spain comes back.
    expect(back).toMatchObject({
      counts: { added: 1, changed: 1 },
      actorId: people.admin,
      why: 'The check was premature',
    })
    expect(back!.sentence).toBe(
      `2 facts in Finance: 1 added, 1 changed. Admin went back to edition ${e.changed!.label}. Why: The check was premature.`,
    )
    expect(bootstrap).toMatchObject({
      counts: { added: 0 },
      vocabulary: 4,
      items: [],
    })
    expect(bootstrap!.sentence).toBe('4 names changed. The first edition.')
  })

  it('pages by edition and stops at a range', async () => {
    const first = await read<Feed>('/editions/feed?limit=2')
    expect(first.entries.map((entry) => entry.edition.label)).toEqual([
      e.back!.label,
      e.retired!.label,
    ])
    expect(first.next).toBe(e.retired!.label)
    const next = await read<Feed>(`/editions/feed?limit=2&before=${first.next}`)
    expect(next.entries.map((entry) => entry.edition.label)).toEqual([
      e.checked!.label,
      e.changed!.label,
    ])
    const range = await read<Feed>(
      `/editions/feed?after=${e.changed!.label}&before=${e.back!.label}`,
    )
    expect(range).toMatchObject({ next: null })
    expect(range.entries.map((entry) => entry.edition.label)).toEqual([
      e.retired!.label,
      e.checked!.label,
    ])
    const through = await read<Feed>(
      `/editions/feed?after=${e.changed!.label}&through=${e.retired!.label}`,
    )
    expect(through).toMatchObject({ next: null })
    expect(through.entries.map((entry) => entry.edition.label)).toEqual([
      e.retired!.label,
      e.checked!.label,
    ])
  })
})

describe('comparing two editions', () => {
  it('nets each item once, with counts for every filter', async () => {
    const comparison = await read<Comparison>(
      `/editions/compare?from=${e.second!.label}&to=${e.retired!.label}`,
    )
    expect(comparison).toMatchObject({
      from: { label: e.second!.label },
      to: { label: e.retired!.label },
      editions: 3,
      backwards: false,
      facets: {
        change: { changed: 1, retired: 1, added: 0 },
        areas: [{ areaId: 'finance', count: 2 }],
        kinds: [{ kind: 'note', count: 2 }],
        risks: [{ riskLevel: 'low', count: 2 }],
      },
      vocabulary: 0,
      total: 2,
      limit: 50,
      offset: 0,
    })
    expect(comparison.sentence).toBe(
      '2 facts in Finance: 1 changed, 1 archived. Across 3 editions.',
    )
    const [changed, retired] = comparison.items
    expect(changed).toMatchObject({
      itemId: norway,
      change: 'changed',
      from: { version: 1 },
      to: { version: 3 },
      // Who and why of the version served now: the owner's recheck.
      why: { decisions: [{ decidedBy: people.owner, outcome: 'accept' }] },
    })
    expect(changed!.fields).toEqual(['summary'])
    expect(retired).toMatchObject({ itemId: spain, change: 'retired', fields: [] })

    const filtered = await read<Comparison>(
      `/editions/compare?from=${e.second!.label}&to=${e.retired!.label}&change=retired`,
    )
    expect(filtered).toMatchObject({ total: 1, facets: { change: { changed: 1, retired: 1 } } })
    expect(filtered.items.map((item) => item.itemId)).toEqual([spain])
    const paged = await read<Comparison>(
      `/editions/compare?from=${e.second!.label}&to=${e.retired!.label}&limit=1&offset=1`,
    )
    expect(paged).toMatchObject({ total: 2, limit: 1, offset: 1 })
    expect(paged.items.map((item) => item.itemId)).toEqual([spain])
    // An item added and retired inside the range is the same at both ends.
    const net = await read<Comparison>(
      `/editions/compare?from=${e.added!.label}&to=${e.retired!.label}`,
    )
    expect(net.items.map((item) => [item.itemId, item.change])).toEqual([[norway, 'changed']])
  })

  it('compares the live edition with the one before by default, and backwards', async () => {
    const latest = await read<Comparison>('/editions/compare')
    expect(latest).toMatchObject({
      from: { label: e.retired!.label },
      to: { label: e.back!.label, live: true },
      editions: 1,
      backwards: false,
    })
    const backwards = await read<Comparison>(
      `/editions/compare?from=${e.back!.label}&to=${e.bootstrap!.label}`,
    )
    expect(backwards).toMatchObject({ backwards: true, editions: 6, vocabulary: 0 })
    // Going back from the live edition to the bootstrap takes both out; nothing retired them.
    expect(backwards.items.map((item) => [item.itemId, item.change])).toEqual([
      [norway, 'removed'],
      [spain, 'removed'],
    ])
    expect(backwards.items[0]!.why).toEqual({
      proposal: null,
      proposerId: null,
      channel: null,
      editedBy: null,
      decisions: [],
    })
  })

  it('shows one item field by field, edition by edition', async () => {
    const item = await read<ItemComparison>(
      `/editions/compare/items/${norway}?from=${e.added!.label}&to=${e.checked!.label}`,
    )
    expect(item).toMatchObject({
      from: e.added!.label,
      to: e.checked!.label,
      backwards: false,
      change: { change: 'changed', from: { version: 1 }, to: { version: 3 } },
      mentions: { added: [], removed: [] },
    })
    expect(item.fields).toContainEqual({
      field: 'summary',
      before: 'Online sales to Norway stopped',
      after: 'Online sales to Norway stopped for good',
      systemFilled: false,
    })
    expect(item.steps.map((step) => [step.edition.label, step.change])).toEqual([
      [e.changed!.label, 'changed'],
      [e.checked!.label, 'checked'],
    ])
    expect(item.steps[0]!.why).toMatchObject({
      proposerId: people.author,
      decisions: [{ reason: 'The law is final' }],
    })

    const retired = await read<ItemComparison>(
      `/editions/compare/items/${spain}?from=${e.second!.label}&to=${e.retired!.label}`,
    )
    expect(retired).toMatchObject({
      change: { change: 'retired', why: { decisions: [{ reason: 'Spain closed again' }] } },
    })
    expect(retired.fields).toContainEqual({
      field: 'title',
      before: 'Spain launch',
      after: null,
      systemFilled: false,
    })
    const same = await read<ItemComparison>(
      `/editions/compare/items/${spain}?from=${e.retired!.label}&to=${e.retired!.label}`,
    )
    expect(same).toMatchObject({ change: null, fields: [], steps: [] })
    expect((await call('GET', '/editions/compare/items/itm_nosuchitem1', 'owner')).statusCode).toBe(
      404,
    )
  })

  it('tells a version saved again with nothing different from a change', async () => {
    // The fixture gives every version the same content digest.
    const first = await transaction(client, async () => {
      const saved = await version(client, { owner: people.owner, title: 'Saved twice' })
      await accept(client, saved.id)
      await publish(client, saved.id)
      return saved
    })
    await transaction(client, async () => {
      const again = await version(client, {
        item: first.item,
        previous: first.id,
        owner: people.owner,
        title: 'Saved twice',
      })
      await accept(client, again.id)
      await publish(client, again.id)
    })
    const [resaved] = (await read<Feed>('/editions/feed?limit=1')).entries
    expect(resaved).toMatchObject({
      counts: { resaved: 1 },
      items: [{ itemId: first.item, change: 'resaved', from: { version: 1 }, to: { version: 2 } }],
    })
    expect(resaved!.sentence).toBe(
      '"Saved twice" in Finance was saved again, nothing different. Proposed by author, accepted by owner. Why: Reviewed.',
    )
    e.resaved = resaved!.edition
  })

  it('is for the people who maintain an area', async () => {
    for (const path of ['/editions/feed', '/editions/compare', `/editions/compare/items/${norway}`])
      expect((await call('GET', path, 'stranger')).statusCode, path).toBe(403)
  })
})

describe('going back', () => {
  it('previews what going back would change, for an administrator', async () => {
    const preview = await read<Preview>(`/editions/${e.second!.label}/rollback-preview`, 'admin')
    expect(preview).toMatchObject({
      live: { label: e.resaved!.label, live: true },
      target: { label: e.second!.label },
      comparison: {
        backwards: true,
        facets: { change: { changed: 1, removed: 1 } },
      },
      blocked: [],
    })
    expect(preview.comparison.items.map((item) => [item.itemId, item.change])).toEqual([
      [norway, 'changed'],
      [expect.stringMatching(/^itm_/), 'removed'],
    ])
    expect(
      (await call('GET', `/editions/${e.second!.label}/rollback-preview`, 'owner')).statusCode,
    ).toBe(403)
  })

  it('names the versions that cannot be served again instead of failing', async () => {
    // A check that failed after the first Norway version left service.
    const [first] = (
      await client.query<{ id: string }>(
        'select id::text from item_versions where item_id=$1 and version_no=1',
        [norway],
      )
    ).rows
    await client.query(
      "insert into check_results(item_version_id,level,outcome) values($1,'format','failed')",
      [first!.id],
    )
    const preview = await read<Preview>(`/editions/${e.added!.label}/rollback-preview`, 'admin')
    expect(preview.blocked).toEqual([
      {
        itemId: norway,
        title: 'Norway closure',
        version: 1,
        problem: 'a required check has not passed',
      },
    ])
    const refused = await call('POST', `/editions/${e.added!.label}/rollback`, 'admin', {
      note: 'Back to the first item',
    })
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json()).toMatchObject({
      message: `You can't go back to edition ${e.added!.label}. "Norway closure" (version 1) can't be shared with AI apps again: a required check has not passed.`,
      data: { blocked: preview.blocked },
    })
    const [live] = await read<Edition[]>('/editions?limit=1')
    expect(live!.label).toBe(e.resaved!.label)
  })
})

describe('a version with an audience group', () => {
  it('is counted and shows nothing else, like the edition export', async () => {
    const hidden = await transaction(client, async () => {
      const saved = await version(client, {
        owner: people.owner,
        title: 'For one group only',
        audience: ['finance_team'],
      })
      await accept(client, saved.id)
      await publish(client, saved.id)
      return saved
    })
    const [entry] = (await read<Feed>('/editions/feed?limit=1')).entries
    expect(entry).toMatchObject({ withheld: 1, items: [], more: 0, areas: [], highestRisk: null })
    expect(entry!.sentence).toBe(
      '1 fact that only some groups see changed. Accepted automatically.',
    )
    const comparison = await read<Comparison>(
      `/editions/compare?from=${e.resaved!.label}&to=${entry!.edition.label}`,
    )
    expect(comparison).toMatchObject({ withheld: 1, total: 0, items: [] })
    expect(comparison.facets.areas).toEqual([])
    expect(
      (
        await call(
          'GET',
          `/editions/compare/items/${hidden.item}?from=${e.resaved!.label}&to=${entry!.edition.label}`,
          'owner',
        )
      ).statusCode,
    ).toBe(404)
  })
})
