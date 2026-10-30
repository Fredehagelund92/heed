import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaDetail } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Role changes in one step (FR-804) over authenticated HTTP and PostgreSQL: a domain is created
  with its team (FR-801), all or none, one history entry each with a shared batch id and the
  reason (FR-806), and the history chain covers what each entry says.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (path: string, who: Who | null, payload: object, key: string = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/api/v1' + path,
    headers: {
      ...(who ? headers[who] : { origin: 'http://localhost' }),
      'idempotency-key': key,
    },
    payload,
  })

type Entry = {
  action: string
  area_id: string | null
  subject_id: string
  details: Record<string, unknown>
  batch_id: string | null
  reason: string | null
  source: string | null
}
const entriesSince = async (seq: number) =>
  (
    await client.query<Entry>(
      `select action, area_id, subject_id, details, batch_id::text, reason, source
         from audit_log where seq > $1 order by seq`,
      [seq],
    )
  ).rows
const lastSeq = async () =>
  (await client.query<{ seq: number }>('select coalesce(max(seq),0)::int as seq from audit_log'))
    .rows[0]!.seq
beforeAll(async () => {
  await transaction(client, () => foundation(client))
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

describe('creating a domain with its team', () => {
  const fields = {
    label: 'teal',
    reviewDays: 3,
    chatChannel: null,
    ownerTeam: null,
    reason: 'Payments numbers get their own owner',
  } as const

  it('creates the domain and gives its owners and approvers in the same step', async () => {
    const before = await lastSeq()
    const response = await call('/areas', 'admin', {
      ...fields,
      id: 'payments',
      name: 'Payments',
      team: {
        ownerIds: [people.owner, people.author],
        approverIds: [people.approver, people.stranger],
      },
    })
    expect(response.statusCode, response.body).toBe(200)
    const created = response.json<AreaDetail>()
    expect(created).toMatchObject({
      id: 'payments',
      approverIds: [people.approver, people.stranger].sort(),
    })
    // Given in one step, so they start at the same moment, in the order of their ids.
    expect(created.ownerIds).toEqual([people.owner, people.author].sort())
    const entries = await entriesSince(before)
    expect(entries.map((entry) => [entry.action, entry.details.role ?? null])).toEqual([
      ['area.created', null],
      ['assignment.granted', 'owner'],
      ['assignment.granted', 'owner'],
      ['assignment.granted', 'approver'],
      ['assignment.granted', 'approver'],
    ])
    const team = entries.slice(1)
    expect(new Set(team.map((entry) => entry.batch_id)).size).toBe(1)
    expect(team.every((entry) => entry.reason === fields.reason)).toBe(true)
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])
  })

  it('creates nothing when a team member cannot be given the role', async () => {
    const before = await lastSeq()
    await client.query('update people set deactivated_at=now() where id=$1', [people.stranger])
    try {
      const response = await call('/areas', 'admin', {
        ...fields,
        id: 'wallets',
        name: 'Wallets',
        team: { ownerIds: [people.stranger] },
      })
      expect(response.statusCode).toBe(404)
    } finally {
      await client.query('update people set deactivated_at=null where id=$1', [people.stranger])
    }
    expect((await client.query("select 1 from areas where id='wallets'")).rows).toEqual([])
    expect(await entriesSince(before)).toEqual([])
  })
})

describe('the history chain', () => {
  it('covers the batch id, the reason and the source, so changing one breaks the chain', async () => {
    const [entry] = (
      await client.query<{ seq: number; reason: string }>(
        'select seq::int, reason from audit_log where reason is not null order by seq limit 1',
      )
    ).rows
    // Tampering needs the owner to lift the append-only guard; the API never can.
    const rewrite = (column: string, value: string | null) =>
      transaction(client, async () => {
        await client.query('alter table audit_log disable trigger user')
        await client.query(`update audit_log set ${column}=$1 where seq=$2`, [value, entry!.seq])
        await client.query('alter table audit_log enable trigger user')
      })
    const firstBad = async () =>
      (await client.query<{ seq: number }>('select first_bad_seq::int as seq from audit_verify()'))
        .rows[0]?.seq ?? null
    const original = (
      await client.query<{ batch_id: string; source: string }>(
        'select batch_id::text, source from audit_log where seq=$1',
        [entry!.seq],
      )
    ).rows[0]!
    for (const [column, value, back] of [
      ['reason', 'A different reason', entry!.reason],
      ['batch_id', randomUUID(), original.batch_id],
      ['source', null, original.source],
    ] as const) {
      await rewrite(column, value)
      expect(await firstBad()).toBe(entry!.seq)
      await rewrite(column, back)
      expect(await firstBad()).toBeNull()
    }
  })
})
