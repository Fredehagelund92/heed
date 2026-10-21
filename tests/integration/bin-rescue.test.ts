import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaRemoval } from '../../src/contract/areas.ts'
import type { BinRescuePreview, BinRestoreResult } from '../../src/contract/bin.ts'
import type { HistoryEntry } from '../../src/contract/index.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import type { ContextItem } from '../../src/domain/item.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Restoring an item of a deleted domain into another domain (FR-814, 0079), over authenticated
  HTTP on the real service and PostgreSQL. The bakery is deleted with its items in the Bin. An
  administrator restores one into the pantry: it leaves the Bin retired, never served, and a
  proposal opens in the pantry with its last content, fitted to the pantry, which the dialog read
  first, change by change. The history log and the item's history name the item, the deleted
  domain and the chosen one. Only the pantry's owner accepting it serves it again.
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

/** The bakery's terms: `loaves` goes with it, `visits` stays, as a Marketing item uses it. */
const terms = [
  ['metric:loaves', 'Loaves baked', 'demo:loaves'],
  ['metric:visits', 'Kiosk visits', 'demo:visits'],
] as const

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    // The pantry's owner is the approver, so the bakery owner's items change hands; the cellar
    // has no owner at all.
    await client.query(
      `insert into areas (id,name) values ('bakery','Bakery'),('pantry','Pantry'),('cellar','Cellar')`,
    )
    await client.query(
      `insert into area_assignments (area_id,person_id,role) values
         ('bakery',$1,'owner'),('marketing',$1,'owner'),('pantry',$2,'owner')`,
      [people.owner, people.approver],
    )
    await client.query(
      `insert into definitions (ref,connector_id,kind,name,change_mark,area_hint) values
         ('demo:loaves','demo','metric','Loaves','1',null),('demo:visits','demo','metric','Visits','1',null)`,
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, ref] of [
      ['metric:orders', 'Orders', 'demo:orders'],
      ...terms,
    ] as const) {
      await client.query(
        "insert into vocab_terms (key,kind) values ($1,'metric') on conflict do nothing",
        [key],
      )
      const area = key === 'metric:orders' ? 'finance' : 'bakery'
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,proposer_id,content_digest)
                    values($1,1,$2,$3,$5,sha256(convert_to($1,'UTF8'))) returning id),
              r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v)
         select id from v`,
        [key, name, area, ref, people.author],
      )
      const version = term.rows[0]!.id
      if (area === 'bakery') {
        const proposal = await client.query<{ id: string }>(
          `insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel,submitted_at,closed_at)
           values ('vocabulary','create','accepted','bakery',$1,$2,'form',now(),now()) returning id`,
          [version, people.author],
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

/** A low-risk note, accepted by the area's owner and live. */
async function acceptedItem(areaId: string, extra: Draft, owner: Who = 'owner') {
  const created = await call('POST', '/proposals', 'author', {
    draft: {
      areaId,
      summary: 'Loaves at the north kiosk',
      validity: { start: '2026-08-04', end: null },
      evidence: [{ url: 'https://example.test/bakery', quote: 'Baked', date: '2026-08-04' }],
      ...extra,
    },
  })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const submitted = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(submitted.statusCode, submitted.body).toBe(200)
  return accept(p.id, owner).then(() => p.itemId ?? submitted.json<ProposalRecord>().itemId!)
}
async function accept(id: string, who: Who) {
  const review = await call('GET', `/proposals/${id}/review`, who)
  expect(review.statusCode, review.body).toBe(200)
  const { proposal } = review.json<{ proposal: ReviewProposal }>()
  return call('POST', `/proposals/${id}/decisions`, who, {
    revision: proposal.revision,
    outcome: 'accept',
    reason: 'Reviewed against the evidence',
  })
}

const servedItems = async () =>
  (
    await client.query<{ id: string }>(
      'select item_id as id from item_version_service where editions @> (select seq from live_edition)',
    )
  ).rows.map((row) => row.id)

describe('restoring an item of a deleted domain into another domain', () => {
  const made: { rescued: string; scopeless: string; elsewhere: string } = {} as never

  beforeAll(async () => {
    made.rescued = await acceptedItem('bakery', {
      title: 'North kiosk closed on Mondays',
      summaryMarkup: 'Closed on Mondays, as @[the bakery](area:bakery) said',
      scope: { metrics: ['metric:loaves', 'metric:visits'], dimensions: [], dimensionValues: [] },
      reviewDate: '2026-10-01',
    })
    made.scopeless = await acceptedItem('bakery', {
      title: 'Rye loaves counted twice',
      scope: { metrics: ['metric:loaves'], dimensions: [], dimensionValues: [] },
    })
    // Marketing uses a bakery metric: that term stays, without a domain.
    made.elsewhere = await acceptedItem('marketing', {
      title: 'Kiosk visits in the campaign',
      scope: { metrics: ['metric:visits'], dimensions: [], dimensionValues: [] },
    })
    const plan = await call('GET', '/areas/bakery/removal', 'admin')
    const removed = await call('POST', '/areas/bakery/removal', 'admin', {
      revision: plan.json<AreaRemoval>().revision,
      confirm: 'permanently delete',
    })
    expect(removed.statusCode, removed.body).toBe(200)
  })

  it('asks for another domain rather than refusing outright', async () => {
    const response = await call('POST', '/bin/restore', 'admin', { ids: [made.rescued] })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ message: string }>().message).toBe(
      '"North kiosk closed on Mondays" belongs to Bakery, which was deleted. Nothing was restored. Choose another domain for it, or restore Bakery first in Administration, Domains.',
    )
  })

  it('is for administrators only, and only into a domain that exists', async () => {
    for (const who of ['author', 'owner', 'approver'] as const) {
      expect(
        (
          await call('POST', '/bin/rescue-preview', who, {
            ids: [made.rescued],
            areaId: 'pantry',
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (await call('POST', '/bin/restore', who, { ids: [made.rescued], areaId: 'pantry' }))
          .statusCode,
      ).toBe(403)
    }
    for (const areaId of ['bakery', 'nowhere'])
      expect(
        (await call('POST', '/bin/rescue-preview', 'admin', { ids: [made.rescued], areaId }))
          .statusCode,
      ).toBe(422)
  })

  it('names every change the chosen domain needs, and what cannot go there', async () => {
    const response = await call('POST', '/bin/rescue-preview', 'admin', {
      ids: [made.rescued, made.scopeless],
      areaId: 'pantry',
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<BinRescuePreview>().items).toEqual([
      {
        itemId: made.rescued,
        title: 'North kiosk closed on Mondays',
        deletedDomain: 'Bakery',
        changes: [
          { field: 'domain', before: 'Bakery', after: 'Pantry' },
          { field: 'owner', before: 'owner', after: 'approver' },
          { field: 'scope', before: 'Loaves baked', after: null },
          { field: 'mentions', before: 'the bakery', after: null },
          { field: 'reviewDate', before: '2026-10-01', after: '2027-01-06' },
        ],
        problem: null,
      },
      {
        itemId: made.scopeless,
        title: 'Rye loaves counted twice',
        deletedDomain: 'Bakery',
        changes: [
          { field: 'domain', before: 'Bakery', after: 'Pantry' },
          { field: 'owner', before: 'owner', after: 'approver' },
          { field: 'scope', before: 'Loaves baked', after: null },
        ],
        problem:
          'None of the metrics or markets it applies to exist any more, so agents could never get it.',
      },
    ])
    const cellar = await call('POST', '/bin/rescue-preview', 'admin', {
      ids: [made.rescued],
      areaId: 'cellar',
    })
    expect(cellar.json<BinRescuePreview>().items[0]!.problem).toBe(
      'Cellar has no owner to review it. Give it an owner in Administration, Domains, first.',
    )
  })

  it('restores nothing when one item cannot go to the chosen domain', async () => {
    const response = await call('POST', '/bin/restore', 'admin', {
      ids: [made.rescued, made.scopeless],
      areaId: 'pantry',
    })
    expect(response.statusCode).toBe(422)
    expect(response.json<{ message: string }>().message).toBe(
      '"Rye loaves counted twice" can\'t move to Pantry: None of the metrics or markets it applies to exist any more, so agents could never get it. Nothing was restored.',
    )
    const binned = await client.query<{ item_id: string }>(
      'select item_id from item_bin where restored_at is null order by item_id',
    )
    expect(binned.rows.map((row) => row.item_id).sort()).toEqual(
      [made.rescued, made.scopeless].sort(),
    )
    // A domain is only chosen for an item whose own is deleted.
    expect(
      (await call('POST', '/bin/restore', 'admin', { ids: [made.elsewhere], areaId: 'pantry' }))
        .statusCode,
    ).toBe(404)
  })

  it('brings the item back retired, with a proposal in the chosen domain', async () => {
    const editionCount = async () =>
      (await client.query<{ n: number }>('select count(*)::int as n from editions')).rows[0]!.n
    const editions = await editionCount()
    const response = await call('POST', '/bin/restore', 'admin', {
      ids: [made.rescued],
      areaId: 'pantry',
    })
    expect(response.statusCode, response.body).toBe(200)
    const result = response.json<BinRestoreResult>()
    expect(result).toMatchObject({ restored: [made.rescued], edition: null })
    expect(result.proposals).toEqual([
      {
        itemId: made.rescued,
        id: expect.any(String) as string,
        number: expect.any(Number) as number,
      },
    ])
    // Nothing is served: no edition, and agents do not get it.
    expect(await editionCount()).toBe(editions)
    expect(await servedItems()).not.toContain(made.rescued)
    const item = await call('GET', `/items/${made.rescued}`, 'admin')
    expect(item.json<ContextItem>()).toMatchObject({ status: 'retired', areaId: 'bakery' })

    // The proposal carries the item's last content, fitted to the pantry, and waits for review.
    const id = result.proposals[0]!.id
    const proposal = (await call('GET', `/proposals/${id}`, 'admin')).json<ProposalRecord>()
    expect(proposal).toMatchObject({
      action: 'change',
      state: 'submitted',
      areaId: 'pantry',
      itemId: made.rescued,
      proposerId: people.admin,
      title: 'North kiosk closed on Mondays',
    })
    expect(proposal.draft).toMatchObject({
      areaId: 'pantry',
      ownerId: people.approver,
      summary: 'Closed on Mondays, as the bakery said',
      summaryMarkup: 'Closed on Mondays, as the bakery said',
      scope: { metrics: ['metric:visits'], dimensions: [], dimensionValues: [] },
      reviewDate: '2027-01-06',
      evidence: [{ url: 'https://example.test/bakery', quote: 'Baked', date: '2026-08-04' }],
    })

    // The Bin record, the history log and the item's history name the rescue.
    const bin = await client.query(
      `select restored_via, restored_area, rescue_proposal::text, restored_edition
         from item_bin where item_id=$1`,
      [made.rescued],
    )
    expect(bin.rows).toEqual([
      {
        restored_via: 'rescue',
        restored_area: 'pantry',
        rescue_proposal: id,
        restored_edition: null,
      },
    ])
    const audit = await client.query<{ area_id: string; details: Record<string, unknown> }>(
      "select area_id, details from audit_log where action='item.restored' and subject_id=$1",
      [made.rescued],
    )
    expect(audit.rows).toEqual([
      {
        area_id: 'pantry',
        details: {
          title: 'North kiosk closed on Mondays',
          versionId: expect.any(String) as string,
          edition: null,
          deletedDomain: 'Bakery',
          domain: 'Pantry',
          proposal: proposal.number,
          changes: expect.arrayContaining([
            { field: 'domain', before: 'Bakery', after: 'Pantry' },
          ]) as unknown,
        },
      },
    ])
    const history = (await call('GET', `/items/${made.rescued}/history`, 'author')).json<
      HistoryEntry[]
    >()
    expect(history.find((entry) => entry.event === 'restored')).toMatchObject({
      version: 1,
      personId: people.admin,
      domain: 'Pantry',
    })
    // The pantry's owner is told it waits for them.
    await client.query('select cl_outbox_relay()')
    const told = await client.query<{ person: string }>(
      `select p.display_name as person from inbox_items i join people p on p.id=i.person_id
        where i.kind='proposal.submitted' and i.subject_id=$1`,
      [id],
    )
    expect(told.rows.map((row) => row.person)).toContain('approver')
  })

  it("is reviewed by the chosen domain's owner like any proposal, which serves it again", async () => {
    const [{ id }] = (
      await client.query<{ id: string }>(
        'select rescue_proposal::text as id from item_bin where item_id=$1',
        [made.rescued],
      )
    ).rows as [{ id: string }]
    const review = await call('GET', `/proposals/${id}/review`, 'approver')
    expect(review.statusCode, review.body).toBe(200)
    const body = review.json<{
      rescue: { deletedDomain: string; restoredBy: string } | null
      diff: { field: string; before: unknown; after: unknown }[]
    }>()
    expect(body.rescue).toMatchObject({ deletedDomain: 'Bakery', restoredBy: people.admin })
    // The diff reads against the version agents got before the Bin.
    expect(body.diff).toEqual(
      expect.arrayContaining([{ field: 'areaId', before: 'bakery', after: 'pantry' }]),
    )
    // The bakery's owner has no say in the pantry: the proposal is not theirs to read.
    expect((await call('GET', `/proposals/${id}/review`, 'owner')).statusCode).toBe(404)
    const accepted = await accept(id, 'approver')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(await servedItems()).toContain(made.rescued)
    const item = (await call('GET', `/items/${made.rescued}`, 'author')).json<ContextItem>()
    expect(item).toMatchObject({ status: 'accepted', areaId: 'pantry', version: 2 })
  })
})
