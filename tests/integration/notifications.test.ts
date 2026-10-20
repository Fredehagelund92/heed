import { randomUUID } from 'node:crypto'
import { get as httpGet, type IncomingMessage } from 'node:http'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { StreamEvent } from '../../src/contract/notifications.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import {
  createHub,
  createRelay,
  outboxRelayJob,
  relayOutbox,
} from '../../src/server/modules/notifications/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, openEdition, people, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/**
 * S9 end to end: writes through the API, the real relay on LISTEN/NOTIFY, live streams over a
 * listening HTTP server, the inbox and the activity feed.
 */

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const hub = createHub(database, { pollMs: 200 })
const relay = createRelay({
  // As the service listens: under the API role.
  connectionString: `${url}?options=${encodeURIComponent(`-c role=${localRoles.api}`)}`,
  database,
  hub,
  logger,
  pollMs: 200,
})
const app = buildApp({
  database,
  logger,
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  notifications: hub,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Who = keyof typeof people
type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers = {} as Record<Who, Headers>
let base: string

beforeAll(async () => {
  await foundation(client)
  // A second finance owner, to hand reviews over to.
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
  base = await app.listen({ host: '127.0.0.1', port: 0 })
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
const get = (path: string, who: Who) =>
  app.inject({ method: 'GET', url: '/api/v1' + path, headers: headers[who] })

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

type Inbox = {
  items: {
    id: string
    kind: string
    subject: { type: string; id: string }
    state: string | null
    title: string | null
    actor: { id: string; name: string } | null
    readAt: string | null
    archivedAt: string | null
  }[]
  unread: number
  nextBefore: string | null
}
async function inbox(who: Who, query = ''): Promise<Inbox> {
  await relayOutbox(database)
  const response = await get('/inbox' + query, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Inbox>()
}
const kinds = (page: Inbox, subject: string) =>
  page.items.filter((i) => i.subject.id === subject).map((i) => i.kind)

/** Inserts outbox events as a background writer would, outside any person's transaction. */
async function editionEvents(n: number) {
  await client.query(
    `insert into outbox_events (topic, aggregate_type, aggregate_id, payload)
     select 'edition.published', 'edition', g::text, jsonb_build_object('seq', g) from generate_series(1, $1) g`,
    [n],
  )
}

interface Message {
  id: string | undefined
  event: string | undefined
  data: StreamEvent
}
/**
 * A live stream read over real HTTP, parsed as the browser's EventSource would. Each stream has
 * its own connection, closed with the stream.
 */
async function open(who: Who | null, lastEventId?: string, server = base) {
  const request = httpGet(`${server}/api/v1/events`, {
    agent: false,
    headers: {
      ...(who ? { cookie: headers[who].cookie } : {}),
      ...(lastEventId !== undefined ? { 'last-event-id': lastEventId } : {}),
    },
  })
  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    request.once('response', resolve).once('error', reject),
  )
  const close = () => request.destroy()
  if (response.statusCode !== 200) {
    response.resume()
    close()
    return { refused: response.statusCode }
  }
  expect(response.headers['content-type']).toMatch(/^text\/event-stream/)
  expect(response.headers.connection).toBe('close')
  response.setEncoding('utf8')
  let buffer = ''
  let ended = false
  const messages: Message[] = []
  const waiting = new Set<() => void>()
  void (async () => {
    try {
      for await (const value of response as AsyncIterable<string>) {
        buffer += value
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const fields = new Map<string, string>()
          for (const line of block.split('\n'))
            if (line && !line.startsWith(':')) {
              const at = line.indexOf(':')
              fields.set(line.slice(0, at), line.slice(at + 1).trimStart())
            }
          if (fields.has('data'))
            messages.push({
              id: fields.get('id'),
              event: fields.get('event'),
              data: JSON.parse(fields.get('data')!) as StreamEvent,
            })
          for (const wake of waiting) wake()
        }
      }
    } catch {
      // closed by the test
    } finally {
      ended = true
      for (const wake of waiting) wake()
    }
  })()
  /** Waits until the messages so far satisfy `done`, or fails after `ms`. */
  async function until(done: (messages: Message[]) => boolean, ms = 5_000): Promise<Message[]> {
    const deadline = Date.now() + ms
    while (!done(messages) && !ended && Date.now() < deadline)
      await new Promise<void>((resolve) => {
        const wake = () => {
          waiting.delete(wake)
          resolve()
        }
        waiting.add(wake)
        setTimeout(wake, 50)
      })
    expect(done(messages), JSON.stringify(messages.map((m) => m.data.topic))).toBe(true)
    return [...messages]
  }
  /** Waits until `count` messages have arrived. */
  const take = async (count: number, ms?: number) =>
    (await until((all) => all.length >= count, ms)).slice(0, count)
  return {
    messages,
    take,
    until,
    /** Every message so far, after a quiet moment for stragglers. */
    async settle(ms = 400) {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return [...messages]
    },
    /** Waits until the server ends the stream, or fails after `ms`. */
    async finished(ms = 5_000) {
      await until(() => ended, ms)
    },
    close,
  }
}
type Stream = Exclude<Awaited<ReturnType<typeof open>>, { refused: unknown }>
async function subscribe(who: Who, lastEventId?: string, server?: string): Promise<Stream> {
  const opened = await open(who, lastEventId, server)
  if ('refused' in opened) throw new Error(`stream refused: ${opened.refused}`)
  return opened
}

describe('the outbox relay', () => {
  it('tells the reviewers about a submission, and nobody else', async () => {
    const p = await submitted()
    const owner = await inbox('owner')
    expect(kinds(owner, p.id)).toEqual(['proposal.submitted'])
    expect(owner.items.find((i) => i.subject.id === p.id)).toMatchObject({
      subject: { type: 'proposal', id: p.id },
      state: 'submitted',
      title: 'A dated note',
      actor: { id: people.author, name: 'author' },
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

  it('tells the proposer about a claim and comments, and the new reviewer about a hand-over', async () => {
    let p = await submitted('Claimed note')
    const claimed = await post(`/proposals/${p.id}/claim`, { revision: p.revision }, 'owner')
    expect(claimed.statusCode, claimed.body).toBe(200)
    p = claimed.json<ProposalRecord>()
    const comment = await post(
      `/proposals/${p.id}/comments`,
      { revision: p.revision, text: 'Which report?' },
      'owner',
    )
    expect(comment.statusCode, comment.body).toBe(200)
    p = comment.json<ProposalRecord>()
    const reply = await post(
      `/proposals/${p.id}/comments`,
      { revision: p.revision, text: 'The weekly one' },
      'author',
    )
    expect(reply.statusCode, reply.body).toBe(200)
    p = reply.json<ProposalRecord>()
    const handed = await post(
      `/proposals/${p.id}/hand-over`,
      { revision: p.revision, personId: people.admin },
      'owner',
    )
    expect(handed.statusCode, handed.body).toBe(200)

    expect(kinds(await inbox('author'), p.id)).toEqual(['proposal.commented', 'proposal.claimed'])
    // While claimed, the proposer's reply reaches the claiming reviewer only.
    expect(kinds(await inbox('owner'), p.id)).toEqual(['proposal.commented', 'proposal.submitted'])
    expect(kinds(await inbox('admin'), p.id)).toEqual([
      'proposal.handed_over',
      'proposal.submitted',
    ])
  })

  it('discusses any proposal: a term without a domain tells the administrators (FR-222)', async () => {
    const proposed = await post(
      '/vocabulary/proposals',
      {
        key: 'metric:talk_rate',
        kind: 'metric',
        parentKey: null,
        name: 'Talk rate',
        aliases: [],
        areaId: null,
        definitionRefs: [],
      },
      'author',
    )
    expect(proposed.statusCode, proposed.body).toBe(200)
    const term = proposed.json<{ id: string; revision: number }>()
    const asked = await post(
      `/proposals/${term.id}/comments`,
      { revision: term.revision, text: 'Which **model** defines it?' },
      'author',
    )
    expect(asked.statusCode, asked.body).toBe(200)
    // Nobody reviews a term without a domain but the administrators, who decide it.
    expect(kinds(await inbox('admin'), term.id)).toEqual(['proposal.commented'])
    const stranger = await post(
      `/proposals/${term.id}/comments`,
      { revision: asked.json<ProposalRecord>().revision, text: 'Hello' },
      'owner',
    )
    expect(stranger.statusCode, stranger.body).toBe(404)
    const answer = await post(
      `/proposals/${term.id}/comments`,
      { revision: asked.json<ProposalRecord>().revision, text: 'The payments one.' },
      'admin',
    )
    expect(answer.statusCode, answer.body).toBe(200)
    expect(kinds(await inbox('author'), term.id)).toEqual(['proposal.commented'])
  })

  it("keeps a proposal's comments from people outside its review, once it is accepted", async () => {
    const p = await submitted('Discussed note')
    const commented = await post(
      `/proposals/${p.id}/comments`,
      { revision: p.revision, text: 'Only for the review' },
      'owner',
    )
    expect(commented.statusCode, commented.body).toBe(200)
    await client.query("update proposals set state='accepted',closed_at=now() where id=$1", [p.id])
    const said = async (who: Who) =>
      (await get(`/proposals/${p.id}/events`, who))
        .json<{ kind: string }[]>()
        .filter((event) => event.kind === 'commented').length
    expect(await said('stranger')).toBe(0)
    expect(await said('author')).toBe(1)
    expect(await said('approver')).toBe(1)
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

describe('the live stream', () => {
  it('streams the events each person may see, as they happen', async () => {
    const owner = await subscribe('owner')
    const stranger = await subscribe('stranger')
    const [ready] = await owner.take(1)
    expect(ready!.data).toMatchObject({ topic: 'stream.ready', subject: null })
    expect(ready!.id).toBe(String(ready!.data.id))
    await stranger.take(1)

    const p = await submitted('Streamed note')
    const about = (all: Message[]) => all.filter((m) => m.data.subject?.id === p.id)
    const seen = about(
      await owner.until(
        (all) => about(all).filter((m) => m.data.topic === 'proposal.checked').length >= 2,
      ),
    )
    expect(seen.map((m) => m.data.topic)).toEqual([
      'proposal.created',
      'proposal.submitted',
      'proposal.checked',
      'proposal.checked',
    ])
    const submittedEvent = seen.find((m) => m.data.topic === 'proposal.submitted')!
    expect(submittedEvent.data).toMatchObject({
      areaId: 'finance',
      subject: { type: 'proposal', id: p.id },
      payload: { id: p.id, state: 'submitted' },
      inbox: true,
    })
    expect(Number(submittedEvent.id)).toBe(submittedEvent.data.id)
    expect(JSON.stringify(owner.messages)).not.toContain('Private market update')

    // A stranger may not see another person's proposal, but sees releases.
    await editionEvents(1)
    const [, published] = await stranger.take(2)
    expect(published!.data).toMatchObject({ topic: 'edition.published', inbox: false })
    expect((await stranger.settle()).map((m) => m.data.topic)).toEqual([
      'stream.ready',
      'edition.published',
    ])
    owner.close()
    stranger.close()
  })

  it('replays exactly the missed events after Last-Event-ID, then continues live', async () => {
    const first = await subscribe('owner')
    const [ready] = await first.take(1)
    first.close()

    const p = await submitted('Missed note')
    await relayOutbox(database)
    const missed = await client.query<{ relay_seq: string }>(
      `select relay_seq from outbox_events where relay_seq > $1
       and (aggregate_type = 'edition' or aggregate_id = $2) order by relay_seq`,
      [ready!.id, p.id],
    )
    const resumed = await subscribe('owner', ready!.id)
    const replayed = await resumed.take(missed.rows.length)
    expect(replayed.map((m) => m.id)).toEqual(missed.rows.map((r) => r.relay_seq))
    expect(replayed.map((m) => m.data.topic)).toContain('proposal.submitted')

    await editionEvents(1)
    const live = await resumed.take(missed.rows.length + 1)
    expect(live.at(-1)!.data.topic).toBe('edition.published')
    expect(Number(live.at(-1)!.id)).toBeGreaterThan(Number(replayed.at(-1)!.id))
    resumed.close()
  })

  it('sends every event once, in order, under concurrent writes and relays', async () => {
    const stream = await subscribe('stranger')
    const [ready] = await stream.take(1)
    const writers = Array.from({ length: 20 }, () => {
      const writer = new pg.Client({ connectionString: url })
      return writer
        .connect()
        .then(async () => {
          for (let i = 0; i < 5; i++) {
            await writer.query(
              "insert into outbox_events (topic, aggregate_type, aggregate_id) values ('edition.published','edition','burst')",
            )
            if (i % 2) void relayOutbox(database)
            hub.wake()
          }
        })
        .finally(() => writer.end())
    })
    await Promise.all(writers)
    await relayOutbox(database)
    await stream.take(101, 10_000)
    const messages = (await stream.settle()).slice(1)
    expect(messages).toHaveLength(100)
    const ids = messages.map((m) => Number(m.id))
    expect(new Set(ids).size).toBe(100)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(ids[0]).toBeGreaterThan(Number(ready!.id))
    stream.close()
  })

  it('resets a stream whose missed events are no longer kept', async () => {
    const head = await subscribe('owner')
    const [ready] = await head.take(1)
    head.close()
    for (const lastEventId of ['999999999', 'not-a-number']) {
      const stream = await subscribe('owner', lastEventId)
      const [reset] = await stream.take(1)
      expect(reset!.data).toMatchObject({ topic: 'stream.reset' })
      expect(Number(reset!.id)).toBeGreaterThanOrEqual(Number(ready!.id))
      stream.close()
    }
    // Retention removed the event the reader last saw.
    await editionEvents(2)
    await relayOutbox(database)
    const gone = await client.query<{ relay_seq: string }>(
      'delete from outbox_events where relay_seq = (select max(relay_seq) - 1 from outbox_events) returning relay_seq',
    )
    const stream = await subscribe('owner', gone.rows[0]!.relay_seq)
    expect((await stream.take(1))[0]!.data.topic).toBe('stream.reset')
    stream.close()
  })

  it('ends when the session ends, and refuses a reader who is not signed in', async () => {
    expect(await open(null)).toEqual({ refused: 401 })

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: 'approver@example.test' },
    })
    const session = {
      origin: 'http://localhost',
      cookie: signIn.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': signIn.json<{ csrfToken: string }>().csrfToken,
    }
    const saved = headers.approver
    headers.approver = session
    try {
      const stream = await subscribe('approver')
      await stream.take(1)
      const out = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-out',
        headers: session,
      })
      expect(out.statusCode, out.body).toBe(200)
      await editionEvents(1)
      await relayOutbox(database)
      await stream.finished()
      expect(stream.messages.map((m) => m.data.topic)).toEqual(['stream.ready'])
    } finally {
      headers.approver = saved
    }
  })

  it('ends open streams promptly when the service shuts down', async () => {
    const service = buildApp({
      database: apiDatabase(url),
      logger,
      jobs: idleJobs(),
      devPeople: [],
    })
    const address = await service.listen({ host: '127.0.0.1', port: 0 })
    const live = await subscribe('owner', undefined, address)
    await live.take(1)
    const started = performance.now()
    await service.close()
    expect(performance.now() - started).toBeLessThan(2_000)
    await live.finished()
  })
})

describe('the inbox', () => {
  it('pages, marks read, archives, and tells the person’s other streams', async () => {
    for (let i = 0; i < 3; i++) await submitted(`Inbox note ${i}`)
    const all = await inbox('owner')
    expect(all.unread).toBeGreaterThanOrEqual(3)
    const page = await inbox('owner', '?limit=2')
    expect(page.items).toHaveLength(2)
    expect(page.items.map((i) => i.id)).toEqual(all.items.slice(0, 2).map((i) => i.id))
    const next = await inbox('owner', `?limit=2&before=${page.nextBefore}`)
    expect(next.items[0]!.id).toBe(all.items[2]!.id)

    const stream = await subscribe('owner')
    await stream.take(1)
    const other = await subscribe('author')
    await other.take(1)

    const [first, second] = all.items
    const read = await post('/inbox/read', { ids: [first!.id] }, 'owner')
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json()).toEqual({ changed: 1, unread: all.unread - 1 })
    expect((await post('/inbox/read', { ids: [first!.id] }, 'owner')).json()).toMatchObject({
      changed: 0,
    })
    // Someone else's item ids change nothing.
    expect((await post('/inbox/read', { ids: [second!.id] }, 'author')).json()).toMatchObject({
      changed: 0,
    })
    const archived = await post('/inbox/archive', { ids: [second!.id] }, 'owner')
    expect(archived.json()).toEqual({ changed: 1, unread: all.unread - 2 })
    const archivedPage = await inbox('owner', '?filter=archived')
    expect(archivedPage.items.map((i) => i.id)).toEqual([second!.id])
    expect(archivedPage.items[0]!.readAt).not.toBeNull()
    const unread = await inbox('owner', '?filter=unread')
    expect(unread.unread).toBe(all.unread - 2)
    expect(unread.items.map((i) => i.id)).not.toContain(first!.id)
    expect((await inbox('owner')).items.map((i) => i.id)).not.toContain(second!.id)

    const cleared = await post('/inbox/read-all', undefined, 'owner')
    expect(cleared.json()).toEqual({ changed: all.unread - 2, unread: 0 })

    const changes = await stream.take(4)
    expect(changes.slice(1).map((m) => [m.data.topic, m.data.payload])).toEqual([
      ['inbox.changed', { unread: all.unread - 1 }],
      ['inbox.changed', { unread: all.unread - 2 }],
      ['inbox.changed', { unread: 0 }],
    ])
    expect((await other.settle()).map((m) => m.data.topic)).toEqual(['stream.ready'])
    stream.close()
    other.close()
  })

  it('refuses changes without the session’s CSRF token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox/read-all',
      headers: { cookie: headers.owner.cookie, origin: 'http://localhost' },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('the activity feed', () => {
  it('lists review steps the reader may see, newest first, by area and page', async () => {
    await editionEvents(1)
    const p = await submitted('Activity note')
    await relayOutbox(database)
    const feed = await get('/activity?areaId=finance&limit=100', 'owner')
    expect(feed.statusCode, feed.body).toBe(200)
    const { entries } = feed.json<{
      entries: {
        id: number
        topic: string
        subject: { id: string }
        title: string | null
        actor: { name: string } | null
      }[]
    }>()
    const mine = entries.filter((e) => e.subject.id === p.id)
    expect(mine).toEqual([
      expect.objectContaining({
        topic: 'proposal.submitted',
        title: 'Activity note',
        actor: { id: people.author, name: 'author' },
      }),
    ])
    // Drafts, autosaves, check runs and inbox housekeeping stay out of the feed.
    const topics = new Set(entries.map((e) => e.topic))
    for (const topic of ['proposal.created', 'proposal.saved', 'proposal.checked', 'inbox.changed'])
      expect(topics.has(topic)).toBe(false)
    expect(entries.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort((a, b) => b - a))

    const page = (await get('/activity?limit=2', 'owner')).json<{
      entries: { id: number }[]
      nextBefore: number
    }>()
    expect(page.entries).toHaveLength(2)
    const rest = (await get(`/activity?limit=2&before=${page.nextBefore}`, 'owner')).json<{
      entries: { id: number }[]
    }>()
    expect(rest.entries[0]!.id).toBeLessThan(page.entries[1]!.id)

    // A stranger sees releases, never another person's proposal.
    const stranger = (await get('/activity?limit=100', 'stranger')).json<{
      entries: { topic: string }[]
    }>()
    expect(stranger.entries.length).toBeGreaterThan(0)
    expect(stranger.entries.every((e) => e.topic === 'edition.published')).toBe(true)
  })
})
