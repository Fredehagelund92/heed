import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Feed } from '../../src/contract/inbox.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The review path and the Inbox of Heed v1 over authenticated HTTP (golden plan P6a): the review
  sheet, its decisions and their undo (FR-224 to FR-227), the Inbox's cards and their decisions,
  the setup checklist (FR-816) and a Not found card's draft. Jon's role is played by `owner` (an
  owner of Finance), a member by `author`, an administrator by `admin`.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
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
const ok = async <T>(response: Promise<{ statusCode: number; body: string; json: <U>() => U }>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      `insert into vocab_terms(key,kind,parent_key) select 'val:market/'||m,'dimension_value','dim:market'
         from unnest($1::text[]) m`,
      [markets],
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
      ...markets.map((m) => [`val:market/${m}`, m[0]!.toUpperCase() + m.slice(1), null]),
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
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
})
afterAll(async () => {
  await app.close()
})

/** A market of its own for each case, so what one case publishes is no clash for the next. */
const markets = [
  'spain',
  'denmark',
  'sweden',
  'finland',
  'iceland',
  'germany',
  'france',
  'italy',
  'poland',
  'austria',
  'ireland',
  'portugal',
  'belgium',
  'netherlands',
]
const inMarket = (market: string) => ({
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: `val:market/${market}` }],
  },
})

function draft(extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    kind: 'note',
    title: 'Units sold excludes test accounts',
    summary: 'Orders in Norway leave out the 312 accounts our teams use to test the webshop.',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-01-01', end: null },
    evidence: [
      {
        url: 'https://wiki.example/units-sold',
        quote: 'Test accounts are left out',
        date: '2026-10-01',
      },
    ],
    ...extra,
  }
}
async function submitted(extra: Draft = {}, who: Who = 'author', itemId?: string) {
  const p = await ok<ProposalRecord>(
    call('POST', '/proposals', who, { draft: draft(extra), ...(itemId ? { itemId } : {}) }),
  )
  return ok<ProposalRecord>(
    call('POST', `/proposals/${p.id}/submit`, who, { revision: p.revision }),
  )
}
const sheet = (id: string, who: Who = 'owner') =>
  ok<ReviewSheet>(call('GET', `/review/${id}/sheet`, who))
type Published = {
  proposal: { state: string; revision: number }
  edition: { label: string } | null
  undo: string
}
const publish = (id: string, revision: number, extra: object = {}, who: Who = 'owner') =>
  call('POST', `/review/${id}/publish`, who, { revision, ...extra })
/** A context item published, the way an owner publishes a suggestion. */
async function live(extra: Draft = {}) {
  const p = await submitted(extra)
  await ok<Published>(publish(p.id, p.revision))
  return p.itemId!
}
const served = async (itemId: string) =>
  (
    await client.query<{ n: number | null }>(
      `select v.version_no as n from item_version_service s join item_versions v on v.id=s.version_id
        where s.item_id=$1 and s.editions @> (select seq from live_edition)`,
      [itemId],
    )
  ).rows[0]?.n ?? null
const feed = (who: Who = 'owner', tab: 'needs' | 'all' = 'needs') =>
  ok<Feed>(call('GET', `/inbox/feed?tab=${tab}`, who))

describe('the review sheet (FR-224)', () => {
  it('shows an edit as the change by kind, the stored Markdown line by line, and what agents say', async () => {
    const itemId = await live()
    const change = await submitted(
      {
        summary:
          'Orders in Norway leave out the 340 accounts our teams use to test the webshop. From 1 October 2026 the returns team’s accounts are left out too.',
        evidence: [
          {
            url: 'https://wiki.example/units-sold-october',
            quote: 'Test accounts are left out',
            date: '2026-10-02',
          },
        ],
      },
      'author',
      itemId,
    )
    const s = await sheet(change.id)
    expect(s.mode).toBe('edit')
    expect(s.diff.counts).toEqual([
      { kind: 'wording', n: 2 },
      { kind: 'link', n: 1 },
    ])
    expect(s.diff.values).toEqual(
      expect.arrayContaining([{ what: 'number', field: 'text', before: '312', after: '340' }]),
    )
    expect(s.source.rows.map((r) => r.t)).toEqual(['-', '+'])
    expect(s.source.rows[0]!.words!.filter((w) => w.changed).map((w) => w.text)).toEqual(['312'])
    // A person wrote it: no claim check, which is for what an agent or the assistant copied.
    expect(s.claims).toBeNull()
    expect(s.clashes).toEqual([])
    expect(s.readiness).toMatchObject({ state: 'link', ok: true, bulk: false, publishable: true })
    expect(s.tryIt.question).toMatch(/Orders/)
    expect(s.tryIt.before.items.map((i) => i.id)).toEqual([itemId])
    expect(s.tryIt.after.items.map((i) => i.id)).toEqual([itemId])
    expect(s.from).toEqual({ personId: people.author, name: 'author' })
    expect(s.read).toEqual({ opened: false, read: false })
    expect(s.canPublish).toBe(true)
    // Its writer reads the same sheet, and may not publish it.
    const own = await sheet(change.id, 'author')
    expect(own).toMatchObject({
      canPublish: false,
      whyNot: 'Only an owner of its domain, or an admin, publishes it.',
    })
    // Someone who may not see it gets nothing.
    expect((await call('GET', `/review/${change.id}/sheet`, 'stranger')).statusCode).toBe(404)
  })

  it('reads a new item as one addition, and checks an agent’s claims against the sentence it copied', async () => {
    const p = await submitted({
      title: 'Payments delayed in Spain',
      summary: 'Orders in Spain arrive two days late since 14 October 2026.',
      ...inMarket('iceland'),
      evidence: [
        {
          url: 'https://status.example/spain',
          quote: 'Settlement files arrive within 48 hours from 14 October 2026.',
          date: '2026-10-15',
        },
      ],
    })
    await client.query(
      `update proposals set provenance='{"by":"agent","fields":{},"flags":[]}' where id=$1`,
      [p.id],
    )
    const s = await sheet(p.id)
    expect(s.mode).toBe('new')
    expect(s.diff.counts).toEqual([{ kind: 'added', n: 1 }])
    expect(s.writtenBy).toBe('agent')
    expect(s.claims?.sentence).toBe('Settlement files arrive within 48 hours from 14 October 2026.')
    expect(s.claims?.rows).toEqual(
      expect.arrayContaining([
        { claim: 'since 14 October 2026', source: 'from 14 October 2026', verdict: 'same' },
        { claim: 'two days', source: null, verdict: 'check' },
      ]),
    )
    expect(s.readiness).toMatchObject({
      state: 'claims',
      ok: false,
      bulk: false,
      publishable: true,
    })
    expect(s.readiness.title).toMatch(/^Ready, with \d claims? to check$/)
    expect(s.tryIt.before.state).toBe('missing')
    expect(s.tryIt.after.items.map((i) => i.title)).toEqual(['Payments delayed in Spain'])
  })
})

describe('a clash with live context (FR-225)', () => {
  it('waits for the owner to say how the two relate, keeps every answer, and acts on it', async () => {
    const theirs = await live({
      title: 'Spain orders count store credit',
      summary: 'Orders in Spain include orders paid with store credit.',
      kind: 'note',
      ...inMarket('spain'),
      validity: { start: '2026-01-01', end: null },
    })
    const spain = {
      ...inMarket('spain'),
      validity: { start: '2026-01-01', end: null },
    }
    const mine = await submitted({
      ...spain,
      title: 'Spain orders leave out store credit',
      summary: 'Orders in Spain leave out store credit from 1 November 2026.',
    })
    const s = await sheet(mine.id)
    expect(s.clashes).toEqual([
      {
        itemId: theirs,
        title: 'Spain orders count store credit',
        summary: 'Orders in Spain include orders paid with store credit.',
        relation: null,
      },
    ])
    expect(s.readiness).toMatchObject({ state: 'clash', publishable: false })
    expect(s.canPublish).toBe(false)
    const refused = await publish(mine.id, mine.revision)
    expect(refused.statusCode).toBe(422)
    expect(refused.json<{ message: string }>().message).toMatch(
      /Say how this relates to “Spain orders count store credit” first/,
    )
    // An answer for an item it does not clash with is refused.
    expect(
      (
        await publish(mine.id, mine.revision, {
          relations: [{ itemId: 'itm_nothing0001', relation: 'unrelated' }],
        })
      ).statusCode,
    ).toBe(422)
    // "This replaces it": the new version names it, and publishing archives it.
    const done = await ok<Published>(
      publish(mine.id, mine.revision, { relations: [{ itemId: theirs, relation: 'replaces' }] }),
    )
    expect(done.proposal.state).toBe('accepted')
    expect(await served(theirs)).toBeNull()
    const relations = await client.query<{ relation: string; item: string }>(
      'select relation::text,item_id as item from proposal_relations where proposal_id=$1',
      [mine.id],
    )
    expect(relations.rows).toEqual([{ relation: 'replaces', item: theirs }])
    const [replaced] = (
      await client.query<{ replaces: string[] }>(
        `select array(select replaced_item_id from item_version_replaces r where r.version_id=p.item_version_id) as replaces
           from proposals p where p.id=$1`,
        [mine.id],
      )
    ).rows
    expect(replaced!.replaces).toEqual([theirs])
  })

  it('keeps both when they disagree, so agents get the conflict, and publishes the owner’s own suggestion', async () => {
    const window = {
      ...inMarket('denmark'),
      validity: { start: '2026-03-01', end: '2026-04-01' },
    }
    const theirs = await live({
      ...window,
      title: 'Spain March is normal',
      summary: 'Orders in Spain were normal in March 2026.',
    })
    const own = await submitted(
      { ...window, title: 'Spain March fell', summary: 'Orders in Spain fell in March 2026.' },
      'owner',
    )
    const s = await sheet(own.id)
    expect(s.clashes.map((c) => c.itemId)).toEqual([theirs])
    const done = await ok<Published>(
      publish(own.id, own.revision, { relations: [{ itemId: theirs, relation: 'disagrees' }] }),
    )
    expect(done.proposal.state).toBe('accepted')
    expect(await served(theirs)).toBe(1)
    const conflicts = await client.query<{ other: string }>(
      `select c.other_item_id as other from proposals p join item_version_conflicts c on c.version_id=p.item_version_id where p.id=$1`,
      [own.id],
    )
    expect(conflicts.rows).toEqual([{ other: theirs }])
  })

  async function coAnswered(market: string) {
    const scope = { ...inMarket(market), validity: { start: '2026-01-01', end: null } }
    const a = await live({
      ...scope,
      title: `${market} orders count store credit`,
      summary: `Orders in ${market} include orders paid with store credit.`,
    })
    const next = await submitted({
      ...scope,
      title: `${market} orders lag a day`,
      summary: `Orders in ${market} arrive a day late from the payment provider.`,
    })
    await ok<Published>(
      publish(next.id, next.revision, { relations: [{ itemId: a, relation: 'unrelated' }] }),
    )
    return { scope, a, b: next.itemId! }
  }

  it('shows the live item an edit of one of two co-answered items now contradicts as a clash', async () => {
    const { scope, a, b } = await coAnswered('portugal')
    const edit = await submitted(
      {
        ...scope,
        title: 'portugal orders leave out store credit',
        summary: 'Orders in portugal leave out store credit.',
      },
      'author',
      a,
    )
    const s = await sheet(edit.id)
    expect(s.mode).toBe('edit')
    expect(s.clashes.map((c) => c.itemId)).toEqual([b])
    expect(s.readiness).toMatchObject({ state: 'clash', publishable: false })
    expect((await publish(edit.id, edit.revision)).statusCode).toBe(422)
  })

  it('finds no clash in an edit that only changes formatting, and finds it for a new item', async () => {
    const { scope, a, b } = await coAnswered('netherlands')
    const edit = await submitted(
      {
        ...scope,
        title: 'netherlands orders count store credit',
        summary: 'Orders in netherlands **include** orders paid with store credit.',
      },
      'author',
      a,
    )
    const s = await sheet(edit.id)
    expect(s.mode).toBe('edit')
    expect(s.clashes).toEqual([])
    expect(s.readiness).toMatchObject({ publishable: true })
    expect(s.readiness.state).not.toBe('clash')
    const fresh = await submitted({
      ...scope,
      title: 'netherlands orders leave out store credit',
      summary: 'Orders in netherlands leave out store credit from 1 November 2026.',
    })
    expect((await sheet(fresh.id)).clashes.map((c) => c.itemId).sort()).toEqual([a, b].sort())
  })
})

describe('a suggestion to archive', () => {
  it('archives the item, and its review still reads once it is archived', async () => {
    const itemId = await live({ title: 'Belgium orders lag a day', ...inMarket('belgium') })
    const proposal = await ok<ProposalRecord>(
      call('POST', `/items/${itemId}/retire-proposals`, 'author', {
        reason: 'The provider sends the files on time again.',
      }),
    )
    const before = await sheet(proposal.id)
    expect(before.mode).toBe('retire')
    expect(before.readiness).toMatchObject({ state: 'archive', publishable: true })
    await ok<Published>(publish(proposal.id, before.proposal.revision))
    expect(await served(itemId)).toBeNull()
    const after = await sheet(proposal.id)
    expect(after.mode).toBe('retire')
    expect(after.proposal.state).toBe('accepted')
    expect(after.canPublish).toBe(false)
  })
})

describe('reading, publishing what was read, and undo (FR-226, FR-227)', () => {
  it('publishes only the plain changes the owner read, names the rest, and undoes all of them together', async () => {
    const a = await live({ title: 'Read one', ...inMarket('sweden') })
    const b = await live({ title: 'Read two', ...inMarket('finland') })
    const c = await live({ title: 'Not read', ...inMarket('germany') })
    const reworded = (title: string, market: string) => ({
      title,
      summary: 'Orders in Norway leave out the accounts our teams use to test the webshop.',
      ...inMarket(market),
    })
    const ra = await submitted(reworded('Read one', 'sweden'), 'author', a)
    const rb = await submitted(reworded('Read two', 'finland'), 'author', b)
    const rc = await submitted(reworded('Not read', 'germany'), 'author', c)
    // Opening is not reading.
    await ok(call('POST', '/inbox/cards/read', 'owner', { cards: [`proposal:${rc.id}`] }))
    expect((await sheet(rc.id)).read).toEqual({ opened: true, read: false })
    for (const p of [ra, rb])
      expect(
        await ok(call('POST', `/review/${p.id}/read`, 'owner', { itemVersionId: p.itemVersionId })),
      ).toEqual({ read: true })
    // A read counts for the version that was read only.
    expect(
      (await call('POST', `/review/${rc.id}/read`, 'owner', { itemVersionId: ra.itemVersionId }))
        .statusCode,
    ).toBe(409)
    // The Inbox says which suggestions the owner read, and which they only opened.
    const cards = (await feed()).cards
    const card = (id: string) => cards.find((c) => c.id === `proposal:${id}`)
    expect([ra, rb, rc].map((p) => card(p.id))).toMatchObject([
      { read: true, opened: true },
      { read: true, opened: true },
      { read: false, opened: true },
    ])
    const result = await ok<{
      published: { id: string }[]
      skipped: { id: string; code: string }[]
      undo: string | null
    }>(call('POST', '/review/publish-read', 'owner', { ids: [ra.id, rb.id, rc.id] }))
    expect(result.published.map((x) => x.id).sort()).toEqual([ra.id, rb.id].sort())
    expect(result.skipped).toEqual([
      { id: rc.id, code: 'not_read', message: expect.any(String) as unknown },
    ])
    expect([await served(a), await served(b)]).toEqual([2, 2])
    const undone = await ok<{ edition: string | null }>(
      call('POST', '/decisions/undo', 'owner', { token: result.undo }),
    )
    expect(undone.edition).toEqual(expect.any(String))
    expect([await served(a), await served(b)]).toEqual([1, 1])
    const states = await client.query<{ state: string }>(
      'select state::text from proposals where id=any($1::uuid[]) order by id',
      [[ra.id, rb.id]],
    )
    expect(states.rows).toEqual([{ state: 'submitted' }, { state: 'submitted' }])
    const reason = await client.query<{ reason: string }>(
      'select reason::text from editions where label=$1',
      [undone.edition],
    )
    expect(reason.rows).toEqual([{ reason: 'decision_undone' }])
    // Waiting again, it can be published again, and that publish undone again.
    const again = await ok<Published>(publish(ra.id, (await sheet(ra.id)).proposal.revision))
    expect(await served(a)).toBe(2)
    await ok(call('POST', '/decisions/undo', 'owner', { token: again.undo }))
    expect(await served(a)).toBe(1)
  })

  it('leaves out a change that needs its own look, even when it was read', async () => {
    const itemId = await live({ title: 'New link', ...inMarket('france') })
    const p = await submitted(
      {
        title: 'New link',
        ...inMarket('france'),
        evidence: [
          {
            url: 'https://wiki.example/moved',
            quote: 'Test accounts are left out',
            date: '2026-10-03',
          },
        ],
      },
      'author',
      itemId,
    )
    await ok(call('POST', `/review/${p.id}/read`, 'owner', { itemVersionId: p.itemVersionId }))
    const result = await ok<{ published: unknown[]; skipped: { code: string }[] }>(
      call('POST', '/review/publish-read', 'owner', { ids: [p.id] }),
    )
    expect(result.published).toEqual([])
    expect(result.skipped.map((s) => s.code)).toEqual(['needs_care'])
  })

  it('undoes a new item’s publish, only for the person who decided, and only within the window', async () => {
    const p = await submitted({ title: 'Brand new', ...inMarket('italy') })
    const done = await ok<Published>(publish(p.id, p.revision))
    expect(await served(p.itemId!)).toBe(1)
    expect((await call('POST', '/decisions/undo', 'admin', { token: done.undo })).statusCode).toBe(
      403,
    )
    await ok(call('POST', '/decisions/undo', 'owner', { token: done.undo }))
    expect(await served(p.itemId!)).toBeNull()
    // Twice is once.
    expect((await call('POST', '/decisions/undo', 'owner', { token: done.undo })).statusCode).toBe(
      409,
    )
    // Too late: the window has passed.
    const late = await submitted({ title: 'Too late', ...inMarket('poland') })
    const decided = await ok<Published>(publish(late.id, late.revision))
    await client.query(
      `insert into settings_versions(key,version,value,reason)
       select 'limits.undo_seconds',max(version)+1,'0','test' from settings_versions where key='limits.undo_seconds'`,
    )
    try {
      expect(
        (await call('POST', '/decisions/undo', 'owner', { token: decided.undo })).statusCode,
      ).toBe(409)
    } finally {
      await client.query(
        `insert into settings_versions(key,version,value,reason)
         select 'limits.undo_seconds',max(version)+1,'15','test' from settings_versions where key='limits.undo_seconds'`,
      )
    }
  })

  it('returns a suggestion with a note as its first comment, and an undo sends it back to waiting', async () => {
    const p = await submitted({ title: 'Return me' })
    const returned = await ok<{ proposal: { state: string }; undo: string }>(
      call('POST', `/review/${p.id}/return`, 'owner', {
        revision: p.revision,
        note: 'Which markets does this cover?',
      }),
    )
    expect(returned.proposal.state).toBe('changes_requested')
    const events = await ok<{ kind: string; data: { text?: string } }[]>(
      call('GET', `/proposals/${p.id}/events`, 'author'),
    )
    expect(events.map((e) => e.kind)).toContain('commented')
    await ok(call('POST', '/decisions/undo', 'owner', { token: returned.undo }))
    const back = await ok<{ state: string }>(call('GET', `/proposals/${p.id}`, 'author'))
    expect(back.state).toBe('submitted')
  })
})

describe('the Inbox (docs/product.md, section 5)', () => {
  let gapId = ''
  let feedbackId = ''
  let dueItem = ''

  beforeAll(async () => {
    const topic = await client.query<{ id: string }>(
      `insert into topics (key,area_id,metric_keys,value_keys,month)
       values ('finance|orders|spain|2026-10','finance','{metric:orders}','{val:market/spain}','2026-10-01') returning id::text`,
    )
    const gap = await client.query<{ id: string }>(
      `insert into gaps (topic_id,type,opened_by_case) values ($1,'missing',1) returning id::text`,
      [topic.rows[0]!.id],
    )
    gapId = gap.rows[0]!.id
    await client.query(
      `insert into gap_weekly_counts (gap_id,week,no_item_calls) values ($1,date_trunc('week', now() at time zone 'UTC')::date,9)`,
      [gapId],
    )
    const fb = await client.query<{ id: string }>(
      `insert into feedback (verdict,note,client_label,area_id) values ('unclear','Is this Germany only?','claude-code','finance') returning id::text`,
    )
    feedbackId = fb.rows[0]!.id
    dueItem = await live({
      title: 'Due again',
      ...inMarket('austria'),
      validity: { start: '2026-01-01', end: null },
      reviewDate: '2026-02-01',
    })
  })

  it('groups the owner’s cards by need, and shows a member none of them', async () => {
    const f = await feed()
    const groups = f.groups.map((g) => g.group)
    expect(groups.slice(0, 3)).toEqual(['gap', 'flag', 'check'])
    expect(groups).toContain('suggestion')
    const gap = f.cards.find((c) => c.id === `gap:${gapId}`)
    expect(gap).toMatchObject({ group: 'gap', times: 9, draft: null, opened: false })
    expect(gap && 'title' in gap ? gap.title : '').toMatch(/Orders/)
    expect(f.cards.find((c) => c.id === `feedback:${feedbackId}`)).toMatchObject({
      group: 'flag',
      verdict: 'unclear',
      note: 'Is this Germany only?',
    })
    expect(f.cards.find((c) => c.id === `check:${dueItem}`)).toMatchObject({
      group: 'check',
      reason: 'date',
    })
    // Cards in the order of need.
    const firstSuggestion = f.cards.findIndex((c) => c.group === 'suggestion')
    expect(f.cards.findIndex((c) => c.group === 'gap')).toBeLessThan(firstSuggestion)
    const member = await feed('author')
    expect(member.cards).toEqual([])
  })

  it('marks cards opened for the person only', async () => {
    await ok(
      call('POST', '/inbox/cards/read', 'owner', {
        cards: [`gap:${gapId}`, `feedback:${feedbackId}`],
      }),
    )
    const f = await feed()
    expect(f.cards.find((c) => c.id === `gap:${gapId}`)?.opened).toBe(true)
    expect((await feed('admin')).cards.find((c) => c.id === `gap:${gapId}`)?.opened).toBe(false)
  })

  it('closes a report that is not a problem for every owner, and undoes it', async () => {
    const decided = await ok<{ undo: string }>(
      call('POST', '/inbox/cards/decide', 'owner', {
        card: `feedback:${feedbackId}`,
        action: 'not_a_problem',
      }),
    )
    expect(
      (await feed('admin')).cards.find((c) => c.id === `feedback:${feedbackId}`),
    ).toBeUndefined()
    const all = await feed('owner', 'all')
    expect(all.cards.find((c) => c.id === `feedback:${feedbackId}`)?.done).toMatchObject({
      outcome: 'Not a problem',
    })
    // A member decides no card.
    expect(
      (
        await call('POST', '/inbox/cards/decide', 'author', {
          card: `feedback:${feedbackId}`,
          action: 'not_a_problem',
        })
      ).statusCode,
    ).toBe(403)
    await ok(call('POST', '/decisions/undo', 'owner', { token: decided.undo }))
    expect((await feed()).cards.find((c) => c.id === `feedback:${feedbackId}`)).toBeDefined()
  })

  it('says a Not found is not something we write down, and undoes it', async () => {
    const decided = await ok<{ undo: string }>(
      call('POST', '/inbox/cards/decide', 'owner', { card: `gap:${gapId}`, action: 'not_written' }),
    )
    const status = async () =>
      (await client.query<{ status: string }>('select status::text from gaps where id=$1', [gapId]))
        .rows[0]!.status
    expect(await status()).toBe('wont_fix')
    await ok(call('POST', '/decisions/undo', 'owner', { token: decided.undo }))
    expect(await status()).toBe('open')
    // A card that does not offer that decision.
    expect(
      (
        await call('POST', '/inbox/cards/decide', 'owner', {
          card: `gap:${gapId}`,
          action: 'still_true',
        })
      ).statusCode,
    ).toBe(422)
  })

  it('checks a due item as still true and archives one, each with an undo', async () => {
    const checked = await ok<{ edition: string | null; undo: string }>(
      call('POST', '/inbox/cards/decide', 'owner', {
        card: `check:${dueItem}`,
        action: 'still_true',
      }),
    )
    expect(checked.edition).toEqual(expect.any(String))
    expect(await served(dueItem)).toBe(2)
    await ok(call('POST', '/decisions/undo', 'owner', { token: checked.undo }))
    expect(await served(dueItem)).toBe(1)
    const archived = await ok<{ undo: string }>(
      call('POST', '/inbox/cards/decide', 'owner', { card: `check:${dueItem}`, action: 'archive' }),
    )
    expect(await served(dueItem)).toBeNull()
    await ok(call('POST', '/decisions/undo', 'owner', { token: archived.undo }))
    expect(await served(dueItem)).toBe(1)
  })

  it('lists what the person sent that waits on an owner, under All', async () => {
    const mine = await submitted({ title: 'Waiting on Finance' })
    const all = await feed('author', 'all')
    expect(all.waiting.find((w) => w.proposalId === mine.id)).toMatchObject({
      title: 'Waiting on Finance',
      areaId: 'finance',
    })
    expect(all.groups.find((g) => g.group === 'waiting')?.count).toBeGreaterThan(0)
  })

  it('hides counts from agents under the minimum, and never names who asked', async () => {
    const f = await feed()
    for (const value of [f.week.asked, f.week.found, f.week.nothing])
      expect(value === null || value === 0 || value >= 5).toBe(true)
    expect(JSON.stringify(f.week)).not.toMatch(/claude-code/)
  })

  it('gives a Not found card a draft dated to its month, and the same one again', async () => {
    const first = await ok<ProposalRecord>(call('POST', `/gaps/${gapId}/scope-draft`, 'owner', {}))
    expect(first.draft).toMatchObject({
      areaId: 'finance',
      validity: { start: '2026-10-01', end: '2026-11-01' },
      scope: { metrics: ['metric:orders'], dimensionValues: [{ value: 'val:market/spain' }] },
    })
    const again = await ok<ProposalRecord>(call('POST', `/gaps/${gapId}/scope-draft`, 'owner', {}))
    expect(again.id).toBe(first.id)
    expect((await feed()).cards.find((c) => c.id === `gap:${gapId}`)).toMatchObject({
      draft: first.id,
    })
  })
})

describe('the setup checklist (FR-816)', () => {
  it('reads each step from what exists, and Ask marks only that it was used', async () => {
    const before = await ok<{ steps: { id: string; done: boolean }[]; done: boolean }>(
      call('GET', '/setup', 'admin'),
    )
    expect(before.steps.map((s) => s.id)).toEqual(['about', 'fact', 'ask', 'agent', 'definitions'])
    expect(before.steps.find((s) => s.id === 'fact')?.done).toBe(true)
    expect(before.steps.find((s) => s.id === 'ask')?.done).toBe(false)
    const asked = await call('POST', '/ask/lookup', 'author', {
      question: 'Why did orders drop in Norway?',
    })
    expect(asked.statusCode, asked.body).toBe(200)
    const after = await ok<{ steps: { id: string; done: boolean }[] }>(
      call('GET', '/setup', 'author'),
    )
    expect(after.steps.find((s) => s.id === 'ask')?.done).toBe(true)
    const marks = await client.query('select * from setup_marks')
    expect(Object.keys(marks.rows[0] as object).sort()).toEqual(['done_at', 'step'])
  })
})

describe('row security and guards of what the Inbox and undo keep', () => {
  /** Runs work as a person through the API role, then rolls it back. */
  async function as<T>(
    who: Who,
    work: () => Promise<T>,
    setup?: () => Promise<unknown>,
  ): Promise<T> {
    await client.query('begin')
    try {
      await setup?.()
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id', $1, true)", [people[who]])
      return await work()
    } finally {
      await client.query('rollback')
    }
  }
  const q = (sql: string, values: unknown[] = []) => client.query(sql, values)
  /** The undo window closed, for the transaction only. */
  const noWindow = () =>
    q(`insert into settings_versions(key,version,value,reason)
       select 'limits.undo_seconds',max(version)+1,'0','test' from settings_versions where key='limits.undo_seconds'`)
  let decision = ''
  let proposal = ''

  beforeAll(async () => {
    const p = await submitted({ title: 'Guarded', ...inMarket('ireland') })
    await ok<Published>(publish(p.id, p.revision))
    proposal = p.id
    decision = (
      await client.query<{ id: string }>(
        "select id::text from decisions where proposal_id=$1 and outcome='accept'",
        [p.id],
      )
    ).rows[0]!.id
  })

  it('keeps which cards a person opened to that person', async () => {
    await as('owner', async () => {
      await q("insert into card_reads (person_id,card) values ($1,'gap:one')", [people.owner])
      await expect(
        q("insert into card_reads (person_id,card) values ($1,'gap:one')", [people.author]),
      ).rejects.toThrow(/row-level security/)
    })
    await q("insert into card_reads (person_id,card) values ($1,'gap:theirs')", [people.author])
    expect(
      (await as('owner', () => q('select * from card_reads where person_id<>$1', [people.owner])))
        .rows,
    ).toEqual([])
    await expect(
      as('author', () =>
        q("insert into card_reads (person_id,card) values ($1,'not a card')", [people.author]),
      ),
    ).rejects.toThrow(/card_reads_card_check/)
  })

  it('lets an owner or an admin close a card, as themselves, and only its closer open it again in the window', async () => {
    const close = (by: Who) =>
      q(
        "insert into card_states (card,area_id,state,decided_by) values ('feedback:x','finance','closed',$1)",
        [people[by]],
      )
    await expect(as('author', () => close('author'))).rejects.toThrow(/row-level security/)
    await expect(as('owner', () => close('admin'))).rejects.toThrow(/row-level security/)
    expect(await as('owner', async () => (await close('owner')).rowCount)).toBe(1)
    await close('owner')
    try {
      expect((await as('author', () => q('select * from card_states'))).rows).toEqual([])
      expect((await as('admin', () => q('select card from card_states'))).rows).toEqual([
        { card: 'feedback:x' },
      ])
      expect((await as('admin', () => q('delete from card_states'))).rowCount).toBe(0)
      await expect(as('owner', () => q("update card_states set state='closed'"))).rejects.toThrow(
        /permission denied/,
      )
      expect((await as('owner', () => q('delete from card_states'), noWindow)).rowCount).toBe(0)
      expect((await as('owner', () => q('delete from card_states'))).rowCount).toBe(1)
    } finally {
      await client.query('delete from card_states')
    }
  })

  it('records an undo only by the decision’s maker, in the window, and keeps it', async () => {
    const undo = (by: Who) =>
      q('insert into decision_undos (decision_id,undone_by) values ($1,$2)', [decision, people[by]])
    await expect(as('admin', () => undo('admin'))).rejects.toThrow(/row-level security/)
    await expect(as('admin', () => undo('owner'))).rejects.toThrow(/row-level security/)
    await expect(as('owner', () => undo('owner'), noWindow)).rejects.toThrow(/row-level security/)
    await as('owner', async () => {
      await undo('owner')
      await expect(q('delete from decision_undos')).rejects.toThrow(
        /permission denied|append-only|forbid/,
      )
    })
  })

  it('opens a published suggestion again only with its undo, and decides a version again only in a new round', async () => {
    await expect(
      transaction(client, () =>
        q("update proposals set state='submitted', closed_at=null where id=$1", [proposal]),
      ),
    ).rejects.toThrow(/reopens only when its accept is undone/)
    await expect(
      transaction(client, () =>
        q(
          `insert into decisions (proposal_id,item_version_id,area_id,decided_by,capacity,outcome,reason)
           select proposal_id,item_version_id,area_id,decided_by,capacity,outcome,'Again' from decisions where id=$1`,
          [decision],
        ),
      ),
    ).rejects.toThrow(/decisions_once_item/)
  })

  it('names a setup step only, never who or what', async () => {
    await expect(
      transaction(client, () => q("insert into setup_marks (step) values ('fact')")),
    ).rejects.toThrow(/setup_marks_step_check/)
  })
})
