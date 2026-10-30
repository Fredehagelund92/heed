import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaDetail, AuditEntry } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The back end of Settings over authenticated HTTP and PostgreSQL: an administrator creates areas
  (FR-801), and a domain's owner says what it is (FR-813).
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

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
type Method = 'GET' | 'POST' | 'PUT'
const call = (method: Method, path: string, who: Who, payload?: object, key = randomUUID()) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': key },
    ...(payload ? { payload } : {}),
  })
async function ok<T>(method: Method, path: string, who: Who, payload?: object) {
  const response = await call(method, path, who, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const audit = async (action: string) =>
  (
    await client.query<{ actor_id: string; area_id: string; details: Record<string, unknown> }>(
      'select actor_id, area_id, details from audit_log where action=$1 order by seq',
      [action],
    )
  ).rows

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await servingEdition(client)
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

const payments = {
  id: 'payments',
  name: 'Payments',
  label: 'sky',
  reviewDays: 3,
  chatChannel: '#payments-data',
  ownerTeam: 'Payments analytics',
  summary: '',
  description: '',
  reason: 'Payments numbers get their own owner',
} as const

describe('areas from settings', () => {
  it('creates an area, served at once and with nobody assigned, and records why', async () => {
    const { createdAt, ...created } = await ok<AreaDetail>('POST', '/areas', 'admin', payments)
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    expect(created).toEqual({
      id: 'payments',
      name: 'Payments',
      label: 'sky',
      reviewDays: 3,
      chatChannel: '#payments-data',
      ownerTeam: 'Payments analytics',
      demo: false,
      summary: '',
      description: '',
      ownerIds: [],
      approverIds: [],
      revision: 1,
    })
    const areas = await ok<{ id: string; summary: string; label: string }[]>(
      'GET',
      '/areas',
      'author',
    )
    expect(areas.find((a) => a.id === 'payments')).toMatchObject({ summary: '', label: 'sky' })
    expect(JSON.stringify(areas)).not.toMatch(/not_started|"state"/)
    expect(await audit('area.created')).toEqual([
      {
        actor_id: people.admin,
        area_id: 'payments',
        details: {
          name: 'Payments',
          label: 'sky',
          reviewDays: 3,
          chatChannel: '#payments-data',
          ownerTeam: 'Payments analytics',
          summary: '',
          description: '',
          reason: 'Payments numbers get their own owner',
        },
      },
    ])
  })

  it('answers a retry with the same key once, and refuses a taken id or name', async () => {
    const key = randomUUID()
    const again = { ...payments, id: 'payments_two', name: 'Payments two' }
    const first = await call('POST', '/areas', 'admin', again, key)
    const retry = await call('POST', '/areas', 'admin', again, key)
    expect(first.statusCode, first.body).toBe(200)
    expect(retry.json()).toEqual(first.json())
    expect(await audit('area.created')).toHaveLength(2)

    expect((await call('POST', '/areas', 'admin', payments)).statusCode).toBe(409)
    const sameName = { ...payments, id: 'finance_two', name: 'FINANCE' }
    const taken = await call('POST', '/areas', 'admin', sameName)
    expect(taken.statusCode).toBe(409)
    expect(taken.json()).toMatchObject({
      message: 'Another domain already has this name. Choose another.',
    })
    expect(await audit('area.created')).toHaveLength(2)
  })

  it('refuses invalid input, sensitive reasons and anyone but an administrator', async () => {
    const before = await audit('area.created')
    const fresh = { ...payments, id: 'payments_new', name: 'Payments new' }
    for (const invalid of [
      { ...fresh, id: 'Payments_new' },
      { ...fresh, id: 'p' },
      { ...fresh, name: ' Payments new' },
      { ...fresh, name: 'Payments\nnew' },
      { ...fresh, name: '' },
      { ...fresh, label: 'amber' },
      { ...fresh, reviewDays: 0 },
      { ...fresh, reviewDays: 31 },
      { ...fresh, reviewDays: 2.5 },
      { ...fresh, chatChannel: '' },
      { ...fresh, ownerTeam: 'x'.repeat(101) },
      { ...fresh, reason: '' },
      { ...fresh, extra: true },
    ]) {
      const response = await call('POST', '/areas', 'admin', invalid)
      expect(response.statusCode, JSON.stringify(invalid)).toBe(400)
    }
    const secret = await call('POST', '/areas', 'admin', {
      ...payments,
      id: 'payments_secret',
      name: 'Payments secret',
      reason: 'password: hunter22',
    })
    expect(secret.statusCode).toBe(422)
    const noKey = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: headers.admin!,
      payload: { ...payments, id: 'payments_nokey', name: 'Payments no key' },
    })
    expect(noKey.statusCode).toBe(400)
    for (const who of ['owner', 'author', 'stranger'] as const) {
      const response = await call('POST', '/areas', who, {
        ...payments,
        id: 'payments_' + who,
        name: 'Payments ' + who,
      })
      expect(response.statusCode, who).toBe(403)
    }
    expect(await audit('area.created')).toEqual(before)
  })

  it('shows who looks after the area, and the new area starts like any other', async () => {
    for (const [personId, role] of [
      [people.owner, 'owner'],
      [people.approver, 'approver'],
      [people.author, 'approver'],
    ] as const)
      await ok('POST', '/assignments/grant', 'admin', { personId, role, areaId: 'payments' })
    const team = await client.query<{ person_id: string; role: string }>(
      `select person_id::text, role::text from area_assignments
        where area_id='payments' and upper_inf(valid_at) order by role, person_id`,
    )
    expect(team.rows.filter((r) => r.role === 'owner').map((r) => r.person_id)).toEqual([
      people.owner,
    ])
    expect(team.rows.filter((r) => r.role === 'approver').map((r) => r.person_id)).toEqual(
      [people.author, people.approver].sort(),
    )

    // A proposal in the new area is due after its own review time (3 working days).
    const { rows } = await client.query<{ review_days: number }>(
      "select review_days from areas where id='payments'",
    )
    expect(rows[0]!.review_days).toBe(3)
  })

  it('takes the role lock before the log lock, so creating an area with a team cannot deadlock a role change', async () => {
    // Another transaction holds the role lock, as a role change does, and then wants the log's.
    const other = new pg.Client({ connectionString: url })
    await other.connect()
    try {
      await other.query('begin')
      await other.query("select pg_advisory_xact_lock(hashtextextended('heed.roles', 0))")
      const created = call('POST', '/areas', 'admin', {
        ...payments,
        id: 'lock_order',
        name: 'Lock order',
        team: { ownerIds: [people.owner] },
      })
      // The creation waits for the role lock before it writes its first log entry.
      for (let tries = 0; ; tries++) {
        const { rowCount } = await client.query(
          "select 1 from pg_locks where locktype = 'advisory' and not granted",
        )
        if (rowCount) break
        expect(tries, 'the creation never waited for the role lock').toBeLessThan(200)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // Taking the log's lock now would be a deadlock if the creation already held it.
      await other.query("select pg_advisory_xact_lock(hashtextextended('context_layer.audit', 0))")
      await other.query('commit')
      const response = await created
      expect(response.statusCode, response.body).toBe(200)
    } finally {
      await other.end()
    }
  })

  it("lets the domain's owner say what it is, recorded and served at once (FR-813)", async () => {
    const listed = async () =>
      (
        await ok<{ id: string; summary: string; description: string; revision: number }[]>(
          'GET',
          '/areas',
          'author',
        )
      ).find((a) => a.id === 'payments')!
    const { revision } = await listed()
    const about = {
      summary: 'Orders, returns and gift cards, by market and provider.',
      description:
        'Payments covers **orders** and **returns**.\n\n- Amounts are in euros.\n- Ask the owner before comparing providers.',
    }
    const put = (who: Who, payload: object) =>
      call('PUT', '/areas/payments/description', who, payload)
    // A high-risk approver of the area, and a contributor, may not.
    for (const who of ['approver', 'author'] as const)
      expect((await put(who, { revision, ...about })).statusCode).toBe(403)
    // One line of at most 160 characters, and at most 1,500 for the description.
    for (const bad of [
      { ...about, summary: 'x'.repeat(161) },
      { ...about, summary: 'Two\nlines' },
      { ...about, description: 'x'.repeat(1501) },
    ])
      expect((await put('owner', { revision, ...bad })).statusCode).toBe(400)
    const saved = await put('owner', { revision, ...about })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json<AreaDetail>()).toMatchObject({ ...about, revision: revision + 1 })
    expect(await listed()).toMatchObject({ ...about, revision: revision + 1 })
    // An edit from the revision before is a conflict.
    expect((await put('admin', { revision, summary: '', description: '' })).statusCode).toBe(409)
    // The history log names the owner and what changed; a description takes no reason.
    expect((await audit('area.changed')).at(-1)).toEqual({
      actor_id: people.owner,
      area_id: 'payments',
      details: { from: { summary: '', description: '' }, to: about },
    })
    // Serving reads it with the domain on the next request: no new edition is needed.
    const { rows } = await client.query<{ areas: { id: string; summary: string }[] }>(
      "select serving_metadata((select seq from live_edition))->'areas' as areas",
    )
    expect(rows[0]!.areas.find((a) => a.id === 'payments')).toMatchObject(about)
  })

  it('keeps the history log chain whole', async () => {
    expect(await ok('GET', '/audit/verify', 'admin')).toEqual({
      verified: true,
      firstBadSeq: null,
    })
    const entries = await ok<{ entries: AuditEntry[] }>('GET', '/audit?action=area', 'admin')
    expect(entries.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['area.created', 'area.changed']),
    )
  })
})
