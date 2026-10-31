import { beforeEach, describe, expect, it } from 'vitest'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'

/*
  Every agent by name (FR-420), end to end on PostgreSQL: an app a person signs in with is one agent
  per person and app, an access key is one; each is listed with its name, its kind and what an
  administrator lets it do, and what it may do is enforced by the MCP server at the agent's very
  next request. An agent set to read only can never suggest, one set to no access gets nothing,
  a switch never widens what the person allowed, a revoke ends the agent at once, and every
  change is in the history log. A suggestion an agent sends names the agent, never publishes, and
  which agent sent it can never change.
*/

const harness = await signInHarness()
const { admin, browser, registered, signInFlow, exchange, mcpClient, mcpStatus, resource } = harness

beforeEach(async () => {
  harness.advance(61)
  // Room for every suggestion these tests send.
  await admin.query(
    `insert into settings_versions (key,version,value,reason)
     select 'limits.agent_drafts',max(version)+1,'{"per_day":100,"open":100}','test'
       from settings_versions where key='limits.agent_drafts'`,
  )
})

type Listed = {
  id: string
  kind: 'app' | 'key'
  name: string
  host: string | null
  person: { id: string; name: string } | null
  madeBy: { id: string; name: string } | null
  tools: { tool: string; on: boolean; allowed: boolean }[]
  toolsSetBy: { name: string; at: string } | null
  suggestions: { lastDays: number; recent: { id: string; title: string; state: string }[] }
}

async function signedIn(name: string) {
  const person = browser()
  await person.signIn(name)
  return person
}

/** One person signs an app in: its access token, and the client it signed in with. */
async function connect(person = 'author', scope = 'read feedback propose') {
  const clientId = await registered()
  const flow = await signInFlow(clientId, { person, scope })
  const tokens = await exchange(clientId, flow.code!, flow.verifier)
  expect(tokens.status).toBe(200)
  return { clientId, token: tokens.body.access_token! }
}

async function agentsOf(who: Awaited<ReturnType<typeof signedIn>>) {
  const response = await who.api('/agents')
  expect(response.status).toBe(200)
  return (await response.json()) as Listed[]
}

/** The agent of an app: one per person and client. */
async function agentOfClient(clientId: string) {
  const { rows } = await admin.query<{ id: string }>(
    "select id::text from auth.agents where kind='app' and client_id=$1",
    [clientId],
  )
  return rows[0]!.id
}

const call = (token: string, body: object) =>
  fetch(resource, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, ...body }),
  })

const suggestion = (title: string) => ({
  name: 'suggest_context',
  arguments: {
    text: `${title}, from 1 October 2026.`,
    scope: { metrics: ['Orders'] },
    window: { from: '2026-10-01' },
    evidence: [
      {
        url: 'https://wiki.example/finance/orders-gift-cards',
        quote: 'Gift cards are not orders.',
      },
    ],
    new_item: true,
  },
})

const proposalCount = async () =>
  (await admin.query<{ n: number }>('select count(*)::int as n from proposals')).rows[0]!.n

const toolNames = [
  'get_context',
  'find_context',
  'read_context',
  'report',
  'suggest_context',
  'get_related',
]

/** An administrator switches one tool of one agent, with a reason the history log keeps. */
function setTool(
  who: Awaited<ReturnType<typeof signedIn>>,
  id: string,
  tool: string,
  on: boolean,
  reason = 'Checking what it sends',
) {
  return who.api(`/agents/${id}/tools`, { tool, on, reason })
}

/** Every tool of one agent switched the same way. */
async function setAll(boss: Awaited<ReturnType<typeof signedIn>>, id: string, on: boolean) {
  for (const tool of toolNames) expect((await setTool(boss, id, tool, on)).status).toBe(200)
}

/** The tools an agent's row says it may call now: switched on and allowed. */
const toolsOn = (row: Listed) => row.tools.filter((t) => t.on && t.allowed).map((t) => t.tool)

describe('every agent by name', () => {
  it('lists an app by its name, kind and person, and names it on the suggestion it sends', async () => {
    const app = await connect('author')
    const id = await agentOfClient(app.clientId)
    const boss = await signedIn('admin')
    const row = (await agentsOf(boss)).find((r) => r.id === id)
    expect(row).toMatchObject({
      kind: 'app',
      name: 'Test client',
      host: '127.0.0.1',
      person: { id: people.author, name: 'author' },
      madeBy: null,
      tools: toolNames.map((tool) => ({ tool, on: true, allowed: true })),
      toolsSetBy: null,
      suggestions: { lastDays: 0, recent: [] },
    })

    const wire = await mcpClient(app.token)
    const reply = await wire.callTool(suggestion('Orders exclude gift cards'))
    await wire.close()
    expect(reply.isError).not.toBe(true)
    const { draft_id: proposalId } = reply.structuredContent as { draft_id: string }

    // The suggestion names the agent beside the person, waits for the owner, and is not published.
    const { rows } = await admin.query<{
      agent_id: string
      agent_name: string
      proposer_id: string
      state: string
    }>('select agent_id::text, agent_name, proposer_id::text, state from proposals where id=$1', [
      proposalId,
    ])
    expect(rows).toEqual([
      { agent_id: id, agent_name: 'Test client', proposer_id: people.author, state: 'submitted' },
    ])
    expect(
      (
        await admin.query(
          'select 1 from decisions d join proposals p on p.item_version_id=d.item_version_id where p.id=$1',
          [proposalId],
        )
      ).rows,
    ).toEqual([])

    // Each step of its history names the agent, as the person who said yes.
    const audit = await admin.query<{ action: string; actor: string; agent: unknown }>(
      `select action, actor_id::text as actor, details->'agent' as agent from audit_log
        where subject_type='proposal' and subject_id=$1 order by seq`,
      [proposalId],
    )
    expect(audit.rows.map((r) => r.action)).toEqual([
      'proposal.created',
      'proposal.submitted',
      'proposal.checked',
    ])
    for (const entry of audit.rows)
      expect(entry).toMatchObject({ actor: people.author, agent: { id, name: 'Test client' } })

    // The owner's review and the agent's own row name it too.
    const owner = await signedIn('owner')
    const sheet = (await (await owner.api(`/review/${proposalId}/sheet`)).json()) as {
      agent: string | null
      writtenBy: string | null
    }
    expect(sheet).toMatchObject({ agent: 'Test client', writtenBy: 'agent' })
    const listed = (await agentsOf(boss)).find((r) => r.id === id)!
    expect(listed.suggestions.lastDays).toBe(1)
    expect(listed.suggestions.recent).toMatchObject([{ id: proposalId, state: 'submitted' }])

    // Which agent sent a suggestion never changes, whoever asks.
    await expect(
      admin.query("update proposals set agent_name='Someone else' where id=$1", [proposalId]),
    ).rejects.toThrow(/cannot change/)
  })

  it('stops an app with suggest_context switched off from suggesting at its next request', async () => {
    const app = await connect('author')
    const id = await agentOfClient(app.clientId)
    const boss = await signedIn('admin')
    const before = await proposalCount()

    // A reason is required, and it is checked for secrets like every reason the log keeps.
    expect((await setTool(boss, id, 'suggest_context', false, '')).status).toBe(400)
    expect(
      (await setTool(boss, id, 'suggest_context', false, `password: ${'hak_' + 'x'.repeat(43)}`))
        .status,
    ).toBe(422)
    expect((await setTool(boss, id, 'not_a_tool', false)).status).toBe(400)
    expect((await setTool(boss, id, 'suggest_context', false)).status).toBe(200)

    const wire = await mcpClient(app.token)
    const names = (await wire.listTools()).tools.map((t) => t.name)
    await wire.close()
    expect(names).toContain('get_context')
    expect(names).not.toContain('suggest_context')
    const refused = await call(app.token, {
      method: 'tools/call',
      params: suggestion('Orders exclude test orders'),
    })
    expect(refused.status).toBe(403)
    // No scope challenge: the app is not asked to sign the person in again.
    expect(refused.headers.get('www-authenticate')).toBeNull()
    expect(await refused.json()).toEqual({
      error:
        'An admin switched suggest_context off for this agent in Heed. The person can suggest in Heed instead.',
    })
    expect(await proposalCount()).toBe(before)

    // The row says so, and who changed it; the history log keeps why.
    const row = (await agentsOf(boss)).find((r) => r.id === id)!
    expect(toolsOn(row)).toEqual(toolNames.filter((t) => t !== 'suggest_context'))
    expect(row.tools.find((t) => t.tool === 'suggest_context')).toEqual({
      tool: 'suggest_context',
      on: false,
      allowed: true,
    })
    expect(row.toolsSetBy).toMatchObject({ name: 'admin' })
    const audit = await admin.query<{ action: string; actor: string; details: unknown }>(
      `select action, actor_id::text as actor, details, reason from audit_log
        where subject_type='agent' and subject_id=$1 order by seq`,
      [id],
    )
    expect(audit.rows).toEqual([
      {
        action: 'agent.tool_switched',
        actor: people.admin,
        details: { name: 'Test client', kind: 'app', tool: 'suggest_context', on: false },
        reason: 'Checking what it sends',
      },
    ])

    // Switched back on, it may suggest again at once.
    expect((await setTool(boss, id, 'suggest_context', true)).status).toBe(200)
    const again = await mcpClient(app.token)
    const reply = await again.callTool(suggestion('Orders exclude staff orders'))
    await again.close()
    expect(reply.isError).not.toBe(true)
    expect(await proposalCount()).toBe(before + 1)
  })

  it('refuses one tool switched off, gives an agent with every tool off nothing, and never widens consent', async () => {
    const app = await connect('author')
    const reader = await connect('author', 'read feedback')
    const boss = await signedIn('admin')
    const id = await agentOfClient(app.clientId)
    expect(await mcpStatus(app.token)).toBe(200)

    // One read tool off: it is neither offered nor run, and the others go on.
    expect((await setTool(boss, id, 'find_context', false)).status).toBe(200)
    const wire0 = await mcpClient(app.token)
    expect((await wire0.listTools()).tools.map((t) => t.name)).not.toContain('find_context')
    await wire0.close()
    const one = await call(app.token, {
      method: 'tools/call',
      params: { name: 'find_context', arguments: { query: 'orders' } },
    })
    expect(one.status).toBe(403)
    expect(((await one.json()) as { error: string }).error).toBe(
      'An admin switched find_context off for this agent in Heed.',
    )
    expect(await mcpStatus(app.token)).toBe(200)

    await setAll(boss, id, false)
    const refused = await call(app.token, { method: 'tools/list' })
    expect(refused.status).toBe(403)
    expect(refused.headers.get('www-authenticate')).toBeNull()
    expect(((await refused.json()) as { error: string }).error).toMatch(
      /^An admin switched off every tool for this agent/,
    )
    // Its other connections are the same agent, and get nothing either.
    const second = await signInFlow(app.clientId, { person: 'author', scope: 'read' })
    const tokens = await exchange(app.clientId, second.code!, second.verifier)
    expect(await mcpStatus(tokens.body.access_token!)).toBe(403)
    expect(toolsOn((await agentsOf(boss)).find((r) => r.id === id)!)).toEqual([])
    await setAll(boss, id, true)
    expect(await mcpStatus(app.token)).toBe(200)

    // An app the person allowed only to read never suggests, whatever its switch says.
    const readerId = await agentOfClient(reader.clientId)
    expect((await setTool(boss, readerId, 'suggest_context', true)).status).toBe(200)
    const wire = await mcpClient(reader.token)
    expect((await wire.listTools()).tools.map((t) => t.name)).not.toContain('suggest_context')
    await wire.close()
    const readerRow = (await agentsOf(boss)).find((r) => r.id === readerId)!
    expect(toolsOn(readerRow)).not.toContain('suggest_context')
    expect(readerRow.tools.find((t) => t.tool === 'suggest_context')).toMatchObject({
      allowed: false,
    })
  })

  it('keeps what an admin set when the same app registers again as a new client', async () => {
    const first = await connect('author')
    const boss = await signedIn('admin')
    await setAll(boss, await agentOfClient(first.clientId), false)
    // The same app, registered anew: a new client id, the same name, the same person.
    const again = await connect('author')
    const id = await agentOfClient(again.clientId)
    const row = (await agentsOf(boss)).find((r) => r.id === id)!
    expect(toolsOn(row)).toEqual([])
    expect(row.toolsSetBy).toMatchObject({ name: 'admin' })
    expect(await mcpStatus(again.token)).toBe(403)
    // Another person's app by that name starts as usual.
    const other = await connect('owner')
    expect(await mcpStatus(other.token)).toBe(200)
  })

  it('keeps every switch of every earlier registration of the same app, not only one', async () => {
    const boss = await signedIn('admin')
    const one = await connect('owner')
    const two = await connect('owner')
    expect(
      (await setTool(boss, await agentOfClient(one.clientId), 'suggest_context', false)).status,
    ).toBe(200)
    expect(
      (await setTool(boss, await agentOfClient(two.clientId), 'get_related', false)).status,
    ).toBe(200)
    const again = await connect('owner')
    const id = await agentOfClient(again.clientId)
    const fresh = (await agentsOf(boss)).find((r) => r.id === id)!
    expect(toolsOn(fresh)).toEqual(['get_context', 'find_context', 'read_context', 'report'])
  })

  it('ends every connection of an app at once when an agent is revoked', async () => {
    const app = await connect('author')
    const id = await agentOfClient(app.clientId)
    const second = await signInFlow(app.clientId, { person: 'author', scope: 'read' })
    const other = (await exchange(app.clientId, second.code!, second.verifier)).body.access_token!
    const boss = await signedIn('admin')
    expect((await boss.api(`/agents/${id}/revoke`, {})).status).toBe(403)
    const ended = await boss.api(`/agents/${id}/revoke`, { reason: 'Left the team' })
    expect(ended.status).toBe(200)
    expect(await mcpStatus(app.token)).toBe(401)
    expect(await mcpStatus(other)).toBe(401)
    expect((await agentsOf(boss)).map((r) => r.id)).not.toContain(id)
    expect((await boss.api(`/agents/${id}/revoke`, { reason: 'Again' })).status).toBe(404)
    const audit = await admin.query<{ action: string; reason: string }>(
      `select action, reason from audit_log where action='ai_client.disconnected'
          and details->>'person'=$1 order by seq desc limit 2`,
      [people.author],
    )
    expect(audit.rows).toEqual([
      { action: 'ai_client.disconnected', reason: 'Left the team' },
      { action: 'ai_client.disconnected', reason: 'Left the team' },
    ])
  })

  it('shows anyone else only their own apps, which they may end but never change', async () => {
    const mine = await connect('author')
    const theirs = await connect('owner')
    const mineId = await agentOfClient(mine.clientId)
    const theirsId = await agentOfClient(theirs.clientId)
    const author = await signedIn('author')
    const listed = await agentsOf(author)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((r) => r.kind === 'app' && r.person?.id === people.author)).toBe(true)
    expect(listed.map((r) => r.id)).not.toContain(theirsId)
    expect((await setTool(author, mineId, 'get_context', false)).status).toBe(403)
    expect((await author.api(`/agents/${theirsId}/revoke`, {})).status).toBe(403)
    expect(await mcpStatus(theirs.token)).toBe(200)
    expect((await author.api(`/agents/${mineId}/revoke`, {})).status).toBe(200)
    expect(await mcpStatus(mine.token)).toBe(401)
    expect((await browser().api('/agents')).status).toBe(401)
  })

  it('names an access key, renames it, and sets it to no access and back at once', async () => {
    const boss = await signedIn('admin')
    for (const name of ['', '   ', 'x'.repeat(101), 'Two\nlines'])
      expect((await boss.api('/access-keys', { name })).status).toBe(400)
    const created = (await (
      await boss.api('/access-keys', { name: ' Weekly digest ' })
    ).json()) as {
      id: string
      name: string
      key: string
    }
    expect(created.name).toBe('Weekly digest')
    const row = (await agentsOf(boss)).find((r) => r.kind === 'key' && r.name === 'Weekly digest')!
    expect(row).toMatchObject({
      person: null,
      madeBy: { id: people.admin, name: 'admin' },
    })
    expect(toolsOn(row)).toEqual(toolNames.filter((t) => t !== 'suggest_context'))
    // An access key names no person, so it can never be given suggest_context.
    expect((await setTool(boss, row.id, 'suggest_context', true)).status).toBe(404)

    await setAll(boss, row.id, false)
    expect(await mcpStatus(created.key)).toBe(403)
    for (const tool of toolNames.filter((t) => t !== 'suggest_context'))
      expect((await setTool(boss, row.id, tool, true)).status).toBe(200)
    expect(await mcpStatus(created.key)).toBe(200)

    const renamed = await boss.api(`/agents/${row.id}/name`, { name: 'Monday digest' })
    expect(renamed.status).toBe(200)
    expect((await agentsOf(boss)).find((r) => r.id === row.id)).toMatchObject({
      name: 'Monday digest',
    })
    const audit = await admin.query<{ action: string; details: unknown }>(
      `select action, details from audit_log where subject_type='access_key' and subject_id=$1
        order by seq`,
      [created.id],
    )
    expect(audit.rows).toEqual([
      {
        action: 'access_key.created',
        details: { name: 'Weekly digest', scopes: ['read', 'feedback'] },
      },
      { action: 'access_key.renamed', details: { from: 'Weekly digest', to: 'Monday digest' } },
    ])
    const author = await signedIn('author')
    expect((await author.api(`/agents/${row.id}/name`, { name: 'Mine now' })).status).toBe(403)

    // Revoked through its agent, it ends at its next request.
    expect((await boss.api(`/agents/${row.id}/revoke`, { reason: 'Job retired' })).status).toBe(200)
    expect(await mcpStatus(created.key)).toBe(401)
    expect((await boss.api(`/agents/${row.id}/name`, { name: 'Late' })).status).toBe(404)
  })
})
