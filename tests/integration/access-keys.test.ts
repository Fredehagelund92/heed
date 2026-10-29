import { beforeEach, describe, expect, it, vi } from 'vitest'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'

/*
  Access keys end to end on PostgreSQL (docs/ai-sign-in.md): an administrator creates a key for a
  bot or a scheduled job that can't sign in; the key is in that answer only and kept as its digest;
  it reads context under its own client label, names no person, so it can never suggest, and a
  revoke ends it at its very next request. The key is never in a read, a record or a log line.
*/

const harness = await signInHarness()
const { admin, browser, mcpClient, mcpStatus, resource, rawLog, logLines } = harness

beforeEach(() => harness.advance(61))

type Listed = {
  kind: string
  id: string
  lastUsedAt?: string | null
  madeBy?: { id: string; name: string }
}

async function signedIn(name: string) {
  const person = browser()
  await person.signIn(name)
  return person
}

async function createKey(boss: Awaited<ReturnType<typeof signedIn>>) {
  const response = await boss.api('/access-keys', {})
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  return (await response.json()) as { id: string; key: string; createdAt: string }
}

const call = (key: string, body: object) =>
  fetch(resource, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, ...body }),
  })

describe('access keys', () => {
  it('reads context with a new key, lists it by who made it, and keeps only its digest', async () => {
    const boss = await signedIn('admin')
    const created = await createKey(boss)
    expect(created.key).toMatch(/^hak_[A-Za-z0-9_-]{43}$/)

    const wire = await mcpClient(created.key)
    const reply = await wire.callTool({
      name: 'get_facts',
      arguments: { question: 'Orders in Norway, August 2026' },
    })
    expect(reply.isError).not.toBe(true)
    expect(reply.structuredContent).toMatchObject({ status: 'matched' })
    await wire.close()

    // The list names who made it, never the key; the database holds its digest only.
    const listed = (await (await boss.api('/agent-connections')).json()) as Listed[]
    const row = listed.find((r) => r.id === created.id)
    expect(row).toMatchObject({
      kind: 'access_key',
      scopes: ['read', 'feedback'],
      madeBy: { id: people.admin, name: 'admin' },
    })
    expect(row?.lastUsedAt).toEqual(expect.any(String))
    expect(JSON.stringify(listed)).not.toContain(created.key)
    const stored = await admin.query<{ key_hash: string }>(
      'select key_hash from auth.access_keys where id=$1',
      [created.id],
    )
    expect(stored.rows[0]!.key_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(stored.rows)).not.toContain(created.key.slice(4))

    // Its requests carry the access key's own client label, never a person.
    await vi.waitFor(async () => {
      const labels = await admin.query<{ client_label: string }>(
        "select distinct client_label from mcp_requests where client_label='access-key'",
      )
      expect(labels.rows).toEqual([{ client_label: 'access-key' }])
    })

    // The history log notes the key was made, by whom, and holds neither the key nor its digest.
    const audit = await admin.query<{ action: string; actor: string; details: unknown }>(
      `select action, actor_id::text as actor, details from audit_log
        where subject_type='access_key' and subject_id=$1`,
      [created.id],
    )
    expect(audit.rows).toEqual([
      {
        action: 'access_key.created',
        actor: people.admin,
        details: { scopes: ['read', 'feedback'] },
      },
    ])
    expect(JSON.stringify(audit.rows)).not.toContain(stored.rows[0]!.key_hash)
  })

  it('can never suggest: suggest_context is not offered to a key, and is refused', async () => {
    const boss = await signedIn('admin')
    const { key } = await createKey(boss)
    const proposals = async () =>
      (await admin.query<{ n: number }>('select count(*)::int as n from proposals')).rows[0]!.n
    const before = await proposals()
    const wire = await mcpClient(key)
    const names = (await wire.listTools()).tools.map((t) => t.name)
    expect(names).toContain('get_facts')
    expect(names).not.toContain('suggest_context')
    expect(names).not.toContain('draft_context')
    await wire.close()
    for (const name of ['suggest_context', 'draft_context']) {
      const refused = await call(key, {
        method: 'tools/call',
        params: { name, arguments: { text: 'Returns are not part of Orders.' } },
      })
      // A key never holds the propose scope, so the gateway refuses it before the tool runs.
      expect(refused.status).toBe(403)
      expect(refused.headers.get('www-authenticate')).toContain('error="insufficient_scope"')
    }
    expect(await proposals()).toBe(before)
  })

  it('ends a key at once when an administrator revokes it, with a reason the log keeps', async () => {
    const boss = await signedIn('admin')
    const kept = await createKey(boss)
    const gone = await createKey(boss)
    expect(await mcpStatus(gone.key)).toBe(200)

    // The reason is kept for good, so it must hold no secret.
    const secret = await boss.api(`/agent-connections/${gone.id}/disconnect`, {
      reason: `password: ${gone.key}`,
    })
    expect(secret.status).toBe(422)
    expect(await mcpStatus(gone.key)).toBe(200)

    const ended = await boss.api(`/agent-connections/${gone.id}/disconnect`, {
      reason: 'The job moved to another team',
    })
    expect(ended.status).toBe(200)
    expect(await ended.json()).toEqual({ disconnected: 1 })
    // The very next request is refused; the other key keeps working.
    expect(await mcpStatus(gone.key)).toBe(401)
    expect(await mcpStatus(kept.key)).toBe(200)
    const refusal = logLines.find(
      (line) => line.msg === 'MCP token rejected' && line.reason === 'revoked',
    )
    expect(refusal).toMatchObject({ client: 'access-key' })

    const listed = (await (await boss.api('/agent-connections')).json()) as Listed[]
    expect(listed.map((r) => r.id)).not.toContain(gone.id)
    expect(listed.map((r) => r.id)).toContain(kept.id)
    expect(
      (await boss.api(`/agent-connections/${gone.id}/disconnect`, { reason: 'Again' })).status,
    ).toBe(404)
    const audit = await admin.query<{ action: string; actor: string; reason: string }>(
      `select action, actor_id::text as actor, reason from audit_log
        where subject_type='access_key' and subject_id=$1 order by seq`,
      [gone.id],
    )
    expect(audit.rows.map((r) => r.action)).toEqual(['access_key.created', 'access_key.revoked'])
    expect(audit.rows[1]).toMatchObject({
      actor: people.admin,
      reason: 'The job moved to another team',
    })
  })

  it('refuses a key nobody made, and a key of the wrong form, naming no key', async () => {
    expect(await mcpStatus(`hak_${'A'.repeat(43)}`)).toBe(401)
    expect(await mcpStatus('hak_short')).toBe(401)
    const reasons = logLines
      .filter((line) => line.msg === 'MCP token rejected' && line.client === 'access-key')
      .map((line) => line.reason)
    expect(reasons).toEqual(expect.arrayContaining(['unknown_key', 'malformed']))
  })

  it('lets only an administrator create or revoke a key', async () => {
    const boss = await signedIn('admin')
    const { id, key } = await createKey(boss)
    const person = await signedIn('author')
    expect((await person.api('/access-keys', {})).status).toBe(403)
    expect((await person.api('/agent-connections')).status).toBe(403)
    expect(
      (await person.api(`/agent-connections/${id}/disconnect`, { reason: 'Mine now' })).status,
    ).toBe(403)
    expect(await mcpStatus(key)).toBe(200)
    expect((await browser().api('/access-keys', {})).status).toBe(401)
    expect(
      (
        await admin.query('select count(*)::int as n from auth.access_keys where created_by=$1', [
          people.author,
        ])
      ).rows,
    ).toEqual([{ n: 0 }])
  })

  it('never writes a key to a log line', async () => {
    const boss = await signedIn('admin')
    const { key } = await createKey(boss)
    await mcpStatus(key)
    const log = rawLog.join('\n')
    expect(log).not.toContain(key)
    expect(log).not.toContain(key.slice(4))
  })
})
