import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import {
  createRelay,
  outboxRelayJob,
  relayOutbox,
} from '../../src/server/modules/notifications/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, openEdition, people, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/**
 * The outbox relay end to end: writes through the API, the real relay on LISTEN/NOTIFY, and the
 * inbox items it writes (`inbox_items`), which the Inbox reads for alerts.
 */

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const relay = createRelay({
  // As the service listens: under the API role.
  connectionString: `${url}?options=${encodeURIComponent(`-c role=${localRoles.api}`)}`,
  database,
  logger,
  pollMs: 200,
})
const app = buildApp({
  database,
  logger,
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Who = keyof typeof people
type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers = {} as Record<Who, Headers>

beforeAll(async () => {
  await foundation(client)
  // A second finance owner, who reviews too.
  await client.query(
    "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'owner')",
    [people.admin],
  )
  await transaction(client, async () => {
    const v = await version(client, { risk: 'low', owner: people.owner })
    await accept(client, v.id)
    let seq = await openEdition(client)
    await client.query("select set_config('cl.person_id',$1,true)", [people.admin])
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
    seq = await openEdition(client)
    await client.query('select edition_serve_item_version($1,$2)', [seq, v.id])
    // The live vocabulary is a fixture here, as in the write-path tests.
    await client.query('alter table vocab_term_service disable trigger user')
    for (const [key, name, ref] of [
      ['metric:orders', 'Orders', 'demo:orders'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,name,area_id,proposer_id,content_digest,version_no) values($1,$2,'finance',$4,sha256('term'),1) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$3 from v where $3::text is not null) select id from v`,
        [key, name, ref, people.owner],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('alter table vocab_term_service enable trigger user')
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
  relay.start()
})
afterAll(async () => {
  await relay.stop()
  await app.close()
})

const post = (path: string, payload: object | undefined, who: Who) =>
  app.inject({
    method: 'POST',
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

async function submitted(title = 'A dated note'): Promise<ProposalRecord> {
  const created = await post(
    '/proposals',
    {
      draft: {
        areaId: 'finance',
        title,
        summary: 'Private market update',
        scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
        validity: { start: '2026-08-04', end: null },
        evidence: [{ url: 'https://example.test/r', quote: 'Trading resumed', date: '2026-08-04' }],
      },
    },
    'author',
  )
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const response = await post(`/proposals/${p.id}/submit`, { revision: p.revision }, 'author')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}

/** A person's inbox items, newest first, after the relay ran. */
async function inbox(who: Who) {
  await relayOutbox(database)
  return (
    await client.query<{
      kind: string
      subject: { type: string; id: string }
      state: string | null
      actorId: string | null
      readAt: string | null
    }>(
      `select kind, json_build_object('type', subject_type, 'id', subject_id) as subject,
         payload->>'state' as state, actor_id::text as "actorId", read_at::text as "readAt"
       from inbox_items where person_id = $1 order by id desc`,
      [people[who]],
    )
  ).rows
}
const kinds = (items: Awaited<ReturnType<typeof inbox>>, subject: string) =>
  items.filter((i) => i.subject.id === subject).map((i) => i.kind)

/** Inserts outbox events as a background writer would, outside any person's transaction. */
async function editionEvents(n: number) {
  await client.query(
    `insert into outbox_events (topic, aggregate_type, aggregate_id, payload)
     select 'edition.published', 'edition', g::text, jsonb_build_object('seq', g) from generate_series(1, $1) g`,
    [n],
  )
}

describe('the outbox relay', () => {
  it('tells the reviewers about a submission, and nobody else', async () => {
    const p = await submitted()
    const owner = await inbox('owner')
    expect(kinds(owner, p.id)).toEqual(['proposal.submitted'])
    expect(owner.find((i) => i.subject.id === p.id)).toMatchObject({
      subject: { type: 'proposal', id: p.id },
      state: 'submitted',
      actorId: people.author,
      readAt: null,
    })
    // The second owner reviews too; the author, the approver and others do not.
    expect(kinds(await inbox('admin'), p.id)).toEqual(['proposal.submitted'])
    for (const who of ['author', 'approver', 'stranger'] as const)
      expect(kinds(await inbox(who), p.id)).toEqual([])
    // Inbox items hold ids and states, never the proposal's text.
    const rows = await client.query('select payload from inbox_items')
    expect(JSON.stringify(rows.rows)).not.toContain('Private market update')
  })

  it('relays each event once, even when relays race', async () => {
    const p = await submitted('Raced note')
    await client.query(
      `insert into outbox_events (topic, area_id, aggregate_type, aggregate_id, payload)
       select 'proposal.commented', 'finance', 'proposal', $1, '{}' from generate_series(1, 300)`,
      [p.id],
    )
    const passes = await Promise.all(Array.from({ length: 6 }, () => relayOutbox(database)))
    expect(passes.reduce((n, pass) => n + pass.relayed, 0)).toBeLessThanOrEqual(302)
    const { rows } = await client.query<{ waiting: number; distinct: number; total: number }>(
      `select count(*) filter (where relayed_at is null)::int as waiting,
       count(distinct relay_seq)::int as distinct, count(relay_seq)::int as total from outbox_events`,
    )
    expect(rows[0]!.waiting).toBe(0)
    expect(rows[0]!.distinct).toBe(rows[0]!.total)
    // One inbox item per reviewer and event, however often the relay ran.
    const items = await client.query<{ n: number }>(
      `select count(*)::int as n from inbox_items i join outbox_events o on o.seq = i.event_seq
       where o.aggregate_id = $1 and o.topic = 'proposal.commented'`,
      [p.id],
    )
    // The writer acted as nobody, so the proposer and both owners each get one.
    expect(items.rows[0]!.n).toBe(900)
    expect((await client.query('select * from cl_outbox_relay(10)')).rows).toEqual([
      { relayed: 0, delivered: 0, head: null },
    ])
  })

  it('numbers events in commit order, so a late commit is never skipped', async () => {
    await relayOutbox(database)
    const slow = new pg.Client({ connectionString: url })
    await slow.connect()
    try {
      await slow.query('begin')
      const early = await slow.query<{ seq: string }>(
        "insert into outbox_events (topic, aggregate_type, aggregate_id) values ('edition.published','edition','early') returning seq",
      )
      const late = await client.query<{ seq: string }>(
        "insert into outbox_events (topic, aggregate_type, aggregate_id) values ('edition.published','edition','late') returning seq",
      )
      expect(Number(early.rows[0]!.seq)).toBeLessThan(Number(late.rows[0]!.seq))
      await relayOutbox(database)
      await slow.query('commit')
      await relayOutbox(database)
    } finally {
      await slow.end()
    }
    const { rows } = await client.query<{ aggregate_id: string }>(
      "select aggregate_id from outbox_events where aggregate_id in ('early','late') order by relay_seq",
    )
    expect(rows.map((r) => r.aggregate_id)).toEqual(['late', 'early'])
  })

  it('keeps relaying after losing its listening connection, and listens again', async () => {
    const listeners = async () =>
      (
        await client.query<{ pid: number }>(
          "select pid from pg_stat_activity where application_name = 'heed-relay' and datname = current_database()",
        )
      ).rows.map((row) => row.pid)
    await expect.poll(listeners).toHaveLength(1)
    const [lost] = await listeners()
    await client.query('reset role')
    try {
      await client.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'heed-relay' and datname = current_database()",
      )
    } finally {
      await client.query(`set role ${localRoles.owner}`)
    }
    await editionEvents(1)
    await expect
      .poll(
        async () =>
          (
            await client.query<{ n: number }>(
              'select count(*)::int as n from outbox_events where relayed_at is null',
            )
          ).rows[0]!.n,
      )
      .toBe(0)
    // A new connection listens in place of the terminated one.
    await expect
      .poll(
        async () => {
          const now = await listeners()
          return now.length === 1 && now[0] !== lost
        },
        { timeout: 5_000 },
      )
      .toBe(true)
  })

  it('runs as a scheduled job that keeps the watchdog informed', async () => {
    await editionEvents(3)
    const summary = await outboxRelayJob.run({
      database,
      logger,
      signal: new AbortController().signal,
    })
    expect(summary).toMatchObject({ relayed: expect.any(Number) as number, delivered: 0 })
    expect(
      (await client.query('select count(*)::int as n from outbox_events where relayed_at is null'))
        .rows,
    ).toEqual([{ n: 0 }])
  })

  it('lets only the API role relay, and never lets it write another person’s inbox', async () => {
    await client.query('begin')
    try {
      await client.query(`set local role ${localRoles.serve}`)
      await expect(client.query('select * from cl_outbox_relay(1)')).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await client.query('rollback')
    }
    await client.query('begin')
    try {
      await client.query(`set local role ${localRoles.api}`)
      await client.query("select set_config('cl.person_id',$1,true)", [people.stranger])
      await expect(
        client.query(
          "insert into inbox_items (person_id, kind, subject_type, subject_id) values ($1,'x.y','proposal','p')",
          [people.owner],
        ),
      ).rejects.toThrow(/row-level security/)
    } finally {
      await client.query('rollback')
    }
  })
})
