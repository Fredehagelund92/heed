import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  DeletedTerm,
  Term,
  TermChangeResult,
  TermList,
  TermRestoreResult,
  TermVersion,
} from '../../src/contract/terms.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Terms and synonyms over authenticated HTTP (FR-138, golden plan P7b): writing a term with its own
  meaning or another name for a metric, a dimension or a term; one word, one meaning across the
  vocabulary, the definitions source and the terms, refused with who has it; who may write; edits,
  moves and deletes with their Undo; the deleted list and restoring; each term's history; coverage;
  and the database's own checks and row security on what is kept. `owner` owns Finance, `stranger`
  owns Marketing, `admin` is an administrator and `author` a member.
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
type Reply = { statusCode: number; body: string; json: <U>() => U }
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  }) as Promise<Reply>
const ok = async <T>(response: Promise<Reply>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}
const refused = async (response: Promise<Reply>, status: number) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<{ message: string; data?: { refusal?: object } }>()
}

const markets = Array.from({ length: 12 }, (_, i) => `m${String(i).padStart(2, '0')}`)
let words = 0
/** A word nothing has yet. */
const fresh = (stem = 'Word') => `${stem} ${String.fromCharCode(97 + (words % 26))}${++words}`

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
    await client.query(
      `insert into vocab_terms(key,kind,parent_key) values
         ('metric:revenue','metric',null),('metric:spend','metric',null),('metric:hidden','metric',null),
         ('metric:gone','metric',null)`,
    )
    await client.query(
      `insert into vocab_terms(key,kind,parent_key) select 'val:market/'||m,'dimension_value','dim:market'
         from unnest($1::text[]) m`,
      [markets],
    )
    await client.query(
      `insert into connectors (id,kind,type,name) values ('cube','definition_source','cube','Cube')`,
    )
    await client.query(
      `insert into definitions (ref,connector_id,kind,name,title,synonyms,change_mark,visible_groups) values
         ('cube:revenue','cube','metric','payments.net_revenue','Net revenue','{Net sales}','1',null),
         ('cube:hidden','cube','metric','board.hidden','Hidden metric','{}','1','{board}')`,
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    const terms: [string, string, string | null, string[], string[]][] = [
      ['metric:orders', 'Orders', 'finance', ['Order count'], ['demo:orders']],
      ['metric:revenue', 'Net revenue', 'finance', [], ['cube:revenue']],
      ['metric:spend', 'Marketing spend', 'marketing', [], []],
      ['metric:hidden', 'Hidden metric', 'finance', [], ['cube:hidden']],
      ['metric:gone', 'Old metric', 'finance', [], []],
      ['dim:market', 'Market', null, [], []],
      ['val:market/norway', 'Norway', null, [], []],
      ...markets.map((m): [string, string, null, string[], string[]] => [
        `val:market/${m}`,
        `Market ${m}`,
        null,
        [],
        [],
      ]),
    ]
    for (const [key, name, area, aliases, refs] of terms) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,aliases,area_id,content_digest)
         values($1,1,$2,$3,$4,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, aliases, area],
      )
      for (const ref of refs)
        await client.query(
          'insert into vocab_term_refs (version_id,definition_ref) values ($1,$2)',
          [term.rows[0]!.id, ref],
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

const create = (who: Who, input: object) => call('POST', '/terms', who, input)
const term = async (who: Who, input: object) => ok<Term>(create(who, input))
const own = (name = fresh(), extra: object = {}) =>
  term('owner', { name, meaning: `What ${name} means here.`, areaId: 'finance', ...extra })
const list = async (who: Who = 'owner') => (await ok<TermList>(call('GET', '/terms', who))).terms
const listed = async (id: string, who: Who = 'owner') => (await list(who)).find((t) => t.id === id)
const update = (who: Who, t: Term, change: object) =>
  call('PUT', `/terms/${t.id}`, who, {
    revision: t.revision,
    name: t.name,
    ...(t.sameAs ? { sameAs: t.sameAs.ref } : { meaning: t.meaning }),
    areaId: t.areaId,
    ...change,
  })
const remove = (who: Who, ids: string[]) =>
  ok<TermChangeResult>(call('POST', '/terms/delete', who, { ids }))
const undo = (who: Who, token: string) => call('POST', '/decisions/undo', who, { token })

describe('writing a term (FR-138)', () => {
  it('keeps a word with its own meaning in its domain, with who wrote it', async () => {
    const t = await term('owner', {
      name: '  Peak   season ',
      meaning: '15 November to 31 December.',
      areaId: 'finance',
    })
    expect(t).toMatchObject({
      name: 'Peak season',
      meaning: '15 November to 31 December.',
      sameAs: null,
      areaId: 'finance',
      createdBy: people.owner,
      revision: 1,
      items: 0,
      conflict: null,
      canChange: true,
    })
    // Everyone signed in reads it; only its domain's owners and admins may change it.
    expect(await listed(t.id, 'author')).toMatchObject({ name: 'Peak season', canChange: false })
    expect(await listed(t.id, 'admin')).toMatchObject({ canChange: true })
  })

  it('writes another name for a metric, a dimension or a term, in the domain of what it means', async () => {
    const gmv = await term('owner', {
      name: fresh('GMV'),
      sameAs: 'metric:revenue',
      areaId: 'marketing',
    })
    expect(gmv).toMatchObject({
      meaning: null,
      sameAs: { ref: 'metric:revenue', name: 'Net revenue', type: 'metric' },
      areaId: 'finance',
      items: null,
    })
    const webshop = await own(fresh('Webshop'))
    const store = await term('owner', { name: fresh('Online store'), sameAs: `term:${webshop.id}` })
    expect(store.sameAs).toEqual({ ref: `term:${webshop.id}`, name: webshop.name, type: 'term' })
    // A synonym of a synonym means what that one means.
    const shop = await term('owner', { name: fresh('Shop'), sameAs: `term:${store.id}` })
    expect(shop.sameAs?.ref).toBe(`term:${webshop.id}`)
    // Market belongs to no domain: only an admin names it.
    const country = await term('admin', { name: fresh('Country'), sameAs: 'dim:market' })
    expect(country).toMatchObject({ areaId: null, sameAs: { type: 'dimension' } })
    await refused(create('owner', { name: fresh('Land'), sameAs: 'dim:market' }), 403)
  })

  it('takes its own meaning or what it is another name for, not both or neither', async () => {
    await refused(
      create('owner', { name: fresh(), meaning: 'x', sameAs: 'metric:orders', areaId: 'finance' }),
      400,
    )
    await refused(create('owner', { name: fresh(), areaId: 'finance' }), 400)
    await refused(create('owner', { name: 'Two, words', meaning: 'x', areaId: 'finance' }), 400)
    // What it names must be there: a value is not a definition, and an unknown key is nothing.
    await refused(create('owner', { name: fresh(), sameAs: 'metric:nothere' }), 404)
    await refused(create('owner', { name: fresh(), sameAs: `term:${randomUUID()}` }), 404)
  })

  it("is an owner's of the domain or an admin's", async () => {
    await refused(create('author', { name: fresh(), meaning: 'x', areaId: 'finance' }), 403)
    const r = await refused(
      create('stranger', { name: fresh(), meaning: 'x', areaId: 'finance' }),
      403,
    )
    expect(r.message).toBe('Only an owner of Finance or an admin can change its terms.')
    // A word with no domain is an admin's.
    await refused(create('owner', { name: fresh(), meaning: 'x' }), 403)
    expect(await term('admin', { name: fresh(), meaning: 'x' })).toMatchObject({ areaId: null })
    // A synonym of a Marketing metric is Marketing's.
    await refused(create('owner', { name: fresh(), sameAs: 'metric:spend' }), 403)
    expect(await term('stranger', { name: fresh(), sameAs: 'metric:spend' })).toMatchObject({
      areaId: 'marketing',
    })
  })
})

describe('one word, one meaning (FR-138)', () => {
  const refusal = async (who: Who, input: object) => {
    const r = await refused(create(who, input), 409)
    return { message: r.message, ...r.data?.refusal }
  }

  it('refuses a word the vocabulary or the definitions source uses, saying for what', async () => {
    // The metric's own name, another name of it, and the source's title and synonym for it.
    expect(await refusal('owner', { name: 'orders', meaning: 'x', areaId: 'finance' })).toEqual({
      code: 'source',
      message: "“orders” is Demo's name for Orders.",
      holder: 'Orders',
      by: 'Demo',
    })
    expect(
      await refusal('owner', { name: 'Order  Count', meaning: 'x', areaId: 'finance' }),
    ).toEqual({
      code: 'source',
      message: '“Order Count” is already a name for Orders.',
      holder: 'Orders',
      by: null,
    })
    expect(await refusal('owner', { name: 'Net sales', sameAs: 'metric:orders' })).toEqual({
      code: 'source',
      message: "“Net sales” is Cube's name for Net revenue.",
      holder: 'Net revenue',
      by: 'Cube',
    })
    expect(await refusal('admin', { name: 'market', meaning: 'x' })).toMatchObject({
      code: 'source',
      holder: 'Market',
    })
  })

  it('refuses a word the metric already has, and a synonym it already has, as said already', async () => {
    expect(await refusal('owner', { name: 'net sales', sameAs: 'metric:revenue' })).toEqual({
      code: 'here',
      message: 'Net revenue is already called “net sales”.',
      holder: 'Net revenue',
      by: 'Cube',
    })
    const word = fresh('Turnover')
    await term('owner', { name: word, sameAs: 'metric:revenue' })
    expect(await refusal('owner', { name: word.toUpperCase(), sameAs: 'metric:revenue' })).toEqual({
      code: 'here',
      message: `Net revenue is already called “${word.toUpperCase()}”.`,
      holder: 'Net revenue',
      by: 'owner',
    })
  })

  it('refuses a word another term has, naming who wrote it', async () => {
    const synonym = await term('owner', { name: fresh('Basket'), sameAs: 'metric:orders' })
    expect(await refusal('stranger', { name: synonym.name, sameAs: 'metric:spend' })).toEqual({
      code: 'taken',
      message: `“${synonym.name}” is already another name for Orders, added by owner.`,
      holder: 'Orders',
      by: 'owner',
    })
    const own = await term('stranger', {
      name: fresh('Promotion'),
      meaning: 'x',
      areaId: 'marketing',
    })
    expect(
      await refusal('owner', {
        name: ` ${own.name.toLowerCase()} `,
        meaning: 'y',
        areaId: 'finance',
      }),
    ).toEqual({
      code: 'term',
      message: `“${own.name}” is a term with its own meaning, written by stranger.`,
      holder: own.name,
      by: 'stranger',
    })
  })

  it('frees a word once its term is deleted', async () => {
    const t = await own()
    await remove('owner', [t.id])
    expect(await own(t.name)).toMatchObject({ name: t.name })
  })
})

describe('changing a term', () => {
  it('renames it, refusing a word that means something else, and keeps the revision it read', async () => {
    const t = await own()
    const renamed = await ok<Term>(update('owner', t, { name: fresh('Renamed') }))
    expect(renamed).toMatchObject({ revision: 2, updatedBy: people.owner })
    expect((await refused(update('owner', t, { meaning: 'Old read.' }), 409)).message).toBe(
      'Someone changed this word after you opened it. Look at it again, then try again.',
    )
    const r = await refused(update('owner', renamed, { name: 'Orders' }), 409)
    expect(r.data?.refusal).toEqual({ code: 'source', holder: 'Orders', by: 'Demo' })
    // A new casing is the same word.
    expect(
      await ok<Term>(update('owner', renamed, { name: renamed.name.toUpperCase() })),
    ).toMatchObject({
      name: renamed.name.toUpperCase(),
    })
  })

  it('is changed by an owner of its domain or an admin, and moved only to a domain they own', async () => {
    const t = await own()
    await refused(update('author', t, { meaning: 'Mine now.' }), 403)
    await refused(update('stranger', t, { meaning: 'Mine now.' }), 403)
    await refused(update('owner', t, { areaId: 'marketing' }), 403)
    expect(await ok<Term>(update('admin', t, { areaId: 'marketing' }))).toMatchObject({
      areaId: 'marketing',
    })
  })

  it('keeps its domain when an update leaves the domain out, and clears it only when told to', async () => {
    const t = await own()
    const kept = await ok<Term>(update('owner', t, { areaId: undefined, meaning: 'Said again.' }))
    expect(kept).toMatchObject({ areaId: 'finance', meaning: 'Said again.' })
    expect(await ok<Term>(update('admin', kept, { areaId: null }))).toMatchObject({ areaId: null })
  })

  it('keeps the meaning of a term other words point at, and never points a word at itself', async () => {
    const t = await own()
    await term('owner', { name: fresh(), sameAs: `term:${t.id}` })
    const r = await refused(
      update('owner', t, { meaning: undefined, sameAs: 'metric:orders' }),
      409,
    )
    expect(r.message).toBe(
      `Other words are another name for “${t.name}”, so it keeps its own meaning. Point them at something else first.`,
    )
    await refused(update('owner', t, { meaning: undefined, sameAs: `term:${t.id}` }), 400)
  })

  it('shows a conflict a sync makes later, and still saves what it means until its owner settles it', async () => {
    const t = await own(fresh('Gross takings'))
    expect(t.conflict).toBeNull()
    await client.query(
      "update definitions set synonyms = synonyms || $1::text where ref = 'cube:revenue'",
      [t.name],
    )
    try {
      const now = (await listed(t.id))!
      expect(now.conflict).toEqual({
        code: 'source',
        holder: 'Net revenue',
        message: `“${t.name}” already means Net revenue in Cube. An agent can't tell which one a person means. Rename this term or point it at Net revenue.`,
      })
      expect(await ok<Term>(update('owner', now, { meaning: 'Still ours.' }))).toMatchObject({
        meaning: 'Still ours.',
      })
      // Its word still claims another meaning: a new word settles it.
      const settled = await ok<Term>(
        update('owner', (await listed(t.id))!, { name: fresh('Gross takings') }),
      )
      expect(settled.conflict).toBeNull()
    } finally {
      await client.query(
        "update definitions set synonyms = array_remove(synonyms, $1) where ref = 'cube:revenue'",
        [t.name],
      )
    }
  })
})

describe('deleting, moving and Undo', () => {
  it('deletes a term with the synonyms that point at it, skips what it may not, and Undo brings them back', async () => {
    const t = await own()
    const s = await term('owner', { name: fresh(), sameAs: `term:${t.id}` })
    const theirs = await term('stranger', { name: fresh(), meaning: 'x', areaId: 'marketing' })
    const missing = randomUUID()
    const r = await remove('owner', [t.id, theirs.id, missing])
    expect(r.done).toEqual([
      { id: t.id, name: t.name },
      { id: s.id, name: s.name },
    ])
    expect(r.skipped).toEqual([
      {
        id: theirs.id,
        name: theirs.name,
        message: 'Only an owner of Marketing or an admin can change its terms.',
      },
      { id: missing, name: '', message: "It isn't in Definitions any more." },
    ])
    expect(await listed(t.id)).toBeUndefined()
    expect(await listed(s.id)).toBeUndefined()
    // Only its maker undoes it, once; nobody else even reads it, but an admin.
    expect((await undo('stranger', r.undo!)).statusCode).toBe(404)
    expect((await undo('admin', r.undo!)).statusCode).toBe(403)
    expect((await undo('owner', r.undo!)).statusCode).toBe(200)
    expect((await undo('owner', r.undo!)).statusCode).toBe(409)
    expect(await listed(t.id)).toMatchObject({ name: t.name })
    expect(await listed(s.id)).toMatchObject({ sameAs: { ref: `term:${t.id}` } })
  })

  it('is too late to undo after the window', async () => {
    const t = await own()
    const r = await remove('owner', [t.id])
    await client.query(
      "update term_changes set made_at = now() - interval '1 hour' where id = $1::uuid",
      [r.undo!.slice('terms:'.length)],
    )
    const late = await undo('owner', r.undo!)
    expect(late.statusCode).toBe(409)
    expect(late.json<{ message: string }>().message).toBe(
      'It is too late to undo this change. Change them again instead.',
    )
  })

  it('moves terms with their synonyms, leaves a synonym to what it means, and Undo puts them back', async () => {
    const t = await term('admin', { name: fresh(), meaning: 'x', areaId: 'finance' })
    const s = await term('admin', { name: fresh(), sameAs: `term:${t.id}` })
    const moved = await ok<TermChangeResult>(
      call('POST', '/terms/move', 'admin', { ids: [t.id, s.id], areaId: 'marketing' }),
    )
    expect(moved.done).toEqual([{ id: t.id, name: t.name }])
    expect(moved.skipped).toEqual([
      {
        id: s.id,
        name: s.name,
        message: `A synonym is in the domain of what it means: move ${t.name} instead.`,
      },
    ])
    expect(await listed(s.id)).toMatchObject({ areaId: 'marketing' })
    // Finance's owner may not move a term to Marketing.
    const back = await ok<TermChangeResult>(
      call('POST', '/terms/move', 'owner', { ids: [t.id], areaId: 'finance' }),
    )
    expect(back.done).toEqual([])
    expect((await undo('admin', moved.undo!)).statusCode).toBe(200)
    expect(await listed(t.id)).toMatchObject({ areaId: 'finance' })
    expect(await listed(s.id)).toMatchObject({ areaId: 'finance' })
  })
})

describe('the deleted list and restoring', () => {
  it('lists a deleted term with the synonyms that went with it, for its owners and admins', async () => {
    const t = await own()
    const s = await term('owner', { name: fresh(), sameAs: `term:${t.id}` })
    await remove('owner', [t.id])
    const entry: DeletedTerm = {
      id: t.id,
      name: t.name,
      sameAs: null,
      areaId: 'finance',
      personId: people.owner,
      at: expect.any(String) as string,
      synonyms: [s.name],
    }
    expect(await ok<DeletedTerm[]>(call('GET', '/terms/deleted', 'admin'))).toContainEqual(entry)
    expect(await ok<DeletedTerm[]>(call('GET', '/terms/deleted', 'owner'))).toContainEqual(entry)
    const seen = await ok<DeletedTerm[]>(call('GET', '/terms/deleted', 'author'))
    expect(seen.map((d) => d.id)).not.toContain(t.id)
  })

  it('restores a term and its synonyms, leaving one whose word means something else by now', async () => {
    const t = await own()
    const s = await term('owner', { name: fresh(), sameAs: `term:${t.id}` })
    const kept = await term('owner', { name: fresh(), sameAs: `term:${t.id}` })
    await remove('owner', [t.id])
    // Meanwhile someone gives one of its synonyms' words a meaning of its own.
    const taker = await own(s.name)
    const r = await ok<TermRestoreResult>(call('POST', '/terms/restore', 'owner', { ids: [t.id] }))
    expect(r.restored).toEqual([
      { id: t.id, name: t.name },
      { id: kept.id, name: kept.name },
    ])
    expect(r.skipped).toEqual([
      {
        id: s.id,
        name: s.name,
        message: `“${taker.name}” is a term with its own meaning, written by owner.`,
      },
    ])
    expect(await listed(t.id)).toMatchObject({ name: t.name })
  })

  it('restores only what is deleted, for an owner of its domain or an admin', async () => {
    const t = await own()
    const r = await ok<TermRestoreResult>(call('POST', '/terms/restore', 'owner', { ids: [t.id] }))
    expect(r).toEqual({
      restored: [],
      skipped: [{ id: t.id, name: t.name, message: 'It is in Definitions already.' }],
    })
    await remove('owner', [t.id])
    const author = await ok<TermRestoreResult>(
      call('POST', '/terms/restore', 'author', { ids: [t.id] }),
    )
    expect(author.restored).toEqual([])
    expect(
      (await ok<TermRestoreResult>(call('POST', '/terms/restore', 'admin', { ids: [t.id] })))
        .restored,
    ).toEqual([{ id: t.id, name: t.name }])
  })
})

describe("a term's history", () => {
  it('keeps every write, newest first, with who made it', async () => {
    const t = await own()
    const edited = await ok<Term>(update('owner', t, { meaning: 'Edited.' }))
    const moved = await ok<Term>(update('admin', edited, { areaId: 'marketing' }))
    await remove('admin', [moved.id])
    await ok<TermRestoreResult>(call('POST', '/terms/restore', 'admin', { ids: [t.id] }))
    const history = await ok<TermVersion[]>(call('GET', `/terms/${t.id}/history`, 'author'))
    expect(history.map((v) => [v.revision, v.change, v.personId])).toEqual([
      [5, 'restored', people.admin],
      [4, 'deleted', people.admin],
      [3, 'moved', people.admin],
      [2, 'edited', people.owner],
      [1, 'created', people.owner],
    ])
    expect(history[3]).toMatchObject({ meaning: 'Edited.', areaId: 'finance' })
    expect((await call('GET', `/terms/${randomUUID()}/history`, 'owner')).statusCode).toBe(404)
  })
})

describe('what the database keeps', () => {
  /** A statement as the service's role, for a person: row security applies. */
  async function as<T extends object>(who: Who, statement: string, values: unknown[] = []) {
    return transaction(client, async () => {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id', $1, true)", [people[who]])
      return (await client.query<T>(statement, values)).rows
    })
  }
  type Fields = { meaning?: string; key?: string; term?: string; area?: string | null }
  const insert = (who: Who, name: string, f: Fields = { meaning: 'x', area: 'finance' }) =>
    as<{ id: string; area_id: string | null }>(
      who,
      `insert into terms (name, meaning, same_as_key, same_as_term, area_id, created_by, updated_by)
       values ($1, $2, $3, $4::uuid, $5, $6::uuid, $6::uuid) returning id::text, area_id`,
      [name, f.meaning ?? null, f.key ?? null, f.term ?? null, f.area ?? null, people[who]],
    )

  it('keeps one word once, never a word of the vocabulary or the source, whoever writes it', async () => {
    const t = await own()
    await expect(insert('owner', ` ${t.name.toUpperCase()} `)).rejects.toMatchObject({
      code: '23505',
    })
    await expect(insert('owner', 'Order count')).rejects.toMatchObject({ code: '23505' })
    await expect(insert('owner', 'net sales')).rejects.toMatchObject({ code: '23505' })
    await expect(
      insert('owner', fresh(), { meaning: 'x', key: 'metric:orders', area: 'finance' }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('points a synonym only at a live metric or dimension, or a term with its own meaning', async () => {
    const t = await own()
    const s = await term('owner', { name: fresh(), sameAs: `term:${t.id}` })
    await expect(
      insert('owner', fresh(), { key: 'val:market/norway', area: 'finance' }),
    ).rejects.toMatchObject({ code: '23503' })
    await expect(insert('owner', fresh(), { term: s.id, area: 'finance' })).rejects.toMatchObject({
      code: '23514',
    })
    // Deleting a term its synonyms still point at is refused: they go first.
    await expect(
      as('owner', 'update terms set deleted_at = now() where id = $1::uuid', [t.id]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it("writes as its domain's owner or an admin only, and keeps a synonym in its meaning's domain", async () => {
    await expect(insert('author', fresh())).rejects.toMatchObject({ code: '42501' })
    await expect(insert('stranger', fresh())).rejects.toMatchObject({ code: '42501' })
    const t = await own()
    expect(
      await as('stranger', "update terms set meaning = 'theirs' where id = $1::uuid returning id", [
        t.id,
      ]),
    ).toEqual([])
    const [synonym] = await insert('admin', fresh(), { key: 'metric:spend', area: 'finance' })
    expect(synonym!.area_id).toBe('marketing')
    // A term is never removed, and its history is never changed.
    await expect(
      as('admin', 'delete from terms where id = $1::uuid', [t.id]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      as('admin', "update term_versions set name = 'x' where term_id = $1::uuid", [t.id]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('when what a synonym means leaves the definitions', () => {
  it('shows it as missing, keeps it out of a restore, and lets its owner point it elsewhere', async () => {
    const s = await term('owner', { name: fresh('Old name'), sameAs: 'metric:gone' })
    const deleted = await term('owner', { name: fresh('Older name'), sameAs: 'metric:gone' })
    await remove('owner', [deleted.id])
    await transaction(client, async () => {
      const [{ seq }] = (
        await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
      ).rows as [{ seq: string }]
      await client.query(
        `update vocab_term_service set editions = int8range(lower(editions), $1)
          where term_key = 'metric:gone' and upper_inf(editions)`,
        [seq],
      )
      await client.query('select edition_seal($1)', [seq])
      await client.query('select edition_publish($1)', [seq])
    })
    expect((await listed(s.id))!.conflict).toEqual({
      code: 'missing',
      holder: null,
      message: `Old metric isn't in Definitions any more. Point ${s.name} at something else.`,
    })
    expect(
      await ok<TermRestoreResult>(call('POST', '/terms/restore', 'owner', { ids: [deleted.id] })),
    ).toEqual({
      restored: [],
      skipped: [
        {
          id: deleted.id,
          name: deleted.name,
          message: `What “${deleted.name}” meant isn't in Definitions any more.`,
        },
      ],
    })
    // It can't be written again as it was, and it can mean something that is there.
    await refused(create('owner', { name: fresh(), sameAs: 'metric:gone' }), 404)
    const now = await ok<Term>(update('owner', (await listed(s.id))!, { sameAs: 'metric:orders' }))
    expect(now).toMatchObject({ sameAs: { ref: 'metric:orders' }, conflict: null })
  })
})
