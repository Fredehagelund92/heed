import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaDetail, AuditEntry, TrafficSummary } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The back end of Settings over authenticated HTTP and PostgreSQL: an administrator creates and
  edits areas (FR-801), and reads MCP traffic by client and tool from the request log (FR-410),
  which names no person.
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
      expect((await call('GET', '/areas/payments', who)).statusCode).toBe(403)
      expect(
        (await call('PUT', '/areas/payments', who, { ...payments, revision: 1 })).statusCode,
      ).toBe(403)
    }
    expect(await audit('area.created')).toEqual(before)
  })

  it('edits an area with the revision read, recording only what changed', async () => {
    const edit = {
      ...payments,
      revision: 1,
      name: 'Payments and gift cards',
      reviewDays: 5,
      ownerTeam: null,
      reason: 'Gift cards joined the area',
    }
    const { id: _id, ...body } = edit
    const saved = await ok<AreaDetail>('PUT', '/areas/payments', 'admin', body)
    expect(saved).toMatchObject({
      id: 'payments',
      name: 'Payments and gift cards',
      reviewDays: 5,
      chatChannel: '#payments-data',
      ownerTeam: null,
      revision: 2,
    })
    expect(await audit('area.changed')).toEqual([
      {
        actor_id: people.admin,
        area_id: 'payments',
        details: {
          from: { name: 'Payments', reviewDays: 3, ownerTeam: 'Payments analytics' },
          to: { name: 'Payments and gift cards', reviewDays: 5, ownerTeam: null },
          reason: 'Gift cards joined the area',
        },
      },
    ])

    // An edit from the revision before is a conflict, and changes nothing.
    const stale = await call('PUT', '/areas/payments', 'admin', { ...body, name: 'Gift cards' })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({
      message:
        'Someone changed this domain after you opened it. Look at the latest version, then try again.',
    })
    // Nothing to change keeps the revision and writes no history.
    const same = await ok<AreaDetail>('PUT', '/areas/payments', 'admin', { ...body, revision: 2 })
    expect(same.revision).toBe(2)
    expect(await audit('area.changed')).toHaveLength(1)

    const taken = await call('PUT', '/areas/payments', 'admin', {
      ...body,
      revision: 2,
      name: 'Marketing',
    })
    expect(taken.statusCode).toBe(409)
    const missing = await call('PUT', '/areas/nowhere', 'admin', { ...body, revision: 1 })
    expect(missing.statusCode).toBe(404)
    expect((await call('GET', '/areas/nowhere', 'admin')).statusCode).toBe(404)
    expect((await ok<AreaDetail>('GET', '/areas/payments', 'admin')).revision).toBe(2)
  })

  it('shows who looks after the area, and the new area starts like any other', async () => {
    for (const [personId, role] of [
      [people.owner, 'owner'],
      [people.approver, 'approver'],
      [people.author, 'approver'],
    ] as const)
      await ok('POST', '/assignments/grant', 'admin', { personId, role, areaId: 'payments' })
    const area = await ok<AreaDetail>('GET', '/areas/payments', 'admin')
    expect(area).toMatchObject({ ownerIds: [people.owner] })
    expect(area.approverIds).toEqual([people.author, people.approver].sort())

    // A proposal in the new area is due after its own review time (5 working days).
    const { rows } = await client.query<{ review_days: number }>(
      "select review_days from areas where id='payments'",
    )
    expect(rows[0]!.review_days).toBe(5)
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

describe('MCP traffic', () => {
  it('answers zeros before any call, to administrators only', async () => {
    const empty = await ok<TrafficSummary>('GET', '/traffic', 'admin')
    expect(empty.rows).toEqual([])
    expect(empty.total).toEqual({
      calls: 0,
      ok: 0,
      errors: 0,
      invalidInput: 0,
      rateLimited: 0,
      forbidden: 0,
      unauthorized: 0,
      medianMs: null,
      p95Ms: null,
      bytes: 0,
      lastHour: null,
    })
    expect(empty.retentionDays).toBe(90)
    expect(new Date(empty.to).getTime() - new Date(empty.from).getTime()).toBe(7 * 86_400_000)
    for (const who of ['owner', 'author', 'stranger'] as const)
      expect((await call('GET', '/traffic', who)).statusCode).toBe(403)
    for (const days of [0, 91, 'x'])
      expect((await call('GET', `/traffic?days=${days}`, 'admin')).statusCode).toBe(400)
  })

  it('counts calls by client and tool within the window, with no person', async () => {
    await transaction(client, async () => {
      // The log is partitioned by month; a test early in a month reaches back into the last one.
      await client.query(`do $$ declare m date; begin
        for i in 1 .. 2 loop
          m := (date_trunc('month', now() at time zone 'UTC') - make_interval(months => i))::date;
          execute format('create table if not exists %I partition of mcp_requests for values from (%L) to (%L)',
            'mcp_requests_' || to_char(m, 'YYYY_MM'), m::timestamp at time zone 'UTC',
            (m + interval '1 month')::timestamp at time zone 'UTC');
        end loop; end $$`)
      await client.query(
        `insert into mcp_requests (hour, client_label, tool, status, duration_ms, edition_seq, response_bytes)
         select date_trunc('hour', now(), 'UTC') - make_interval(hours => r.ago), r.client, r.tool, r.status, r.ms, 1, r.bytes
           from (values
             (0, 'signed-in', 'get_context', 'ok', 10, 100),
             (1, 'signed-in', 'get_context', 'ok', 20, 100),
             (2, 'signed-in', 'get_context', 'ok', 30, 100),
             (30, 'signed-in', 'get_context', 'ok', 40, 100),
             (3, 'signed-in', 'get_context', 'rate_limited', 1, 0),
             (2, 'unknown', 'protocol', 'unauthorized', 2, 0),
             (5, 'unknown', 'protocol', 'unauthorized', 4, 0),
             (4, 'signed-in', 'report_gap', 'forbidden', 3, 0),
             (6, 'signed-in', 'report_gap', 'error', 5, 0),
             (7, 'signed-in', 'report_gap', 'invalid_input', 2, 0),
             (240, 'signed-in', 'get_context', 'ok', 9, 9999)
           ) as r(ago, client, tool, status, ms, bytes)`,
      )
    })
    const week = await ok<TrafficSummary>('GET', '/traffic', 'admin')
    const hour = (ago: number) => {
      const now = new Date()
      now.setUTCMinutes(0, 0, 0)
      return new Date(now.getTime() - ago * 3_600_000).toISOString().replace('.000Z', 'Z')
    }
    expect(week.rows).toEqual([
      {
        client: 'signed-in',
        clientName: 'AI apps people sign in with',
        tool: 'get_context',
        calls: 5,
        ok: 4,
        errors: 0,
        invalidInput: 0,
        rateLimited: 1,
        forbidden: 0,
        unauthorized: 0,
        medianMs: 20,
        p95Ms: 38,
        bytes: 400,
        lastHour: hour(0),
      },
      {
        client: 'signed-in',
        clientName: 'AI apps people sign in with',
        tool: 'report_gap',
        calls: 3,
        ok: 0,
        errors: 1,
        // A model's malformed call, counted apart from Heed's error.
        invalidInput: 1,
        rateLimited: 0,
        forbidden: 1,
        unauthorized: 0,
        medianMs: 3,
        p95Ms: 5,
        bytes: 0,
        lastHour: hour(4),
      },
      {
        client: 'unknown',
        clientName: null,
        tool: 'protocol',
        calls: 2,
        ok: 0,
        errors: 0,
        invalidInput: 0,
        rateLimited: 0,
        forbidden: 0,
        unauthorized: 2,
        medianMs: 3,
        p95Ms: 4,
        bytes: 0,
        lastHour: hour(2),
      },
    ])
    expect(week.total).toMatchObject({
      calls: 10,
      ok: 4,
      invalidInput: 1,
      bytes: 400,
      lastHour: hour(0),
    })

    // Ten days back is outside the week and inside a month.
    const month = await ok<TrafficSummary>('GET', '/traffic?days=30', 'admin')
    expect(month.total).toMatchObject({ calls: 11, ok: 5, bytes: 10_399 })
    expect(month.rows[0]).toMatchObject({ tool: 'get_context', calls: 6, lastHour: hour(0) })

    const body = JSON.stringify(month)
    for (const id of Object.values(people)) expect(body).not.toContain(id)
    expect(body).not.toContain('@example.test')
  })
})
