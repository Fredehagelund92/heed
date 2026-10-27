import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Comment, Thread } from '../../src/contract/comments.ts'
import type { Feed } from '../../src/contract/inbox.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Comments, reactions and mentions over authenticated HTTP (FR-817, golden plan P9): anyone who may
  read a suggestion or a context item comments there and reacts with one of five; people edit and
  delete only their own words; a mention reaches the Inbox of the person mentioned until they read
  it; a reply since someone last opened a thread they take part in is new to them; "Return with a
  note" writes the suggestion's first comment, and its undo takes it away. An owner of Finance is
  `owner`, a member `author`, someone who may see neither a draft nor a pending suggestion
  `stranger`.
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
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  who: Who,
  payload?: object,
) =>
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

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
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
  return {
    areaId: 'finance',
    kind: 'note',
    title: 'Units sold excludes test accounts',
    summary: 'Orders in Norway leave out the 312 accounts our teams use to test the webshop.',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
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
async function submitted(extra: Draft = {}, who: Who = 'author', itemId?: string) {
  const p = await ok<ProposalRecord>(
    call('POST', '/proposals', who, { draft: draft(extra), ...(itemId ? { itemId } : {}) }),
  )
  return ok<ProposalRecord>(
    call('POST', `/proposals/${p.id}/submit`, who, { revision: p.revision }),
  )
}
/** A context item everyone reads: a suggestion its owner published. */
async function live(extra: Draft = {}) {
  const p = await submitted(extra)
  await ok(call('POST', `/review/${p.id}/publish`, 'owner', { revision: p.revision }))
  return p.itemId!
}

const words = (text: string, mention?: { id: string; label: string }) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        ...(mention
          ? [
              { type: 'text', text: ' ' },
              { type: 'mention', attrs: mention },
            ]
          : []),
      ],
    },
  ],
})
const mentionOf = (who: Who) => ({ id: `person:${people[who]}`, label: who })

const post = (who: Who, subject: string, body: object, parentId?: string) =>
  call('POST', '/comments', who, { subject, body, ...(parentId ? { parentId } : {}) })
const thread = async (subject: string, who: Who = 'owner') =>
  (await ok<{ threads: Thread[] }>(call('GET', `/comments?subject=${subject}`, who))).threads[0]!
const feed = (who: Who) => ok<Feed>(call('GET', '/inbox/feed', who))

let item: string
let suggestion: ProposalRecord
beforeAll(async () => {
  item = await live()
  suggestion = await submitted({ title: 'Orders in Norway include staff orders' })
})

describe('a thread on a context item', () => {
  it('lets anyone who reads the item comment, reply and read it back with names and times', async () => {
    const subject = `context:${item}`
    const first = await ok<Comment>(post('author', subject, words('Is this still true in 2027?')))
    expect(first).toMatchObject({
      author: { personId: people.author, name: 'author' },
      returned: false,
      deleted: false,
      editedAt: null,
      replies: [],
      reactions: [],
      body: words('Is this still true in 2027?'),
    })
    expect(Date.parse(first.at)).not.toBeNaN()
    const reply = await ok<Comment>(
      post('owner', subject, words('Yes, until we hear otherwise.'), first.id),
    )
    const read = await thread(subject, 'stranger')
    expect(read.subject).toBe(subject)
    expect(read.comments.map((c) => [c.id, c.replies.map((r) => r.id)])).toEqual([
      [first.id, [reply.id]],
    ])
  })

  it('keeps only what the comment box writes, and refuses an empty or unknown document', async () => {
    const subject = `context:${item}`
    const posted = await ok<Comment>(
      post('author', subject, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'left' },
            content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold', attrs: {} }] }],
          },
        ],
      }),
    )
    expect(posted.body).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] },
      ],
    })
    for (const body of [
      { type: 'doc', content: [{ type: 'paragraph' }] },
      { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'Hi' }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image' }] }] },
      words('x'.repeat(2001)),
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'mention', attrs: { id: 'item:itm_target0001', label: 'An item' } }],
          },
        ],
      },
    ])
      expect((await post('author', subject, body)).statusCode, JSON.stringify(body)).toBe(400)
    // A mention of someone who is not in the workspace.
    const nobody = { id: `person:${randomUUID()}`, label: 'Nobody' }
    expect((await post('author', subject, words('Ask', nobody))).statusCode).toBe(422)
  })

  it('lets only the author edit and delete, and keeps a deleted comment that is answered', async () => {
    const subject = `context:${item}`
    const mine = await ok<Comment>(post('author', subject, words('First thought')))
    expect(
      (await call('PUT', `/comments/${mine.id}`, 'owner', { body: words('Mine now') })).statusCode,
    ).toBe(403)
    expect((await call('DELETE', `/comments/${mine.id}`, 'owner')).statusCode).toBe(403)
    const edited = await ok<Comment>(
      call('PUT', `/comments/${mine.id}`, 'author', { body: words('Second thought') }),
    )
    expect(edited.body).toEqual(words('Second thought'))
    expect(edited.editedAt).not.toBeNull()

    const answer = await ok<Comment>(post('owner', subject, words('Agreed'), mine.id))
    expect(await ok(call('DELETE', `/comments/${mine.id}`, 'author'))).toEqual({ removed: 'kept' })
    const kept = (await thread(subject)).comments.find((c) => c.id === mine.id)!
    expect(kept).toMatchObject({ deleted: true, body: { type: 'doc' }, reactions: [] })
    expect(kept.replies.map((r) => r.id)).toEqual([answer.id])
    // Nothing more happens to it: no reply, no reaction, no edit.
    expect((await post('owner', subject, words('Hello?'), mine.id)).statusCode).toBe(422)
    expect(
      (
        await call('POST', '/reactions/toggle', 'owner', {
          subject,
          commentId: mine.id,
          emoji: '👍',
        })
      ).statusCode,
    ).toBe(409)

    const alone = await ok<Comment>(post('author', subject, words('Never mind')))
    expect(await ok(call('DELETE', `/comments/${alone.id}`, 'author'))).toEqual({ removed: 'gone' })
    expect((await thread(subject)).comments.map((c) => c.id)).not.toContain(alone.id)
    expect((await call('DELETE', `/comments/${alone.id}`, 'author')).statusCode).toBe(404)
  })

  it('takes five reactions only, once per person, on the item and on a comment', async () => {
    const subject = `context:${item}`
    const comment = await ok<Comment>(post('author', subject, words('Shipped')))
    const toggle = (who: Who, emoji: string, commentId?: string) =>
      call('POST', '/reactions/toggle', who, {
        subject,
        emoji,
        ...(commentId ? { commentId } : {}),
      })
    expect(await ok(toggle('owner', '👍'))).toEqual({ on: true })
    expect(await ok(toggle('author', '👍'))).toEqual({ on: true })
    expect(await ok(toggle('owner', '🙏', comment.id))).toEqual({ on: true })
    expect(await ok(toggle('author', '👍'))).toEqual({ on: false })
    for (const emoji of ['🎉', '❤️', ':thumbsup:', '👍🏽'])
      expect((await toggle('owner', emoji)).statusCode, emoji).toBe(400)
    const read = await thread(subject)
    expect(read.reactions).toEqual([
      { emoji: '👍', by: [{ personId: people.owner, name: 'owner' }] },
    ])
    expect(read.comments.find((c) => c.id === comment.id)!.reactions).toEqual([
      { emoji: '🙏', by: [{ personId: people.owner, name: 'owner' }] },
    ])
    // The database keeps the five too, whatever writes to it.
    await expect(
      client.query("insert into reactions (person_id,emoji,item_id) values ($1,'🎉',$2)", [
        people.owner,
        item,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('a thread on a suggestion', () => {
  it('is for those who may read the suggestion only', async () => {
    const subject = `review:${suggestion.id}`
    await ok(post('owner', subject, words('Which markets?')))
    expect((await post('stranger', subject, words('Me too'))).statusCode).toBe(404)
    expect((await call('GET', `/comments?subject=${subject}`, 'stranger')).statusCode).toBe(404)
    const all = await ok<{ threads: Thread[] }>(call('GET', '/comments', 'stranger'))
    expect(all.threads.map((t) => t.subject)).not.toContain(subject)
    expect((await post('author', `review:${randomUUID()}`, words('Lost'))).statusCode).toBe(404)
  })

  it('shows its sender a reply as new until they open the thread again', async () => {
    const p = await submitted({ title: 'Orders in Norway exclude refunds' })
    const subject = `review:${p.id}`
    expect((await thread(subject, 'author')).newReply).toBeNull()
    const reply = await ok<Comment>(post('owner', subject, words('Since when?')))
    expect((await thread(subject, 'author')).newReply).toMatchObject({
      commentId: reply.id,
      from: { personId: people.owner, name: 'owner' },
      excerpt: 'Since when?',
    })
    // Its writer has nothing new: they wrote it.
    expect((await thread(subject, 'owner')).newReply).toBeNull()
    await ok(call('POST', '/comments/threads/read', 'author', { subject }))
    expect((await thread(subject, 'author')).newReply).toBeNull()
    // Answering is reading; the next answer is new to the owner, who takes part now.
    await ok(post('author', subject, words('Since 1 October')))
    expect((await thread(subject, 'author')).newReply).toBeNull()
    expect((await thread(subject, 'owner')).newReply?.excerpt).toBe('Since 1 October')
  })

  it('writes the note of a return as its first comment, and the undo takes it away', async () => {
    const p = await submitted({ title: 'Orders in Norway count gift cards' })
    const subject = `review:${p.id}`
    const returned = await ok<{ undo: string }>(
      call('POST', `/review/${p.id}/return`, 'owner', {
        revision: p.revision,
        note: 'Which source says so?',
      }),
    )
    const [note] = (await thread(subject, 'author')).comments
    expect(note).toMatchObject({
      returned: true,
      author: { personId: people.owner },
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Which source says so?' }] },
        ],
      },
    })
    expect((await thread(subject, 'author')).newReply?.commentId).toBe(note!.id)
    await ok(call('POST', '/decisions/undo', 'owner', { token: returned.undo }))
    expect((await thread(subject, 'author')).comments).toEqual([])
  })

  it('keeps the note as the comment box wrote it, with its mentions', async () => {
    const p = await submitted({ title: 'Orders in Norway count vouchers' })
    const body = words('Ask', mentionOf('admin'))
    await ok(
      call('POST', `/review/${p.id}/return`, 'owner', {
        revision: p.revision,
        note: 'Ask @admin',
        body,
      }),
    )
    const [note] = (await thread(`review:${p.id}`, 'owner')).comments
    expect(note).toMatchObject({ returned: true, body })
    expect(
      (await feed('admin')).cards.filter((c) => c.group === 'mention').map((c) => c.id),
    ).toContain(`mention:review:${p.id}`)
  })
})

describe('mentions', () => {
  it("put a Mentioned you card in the person's Inbox until they read them", async () => {
    const subject = `context:${item}`
    const before = (await feed('stranger')).cards.filter((c) => c.group === 'mention')
    expect(before).toEqual([])
    const comment = await ok<Comment>(
      post('author', subject, words('Can you check?', mentionOf('stranger'))),
    )
    const card = (await feed('stranger')).cards.find((c) => c.id === `mention:${subject}`)
    expect(card).toMatchObject({
      group: 'mention',
      subject,
      commentId: comment.id,
      title: 'Units sold excludes test accounts',
      areaId: 'finance',
      opened: false,
      done: null,
      from: { personId: people.author, name: 'author' },
      excerpt: 'Can you check? @stranger',
    })
    expect((await feed('stranger')).groups).toContainEqual({ group: 'mention', count: 1 })
    expect((await thread(subject, 'stranger')).mentions.map((m) => m.commentId)).toEqual([
      comment.id,
    ])
    // Its author is not told about their own words, nor is anyone else.
    expect((await feed('author')).cards.some((c) => c.id === `mention:${subject}`)).toBe(false)

    expect(await ok(call('POST', '/comments/mentions/read', 'stranger', { subject }))).toEqual({
      marked: 1,
    })
    expect((await feed('stranger')).cards.some((c) => c.group === 'mention')).toBe(false)
    expect((await thread(subject, 'stranger')).mentions).toEqual([])
  })

  it('follow an edit, and opening the card in the Inbox reads them', async () => {
    const subject = `context:${item}`
    const comment = await ok<Comment>(
      post('owner', subject, words('Over to you', mentionOf('author'))),
    )
    expect((await feed('author')).cards.some((c) => c.id === `mention:${subject}`)).toBe(true)
    await ok(call('PUT', `/comments/${comment.id}`, 'owner', { body: words('Over to me') }))
    expect((await feed('author')).cards.some((c) => c.id === `mention:${subject}`)).toBe(false)
    await ok(
      call('PUT', `/comments/${comment.id}`, 'owner', {
        body: words('Over to you', mentionOf('author')),
      }),
    )
    await ok(call('POST', '/inbox/cards/read', 'author', { cards: [`mention:${subject}`] }))
    expect((await feed('author')).cards.some((c) => c.id === `mention:${subject}`)).toBe(false)
  })

  it('of oneself mark nothing, and a deleted comment takes its mentions with it', async () => {
    const subject = `context:${item}`
    await ok(post('admin', subject, words('Note to self', mentionOf('admin'))))
    expect((await feed('admin')).cards.some((c) => c.id === `mention:${subject}`)).toBe(false)
    const gone = await ok<Comment>(post('owner', subject, words('Look', mentionOf('admin'))))
    expect((await feed('admin')).cards.some((c) => c.id === `mention:${subject}`)).toBe(true)
    await ok(call('DELETE', `/comments/${gone.id}`, 'owner'))
    expect((await feed('admin')).cards.some((c) => c.id === `mention:${subject}`)).toBe(false)
  })
})

describe('row security on its own', () => {
  it('refuses a comment as someone else, a change by someone else, and a read without a person', async () => {
    const asApi = async <T>(person: string | null, work: () => Promise<T>) => {
      await client.query(`set role ${identifier(localRoles.api)}`)
      try {
        return await transaction(client, async () => {
          await client.query("select set_config('cl.person_id',$1,true)", [person ?? ''])
          return work()
        })
      } finally {
        await client.query(`set role ${identifier(localRoles.owner)}`)
      }
    }
    const body = JSON.stringify(words('Sneaky'))
    await expect(
      asApi(people.author, () =>
        client.query('insert into comments (item_id,author_id,body) values ($1,$2,$3)', [
          item,
          people.owner,
          body,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
    const [own] = await asApi(
      people.author,
      async () =>
        (
          await client.query<{ id: string }>(
            'insert into comments (item_id,author_id,body) values ($1,$2,$3) returning id',
            [item, people.author, body],
          )
        ).rows,
    )
    expect(
      await asApi(
        people.owner,
        async () =>
          (await client.query('update comments set body=$2 where id=$1', [own!.id, body])).rowCount,
      ),
    ).toBe(0)
    expect(
      await asApi(
        people.owner,
        async () => (await client.query('delete from comments where id=$1', [own!.id])).rowCount,
      ),
    ).toBe(0)
    expect(
      await asApi(null, async () => (await client.query('select * from comments')).rowCount),
    ).toBe(0)
    // What a comment hangs on, and who wrote it, never change.
    await expect(
      asApi(people.author, () =>
        client.query("update comments set item_id='itm_target0001' where id=$1", [own!.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
