import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lastOwnerMessage } from '../../src/contract/auth.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Feed } from '../../src/contract/inbox.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people as fixturePeople } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Several owners (captain's decisions, 16 October 2026) over authenticated HTTP and PostgreSQL:
  one person may own several domains, and a domain may have several owners. Each owner
  of a domain reviews it: the Inbox and the decisions follow any of the domains a person owns.
  Removing an owner from one domain leaves the others, and a domain keeps at least one owner.
*/

const people = {
  ...fixturePeople,
  second: '00000000-0000-4000-8000-0000000000e2',
  third: '00000000-0000-4000-8000-0000000000e3',
}
type Who = keyof typeof people

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
const headers = {} as Record<Who, Headers>
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  await foundation(client)
  await client.query(
    `insert into people (id,email,display_name) values
       ($1,'second@example.test','second'),($2,'third@example.test','third')`,
    [people.second, people.third],
  )
  await transaction(client, async () => {
    await client.query(
      "insert into vocab_terms(key,kind,parent_key) values('metric:spend','metric',null)",
    )
    // The first edition is a bootstrap: its vocabulary needs no decision (0006).
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['metric:spend', 'Spend', 'marketing'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
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
  for (const name of Object.keys(people) as Who[]) {
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

/** A domain's owners, all of them, in one step, as Domains and owners sets them. */
const owners = (areaId: string, who: Who[]) =>
  call('PUT', `/areas/${areaId}/owners`, 'admin', { personIds: who.map((name) => people[name]) })

async function submitted(areaId: 'finance' | 'marketing', title: string) {
  const draft: Draft = {
    areaId,
    title,
    summary: `A note for ${areaId}`,
    scope: {
      metrics: [areaId === 'finance' ? 'metric:orders' : 'metric:spend'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: null },
    evidence: [{ url: 'https://example.test/n', quote: 'It happened', date: '2026-08-04' }],
  }
  const created = await call('POST', '/proposals', 'author', { draft })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const response = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}

/** The suggestions waiting in a person's Inbox. */
const queue = async (who: Who) => {
  const response = await call('GET', '/inbox/feed', who)
  expect(response.statusCode, response.body).toBe(200)
  return response
    .json<Feed>()
    .cards.flatMap((card) => (card.group === 'suggestion' ? [card.proposalId] : []))
}
const assignments = async (who: Who) =>
  (await call('GET', '/me', who)).json<{
    permissions: { assignments: { areaId: string; role: string }[] }
  }>().permissions.assignments
/** Who an event of the proposal reached in their inbox. */
async function told(proposalId: string, kind: string) {
  await client.query('select cl_outbox_relay(1000)')
  const rows = await client.query<{ person_id: string }>(
    'select person_id::text from inbox_items where kind=$1 and subject_id=$2 order by person_id',
    [kind, proposalId],
  )
  return rows.rows.map((row) => row.person_id)
}

describe('a person who owns two domains', () => {
  it('is given both, and reviews either from one Inbox', async () => {
    for (const [areaId, who] of [
      ['finance', ['owner', 'stranger']],
      ['marketing', ['stranger']],
    ] as const) {
      const given = await owners(areaId, [...who])
      expect(given.statusCode, given.body).toBe(200)
    }
    expect(await assignments('stranger')).toEqual(
      expect.arrayContaining([
        { areaId: 'finance', role: 'owner' },
        { areaId: 'marketing', role: 'owner' },
      ]),
    )
    const money = await submitted('finance', 'Finance note')
    const ads = await submitted('marketing', 'Marketing note')
    expect(await queue('stranger')).toEqual(expect.arrayContaining([money.id, ads.id]))
    // Each domain's other owner sees only their own domain's.
    expect(await queue('owner')).toContain(money.id)
    expect(await queue('owner')).not.toContain(ads.id)
    // Submitting tells every owner of the domain.
    expect(await told(money.id, 'proposal.submitted')).toEqual(
      [people.owner, people.stranger].sort(),
    )
    expect(await told(ads.id, 'proposal.submitted')).toEqual([people.stranger])
    // They decide in either.
    for (const p of [money, ads]) {
      const decided = await call('POST', `/review/${p.id}/return`, 'stranger', {
        revision: p.revision,
        note: 'Name the source',
      })
      expect(decided.statusCode, decided.body).toBe(200)
      expect(decided.json()).toMatchObject({ proposal: { state: 'changes_requested' } })
    }
  })

  it('keeps the other domain when one is taken away', async () => {
    const removed = await owners('finance', ['owner'])
    expect(removed.statusCode, removed.body).toBe(200)
    expect(await assignments('stranger')).toEqual([{ areaId: 'marketing', role: 'owner' }])
    const money = await submitted('finance', 'Finance note, later')
    const ads = await submitted('marketing', 'Marketing note, later')
    const mine = await queue('stranger')
    expect(mine).toContain(ads.id)
    expect(mine).not.toContain(money.id)
    const refused = await call('GET', `/review/${money.id}/sheet`, 'stranger')
    // Finance's open proposals are no longer theirs to read, let alone decide.
    expect(refused.statusCode).toBe(404)
  })

  it('may not leave a domain without an owner: the last one stays, with the next step named', async () => {
    const before = await assignments('stranger')
    const last = await call('POST', '/assignments/revoke', 'admin', {
      personId: people.stranger,
      areaId: 'marketing',
      role: 'owner',
    })
    expect(last.statusCode).toBe(409)
    expect(last.json()).toMatchObject({ message: lastOwnerMessage('Marketing') })
    expect(await assignments('stranger')).toEqual(before)
    // Giving it to someone else in the same step replaces them at once.
    const handed = await owners('marketing', ['author'])
    expect(handed.statusCode, handed.body).toBe(200)
    expect(await assignments('stranger')).toEqual([])
    expect(await assignments('author')).toEqual([{ areaId: 'marketing', role: 'owner' }])
  })
})

describe('a domain with three owners', () => {
  it('lets each of them review and decide', async () => {
    const given = await owners('finance', ['owner', 'second', 'third'])
    expect(given.statusCode, given.body).toBe(200)
    const p = await submitted('finance', 'Three owners')
    expect(await told(p.id, 'proposal.submitted')).toEqual(
      [people.owner, people.second, people.third].sort(),
    )
    for (const who of ['owner', 'second', 'third'] as const)
      expect(await queue(who)).toContain(p.id)
    const decided = await call('POST', `/review/${p.id}/return`, 'third', {
      revision: p.revision,
      note: 'Not a fact yet: name the source',
    })
    expect(decided.statusCode, decided.body).toBe(200)
    const decisions = await client.query<{ capacity: string; decided_by: string }>(
      'select capacity::text, decided_by::text from decisions where proposal_id=$1',
      [p.id],
    )
    expect(decisions.rows).toEqual([{ capacity: 'owner', decided_by: people.third }])
  })

  it('leaves the others when one or two go, and refuses only the last', async () => {
    const two = await owners('finance', ['owner'])
    expect(two.statusCode, two.body).toBe(200)
    const holders = await client.query<{ person_id: string }>(
      "select person_id::text from area_assignments where area_id='finance' and role='owner' and valid_at @> now()",
    )
    expect(holders.rows).toEqual([{ person_id: people.owner }])
    const last = await owners('finance', [])
    expect(last.statusCode).toBe(409)
    // The single-change route keeps the same rule.
    const single = await call('POST', '/assignments/revoke', 'admin', {
      personId: people.owner,
      areaId: 'finance',
      role: 'owner',
    })
    expect(single.statusCode).toBe(409)
  })
})
