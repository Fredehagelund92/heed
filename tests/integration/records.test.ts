import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LookupEvent, RecordsAnswer } from '../../src/contract/answer.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, openEdition, people, servingEdition, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Records answers in Ask (FR-718) on PostgreSQL: a question about the context's own records is
  answered inside the person's own request, from what the Context list shows them. A member, an
  owner and an administrator get the same answers over the same rows; an item an audience rule
  hides is never counted or named; a version never published is not in the records; a question
  about one person's work is refused; and only which question it was is counted, by week.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const origin = 'http://localhost:5173'
const clock = systemClock('2026-10-08')

const reader = '00000000-0000-4000-8000-0000000000b1'
const hidden = { id: 'itm_recvault01', title: 'Quokkasunrise harbour closure' }
const archived = { id: 'itm_recgone001', title: 'Harbour opening hours, winter' }
const draft = { id: 'itm_recdraft01', title: 'Zephyrdraft harbour note' }
const canaries = [hidden.id, 'Quokkasunrise', draft.id, 'Zephyrdraft']

const app = buildApp({
  database,
  jobs: idleJobs(),
  clock,
  logger: createLogger({ level: 'silent' }),
  devPeople: ['owner', 'admin', 'reader'].map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  origins: [origin],
})

type Session = { cookie: string; csrf: string }
const sessions = new Map<string, Session>()

async function signIn(name: string): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  const cookie = response.cookies[0]!
  return {
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: response.json<{ csrfToken: string }>().csrfToken,
  }
}

/** A question asked in Ask as `who`: the look-up's events, and its body as sent. */
async function ask(who: string, payload: object): Promise<{ events: LookupEvent[]; body: string }> {
  const session = sessions.get(who)!
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/ask/lookup',
    headers: { cookie: session.cookie, 'x-heed-csrf': session.csrf, origin },
    payload,
  })
  expect(response.statusCode, response.body).toBe(200)
  const events = response.body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as LookupEvent)
  return { events, body: response.body }
}
const recordsOf = async (who: string, question: string): Promise<RecordsAnswer> => {
  const { events } = await ask(who, { question })
  const found = events.find((e) => e.type === 'records')
  if (!found) throw new Error(`"${question}" got no records answer`)
  expect(events).toHaveLength(1)
  return found.records
}

/** A records answer that answers, not one that refuses. */
const counted = async (who: string, question: string) => {
  const found = await recordsOf(who, question)
  if (found.refused) throw new Error(`"${question}" was refused`)
  return found
}

let secretVersion = ''

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await client.query(
      "insert into people (id,email,display_name) values ($1,'reader@example.test','reader')",
      [reader],
    )
    await servingEdition(client)
    const serve = async (id: string) => {
      const edition = await openEdition(client)
      await client.query('select edition_serve_item_version($1,$2)', [edition, id])
      await client.query('select edition_seal($1)', [edition])
      await client.query('select edition_publish($1)', [edition])
    }
    // An item published, then archived.
    const gone = await version(client, {
      item: archived.id,
      title: archived.title,
      owner: people.owner,
    })
    await accept(client, gone.id)
    await serve(gone.id)
    await client.query(
      "insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,'finance',$2,'owner','retire','Ended')",
      [gone.id, people.owner],
    )
    const close = await openEdition(client)
    await client.query('select edition_close_item($1,$2)', [close, archived.id])
    await client.query('select edition_seal($1)', [close])
    await client.query('select edition_publish($1)', [close])
    // An item for a group nobody is in (groups are parked), as the audience sweep plants it.
    const secret = await version(client, {
      item: hidden.id,
      title: hidden.title,
      owner: people.owner,
    })
    secretVersion = secret.id
    await accept(client, secret.id)
    await serve(secret.id)
    // A version written and never published: a draft is no context item.
    await version(client, { item: draft.id, title: draft.title })
  })
  // Versions are append-only, so the group goes on with their guards off, once they are written.
  await transaction(client, async () => {
    await client.query('alter table item_versions disable trigger user')
    await client.query(
      "update item_versions set audience_groups = '{finance_team}' where id = $1",
      [secretVersion],
    )
    await client.query('alter table item_versions enable trigger user')
  })
  for (const name of ['owner', 'admin', 'reader']) sessions.set(name, await signIn(name))
}, 120_000)
afterAll(async () => {
  await app.close()
})

const questions = [
  'give me context created in last 24 hours?',
  'what changed this week?',
  'what is due for a check?',
  'what is archived?',
  'who owns Finance?',
  'which domains have no owner?',
  'how many context items are there?',
  'what did agents ask that found nothing?',
]

describe('records answers on PostgreSQL', () => {
  it('gives a member, an owner and an administrator the same answers, from what Context lists', async () => {
    const answers = new Map<string, string[]>()
    for (const who of ['reader', 'owner', 'admin']) {
      const session = sessions.get(who)!
      const library = await app.inject({
        method: 'GET',
        url: '/api/v1/library',
        headers: { cookie: session.cookie, 'x-heed-csrf': session.csrf, origin },
      })
      expect(library.statusCode, library.body).toBe(200)
      const listed = library.json<{ items: { id: string; kind: string }[] }>().items
      const count = await counted(who, 'how many context items are there?')
      expect(count.total, who).toBe(listed.filter((i) => i.kind !== 'example').length)
      expect(count.total, who).toBe(2)
      expect((await counted(who, 'what is archived?')).rows).toEqual([
        expect.objectContaining({ type: 'item', id: archived.id, title: archived.title }),
      ])
      const said: string[] = []
      for (const question of questions) {
        const found = await recordsOf(who, question)
        said.push(found.sentence)
      }
      answers.set(who, said)
    }
    expect(answers.get('owner')).toEqual(answers.get('reader'))
    expect(answers.get('admin')).toEqual(answers.get('reader'))
  })

  it('never counts, names or hints at an item hidden by its audience, or a version never published', async () => {
    for (const who of ['reader', 'owner', 'admin'])
      for (const question of [
        ...questions,
        'which items have no owner?',
        'what is new in Finance?',
      ]) {
        const { body } = await ask(who, { question })
        expect(
          canaries.filter((c) => body.includes(c)),
          `${who}: ${question}`,
        ).toEqual([])
      }
    // Both published items were created within the day; the hidden one is never among them.
    const created = await counted('reader', 'give me context created in last 24 hours?')
    expect(created.sentence).toBe('2 context items were created in the last 24 hours.')
    expect(created.period?.label).toMatch(/, UTC$/)
  })

  it('names the owners of a domain as Context names them', async () => {
    expect((await recordsOf('reader', 'who owns Finance?')).sentence).toBe('owner owns Finance.')
    expect((await recordsOf('reader', 'which domains have no owner?')).sentence).toMatch(
      /^Marketing has no owner/,
    )
  })

  it("refuses a question about one person's work, and reads a question scoped with @ as before", async () => {
    expect(await recordsOf('reader', 'what did owner write this week?')).toMatchObject({
      refused: true,
    })
    const scoped = await ask('reader', {
      question: 'what was created this week?',
      metrics: ['metric:orders'],
    })
    expect(scoped.events.some((e) => e.type === 'records')).toBe(false)
    expect(scoped.events.at(-1)?.type).toBe('answer')
  })

  it('counts only which question was asked, by week: never the words, never who', async () => {
    await client.query('delete from records_asked_weekly')
    await recordsOf('reader', 'what is archived?')
    await recordsOf('owner', 'what is archived?')
    await recordsOf('admin', 'what did owner write this week?')
    const { rows } = await client.query<{ week: string; intent: string; asks: number }>(
      "select to_char(week,'YYYY-MM-DD') as week, intent, asks from records_asked_weekly order by intent",
    )
    expect(rows).toEqual([
      { week: '2026-10-05', intent: 'archived', asks: 2 },
      { week: '2026-10-05', intent: 'refused', asks: 1 },
    ])
  })
})
