import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaDetail, AuditEntry } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Role changes in one step (FR-804) over authenticated HTTP and PostgreSQL: `grants.apply` gives
  and removes many roles in one transaction, all or none, one history entry each with a shared
  batch id, the reason and the source (FR-806); a domain has several owners, and a step that
  removes one and gives the role to another replaces them with no gap; Heed
  keeps an administrator after the whole batch; and a domain is created with its team (FR-801).
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
const apply = (payload: object, who: Who | null = 'admin', key?: string) =>
  call('/grants/apply', who, payload, key)

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
const holders = async (areaId: string, role: string) =>
  (
    await client.query<{ person_id: string }>(
      `select person_id::text from area_assignments
        where area_id=$1 and role=$2 and valid_at @> now() order by person_id`,
      [areaId, role],
    )
  ).rows.map((row) => row.person_id)

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

describe('grants.apply', () => {
  it('gives and removes many roles in one step, one history entry each with a shared batch id, reason and source', async () => {
    const before = await lastSeq()
    const changes = [
      { op: 'grant', personId: people.author, role: 'auditor' },
      { op: 'grant', personId: people.author, areaId: 'marketing', role: 'approver' },
      { op: 'grant', personId: people.stranger, areaId: 'marketing', role: 'approver' },
      // Already held: reported, not written.
      { op: 'grant', personId: people.approver, areaId: 'finance', role: 'approver' },
    ]
    const response = await apply({ changes, reason: 'Marketing gets reviewers' })
    expect(response.statusCode, response.body).toBe(200)
    const result = response.json<{ batchId: string; changes: { changed: boolean }[] }>()
    expect(result.batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.changes).toEqual(changes.map((change, n) => ({ ...change, changed: n < 3 })))
    expect(await holders('marketing', 'approver')).toEqual([people.author, people.stranger])
    expect(await entriesSince(before)).toEqual([
      {
        action: 'role.granted',
        area_id: null,
        subject_id: people.author,
        details: { role: 'auditor' },
        batch_id: result.batchId,
        reason: 'Marketing gets reviewers',
        source: 'named',
      },
      ...[people.author, people.stranger].map((personId) => ({
        action: 'assignment.granted',
        area_id: 'marketing',
        subject_id: personId,
        details: { role: 'approver' },
        batch_id: result.batchId,
        reason: 'Marketing gets reviewers',
        source: 'named',
      })),
    ])
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])

    // The history log finds the step by its batch id, with the reason and the source.
    const page = await app.inject({
      url: `/api/v1/audit?batchId=${result.batchId}`,
      headers: headers.admin,
    })
    expect(page.statusCode, page.body).toBe(200)
    const entries = page.json<{ entries: AuditEntry[] }>().entries
    expect(
      entries.map((entry) => [entry.action, entry.batchId, entry.reason, entry.source]),
    ).toEqual([
      ['assignment.granted', result.batchId, 'Marketing gets reviewers', 'named'],
      ['assignment.granted', result.batchId, 'Marketing gets reviewers', 'named'],
      ['role.granted', result.batchId, 'Marketing gets reviewers', 'named'],
    ])

    const beforeRemoval = await lastSeq()
    const removal = await apply({
      changes: changes.slice(0, 3).map((change) => ({ ...change, op: 'revoke' })),
    })
    expect(removal.statusCode, removal.body).toBe(200)
    expect(await holders('marketing', 'approver')).toEqual([])
    const removed = await entriesSince(beforeRemoval)
    expect(removed.map((entry) => [entry.action, entry.reason, entry.source])).toEqual([
      ['role.revoked', null, 'named'],
      ['assignment.revoked', null, 'named'],
      ['assignment.revoked', null, 'named'],
    ])
    expect(new Set(removed.map((entry) => entry.batch_id)).size).toBe(1)
    expect(removed[0]!.batch_id).not.toBe(result.batchId)
  })

  it('replaces an owner at the same instant, with no moment the area has none', async () => {
    const before = await lastSeq()
    const response = await apply({
      changes: [
        { op: 'grant', personId: people.stranger, areaId: 'finance', role: 'owner' },
        { op: 'revoke', personId: people.owner, areaId: 'finance', role: 'owner' },
      ],
      reason: 'Stranger takes over Finance',
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(await holders('finance', 'owner')).toEqual([people.stranger])
    const ranges = await client.query<{ person_id: string; lower: string; upper: string | null }>(
      `select person_id::text, lower(valid_at)::text as lower, upper(valid_at)::text as upper
         from area_assignments where area_id='finance' and role='owner' order by lower(valid_at)`,
    )
    const [old, now] = ranges.rows
    expect(old).toMatchObject({ person_id: people.owner })
    expect(now).toMatchObject({ person_id: people.stranger, upper: null })
    expect(old!.upper).toBe(now!.lower)
    // Removals are written first, whatever order the step names them in.
    expect((await entriesSince(before)).map((entry) => [entry.action, entry.subject_id])).toEqual([
      ['assignment.revoked', people.owner],
      ['assignment.granted', people.stranger],
    ])

    // A domain may have several owners: giving one beside another removes nobody.
    const beside = await apply({
      changes: [{ op: 'grant', personId: people.owner, areaId: 'finance', role: 'owner' }],
    })
    expect(beside.statusCode, beside.body).toBe(200)
    expect(await holders('finance', 'owner')).toEqual([people.stranger, people.owner].sort())

    await apply({
      changes: [{ op: 'revoke', personId: people.stranger, areaId: 'finance', role: 'owner' }],
    })
    expect(await holders('finance', 'owner')).toEqual([people.owner])
  })

  it('changes all or nothing: one refused change leaves every grant and the history as they were', async () => {
    const before = await lastSeq()
    const missing = '00000000-0000-4000-8000-0000000000ff'
    for (const changes of [
      [
        { op: 'grant', personId: people.author, role: 'auditor' },
        { op: 'grant', personId: missing, areaId: 'finance', role: 'approver' },
      ],
      [
        { op: 'grant', personId: people.author, role: 'auditor' },
        { op: 'grant', personId: people.author, areaId: 'no_such_area', role: 'approver' },
      ],
      [
        { op: 'grant', personId: people.author, role: 'auditor' },
        { op: 'revoke', personId: people.admin, role: 'administrator' },
      ],
    ]) {
      const response = await apply({ changes })
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400)
    }
    expect(await entriesSince(before)).toEqual([])
    expect(
      (
        await client.query(
          "select 1 from global_role_grants where person_id=$1 and role='auditor' and valid_at @> now()",
          [people.author],
        )
      ).rows,
    ).toEqual([])
  })

  it('keeps an active administrator after the whole step, so a step may hand the role on', async () => {
    const alone = await apply({
      changes: [{ op: 'revoke', personId: people.admin, role: 'administrator' }],
    })
    expect(alone.statusCode).toBe(409)
    expect(alone.json()).toMatchObject({
      message: 'This would leave no active admin. Make someone else an admin first.',
    })

    // Handing it to a deactivated person is no handover: they cannot be given a role.
    await client.query('update people set deactivated_at=now() where id=$1', [people.stranger])
    try {
      const toLeaver = await apply({
        changes: [
          { op: 'revoke', personId: people.admin, role: 'administrator' },
          { op: 'grant', personId: people.stranger, role: 'administrator' },
        ],
      })
      expect(toLeaver.statusCode).toBe(404)
    } finally {
      await client.query('update people set deactivated_at=null where id=$1', [people.stranger])
    }

    const handover = await apply({
      changes: [
        { op: 'revoke', personId: people.admin, role: 'administrator' },
        { op: 'grant', personId: people.author, role: 'administrator' },
      ],
      reason: 'Author runs Heed from now on',
    })
    expect(handover.statusCode, handover.body).toBe(200)
    // The new administrator hands it back, so the remaining tests run as before.
    const back = await apply(
      {
        changes: [
          { op: 'grant', personId: people.admin, role: 'administrator' },
          { op: 'revoke', personId: people.author, role: 'administrator' },
        ],
      },
      'author',
    )
    expect(back.statusCode, back.body).toBe(200)
    expect((await apply({ changes: [] })).statusCode).toBe(400)
  })

  it('gives one domain two owners in one step: two roles, not one named twice', async () => {
    const twoOwners = await apply({
      changes: [
        { op: 'grant', personId: people.author, areaId: 'marketing', role: 'owner' },
        { op: 'grant', personId: people.stranger, areaId: 'marketing', role: 'owner' },
      ],
    })
    expect(twoOwners.statusCode, twoOwners.body).toBe(200)
    expect(await holders('marketing', 'owner')).toEqual(
      expect.arrayContaining([people.author, people.stranger]),
    )
    await apply({
      changes: [
        { op: 'revoke', personId: people.author, areaId: 'marketing', role: 'owner' },
        { op: 'revoke', personId: people.stranger, areaId: 'marketing', role: 'owner' },
      ],
    })
  })

  it('refuses a step that names a role twice, a sensitive reason, and anyone but an administrator', async () => {
    const before = await lastSeq()
    const twice = await apply({
      changes: [
        { op: 'grant', personId: people.author, areaId: 'finance', role: 'approver' },
        { op: 'revoke', personId: people.author, areaId: 'finance', role: 'approver' },
      ],
    })
    expect(twice.statusCode).toBe(400)
    expect(twice.json()).toMatchObject({
      message: 'The same role is in this change twice. Remove one, then try again.',
    })
    // The same person written in capitals is the same person.
    const sameByCase = await apply({
      changes: [
        { op: 'grant', personId: people.author, role: 'auditor' },
        { op: 'grant', personId: people.author.toUpperCase(), role: 'auditor' },
      ],
    })
    expect(sameByCase.statusCode).toBe(400)
    const secret = await apply({
      changes: [{ op: 'grant', personId: people.author, role: 'auditor' }],
      reason: 'password: hunter22',
    })
    expect(secret.statusCode).toBe(422)
    const tooMany = await apply({
      changes: Array.from({ length: 201 }, () => ({
        op: 'grant',
        personId: randomUUID(),
        role: 'auditor',
      })),
    })
    expect(tooMany.statusCode).toBe(400)
    const mixed = await apply({
      changes: [{ op: 'grant', personId: people.author, role: 'owner' }],
    })
    expect(mixed.statusCode).toBe(400)
    const change = { changes: [{ op: 'grant', personId: people.author, role: 'auditor' }] }
    for (const who of ['author', 'owner', 'approver', 'stranger'] as const)
      expect((await apply(change, who)).statusCode).toBe(403)
    expect((await apply(change, null)).statusCode).toBe(401)
    expect((await apply(change, 'admin', 'short')).statusCode).toBe(400)
    expect(await entriesSince(before)).toEqual([])
  })

  it('applies a hundred changes in one step within two seconds', async () => {
    const ids = Array.from({ length: 100 }, () => randomUUID())
    await client.query(
      `insert into people (id, email, display_name)
       select id, 'bulk-' || n || '@example.test', 'Bulk person ' || n
         from unnest($1::uuid[]) with ordinality as t(id, n)`,
      [ids],
    )
    const started = performance.now()
    const response = await apply({
      changes: ids.map((personId) => ({
        op: 'grant',
        personId,
        areaId: 'marketing',
        role: 'approver',
      })),
    })
    const took = performance.now() - started
    expect(response.statusCode, response.body).toBe(200)
    expect(took).toBeLessThan(2000)
    expect(await holders('marketing', 'approver')).toHaveLength(100)
    await apply({
      changes: ids.map((personId) => ({
        op: 'revoke',
        personId,
        areaId: 'marketing',
        role: 'approver',
      })),
    })
  })

  it('takes a person id in capitals as the same person', async () => {
    const auditor = { op: 'grant', personId: people.author.toUpperCase(), role: 'auditor' }
    const given = await apply({ changes: [auditor] })
    expect(given.statusCode, given.body).toBe(200)
    expect(given.json()).toMatchObject({
      changes: [{ personId: people.author, changed: true }],
    })
    expect((await apply({ changes: [{ ...auditor, op: 'revoke' }] })).json()).toMatchObject({
      changes: [{ changed: true }],
    })
  })

  it('answers a retry with the same key once, with the first answer', async () => {
    const key = randomUUID()
    const change = {
      changes: [{ op: 'grant', personId: people.author, areaId: 'marketing', role: 'approver' }],
    }
    const first = await apply(change, 'admin', key)
    const retry = await apply(change, 'admin', key)
    expect(first.statusCode, first.body).toBe(200)
    expect(retry.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({ changes: [{ changed: true }] })
    await apply({ changes: [{ ...change.changes[0], op: 'revoke' }] })
  })
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
