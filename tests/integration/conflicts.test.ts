import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConflictList, ConflictView, SettledConflict } from '../../src/contract/conflicts.ts'
import type { ItemPage, PublishItemResult } from '../../src/contract/context.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Conflicts over authenticated HTTP (FR-220, the conflict view): the pairs an owner said disagree,
  one pair side by side with what agents would say, and settling it with a reason. Each way of
  settling is checked against the item it changes, a newer version of either holds the decision,
  Undo takes back exactly what it did, and a decision keeps its row security. `owner` owns Finance,
  `stranger` owns Marketing, `admin` is an administrator and `author` a member.
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

/** A market of its own for each pair, so no pair overlaps another. */
const markets = Array.from({ length: 20 }, (_, i) => `c${String(i).padStart(2, '0')}`)
let nextMarket = 0

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
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

function draft(market: string, extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    kind: 'note',
    title: `Orders in ${market} count store credit`,
    summary: `Orders in ${market} include orders paid with store credit and gift cards.`,
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: `val:market/${market}` }],
    },
    validity: { start: '2026-01-01', end: null },
    evidence: [
      { url: 'https://wiki.example/orders', quote: 'Store credit counts', date: '2026-10-01' },
    ],
    ...extra,
  }
}

async function live(d: Draft, who: Who = 'owner') {
  const r = await ok<PublishItemResult>(call('POST', '/items/publish', who, { draft: d }))
  if (!r.published) throw new Error('not published')
  return r.itemId
}

/** Two items of one market, the second saying it disagrees with the first. `otherArea` moves the second. */
async function pair(otherArea: 'finance' | 'marketing' = 'finance') {
  const market = markets[nextMarket++]!
  const first = await live(draft(market))
  const second = await live(
    draft(market, {
      areaId: otherArea,
      title: `Orders in ${market} are card and cash payments only`,
      summary: `Orders in ${market} count only card and cash payments. Store credit is left out.`,
      conflicts: [first],
    }),
    otherArea === 'finance' ? 'owner' : 'stranger',
  )
  return { first, second }
}

const view = (who: Who, holder: string, other: string) =>
  ok<ConflictView>(call('GET', `/conflicts/${holder}/${other}`, who))
const settle = (who: Who, input: object) => call('POST', '/conflicts/settle', who, input)
const status = async (id: string) =>
  (
    await client.query<{ status: string }>('select status::text from v_item_list where id = $1', [
      id,
    ])
  ).rows[0]?.status

describe('reading a conflict', () => {
  it('lists the pair, reads both sides, and says what agents would say with each alone', async () => {
    const { first, second } = await pair()
    const list = await ok<ConflictList>(call('GET', '/conflicts?whose=all', 'owner'))
    const row = list.rows.find((r) => r.key === `${second}.${first}`)
    expect(row).toMatchObject({ canSettle: true, mine: true })
    const v = await view('owner', second, first)
    expect(v.holder).toMatchObject({ id: second, readable: true, version: 1 })
    expect(v.other.title).toMatch(/count store credit/)
    expect(v.said?.now.state).toBe('conflict')
    expect(v.said?.onlyHolder.state).toBe('grounded')
    expect(v.said?.onlyHolder.items.map((i) => i.id)).toEqual([second])
    expect(v.said?.onlyOther.items.map((i) => i.id)).toEqual([first])
    // With the flag removed agents get both, and nothing says they disagree.
    expect(v.said?.withoutFlag.state).toBe('grounded')
    expect(v.said?.withoutFlag.items).toHaveLength(2)
    // Either order of the address reads the same pair, holder first.
    expect((await view('owner', first, second)).holder.id).toBe(second)
    // The item page names the other item, from both sides.
    expect((await ok<ItemPage>(call('GET', `/items/${first}/page`, 'owner'))).conflicts).toEqual([
      second,
    ])
    expect((await ok<ItemPage>(call('GET', `/items/${second}/page`, 'owner'))).conflicts).toEqual([
      first,
    ])
  })

  it('shows a member the pair, with nothing they may settle', async () => {
    const { first, second } = await pair()
    const v = await view('author', second, first)
    expect(Object.values(v.rights).some(Boolean)).toBe(false)
    const refused = await settle('author', {
      holderId: second,
      otherId: first,
      outcome: 'kept_both',
      reason: 'Both hold.',
      versions: { holder: 1, other: 1 },
    })
    expect(refused.statusCode).toBe(403)
  })
})

describe('settling a conflict', () => {
  it('keeps one: archives the other, tells its owners, and Undo puts both back', async () => {
    const { first, second } = await pair('marketing')
    // The Finance owner may archive the Finance item, so keeping the Marketing one is theirs.
    const forbidden = await settle('owner', {
      holderId: second,
      otherId: first,
      outcome: 'kept_one',
      keepId: first,
      reason: 'The finance memo replaced it.',
      versions: { holder: 1, other: 1 },
    })
    expect(forbidden.statusCode).toBe(403)
    const r = await ok<SettledConflict>(
      settle('owner', {
        holderId: second,
        otherId: first,
        outcome: 'kept_one',
        keepId: second,
        reason: 'The finance memo of 2 Oct replaced the old definition.',
        quote: 'Order value is taken from card and cash settlements.',
        versions: { holder: 1, other: 1 },
      }),
    )
    expect(r.decision).toMatchObject({ outcome: 'kept_one', keptId: second })
    expect(await status(first)).toBe('retired')
    // Its history keeps the reason; the Marketing owner is mentioned on the item that stays.
    const page = await ok<ItemPage>(call('GET', `/items/${second}/page`, 'stranger'))
    expect(
      page.history.some((h) => h.kind === 'conflict' && h.after.includes('finance memo')),
    ).toBe(true)
    const mentions = await client.query<{ n: number }>(
      `select count(*)::int as n from comment_mentions m join comments c on c.id = m.comment_id
        where m.person_id = $1 and c.item_id = $2`,
      [people.stranger, second],
    )
    expect(mentions.rows[0]!.n).toBe(1)
    expect((await call('POST', '/decisions/undo', 'owner', { token: r.undo })).statusCode).toBe(200)
    expect(await status(first)).toBe('accepted')
    expect((await view('owner', second, first)).said?.now.state).toBe('conflict')
  })

  it('not a conflict: removes the flag from the item that holds it, and Undo brings it back', async () => {
    const { first, second } = await pair()
    const r = await ok<SettledConflict>(
      settle('owner', {
        holderId: second,
        otherId: first,
        outcome: 'not_conflict',
        reason: 'They apply to different weeks.',
        versions: { holder: 1, other: 1 },
      }),
    )
    expect((await call('GET', `/conflicts/${second}/${first}`, 'owner')).statusCode).toBe(404)
    expect((await ok<ItemPage>(call('GET', `/items/${second}/page`, 'owner'))).conflicts).toEqual(
      [],
    )
    expect((await call('POST', '/decisions/undo', 'owner', { token: r.undo })).statusCode).toBe(200)
    expect((await view('owner', second, first)).holder.version).toBe(1)
  })

  it('keeps both: agents keep saying Conflict, and the pair is off the list until either changes', async () => {
    const { first, second } = await pair()
    await ok<SettledConflict>(
      settle('owner', {
        holderId: second,
        otherId: first,
        outcome: 'kept_both',
        reason: 'Both hold until Finance rules on it.',
        versions: { holder: 1, other: 1 },
      }),
    )
    const v = await view('owner', second, first)
    expect(v.said?.now.state).toBe('conflict')
    expect(v.keptBoth?.reason).toBe('Both hold until Finance rules on it.')
    const listed = async () =>
      (await ok<ConflictList>(call('GET', '/conflicts?whose=all', 'owner'))).rows.some(
        (r) => r.key === `${second}.${first}`,
      )
    expect(await listed()).toBe(false)
    // The alert job sees the pair as kept, with the versions the decision saw.
    const kept = await database.transaction(null, (tx) =>
      tx.query<{ holder_item_id: string }>('select holder_item_id from cl_conflicts_kept()'),
    )
    expect(kept.map((k) => k.holder_item_id)).toContain(second)
    // A new version of either brings it back (the holder's, which needs no answer about the other).
    await ok<PublishItemResult>(
      call('POST', '/items/publish', 'owner', {
        itemId: second,
        draft: { title: `Changed ${second}` },
      }),
    )
    expect(await listed()).toBe(true)
  })

  it('holds a decision when either item changed since it was read', async () => {
    const { first, second } = await pair()
    const stale = await settle('owner', {
      holderId: second,
      otherId: first,
      outcome: 'kept_both',
      reason: 'Both hold.',
      versions: { holder: 1, other: 0 },
    })
    expect(stale.statusCode).toBe(409)
  })

  it('needs a reason in plain words', async () => {
    const { first, second } = await pair()
    const base = {
      holderId: second,
      otherId: first,
      outcome: 'kept_both',
      versions: { holder: 1, other: 1 },
    }
    expect((await settle('owner', { ...base, reason: '' })).statusCode).toBe(400)
    expect(
      (await settle('owner', { ...base, reason: 'Write to jon@larchwood.example first.' }))
        .statusCode,
    ).toBe(422)
  })
})

describe('row security', () => {
  it('lets a person record only their own decision, and only they mark it undone', async () => {
    const { first, second } = await pair()
    const forged = await database
      .transaction(people.author, (tx) =>
        tx.query(
          `insert into conflict_decisions (holder_item_id, other_item_id, outcome, reason, holder_version, other_version, decided_by)
           values ($1, $2, 'kept_both', 'x', 1, 1, $3)`,
          [second, first, people.owner],
        ),
      )
      .catch((error: unknown) => error as { code?: string })
    expect(forged).toMatchObject({ code: '42501' })
    const r = await ok<SettledConflict>(
      settle('owner', {
        holderId: second,
        otherId: first,
        outcome: 'kept_both',
        reason: 'Both hold.',
        versions: { holder: 1, other: 1 },
      }),
    )
    const id = r.undo.slice('conflict:'.length)
    const changed = await database.transaction(people.stranger, (tx) =>
      tx.query('update conflict_decisions set undone_at = now() where id = $1 returning id', [id]),
    )
    expect(changed).toEqual([])
    const refused = await call('POST', '/decisions/undo', 'stranger', { token: r.undo })
    expect(refused.statusCode).toBe(403)
  })

  it('grants nothing to the serving or the analytics role', async () => {
    const rows = await client.query<{ serve: boolean; readonly: boolean }>(
      `select has_table_privilege('context_layer_serve', 'conflict_decisions', 'select') as serve,
              has_table_privilege('context_layer_readonly', 'conflict_decisions', 'select') as readonly`,
    )
    expect(rows.rows[0]).toEqual({ serve: false, readonly: false })
  })
})
