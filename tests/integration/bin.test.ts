import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  BinItem,
  BinList,
  BinMoveResult,
  BinPreview,
  BinRestoreResult,
} from '../../src/contract/bin.ts'
import type { HistoryEntry, LibraryIndex } from '../../src/contract/index.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Edition, ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The Bin (0067) end to end over authenticated HTTP: an administrator moves items out of the
  library in one edition, agents stop getting them, and restoring brings them back the same way.
  Everyone else is refused, and a rollback that serves a binned item again takes it out of the Bin.
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
const servePool = new pg.Pool({
  connectionString: url,
  options: '-c role=context_layer_serve',
  types: {
    getTypeParser(oid, format): (value: string) => unknown {
      return oid === pg.types.builtins.DATE
        ? (value) => value
        : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)
    },
  },
})
const refuse = (): Promise<never> => Promise.reject(new Error('not recorded in this test'))
const execute = createToolService(
  createEditionSource(servePool),
  { write: refuse, reportGap: refuse, feedback: refuse },
  () => new Date('2026-10-08T12:00:00Z'),
)
/** What get_facts delivers for the scope every item in these tests has. */
async function delivered() {
  const result = await execute(
    'get_facts',
    {
      question: '',
      metrics: ['metric:orders'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-08-10', to: '2026-08-20' },
    },
    { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    100000,
    () => {},
  )
  return (result.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)
}

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

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    // The first edition is a bootstrap: its vocabulary needs no decision (0006).
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['group:payments', 'Payments', null, null],
      ['dim:market', 'Market', null, null],
      ['val:market/norway', 'Norway', null, null],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v where $4::text is not null) select id from v`,
        [key, name, area, ref],
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
  await servePool.end()
})

function draft(title: string): Draft {
  return {
    areaId: 'finance',
    title,
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
  }
}
async function submitted(title: string, itemId?: string) {
  const created = await call('POST', '/proposals', 'author', {
    draft: draft(title),
    ...(itemId ? { itemId } : {}),
  })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const response = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}
async function decide(id: string) {
  const review = await call('GET', `/proposals/${id}/review`, 'owner')
  const { proposal } = review.json<{ proposal: ReviewProposal }>()
  return call('POST', `/proposals/${id}/decisions`, 'owner', {
    revision: proposal.revision,
    outcome: 'accept',
    reason: 'Reviewed against the evidence',
  })
}
/** A low-risk note, accepted and live. */
async function acceptedItem(title: string) {
  const p = await submitted(title)
  const response = await decide(p.id)
  expect(response.statusCode, response.body).toBe(200)
  return p.itemId!
}
const libraryIds = async (who: Who = 'author') =>
  (await call('GET', '/library', who)).json<LibraryIndex>().items.map((item) => item.id)
const liveLabel = async () =>
  (
    await client.query<{ label: string }>(
      'select e.label from editions e join live_edition l on l.seq=e.seq',
    )
  ).rows[0]!.label

describe('the Bin', () => {
  it('lets only an administrator open it, preview, move and restore', async () => {
    const item = await acceptedItem('Only for administrators')
    for (const who of ['author', 'owner', 'approver', 'stranger'] as const) {
      expect((await call('GET', '/bin', who)).statusCode).toBe(403)
      expect((await call('POST', '/bin/preview', who, { ids: [item] })).statusCode).toBe(403)
      expect((await call('POST', '/bin', who, { ids: [item], reason: 'No' })).statusCode).toBe(403)
      expect((await call('POST', '/bin/restore', who, { ids: [item] })).statusCode).toBe(403)
    }
    expect(await delivered()).toContain(item)
    expect(await libraryIds()).toContain(item)
    // Below the service, the row policies refuse a Bin record for anyone else too.
    await expect(
      transaction(client, async () => {
        await client.query('set local role context_layer_api')
        await client.query("select set_config('cl.person_id',$1,true)", [people.owner])
        await client.query(
          `insert into item_bin(item_id,version_id,area_id,reason,binned_by)
           select $1,version_id,area_id,'No',$2 from v_item_list where id=$1`,
          [item, people.owner],
        )
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('stops delivery in one edition and leaves every read model, and restores the same way', async () => {
    const first = await acceptedItem('Norway closure, first')
    const second = await acceptedItem('Norway closure, second')
    const retired = await acceptedItem('Norway closure, retired')
    expect(
      (await call('POST', `/items/${retired}/retire`, 'admin', { reason: 'Ended' })).statusCode,
    ).toBe(200)
    expect(await delivered()).toEqual(expect.arrayContaining([first, second]))
    const before = await liveLabel()

    const preview = await call('POST', '/bin/preview', 'admin', { ids: [first, retired] })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json<BinPreview>().items).toEqual([
      { itemId: first, title: 'Norway closure, first', live: true, openProposals: 0 },
      { itemId: retired, title: 'Norway closure, retired', live: false, openProposals: 0 },
    ])

    const moved = await call('POST', '/bin', 'admin', {
      ids: [first, second, retired],
      reason: 'Duplicates of the pilot import',
    })
    expect(moved.statusCode, moved.body).toBe(200)
    const result = moved.json<BinMoveResult>()
    // One edition for the whole action, for the two items agents got.
    expect(result.edition).toMatchObject({
      reason: 'item_retired',
      note: 'Duplicates of the pilot import',
      live: true,
    })
    const editions = await client.query<{ n: number }>(
      'select count(*)::int as n from editions where seq > (select seq from editions where label=$1)',
      [before],
    )
    expect(editions.rows[0]!.n).toBe(1)
    expect(result.items.map((entry) => [entry.itemId, entry.wasLive]).sort()).toEqual(
      [
        [first, true],
        [second, true],
        [retired, false],
      ].sort(),
    )
    expect(result.items[0]).toMatchObject({
      binnedBy: people.admin,
      reason: 'Duplicates of the pilot import',
      areaId: 'finance',
      kind: 'note',
      version: 1,
    })

    // Agents never get them, and no read model shows them: index, list, search, item, catalogue.
    const shown = await delivered()
    expect(shown).not.toContain(first)
    expect(shown).not.toContain(second)
    for (const who of ['author', 'admin'] as const) {
      const ids = await libraryIds(who)
      for (const id of [first, second, retired]) expect(ids).not.toContain(id)
    }
    const search = await call('GET', '/items?q=Norway%20closure', 'admin')
    expect(search.json<{ rows: { id: string }[]; total: number }>().rows.map((r) => r.id)).toEqual(
      [],
    )
    expect((await call('GET', `/items/${first}`, 'admin')).statusCode).toBe(404)
    const catalogue = await call('GET', '/catalogue/metric/orders', 'author')
    expect(catalogue.body).not.toContain(first)

    const bin = (await call('GET', '/bin', 'admin')).json<BinList>()
    expect(bin.items.map((entry) => entry.itemId).sort()).toEqual([first, second, retired].sort())

    // An administrator reads an item in the Bin before restoring it, as the library showed it,
    // with its history; everyone else is refused, and agents still never get it.
    const opened = await call('GET', `/bin/${first}`, 'admin')
    expect(opened.statusCode, opened.body).toBe(200)
    expect(opened.json<BinItem>()).toMatchObject({
      entry: { itemId: first, reason: 'Duplicates of the pilot import', wasLive: true },
      item: {
        id: first,
        title: 'Norway closure, first',
        status: 'accepted',
        evidence: [{ url: 'https://example.test/law' }],
      },
    })
    expect((await call('GET', `/bin/${retired}`, 'admin')).json<BinItem>().item.status).toBe(
      'retired',
    )
    expect((await call('GET', '/bin/itm_missing0001', 'admin')).statusCode).toBe(404)
    const binnedHistory = await call('GET', `/items/${first}/history`, 'admin')
    expect(binnedHistory.statusCode, binnedHistory.body).toBe(200)
    expect(binnedHistory.json<HistoryEntry[]>().map((entry) => entry.event)).toEqual([
      'binned',
      'accepted',
      'proposed',
    ])
    for (const who of ['author', 'owner', 'approver', 'stranger'] as const) {
      expect((await call('GET', `/bin/${first}`, who)).statusCode).toBe(403)
      expect((await call('GET', `/items/${first}/history`, who)).statusCode).toBe(404)
    }
    expect(await delivered()).not.toContain(first)
    // The serving role, which answers agents, cannot read the document an item in the Bin has.
    await expect(servePool.query('select doc from v_item_doc limit 1')).rejects.toMatchObject({
      code: '42501',
    })

    // Moving again is refused; an id that is not in the library is not found.
    expect(
      (await call('POST', '/bin', 'admin', { ids: [first], reason: 'Again' })).statusCode,
    ).toBe(409)
    expect(
      (await call('POST', '/bin', 'admin', { ids: ['itm_missing0001'], reason: 'No' })).statusCode,
    ).toBe(404)

    // The history log keeps each move, with the reason, and each live item a retire decision.
    const logged = await client.query<{
      subject_id: string
      details: { reason: string; title: string }
    }>("select subject_id,details from audit_log where action='item.binned' order by seq")
    expect(logged.rows.map((r) => r.subject_id).sort()).toEqual([first, second, retired].sort())
    // Who, when, why, the title and the id stay in the history log whatever happens to the item.
    expect(logged.rows.find((r) => r.subject_id === first)!.details).toMatchObject({
      title: 'Norway closure, first',
      reason: 'Duplicates of the pilot import',
    })
    const decisions = await client.query<{ n: number }>(
      `select count(*)::int as n from decisions d join item_versions v on v.id=d.item_version_id
        where v.item_id=any($1) and d.outcome='retire' and d.capacity='administrator'`,
      [[first, second]],
    )
    expect(decisions.rows[0]!.n).toBe(2)

    const restored = await call('POST', '/bin/restore', 'admin', { ids: [first, retired] })
    expect(restored.statusCode, restored.body).toBe(200)
    const back = restored.json<BinRestoreResult>()
    expect(back.restored.sort()).toEqual([first, retired].sort())
    expect(back.edition).toMatchObject({ reason: 'item_restored', live: true })
    const now = await delivered()
    expect(now).toContain(first)
    expect(now).not.toContain(second)
    expect(now).not.toContain(retired)
    const index = (await call('GET', '/library', 'author')).json<LibraryIndex>().items
    expect(index.find((item) => item.id === first)).toMatchObject({ status: 'accepted' })
    // An item retired before it went to the Bin comes back retired.
    expect(index.find((item) => item.id === retired)).toMatchObject({ status: 'retired' })
    expect(index.some((item) => item.id === second)).toBe(false)
    expect((await call('POST', '/bin/restore', 'admin', { ids: [first] })).statusCode).toBe(404)
    expect((await call('GET', `/bin/${first}`, 'admin')).statusCode).toBe(404)

    // The item history shows the stay in the Bin to everyone who reads the item, not as retired.
    const history = (await call('GET', `/items/${first}/history`, 'author')).json<HistoryEntry[]>()
    expect(history.map((entry) => entry.event)).toEqual([
      'restored',
      'binned',
      'accepted',
      'proposed',
    ])
    expect(history[0]).toMatchObject({ personId: people.admin })
    const retiredHistory = (await call('GET', `/items/${retired}/history`, 'author')).json<
      HistoryEntry[]
    >()
    expect(retiredHistory.map((entry) => entry.event)).toEqual([
      'restored',
      'binned',
      'retired',
      'accepted',
      'proposed',
    ])
  })

  it('warns about open proposals, which cannot be accepted while the item is in the Bin', async () => {
    const item = await acceptedItem('Has a change waiting')
    const change = await submitted('Has a change waiting, corrected', item)
    const preview = await call('POST', '/bin/preview', 'admin', { ids: [item] })
    expect(preview.json<BinPreview>().items[0]).toMatchObject({ openProposals: 1, live: true })
    const moved = await call('POST', '/bin', 'admin', { ids: [item], reason: 'Wrong domain' })
    expect(moved.statusCode, moved.body).toBe(200)
    expect(moved.json<BinMoveResult>().items[0]).toMatchObject({ openProposals: 1 })
    const accepted = await decide(change.id)
    expect(accepted.statusCode).toBe(409)
    expect(await delivered()).not.toContain(item)

    expect((await call('POST', '/bin/restore', 'admin', { ids: [item] })).statusCode).toBe(200)
    const after = await decide(change.id)
    expect(after.statusCode, after.body).toBe(200)
    expect(await delivered()).toContain(item)
  })

  it('takes an item out of the Bin when a rollback serves it again', async () => {
    const item = await acceptedItem('Comes back with the rollback')
    const target = await liveLabel()
    expect(
      (await call('POST', '/bin', 'admin', { ids: [item], reason: 'Not needed' })).statusCode,
    ).toBe(200)
    expect(await libraryIds()).not.toContain(item)
    const rollback = await call('POST', `/editions/${target}/rollback`, 'admin', {
      note: 'The move was a mistake',
    })
    expect(rollback.statusCode, rollback.body).toBe(200)
    expect(rollback.json<Edition>()).toMatchObject({ reason: 'rollback', restores: target })
    expect(await delivered()).toContain(item)
    expect(await libraryIds()).toContain(item)
    expect((await call('GET', '/bin', 'admin')).json<BinList>().items).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ itemId: item })]),
    )
    const via = await client.query<{ restored_via: string }>(
      'select restored_via from item_bin where item_id=$1',
      [item],
    )
    expect(via.rows).toEqual([{ restored_via: 'rollback' }])
  })

  it('keeps every Bin record: never deleted, restored only once', async () => {
    const item = await acceptedItem('Kept on record')
    expect((await call('POST', '/bin', 'admin', { ids: [item], reason: 'Gone' })).statusCode).toBe(
      200,
    )
    await expect(client.query('delete from item_bin where item_id=$1', [item])).rejects.toThrow()
    await expect(
      client.query("update item_bin set reason='Changed' where item_id=$1", [item]),
    ).rejects.toMatchObject({ code: '23001' })
    expect((await call('POST', '/bin/restore', 'admin', { ids: [item] })).statusCode).toBe(200)
    await expect(
      client.query('update item_bin set restored_at=now() where item_id=$1', [item]),
    ).rejects.toMatchObject({ code: '23001' })
  })
})
