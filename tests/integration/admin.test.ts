import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditEntry, ClientPolicy, Setting } from '../../src/contract/index.ts'
import { ABOUT_BUSINESS_MAX, ABOUT_BUSINESS_STARTER } from '../../src/domain/about-business.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  S15 administration over authenticated HTTP: versioned settings and limits, the tool switch and
  client policies (read by the MCP gateway through the serving role on the next request), and
  the history log's search, export and chain check for administrators and auditors.
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
const servePool = servingPool(url)
const serving = createEditionSource(servePool)

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
async function ok<T>(method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) {
  const response = await call(method, path, who, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const auditRows = async () =>
  Number((await client.query<{ n: string }>('select count(*) as n from audit_log')).rows[0]!.n)

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    // The stranger audits; the owner has only area roles.
    await client.query("insert into global_role_grants (person_id,role) values ($1,'auditor')", [
      people.stranger,
    ])
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
  await servePool.end()
})

describe('settings and limits', () => {
  it('lists every current setting, all of them editable, to administrators only', async () => {
    const settings = await ok<Setting[]>('GET', '/settings', 'admin')
    expect(settings.map((s) => s.key)).toContain('limits.mcp_rate_per_minute')
    expect(settings.every((s) => s.editable)).toBe(true)
    expect(settings.find((s) => s.key === 'privacy.min_count')).toMatchObject({
      version: 1,
      value: 5,
      changedBy: null,
    })
    expect((await call('GET', '/settings', 'owner')).statusCode).toBe(403)
    expect((await call('GET', '/settings', 'stranger')).statusCode).toBe(403)
  })

  it('changes a setting as a new version with a reason, refusing stale and invalid input', async () => {
    const path = '/settings/review.default_days'
    const change = { version: 1, value: 60, reason: 'Shorter review cycle for the pilot' }
    expect((await call('PUT', path, 'admin', { ...change, value: 0 })).statusCode).toBe(422)
    expect((await call('PUT', path, 'admin', { ...change, value: '60' })).statusCode).toBe(422)
    expect((await call('PUT', path, 'admin', { ...change, version: 2 })).statusCode).toBe(409)
    expect(
      (await call('PUT', path, 'admin', { ...change, reason: 'password: hunter22' })).statusCode,
    ).toBe(422)
    expect(
      (await call('PUT', '/settings/made.up', 'admin', { ...change, version: 1 })).statusCode,
    ).toBe(422)
    expect((await call('PUT', path, 'owner', change)).statusCode).toBe(403)

    const saved = await ok<Setting>('PUT', path, 'admin', change)
    expect(saved).toMatchObject({ version: 2, value: 60, changedBy: people.admin })
    expect((await call('PUT', path, 'admin', change)).statusCode).toBe(409)
    const history = await ok<Setting[]>('GET', `${path}/history`, 'admin')
    expect(history.map((s) => [s.version, s.value])).toEqual([
      [2, 60],
      [1, 90],
    ])
    // The services read the current version: the database's own reader sees 60 now.
    const { rows } = await client.query<{ days: number }>(
      "select (value #>> '{}')::int as days from settings_current where key='review.default_days'",
    )
    expect(rows[0]!.days).toBe(60)
    const [audit] = (
      await client.query<{ actor_id: string; details: Record<string, unknown> }>(
        "select actor_id,details from audit_log where action='setting.changed' and subject_id='review.default_days'",
      )
    ).rows
    expect(audit).toMatchObject({
      actor_id: people.admin,
      details: { from: 1, to: 2, value: 60, reason: change.reason },
    })
  })

  it('takes a model setting only for a provider and model the registry has', async () => {
    const path = '/settings/models.judge'
    const [current] = (await ok<Setting[]>('GET', '/settings', 'admin')).filter(
      (s) => s.key === 'models.judge',
    )
    const change = { version: current!.version, reason: 'Judge through the gateway' }
    const refused = await call('PUT', path, 'admin', {
      ...change,
      value: { provider: 'nobody', model: 'claude-opus-5-5' },
    })
    expect(refused.statusCode).toBe(422)
    expect(refused.json<{ message: string }>().message).toMatch(
      /^models\.judge names provider nobody, which is not in the provider registry/,
    )
    const unlisted = await call('PUT', path, 'admin', {
      ...change,
      value: { provider: 'vercel-gateway', model: 'anthropic/claude-opus-9' },
    })
    expect(unlisted.json<{ message: string }>().message).toMatch(
      /models\.judge names model anthropic\/claude-opus-9, which provider vercel-gateway does not list/,
    )
    const unlistedGoogle = await call('PUT', path, 'admin', {
      ...change,
      value: { provider: 'vercel-gateway', model: 'google/gemini-9-pro' },
    })
    expect(unlistedGoogle.statusCode).toBe(422)
    // The scripted models need no key, so a listed gateway model is taken as it is.
    const value = { provider: 'vercel-gateway', model: 'anthropic/claude-opus-5.5' }
    const saved = await ok<Setting>('PUT', path, 'admin', { ...change, value })
    expect(saved.value).toEqual(value)
    // Google's model through the gateway is a listed model too.
    const gemini = { provider: 'vercel-gateway', model: 'google/gemini-2.5-flash-lite' }
    const savedGemini = await ok<Setting>('PUT', path, 'admin', {
      version: saved.version,
      value: gemini,
      reason: 'Judge with Gemini',
    })
    expect(savedGemini.value).toEqual(gemini)
    await ok<Setting>('PUT', path, 'admin', {
      version: savedGemini.version,
      value: 'different_family',
      reason: 'Back to the default judge',
    })
  })

  it('keeps the model folder address off by default and takes only a plain https address', async () => {
    const path = '/settings/sources.cube_model_url'
    const [current] = (await ok<Setting[]>('GET', '/settings', 'admin')).filter(
      (s) => s.key === 'sources.cube_model_url',
    )
    expect(current).toMatchObject({ version: 1, value: null, editable: true })
    const change = { version: current!.version, reason: 'Link the catalogue to the model' }
    for (const value of [
      'http://git.example.test/cube',
      'https://user:secret@git.example.test/cube',
      'https://git.example.test/cube?ref=main',
      'https://git.example.test/cube#top',
      'not an address',
    ])
      expect((await call('PUT', path, 'admin', { ...change, value })).statusCode, value).toBe(422)
    const value = 'https://git.example.test/analytics/cube/-/blob/main/model'
    const saved = await ok<Setting>('PUT', path, 'admin', { ...change, value })
    expect(saved.value).toBe(value)
    const off = await ok<Setting>('PUT', path, 'admin', {
      version: saved.version,
      value: null,
      reason: 'Off again',
    })
    expect(off.value).toBeNull()
  })

  it('reaches the MCP gateway on the next request: per-tool limits through the serving role', async () => {
    const path = '/settings/limits.mcp_rate_per_minute'
    const [current] = (await ok<Setting[]>('GET', '/settings', 'admin')).filter(
      (s) => s.key === 'limits.mcp_rate_per_minute',
    )
    const value = { get_context: 60, report_gap: 5, give_feedback: 5 }
    const reason = 'Tighter feedback limits'
    expect(
      (await call('PUT', path, 'admin', { version: current!.version, value: { nope: 1 }, reason }))
        .statusCode,
    ).toBe(422)
    await ok('PUT', path, 'admin', { version: current!.version, value, reason })
    expect((await serving.policy('claude-code')).limits).toEqual(value)
  })

  it('keeps About our business as a versioned, audited text the MCP gateway reads on the next request', async () => {
    const path = '/settings/business.about'
    const [current] = (await ok<Setting[]>('GET', '/settings', 'admin')).filter(
      (s) => s.key === 'business.about',
    )
    // A fresh Heed starts with the starter text, as installed: a first version nobody changed by hand.
    expect(current).toMatchObject({
      version: 1,
      value: ABOUT_BUSINESS_STARTER,
      changedBy: null,
      editable: true,
    })
    expect((await serving.policy('claude-code')).about).toBe(ABOUT_BUSINESS_STARTER)
    const change = { version: 1, reason: 'Say we also sell in two stores' }
    expect(
      (await call('PUT', path, 'admin', { ...change, value: 'x'.repeat(ABOUT_BUSINESS_MAX + 1) }))
        .statusCode,
    ).toBe(422)
    expect((await call('PUT', path, 'admin', { ...change, value: 42 })).statusCode).toBe(422)
    expect((await call('PUT', path, 'owner', { ...change, value: 'Ours' })).statusCode).toBe(403)
    const before = await auditRows()
    const saved = await ok<Setting>('PUT', path, 'admin', {
      ...change,
      value:
        '  We run a webshop and two stores.\r\n\r\n\r\n- First-time buyer: a first paid order.  ',
    })
    const text = 'We run a webshop and two stores.\n\n- First-time buyer: a first paid order.'
    expect(saved).toMatchObject({ version: 2, value: text, changedBy: people.admin })
    expect(await auditRows()).toBe(before + 1)
    const [audit] = (
      await client.query<{ action: string; actor_id: string; details: Record<string, unknown> }>(
        "select action,actor_id::text,details from audit_log where subject_id='business.about' order by seq desc limit 1",
      )
    ).rows
    expect(audit).toMatchObject({
      action: 'setting.changed',
      actor_id: people.admin,
      details: { from: 1, to: 2, value: text, reason: change.reason },
    })
    expect((await serving.policy('claude-code')).about).toBe(text)
    // Empty is allowed: then nothing is given.
    const empty = await ok<Setting>('PUT', path, 'admin', {
      version: 2,
      value: ' ',
      reason: 'Off for the pilot',
    })
    expect(empty.value).toBe('')
    expect((await serving.policy('claude-code')).about).toBe('')
  })
})

describe('tool switch and client policies', () => {
  it('switches a tool off for every client and records it once', async () => {
    const before = await auditRows()
    const off = { enabled: false, reason: 'Gap reports flood the queue' }
    expect((await call('POST', '/tools/report_gap', 'owner', off)).statusCode).toBe(403)
    expect((await call('POST', '/tools/no_such_tool', 'admin', off)).statusCode).toBe(404)
    expect(await ok('POST', '/tools/report_gap', 'admin', off)).toMatchObject({
      tool: 'report_gap',
      enabled: false,
    })
    expect((await serving.policy('claude-code')).tools).not.toContain('report_gap')
    // Asking for the state it is already in changes and records nothing.
    await ok('POST', '/tools/report_gap', 'admin', off)
    expect(await auditRows()).toBe(before + 1)
    await ok('POST', '/tools/report_gap', 'admin', { enabled: true, reason: 'Queue cleared' })
    expect((await serving.policy('claude-code')).tools).toContain('report_gap')
    const tools = await ok<{ tool: string; enabled: boolean }[]>('GET', '/tools', 'admin')
    // get_related is built switched off until an evaluation shows gain (FR-332), and
    // draft_context until an administrator turns it on (FR-121).
    expect(tools.filter((t) => !t.enabled).map((t) => t.tool)).toEqual([
      'draft_context',
      'get_related',
    ])
  })

  it('adds a client label and changes its tools and limits', async () => {
    const cursor = {
      displayName: 'Cursor',
      toolsAllowed: ['search_context', 'get_context', 'get_context'],
      ratePerMinute: 30,
      maxResponseBytes: 50_000,
      enabled: true,
      reason: 'Engineering pilot',
    }
    expect(
      (await call('PUT', '/clients/cursor', 'admin', { ...cursor, toolsAllowed: ['shell'] }))
        .statusCode,
    ).toBe(422)
    expect(
      (await call('PUT', '/clients/cursor', 'admin', { ...cursor, maxResponseBytes: 500_000 }))
        .statusCode,
    ).toBe(400)
    expect((await call('PUT', '/clients/cursor', 'owner', cursor)).statusCode).toBe(403)
    expect(await ok<ClientPolicy>('PUT', '/clients/cursor', 'admin', cursor)).toEqual({
      label: 'cursor',
      displayName: 'Cursor',
      toolsAllowed: ['get_context', 'search_context'],
      ratePerMinute: 30,
      maxResponseBytes: 50_000,
      enabled: true,
    })
    expect((await serving.policy('cursor')).client).toMatchObject({
      tools_allowed: ['get_context', 'search_context'],
      rate_per_minute: 30,
    })
    await ok('PUT', '/clients/cursor', 'admin', { ...cursor, enabled: false, reason: 'Paused' })
    expect((await serving.policy('cursor')).client?.enabled).toBe(false)
    const clients = await ok<ClientPolicy[]>('GET', '/clients', 'admin')
    // signed-in: every AI app a person signs in with.
    expect(clients.map((c) => c.label)).toEqual(['claude-code', 'cursor', 'eval', 'signed-in'])
    const actions = (
      await client.query<{ action: string }>(
        "select action from audit_log where subject_type='client' order by seq",
      )
    ).rows.map((r) => r.action)
    expect(actions).toEqual(['client_policy.added', 'client_policy.changed'])
  })
})

describe('history log', () => {
  it('lets administrators and auditors search it, newest first, a page at a time', async () => {
    expect((await call('GET', '/audit', 'owner')).statusCode).toBe(403)
    expect((await call('GET', '/audit', 'author')).statusCode).toBe(403)
    const all = await ok<{ entries: AuditEntry[]; next: number | null }>(
      'GET',
      '/audit?limit=200',
      'stranger',
    )
    expect(all.entries.length).toBeGreaterThanOrEqual(6)
    const seqs = all.entries.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a))
    const first = await ok<{ entries: AuditEntry[]; next: number }>(
      'GET',
      '/audit?limit=2',
      'admin',
    )
    const second = await ok<{ entries: AuditEntry[] }>(
      'GET',
      `/audit?limit=2&before=${first.next}`,
      'admin',
    )
    expect([...first.entries, ...second.entries].map((e) => e.seq)).toEqual(seqs.slice(0, 4))

    const tools = await ok<{ entries: AuditEntry[] }>('GET', '/audit?action=tool', 'stranger')
    expect(tools.entries.map((e) => e.action)).toEqual(['tool.switched_on', 'tool.switched_off'])
    expect(tools.entries[0]).toMatchObject({
      actorId: people.admin,
      actorName: 'admin',
      actorKind: 'person',
      subjectType: 'tool',
      subjectId: 'report_gap',
      details: { reason: 'Queue cleared' },
    })
    const bySubject = await ok<{ entries: AuditEntry[] }>(
      'GET',
      '/audit?subjectType=setting&subjectId=review.default_days&from=2026-01-01',
      'admin',
    )
    expect(bySubject.entries.map((e) => e.action)).toEqual(['setting.changed'])
    const none = await ok<{ entries: AuditEntry[] }>('GET', '/audit?to=2000-01-01', 'admin')
    expect(none.entries).toEqual([])
  })

  it('exports JSON Lines and CSV oldest first with the chain check, and records no read', async () => {
    const before = await auditRows()
    const jsonl = await ok<{ content: string; count: number; next: number | null; chain: object }>(
      'GET',
      '/audit/export',
      'stranger',
    )
    const lines = jsonl.content.trimEnd().split('\n')
    expect(lines).toHaveLength(jsonl.count)
    expect(jsonl.count).toBe(before)
    const entries = lines.map((line) => JSON.parse(line) as AuditEntry)
    expect(entries.map((e) => e.seq)).toEqual(entries.map((e) => e.seq).sort((a, b) => a - b))
    expect(jsonl.chain).toEqual({ verified: true, firstBadSeq: null })
    expect(jsonl.next).toBeNull()

    const page = await ok<{ content: string; next: number }>(
      'GET',
      '/audit/export?format=csv&limit=2&action=client_policy',
      'admin',
    )
    expect(page.content.split('\r\n')[0]).toBe(
      'seq,at,actorId,actorName,actorKind,action,areaId,subjectType,subjectId,requestId,details,hash,batchId,reason,source',
    )
    expect(page.content).toContain('"client_policy.added"')
    expect(page.next).toBeNull()
    expect(await ok('GET', '/audit/verify', 'admin')).toEqual({
      verified: true,
      firstBadSeq: null,
    })
    expect(await auditRows()).toBe(before)
  })

  it('reports a broken chain', async () => {
    // Tampering needs the owner to lift the append-only guard; the API never can.
    await transaction(client, async () => {
      await client.query('alter table audit_log disable trigger user')
      await client.query(
        'update audit_log set details=\'{"reason":"rewritten"}\' where action=\'tool.switched_off\'',
      )
      await client.query('alter table audit_log enable trigger user')
    })
    const [{ seq }] = (
      await client.query<{ seq: string }>(
        "select seq from audit_log where action='tool.switched_off'",
      )
    ).rows as [{ seq: string }]
    expect(await ok('GET', '/audit/verify', 'stranger')).toEqual({
      verified: false,
      firstBadSeq: Number(seq),
    })
  })
})
