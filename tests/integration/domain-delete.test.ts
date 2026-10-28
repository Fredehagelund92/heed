import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  AreaRemoval,
  AreaRemoved,
  AreaRestored,
  ArchivedArea,
} from '../../src/contract/areas.ts'
import type { BinList, BinRestoreResult } from '../../src/contract/bin.ts'
import type { LibraryIndex } from '../../src/contract/index.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Deleting a domain in one step (FR-814, 0074) over authenticated HTTP, on the real service and
  PostgreSQL. The bakery domain holds accepted items, terms (one another domain uses, one only
  the source puts there), an open proposal, a draft and a team. One call moves it all, in one
  transaction and one edition, or nothing; restoring brings back the domain, its roles and its
  terms, and the items through the Bin. Everyone but an administrator is refused.
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
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

/*
  The bakery's vocabulary, each term accepted by its owner through a proposal, as terms are (the group by the owner
  who proposed it, which an owner may do):
  a group, two metrics under it (`visits` is used by a Marketing item), a dimension with a value,
  and `flour`, which has no domain of its own and gets the bakery from the source.
*/
const terms = [
  ['group:baking', 'metric_group', null, 'Baking', 'bakery', null],
  ['metric:loaves', 'metric', 'group:baking', 'Loaves baked', 'bakery', 'demo:loaves'],
  ['metric:visits', 'metric', 'group:baking', 'Kiosk visits', 'bakery', 'demo:visits'],
  ['dim:kiosk', 'dimension', null, 'Kiosk', 'bakery', null],
  ['val:kiosk/north', 'dimension_value', 'dim:kiosk', 'North kiosk', 'bakery', null],
  ['metric:flour', 'metric', null, 'Flour used', null, 'demo:flour'],
] as const

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(`insert into areas (id,name) values ('bakery','Bakery'),('cellar','Cellar')`)
    await client.query(
      `insert into area_assignments (area_id,person_id,role) values
         ('bakery',$1,'owner'),('bakery',$2,'approver'),('marketing',$1,'owner'),('cellar',$1,'owner')`,
      [people.owner, people.approver],
    )
    await client.query(
      `insert into definitions (ref,connector_id,kind,name,change_mark,area_hint) values
         ('demo:loaves','demo','metric','Loaves','1',null),('demo:visits','demo','metric','Visits','1',null),
         ('demo:flour','demo','metric','Flour','1','bakery')`,
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    const all = [
      ['metric:orders', 'metric', null, 'Orders', 'finance', 'demo:orders'],
      ['dim:market', 'dimension', null, 'Market', null, null],
      ['val:market/norway', 'dimension_value', 'dim:market', 'Norway', null, null],
      ...terms,
    ] as const
    for (const [key, kind, parent, name, area, ref] of all) {
      await client.query(
        'insert into vocab_terms (key,kind,parent_key) values ($1,$2,$3) on conflict do nothing',
        [key, kind, parent],
      )
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,proposer_id,content_digest)
                    values($1,1,$2,$3,$5,sha256(convert_to($1,'UTF8'))) returning id),
              r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v where $4::text is not null)
         select id from v`,
        [key, name, area, ref, key === 'group:baking' ? people.owner : people.author],
      )
      const version = term.rows[0]!.id
      if (area === 'bakery') {
        const proposal = await client.query<{ id: string }>(
          `insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel,submitted_at,closed_at)
           values ('vocabulary','create','accepted','bakery',$1,$2,'form',now(),now()) returning id`,
          [version, key === 'group:baking' ? people.owner : people.author],
        )
        await client.query(
          `insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason)
           values ($1,$2,'bakery',$3,'owner','accept','Reviewed')`,
          [proposal.rows[0]!.id, version, people.owner],
        )
      }
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, version, seq],
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

function draft(areaId: string, title: string, metric = 'metric:loaves'): Draft {
  return {
    areaId,
    title,
    summary: 'Loaves at the north kiosk',
    scope: {
      metrics: [metric],
      dimensions: [],
      dimensionValues: [],
    },
    validity: { start: '2026-08-04', end: null },
    evidence: [{ url: 'https://example.test/bakery', quote: 'Baked', date: '2026-08-04' }],
  }
}
async function created(areaId: string, title: string, metric?: string) {
  const response = await call('POST', '/proposals', 'author', {
    draft: draft(areaId, title, metric),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}
async function submitted(areaId: string, title: string, metric?: string) {
  const p = await created(areaId, title, metric)
  const response = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}
/** A low-risk note, accepted by the owner and live. */
async function acceptedItem(areaId: string, title: string, metric?: string) {
  const p = await submitted(areaId, title, metric)
  const review = await call('GET', `/proposals/${p.id}/review`, 'owner')
  const { proposal } = review.json<{ proposal: ReviewProposal }>()
  const response = await call('POST', `/proposals/${p.id}/decisions`, 'owner', {
    revision: proposal.revision,
    outcome: 'accept',
    reason: 'Reviewed against the evidence',
  })
  expect(response.statusCode, response.body).toBe(200)
  return p.itemId!
}

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await client.query(sql, params)).rows[0] as T
const live = async () =>
  one<{ seq: string; label: string }>(
    'select e.seq::text,e.label from editions e join live_edition l on l.seq=e.seq',
  )
const editionCount = async () =>
  (await one<{ n: number }>('select count(*)::int as n from editions')).n
/** The items agents get now. */
const servedItems = async () =>
  (
    await client.query<{ id: string }>(
      'select item_id as id from item_version_service where editions @> (select seq from live_edition)',
    )
  ).rows.map((row) => row.id)
/** The terms agents get now, with the domain each has: the vocabulary's, else the source's. */
const servedTerms = async () =>
  Object.fromEntries(
    (
      await client.query<{ key: string; area: string | null }>(
        `select v.key, coalesce(v.area_id, d.area_id) as area
           from serving_vocabulary((select seq from live_edition)) v
           left join serving_source_domains((select seq from live_edition)) d on d.key = v.key`,
      )
    ).rows.map((row) => [row.key, row.area]),
  )
const removal = async (id = 'bakery') => {
  const response = await call('GET', `/areas/${id}/removal`, 'admin')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<AreaRemoval>()
}
const remove = (id: string, revision: number, extra: object = {}) =>
  call('POST', `/areas/${id}/removal`, 'admin', {
    revision,
    confirm: 'permanently delete',
    ...extra,
  })

describe('deleting a domain in one step', () => {
  const made: {
    items: string[]
    elsewhere: string
    open: ProposalRecord
    draft: ProposalRecord
  } = {} as never

  it('refuses everyone but an administrator', async () => {
    for (const who of ['author', 'owner', 'approver', 'stranger'] as const) {
      expect((await call('GET', '/areas/bakery/removal', who)).statusCode).toBe(403)
      expect(
        (
          await call('POST', '/areas/bakery/removal', who, {
            revision: 1,
            confirm: 'permanently delete',
          })
        ).statusCode,
      ).toBe(403)
      expect((await call('GET', '/archived-areas', who)).statusCode).toBe(403)
      expect((await call('POST', '/archived-areas/bakery/restore', who, {})).statusCode).toBe(403)
    }
    // Below the service, the row policies refuse a deletion record and the plan too.
    await expect(
      transaction(client, async () => {
        await client.query('set local role context_layer_api')
        await client.query("select set_config('cl.person_id',$1,true)", [people.owner])
        await client.query("select cl_area_deletion_plan('bakery')")
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('names what goes, by kind: items, terms and their fate, proposals, drafts and roles', async () => {
    made.items = [
      await acceptedItem('bakery', 'North kiosk closed on Mondays'),
      await acceptedItem('bakery', 'Rye loaves counted twice', 'metric:loaves'),
    ]
    // Marketing uses a bakery metric: that term stays, without a domain.
    made.elsewhere = await acceptedItem(
      'marketing',
      'Kiosk visits in the campaign',
      'metric:visits',
    )
    made.open = await submitted('bakery', 'Oven repaired')
    made.draft = await created('bakery', 'Started, never sent')

    const plan = await removal()
    expect(plan).toMatchObject({
      id: 'bakery',
      name: 'Bakery',
      demo: false,
      outcome: 'archive',
      holdings: { items: 2, terms: 6, openProposals: 1, drafts: 1, team: 2, history: true },
    })
    expect(plan.items.map((item) => item.id).sort()).toEqual([...made.items].sort())
    expect(Object.fromEntries(plan.terms.map((term) => [term.key, term.fate]))).toEqual({
      'group:baking': 'kept',
      'metric:loaves': 'retired',
      'metric:visits': 'kept',
      'dim:kiosk': 'retired',
      'val:kiosk/north': 'retired',
      'metric:flour': 'source',
    })
    expect(plan.openProposals).toEqual([
      { id: made.open.id, number: made.open.number, title: 'Oven repaired', subject: 'item' },
    ])
    expect(plan.drafts).toEqual([
      { id: made.draft.id, title: 'Started, never sent', author: 'author' },
    ])
    expect(plan.team.map((role) => [role.name, role.role])).toEqual([
      ['owner', 'owner'],
      ['approver', 'approver'],
    ])
  })

  it('asks for the words permanently delete, on the revision read', async () => {
    const { revision } = await removal()
    for (const confirm of ['Bakery', 'Permanently delete', ''])
      expect((await remove('bakery', revision, { confirm })).statusCode).toBe(400)
    expect((await remove('bakery', revision + 1)).statusCode).toBe(409)
  })

  it('changes nothing when any step fails: the transaction is whole or not at all', async () => {
    const before = {
      edition: await live(),
      editions: await editionCount(),
      items: await servedItems(),
      terms: await servedTerms(),
    }
    // The last write of the step fails.
    await client.query(`create function test_refuse() returns trigger language plpgsql as $$
      begin raise exception 'refused for the test'; end $$`)
    await client.query(
      'create trigger test_refuse before insert on area_deletions for each row execute function test_refuse()',
    )
    try {
      const { revision } = await removal()
      expect((await remove('bakery', revision)).statusCode).toBe(500)
    } finally {
      await client.query('drop trigger test_refuse on area_deletions')
      await client.query('drop function test_refuse()')
    }
    expect(await live()).toEqual(before.edition)
    expect(await editionCount()).toBe(before.editions)
    expect(await servedItems()).toEqual(before.items)
    expect(await servedTerms()).toEqual(before.terms)
    expect(await one('select archived_at from areas where id=$1', ['bakery'])).toEqual({
      archived_at: null,
    })
    expect(
      await one<{ n: number }>(
        "select count(*)::int as n from area_assignments where area_id='bakery' and valid_at @> now()",
      ),
    ).toEqual({ n: 2 })
    expect(await one('select state from proposals where id=$1', [made.open.id])).toEqual({
      state: 'submitted',
    })
    expect(await one<{ n: number }>('select count(*)::int as n from item_bin')).toEqual({ n: 0 })
    expect(
      await one<{ n: number }>(
        "select count(*)::int as n from audit_log where action='area.deleted'",
      ),
    ).toEqual({ n: 0 })
  })

  it('moves everything in one edition, and leaves no item or term in the deleted domain', async () => {
    const editions = await editionCount()
    const { revision } = await removal()
    const response = await remove('bakery', revision, { reason: 'The bakery closed' })
    expect(response.statusCode, response.body).toBe(200)
    const removed = response.json<AreaRemoved>()
    expect(removed).toMatchObject({
      outcome: 'archived',
      area: { id: 'bakery', name: 'Bakery' },
      edition: { reason: 'area_deleted', note: 'The bakery closed', live: true },
      holdings: { items: 2, terms: 6, openProposals: 1, drafts: 1, team: 2 },
    })
    // One edition, sealed, with every change.
    expect(await editionCount()).toBe(editions + 1)
    expect((await live()).label).toBe(removed.edition!.label)
    expect(
      await one('select sealed_at is not null as sealed from editions where label=$1', [
        removed.edition!.label,
      ]),
    ).toEqual({ sealed: true })

    // Agents stop getting the items and the terms at once.
    const served = await servedItems()
    for (const item of made.items) expect(served).not.toContain(item)
    expect(served).toContain(made.elsewhere)
    const vocabulary = await servedTerms()
    expect(vocabulary).not.toHaveProperty('metric:loaves')
    expect(vocabulary).not.toHaveProperty('dim:kiosk')
    expect(vocabulary).not.toHaveProperty('val:kiosk/north')
    // The term Marketing uses stays, and so does its group, both without a domain; the term
    // whose domain only the source gave loses it.
    expect(vocabulary).toMatchObject({
      'metric:visits': null,
      'group:baking': null,
      'metric:flour': null,
      'metric:orders': 'finance',
    })
    expect(Object.values(vocabulary)).not.toContain('bakery')
    expect(
      await one<{ n: number }>(
        `select count(*)::int as n from item_version_service s join item_versions v on v.id=s.version_id
          where s.editions @> (select seq from live_edition) and v.area_id='bakery'`,
      ),
    ).toEqual({ n: 0 })
    // The kept term's new version is an accepted proposal with the administrator's decision.
    expect(
      await one(
        `select p.state,p.reason,d.capacity,d.outcome from proposals p join decisions d on d.proposal_id=p.id
          join vocab_term_versions v on v.id=p.vocab_version_id
          where v.term_key='metric:visits' and v.area_id is null`,
      ),
    ).toEqual({
      state: 'accepted',
      reason: 'Domain deleted',
      capacity: 'administrator',
      outcome: 'accept',
    })

    // The items are in the Bin, out of the library, with the reason.
    const bin = (await call('GET', '/bin', 'admin')).json<BinList>().items
    expect(bin.map((entry) => entry.itemId).sort()).toEqual([...made.items].sort())
    expect(bin.every((entry) => entry.reason === 'Domain deleted' && entry.wasLive)).toBe(true)
    const library = (await call('GET', '/library', 'author')).json<LibraryIndex>().items
    for (const item of made.items) expect(library.map((row) => row.id)).not.toContain(item)

    // The open proposal is withdrawn; the draft stays with its author, as a draft.
    expect(
      (await call('GET', `/proposals/${made.open.id}`, 'author')).json<ProposalRecord>(),
    ).toMatchObject({ state: 'withdrawn', reason: 'Domain deleted' })
    expect(
      (await call('GET', `/proposals/${made.draft.id}`, 'author')).json<ProposalRecord>(),
    ).toMatchObject({ state: 'draft', areaId: 'bakery' })

    // The team's roles end, and the domain leaves every list.
    expect(
      await one<{ n: number }>(
        "select count(*)::int as n from area_assignments where area_id='bakery' and valid_at @> now()",
      ),
    ).toEqual({ n: 0 })
    const areas = (await call('GET', '/areas', 'author')).json<{ id: string }[]>()
    expect(areas.map((area) => area.id)).not.toContain('bakery')

    // One history log record with the full list of what it did.
    const audit = await client.query<{ details: Record<string, unknown> }>(
      "select details from audit_log where action='area.deleted' and area_id='bakery'",
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.details).toMatchObject({
      name: 'Bakery',
      kept: true,
      edition: removed.edition!.label,
      reason: 'The bakery closed',
      openProposals: [{ id: made.open.id, title: 'Oven repaired' }],
      drafts: [{ id: made.draft.id, title: 'Started, never sent' }],
    })
    const details = audit.rows[0]!.details as {
      items: { id: string }[]
      terms: { key: string; fate: string }[]
      roles: unknown[]
    }
    expect(details.items.map((item) => item.id).sort()).toEqual([...made.items].sort())
    expect(details.terms).toHaveLength(6)
    expect(details.roles).toHaveLength(2)

    // The authors and the team are told; the administrator who did it is not.
    await client.query('select cl_outbox_relay()')
    const told = await client.query<{ person: string }>(
      "select p.display_name as person from inbox_items i join people p on p.id=i.person_id where i.kind='area.deleted' order by 1",
    )
    expect(told.rows.map((row) => row.person)).toEqual(['approver', 'author', 'owner'])
    const inbox = await call('GET', '/inbox', 'author')
    expect(inbox.json<{ items: { kind: string; title: string }[] }>().items[0]).toMatchObject({
      kind: 'area.deleted',
      title: 'Bakery',
    })
  })

  it('keeps an item of a deleted domain in the Bin until the domain comes back, or another is chosen', async () => {
    const response = await call('POST', '/bin/restore', 'admin', { ids: [made.items[0]] })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ message: string }>().message).toMatch(
      /belongs to Bakery, which was deleted\. Nothing was restored\. Choose another domain for it, or restore Bakery first/,
    )
  })

  it('lists the deleted domain, and restores it with its roles and its terms in one edition', async () => {
    const listed = (await call('GET', '/archived-areas', 'admin')).json<ArchivedArea[]>()
    expect(listed.find((area) => area.id === 'bakery')).toMatchObject({
      name: 'Bakery',
      team: 2,
      terms: 6,
      binnedItems: 2,
    })
    const editions = await editionCount()
    const response = await call('POST', '/archived-areas/bakery/restore', 'admin', {
      reason: 'Reopened',
    })
    expect(response.statusCode, response.body).toBe(200)
    const restored = response.json<AreaRestored>()
    expect(restored).toMatchObject({
      area: { id: 'bakery', ownerIds: [people.owner], approverIds: [people.approver] },
      edition: { reason: 'area_restored', live: true },
      team: 2,
      terms: 5,
    })
    expect(restored.binnedItems.map((item) => item.id).sort()).toEqual([...made.items].sort())
    expect(await editionCount()).toBe(editions + 1)
    // Every term is back in the bakery, the source's too.
    const vocabulary = await servedTerms()
    for (const [key] of terms) expect(vocabulary[key], key).toBe('bakery')
    // The items come back through the Bin.
    const back = await call('POST', '/bin/restore', 'admin', { ids: made.items })
    expect(back.statusCode, back.body).toBe(200)
    expect(back.json<BinRestoreResult>().restored.sort()).toEqual([...made.items].sort())
    const served = await servedItems()
    for (const item of made.items) expect(served).toContain(item)
    expect((await call('POST', '/archived-areas/bakery/restore', 'admin', {})).statusCode).toBe(404)
    expect(
      await one(
        "select restored_at is not null as restored from area_deletions where area_id='bakery'",
      ),
    ).toEqual({ restored: true })
  })

  it('restores a domain however long ago it was deleted', async () => {
    await call('POST', '/proposals', 'author', { draft: draft('cellar', 'Cellar draft') })
    const { revision } = await removal('cellar')
    const response = await remove('cellar', revision)
    expect(response.statusCode, response.body).toBe(200)
    // A year on.
    await transaction(client, async () => {
      await client.query('alter table area_deletions disable trigger area_deletions_update')
      await client.query(
        "update area_deletions set deleted_at = deleted_at - interval '1 year' where area_id='cellar'",
      )
      await client.query('alter table area_deletions enable trigger area_deletions_update')
      await client.query(
        "update areas set archived_at = archived_at - interval '1 year' where id='cellar'",
      )
    })
    const listed = (await call('GET', '/archived-areas', 'admin')).json<ArchivedArea[]>()
    expect(listed.find((area) => area.id === 'cellar')).toMatchObject({ name: 'Cellar' })
    const restored = await call('POST', '/archived-areas/cellar/restore', 'admin', {})
    expect(restored.statusCode, restored.body).toBe(200)
    expect(restored.json<AreaRestored>().area).toMatchObject({ id: 'cellar' })
  })

  it('deletes a domain that holds nothing for good, with no edition', async () => {
    await client.query("insert into areas (id,name) values ('empty','Empty')")
    const plan = await removal('empty')
    expect(plan).toMatchObject({ outcome: 'delete', holdings: { history: false } })
    const editions = await editionCount()
    const response = await remove('empty', plan.revision)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<AreaRemoved>()).toMatchObject({
      outcome: 'deleted',
      edition: null,
    })
    expect(await editionCount()).toBe(editions)
    expect((await client.query("select 1 from areas where id='empty'")).rowCount).toBe(0)
  })

  it('never deletes the demo domain', async () => {
    await client.query("insert into areas (id,name,is_demo) values ('sandbox_demo','Sandbox',true)")
    const plan = await removal('sandbox_demo')
    expect(plan).toMatchObject({ demo: true, outcome: 'blocked' })
    expect((await remove('sandbox_demo', plan.revision)).statusCode).toBe(409)
  })
})

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
      (await call('GET', '/areas/pantry', 'admin')).json<{ revision: number }>()
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
})
