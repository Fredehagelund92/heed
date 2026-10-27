import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  DeletedDraft,
  DraftFromText,
  ItemBulkPlan,
  ItemBulkResult,
  ItemChange,
  ItemPage,
  PublishItemResult,
  RelatedContext,
} from '../../src/contract/context.ts'
import type { LibraryIndex } from '../../src/contract/index.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Context over authenticated HTTP (golden plan P7): changes to many items at once with their skips
  and Undo (FR-139), a context item's page and history, restoring a version as a draft (FR-140),
  related context, publishing in one step as an owner (FR-137), a draft from pasted text, the
  deleted drafts, and the row security of what they keep. `owner` owns Finance, `stranger` owns
  Marketing, `admin` is an administrator and `author` a member. Support has no owner.
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
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
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

/** A market of its own for each item, so no item clashes with another. */
const markets = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}`)
let nextMarket = 0

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query("insert into areas (id,name) values ('support','Support')")
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
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
      ...markets.map((m) => [`val:market/${m}`, `Market ${m}`, null]),
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

function draft(extra: Draft = {}): Draft {
  const market = markets[nextMarket++]!
  return {
    areaId: 'finance',
    kind: 'note',
    title: `Units sold excludes test accounts in ${market}`,
    summary: 'Orders leave out the 312 accounts our teams use to test the webshop.',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: `val:market/${market}` }],
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

/** A context item published in one step by an owner (or an admin, for another domain). */
async function live(extra: Draft = {}, who: Who = 'owner') {
  const r = await ok<PublishItemResult>(
    call('POST', '/items/publish', who, { draft: draft(extra) }),
  )
  if (!r.published) throw new Error('not published')
  return r.itemId
}
/** A draft of the author's, never sent. */
async function aDraft(extra: Draft = {}, who: Who = 'author') {
  return (await ok<ProposalRecord>(call('POST', '/proposals', who, { draft: draft(extra) }))).id
}
const served = async (itemId: string) =>
  (
    await client.query<{ n: number | null; area: string; kind: string }>(
      `select version_no as n, area_id as area, kind::text as kind
         from serving_items((select seq from live_edition)) where item_id=$1`,
      [itemId],
    )
  ).rows[0] ?? null
const bulk = (who: Who, input: object) =>
  ok<ItemBulkResult>(call('POST', '/items/bulk', who, input))
const plan = (who: Who, input: object) =>
  ok<ItemBulkPlan>(call('POST', '/items/bulk/plan', who, input))
const undo = (who: Who, token: string) => call('POST', '/decisions/undo', who, { token })
const indexRow = async (who: Who, id: string) =>
  (await ok<LibraryIndex>(call('GET', '/library', who))).items.find((i) => i.id === id)

describe('publishing in one step (FR-137)', () => {
  it("publishes an owner's draft at once, and Undo takes it back", async () => {
    const r = await ok<PublishItemResult>(
      call('POST', '/items/publish', 'owner', { draft: draft() }),
    )
    expect(r).toMatchObject({ published: true })
    if (!r.published) return
    expect((await served(r.itemId))?.n).toBe(1)
    expect((await undo('owner', r.undo)).statusCode).toBe(200)
    expect(await served(r.itemId)).toBeNull()
  })

  it("sends anyone else's to the domain's owners, and changes nothing agents get", async () => {
    const r = await ok<PublishItemResult>(
      call('POST', '/items/publish', 'author', { draft: draft() }),
    )
    expect(r).toMatchObject({ published: false, ownerIds: [people.owner] })
    if (r.published) return
    const p = await ok<ProposalRecord>(call('GET', `/proposals/${r.proposalId}`, 'author'))
    expect(p.state).toBe('submitted')
  })

  it('refuses a draft the checks refuse, and keeps nothing', async () => {
    const before = await client.query('select count(*)::int as n from proposals')
    const r = await call('POST', '/items/publish', 'owner', {
      draft: draft({ summary: 'Ask jo@example.test before you read these orders.' }),
    })
    expect(r.statusCode).toBe(422)
    expect((await client.query('select count(*)::int as n from proposals')).rows).toEqual(
      before.rows,
    )
  })
})

describe('a change to many items at once (FR-139)', () => {
  it('plans which rows it acts on, and says why it leaves the others alone', async () => {
    const mine = await live()
    const theirs = await live({ areaId: 'marketing' }, 'admin')
    const draftId = await aDraft()
    const result = await plan('owner', {
      action: 'archive',
      rows: [mine, theirs, draftId, 'itm_nothere001'],
    })
    expect(result.act.map((r) => r.id)).toEqual([mine])
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: 'itm_nothere001', code: 'not_found' }),
      expect.objectContaining({
        id: theirs,
        code: 'not_allowed',
        why: 'owned by Marketing',
        message: 'Only owners of Marketing and admins can change it.',
      }),
      expect.objectContaining({ id: draftId, code: 'draft', why: 'a draft' }),
    ])
  })

  it('archives, takes them away from agents, and Undo puts exactly them back', async () => {
    const [a, b, keep] = [await live(), await live(), await live()]
    const r = await bulk('owner', { action: 'archive', rows: [a, b] })
    expect(r).toMatchObject({ done: [a, b], skipped: [], failed: [] })
    expect(r.change?.summary).toMatch(/^Archived “.*” and 1 more\.$/)
    expect(await served(a)).toBeNull()
    expect(await served(b)).toBeNull()
    expect((await served(keep))?.n).toBe(1)
    const changes = await ok<ItemChange[]>(call('GET', '/context/changes', 'owner'))
    expect(changes[0]).toMatchObject({ action: 'archived', personId: people.owner, undone: false })
    expect((await undo('owner', r.undo!)).statusCode).toBe(200)
    expect((await served(a))?.n).toBe(1)
    expect((await served(b))?.n).toBe(1)
    expect((await ok<ItemChange[]>(call('GET', '/context/changes', 'owner')))[0]?.undone).toBe(true)
    // Once only, and only by its maker.
    expect((await undo('owner', r.undo!)).statusCode).toBe(409)
    const again = await bulk('owner', { action: 'archive', rows: [a] })
    expect((await undo('admin', again.undo!)).statusCode).toBe(403)
  })

  it('deletes drafts only, lists them as deleted, and Undo brings them back', async () => {
    const mine = await live()
    const first = await aDraft()
    const second = await aDraft()
    const r = await bulk('owner', { action: 'delete', rows: [first, second, mine] })
    expect(r.done).toEqual([first, second])
    expect(r.skipped).toEqual([
      expect.objectContaining({
        id: mine,
        code: 'published',
        message: 'Published items are archived, not deleted.',
      }),
    ])
    expect((await served(mine))?.n).toBe(1)
    expect((await call('GET', `/proposals/${first}`, 'author')).statusCode).toBe(404)
    const deleted = await ok<DeletedDraft[]>(call('GET', '/context/deleted', 'admin'))
    expect(deleted.find((d) => d.id === first)).toMatchObject({
      personId: people.owner,
      areaId: 'finance',
    })
    expect((await call('GET', '/context/deleted', 'owner')).statusCode).toBe(403)
    expect((await undo('owner', r.undo!)).statusCode).toBe(200)
    expect((await ok<ProposalRecord>(call('GET', `/proposals/${first}`, 'author'))).state).toBe(
      'draft',
    )
    expect(
      (
        await client.query(
          "select actor_id::text as actor from proposal_events where proposal_id=$1 and kind='restored'",
          [first],
        )
      ).rows,
    ).toEqual([{ actor: people.owner }])
  })

  it('moves items into a domain the person may move into, and Undo moves them back', async () => {
    const item = await live()
    const refused = await call('POST', '/items/bulk', 'owner', {
      action: 'domain',
      rows: [item],
      areaId: 'marketing',
    })
    expect(refused.statusCode).toBe(403)
    expect(refused.json<{ message: string }>().message).toBe(
      'Only owners of Marketing and admins can move context into it.',
    )
    const r = await bulk('admin', { action: 'domain', rows: [item], areaId: 'marketing' })
    expect(r.done).toEqual([item])
    expect(await served(item)).toMatchObject({ n: 2, area: 'marketing' })
    expect(r.change?.summary).toMatch(/^Moved “.*” to Marketing\.$/)
    const same = await plan('admin', { action: 'domain', rows: [item], areaId: 'marketing' })
    expect(same.skipped).toEqual([
      expect.objectContaining({ code: 'same_domain', message: 'It is in Marketing already.' }),
    ])
    expect((await undo('admin', r.undo!)).statusCode).toBe(200)
    expect(await served(item)).toMatchObject({ n: 1, area: 'finance' })
  })

  it('keeps a row a failure left as it was, and says why, beside the rows that went through', async () => {
    // Support has no owner, so a moved item has nobody to answer for it there.
    const [a, b] = [await live(), await live()]
    const r = await bulk('admin', { action: 'domain', rows: [a, b], areaId: 'support' })
    expect(r.done).toEqual([])
    expect(r.failed.map((f) => f.id)).toEqual([a, b])
    expect(r.failed[0]!.message).not.toBe('')
    expect(r).toMatchObject({ change: null, undo: null })
    expect(await served(a)).toMatchObject({ n: 1, area: 'finance' })
  })

  it('changes the kind of an item, which keeps its id and history', async () => {
    const item = await live()
    const r = await bulk('owner', { action: 'kind', rows: [item], kind: 'guide' })
    expect(r.done).toEqual([item])
    expect(await served(item)).toMatchObject({ n: 2, kind: 'guide' })
    expect((await indexRow('owner', item))?.kind).toBe('guide')
    const page = await ok<ItemPage>(call('GET', `/items/${item}/page`, 'owner'))
    expect(page.history[0]).toMatchObject({
      version: 2,
      kind: 'retyped',
      before: 'Rule',
      after: 'Guide',
      restorable: false,
    })
    expect(page.history.at(-1)).toMatchObject({ version: 1, kind: 'published', restorable: true })
    const same = await plan('owner', { action: 'kind', rows: [item], kind: 'guide' })
    expect(same.skipped[0]).toMatchObject({ code: 'same_kind', message: 'It is a Guide already.' })
    expect((await undo('owner', r.undo!)).statusCode).toBe(200)
    expect(await served(item)).toMatchObject({ n: 1, kind: 'note' })
  })

  it('names owners of an item who own its domain, and Undo gives back the owners it had', async () => {
    const item = await live()
    const set = await plan('owner', {
      action: 'owner_set',
      rows: [item],
      personId: people.stranger,
    })
    expect(set.skipped[0]).toMatchObject({
      code: 'not_owner_there',
      why: "stranger doesn't own Finance",
      message: 'Only owners of Finance and admins can own its items.',
    })
    const added = await bulk('owner', { action: 'owner_add', rows: [item], personId: people.admin })
    expect(added.done).toEqual([item])
    expect((await indexRow('author', item))?.owners.sort()).toEqual(
      [people.admin, people.owner].sort(),
    )
    const again = await plan('owner', { action: 'owner_add', rows: [item], personId: people.admin })
    expect(again.skipped[0]).toMatchObject({ code: 'already_owner' })
    const page = await ok<ItemPage>(call('GET', `/items/${item}/page`, 'author'))
    expect(page.history[0]).toMatchObject({ kind: 'owners', version: null })
    expect(page.canChange).toBe(false)
    expect((await undo('owner', added.undo!)).statusCode).toBe(200)
    expect((await indexRow('owner', item))?.owners).toEqual([])
  })

  it('marks as checked only the items the person opened, and records who checked them', async () => {
    const [opened, unopened] = [await live(), await live()]
    expect((await call('POST', `/items/${opened}/read`, 'admin')).statusCode).toBe(200)
    const r = await bulk('admin', { action: 'check', rows: [opened, unopened] })
    expect(r.done).toEqual([opened])
    expect(r.skipped).toEqual([
      expect.objectContaining({
        id: unopened,
        code: 'not_opened',
        message: 'Open it first: checking it means reading it.',
      }),
    ])
    expect(await served(opened)).toMatchObject({ n: 2 })
    expect((await indexRow('owner', opened))?.lastChecked?.personId).toBe(people.admin)
    expect((await call('POST', '/items/itm_nothere001/read', 'admin')).statusCode).toBe(404)
    expect((await undo('admin', r.undo!)).statusCode).toBe(200)
    expect(await served(opened)).toMatchObject({ n: 1 })
  })
})

describe('the History log and the audience rule', () => {
  it('counts an item the reader may not see, never naming it', async () => {
    const [secret, open] = [await live({ title: 'A secret plan' }), await live()]
    const r = await bulk('owner', { action: 'kind', rows: [secret, open], kind: 'guide' })
    expect(r.done).toHaveLength(2)
    const owners = await bulk('owner', {
      action: 'owner_add',
      rows: [secret, open],
      personId: people.admin,
    })
    expect(owners.done).toHaveLength(2)
    // Versions are append-only, so the group goes on with their guards off, once written.
    await transaction(client, async () => {
      await client.query('alter table item_versions disable trigger user')
      await client.query(
        "update item_versions set audience_groups = '{finance_team}' where item_id = $1",
        [secret],
      )
      await client.query('alter table item_versions enable trigger user')
    })
    try {
      const changes = await ok<ItemChange[]>(call('GET', '/context/changes', 'author'))
      const change = changes.find((c) => c.id === r.change!.id)!
      expect(change.items.map((i) => i.id)).toEqual([open])
      expect(change).toMatchObject({ withheld: 1, summary: 'Changed 2 items.' })
      expect(JSON.stringify(changes)).not.toContain('A secret plan')
      const page = await ok<ItemPage>(call('GET', `/items/${open}/page`, 'author'))
      expect(page.history[0]).toMatchObject({
        kind: 'owners',
        after: 'Changed the owners of 2 items.',
      })
      expect(JSON.stringify(page)).not.toContain('A secret plan')
    } finally {
      await transaction(client, async () => {
        await client.query('alter table item_versions disable trigger user')
        await client.query('update item_versions set audience_groups = null where item_id = $1', [
          secret,
        ])
        await client.query('alter table item_versions enable trigger user')
      })
    }
  })
})

describe("a context item's page, history and related context", () => {
  it('reads the item, its row and its history, newest first', async () => {
    const item = await live()
    const page = await ok<ItemPage>(call('GET', `/items/${item}/page`, 'owner'))
    expect(page.item).toMatchObject({ id: item, kind: 'note', status: 'accepted' })
    expect(page).toMatchObject({ trust: 'current', owners: [], canChange: true })
    expect(page.chips).toContain('Orders')
    expect(page.lastChecked?.personId).toBe(people.owner)
    expect(page.history).toEqual([
      expect.objectContaining({ version: 1, kind: 'published', personId: people.owner }),
    ])
    expect((await call('GET', '/items/itm_nothere001/page', 'owner')).statusCode).toBe(404)
  })

  it('restores an earlier version as a draft, for an owner, and changes nothing agents get', async () => {
    const item = await live({ title: 'Webshop orders include store credit' })
    const edited = await ok<PublishItemResult>(
      call('POST', '/items/publish', 'owner', {
        itemId: item,
        draft: { title: 'Webshop orders include store credit and gift cards' },
      }),
    )
    expect(edited.published).toBe(true)
    const page = await ok<ItemPage>(call('GET', `/items/${item}/page`, 'owner'))
    expect(page.history[0]).toMatchObject({
      version: 2,
      kind: 'wording',
      field: 'Title',
      before: 'Webshop orders include store credit',
      after: 'Webshop orders include store credit and gift cards',
    })
    const forbidden = await call('POST', `/items/${item}/restore-draft`, 'author', { version: 1 })
    expect(forbidden.statusCode).toBe(403)
    const now = await call('POST', `/items/${item}/restore-draft`, 'owner', { version: 2 })
    expect(now.statusCode).toBe(409)
    const r = await ok<{ proposalId: string }>(
      call('POST', `/items/${item}/restore-draft`, 'owner', { version: 1 }),
    )
    const p = await ok<ProposalRecord>(call('GET', `/proposals/${r.proposalId}`, 'owner'))
    expect(p).toMatchObject({ state: 'draft', action: 'change', itemId: item })
    expect(p.draft.title).toBe('Webshop orders include store credit')
    expect((await served(item))?.n).toBe(2)
  })

  it('follows what an item applies to, one step, as get_related does', async () => {
    const item = await live()
    const related = await ok<RelatedContext>(call('GET', `/items/${item}/related`, 'author'))
    expect(related.nodes).toContainEqual(
      expect.objectContaining({ type: 'metric', id: 'metric:orders', label: 'Orders' }),
    )
    expect((await call('GET', '/items/itm_nothere001/related', 'author')).statusCode).toBe(404)
  })
})

describe('a draft from pasted text', () => {
  it('reads the words, the kind and the dates by rule, and names what it guessed', async () => {
    const r = await ok<DraftFromText>(
      call('POST', '/drafts/from-text', 'author', {
        text: 'Orders in Norway paused from 3 October 2026 while the payment provider moved.',
      }),
    )
    expect(r.draft.summary).toBe(
      'Orders in Norway paused from 3 October 2026 while the payment provider moved.',
    )
    expect(r.draft.validity?.start).toBe('2026-10-03')
    expect(r.draft.scope?.metrics).toContain('metric:orders')
    expect(r.unsure).toContain('kind')
    expect((await call('POST', '/drafts/from-text', 'author', { text: '   ' })).statusCode).toBe(
      422,
    )
  })
})

describe('row security of what Context keeps', () => {
  async function as<T>(who: Who, work: () => Promise<T>): Promise<T> {
    await client.query('begin')
    try {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id', $1, true)", [people[who]])
      return await work()
    } finally {
      await client.query('rollback')
    }
  }
  const q = (sql: string, values: unknown[] = []) => client.query(sql, values)
  let item = ''
  beforeAll(async () => {
    item = await live()
  })

  it("names an item's owners only as an owner of its domain, and only people who own it", async () => {
    await as('author', async () => {
      await expect(
        q('insert into item_owners (item_id,person_id,added_by) values ($1,$2,$2)', [
          item,
          people.author,
        ]),
      ).rejects.toThrow(/row-level security/)
    })
    await as('owner', async () => {
      await expect(
        q('insert into item_owners (item_id,person_id,added_by) values ($1,$2,$3)', [
          item,
          people.stranger,
          people.owner,
        ]),
      ).rejects.toThrow(/row-level security/)
    })
    await as('owner', () =>
      q('insert into item_owners (item_id,person_id,added_by) values ($1,$2,$2)', [
        item,
        people.owner,
      ]),
    )
  })

  it('keeps which items a person opened to that person', async () => {
    await as('owner', async () => {
      await q('insert into item_reads (person_id,item_id) values ($1,$2)', [people.owner, item])
      await expect(
        q('insert into item_reads (person_id,item_id) values ($1,$2)', [people.author, item]),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('lets only the maker undo a change, and only a deleter bring back a draft', async () => {
    const r = await bulk('owner', { action: 'archive', rows: [await live()] })
    const changeId = r.change!.id
    await as('admin', async () => {
      const updated = await q('update item_changes set undone_at=now() where id=$1', [changeId])
      expect(updated.rowCount).toBe(0)
    })
    const deleted = await bulk('owner', { action: 'delete', rows: [await aDraft()] })
    const draftId = deleted.done[0]!
    await as('admin', async () => {
      await expect(
        q('update proposals set discarded_at=null where id=$1', [draftId]),
      ).rejects.toThrow(/was discarded/)
    })
  })

  it('reads a deletion only as its maker or an admin; other changes, everyone', async () => {
    await as('author', async () => {
      const rows = await q("select action from item_changes where action='deleted'")
      expect(rows.rowCount).toBe(0)
      const others = await q("select action from item_changes where action='archived'")
      expect(others.rowCount).toBeGreaterThan(0)
    })
  })
})
