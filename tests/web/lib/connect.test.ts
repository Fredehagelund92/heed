import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock'
import {
  CHECK_MS,
  connectedLine,
  HINT_MS,
  keysHint,
  MOCK_SIGN_IN_MS,
  phaseAt,
  seenAt,
  STOP_MS,
  toolsLine,
  toolsOn,
  usedLine,
  type Connected,
} from '@/lib/connect'
import { toolRows } from '@/api/mock/data/agents'

// The live line checks every 3 seconds, shows what usually helps after 2 minutes and stops at 10.

describe('waiting for an agent to sign in', () => {
  it('sees a sign-in at the next check, not before', () => {
    expect(CHECK_MS).toBe(3_000)
    expect(seenAt(MOCK_SIGN_IN_MS)).toBe(9_000)
    expect(phaseAt(8_999, MOCK_SIGN_IN_MS)).toBe('waiting')
    expect(phaseAt(9_000, MOCK_SIGN_IN_MS)).toBe('connected')
  })

  it('shows what usually helps after 2 minutes, and stops checking at 10', () => {
    expect(phaseAt(HINT_MS - 1)).toBe('waiting')
    expect(phaseAt(HINT_MS)).toBe('hint')
    expect(phaseAt(STOP_MS - 1)).toBe('hint')
    expect(phaseAt(STOP_MS)).toBe('timeout')
  })

  it('misses an agent that signs in after checking stopped', () => {
    expect(phaseAt(STOP_MS + 60_000, STOP_MS + 30_000)).toBe('timeout')
  })
})

describe('the connected agents', () => {
  it('adds a sign-in on top, marked new, and replaces the same agent for the same person', async () => {
    const { api } = createMockApi()
    const before = (await api.listAgentConnections()).length
    expect(await api.checkConnect({ since: Date.now(), agent: 'Claude Code' })).toEqual({
      state: 'waiting',
    })
    const since = Date.now() - MOCK_SIGN_IN_MS
    expect(await api.checkConnect({ since, agent: 'Claude Code' })).toEqual({
      state: 'connected',
      agent: 'Claude Code',
    })
    await api.checkConnect({ since, agent: 'Cursor' })
    const rows = await api.listAgentConnections()
    expect(rows.length).toBe(before + 1)
    expect(rows[0]!).toMatchObject({
      agent: 'Cursor',
      who: 'Jon Abara',
      used: 'Just now',
      fresh: true,
    })
    expect(rows.filter((r) => r.fresh)).toHaveLength(1)
    expect(rows.filter((r) => r.agent === 'Cursor' && r.who === 'Jon Abara')).toHaveLength(1)
  })

  it('revokes one row', async () => {
    const { api } = createMockApi()
    const row = (await api.listAgentConnections())[0]!
    await api.revokeAgent({ id: row.id })
    expect(await api.listAgentConnections()).not.toContainEqual(row)
  })

  it('says a declined sign-in on the review address', async () => {
    const { api, controls } = createMockApi()
    controls.setAddress({ path: '/settings/agents', query: { connect: 'declined' } })
    expect(await api.checkConnect({ since: 0, agent: 'Claude Code' })).toEqual({
      state: 'declined',
    })
    expect(await api.getConnectReview()).toBe('declined')
  })
})

describe('access keys on Connected agents', () => {
  const base = {
    since: '23 Oct 2026',
    tools: toolRows('app', ['read', 'feedback']),
    sent: 0,
    recent: [],
  } satisfies Partial<Connected>
  const agent: Connected = {
    ...base,
    id: 'a1',
    kind: 'app',
    agent: 'Cursor',
    who: 'Jon Abara',
    since: '12 Sep 2026',
    used: 'Yesterday',
  }
  const key = (id: string): Connected => ({
    ...base,
    id,
    kind: 'key',
    agent: 'Weekly sales digest',
    who: 'Jon Abara',
    used: 'Never',
    tools: toolRows('key', ['read', 'feedback']),
  })

  it('counts the keys beside Create an access key, and says where they are', () => {
    expect(keysHint([agent])).toBe('None yet.')
    expect(keysHint([agent, key('k1')])).toBe('1 key, in Connected agents above.')
    expect(keysHint([key('k1'), agent, key('k2')])).toBe('2 keys, in Connected agents above.')
  })

  it('says how many agents and keys the list holds, in one line', () => {
    expect(connectedLine([])).toBe('None yet.')
    expect(connectedLine([agent])).toBe('1 agent people have connected.')
    expect(connectedLine([agent, agent, key('k1')])).toBe(
      '2 agents people have connected, and 1 access key.',
    )
    expect(connectedLine([key('k1'), key('k2')])).toBe('2 access keys.')
  })

  it('says a key no agent used yet was never used', () => {
    expect(usedLine(key('k1'))).toBe('never used')
    expect(usedLine(agent)).toBe('used yesterday')
  })

  it('lists named keys in the mock, renames one, revokes it alone, and keeps the agents', async () => {
    const { api } = createMockApi()
    await api.signIn({ name: 'Jon Abara', fresh: false })
    const before = await api.listAgentConnections()
    await api.createAccessKey({ name: 'Weekly sales digest' })
    await api.createAccessKey({ name: 'Nightly export' })
    const rows = await api.listAgentConnections()
    const keys = rows.filter((r) => r.kind === 'key')
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatchObject({ agent: 'Nightly export', who: 'Jon Abara', fresh: true })
    await api.renameAccessKey({ id: keys[1]!.id, name: 'Monday digest' })
    expect((await api.listAgentConnections()).find((r) => r.id === keys[1]!.id)).toMatchObject({
      agent: 'Monday digest',
    })
    await api.revokeAgent({ id: keys[0]!.id })
    const after = await api.listAgentConnections()
    expect(after.filter((r) => r.kind === 'key').map((r) => r.id)).toEqual([keys[1]!.id])
    expect(after.filter((r) => r.kind === 'app')).toHaveLength(before.length)
  })

  it('switches one tool per agent, never wider than what it was allowed', async () => {
    const { api } = createMockApi()
    await api.signIn({ name: 'Jon Abara', fresh: false })
    const kofi = (await api.listAgentConnections()).find((r) => r.who === 'Kofi Mensah')!
    expect(toolsLine(kofi)).toBe('All 6 tools')
    await api.setAgentTool({ id: kofi.id, tool: 'suggest_context', on: false })
    let now = (await api.listAgentConnections()).find((r) => r.id === kofi.id)!
    expect(toolsOn(now)).not.toContain('suggest_context')
    expect(toolsLine(now)).toBe('5 of 6 tools')
    expect(now.setBy?.name).toBe('Jon Abara')
    for (const { tool } of now.tools) await api.setAgentTool({ id: kofi.id, tool, on: false })
    now = (await api.listAgentConnections()).find((r) => r.id === kofi.id)!
    expect(toolsOn(now)).toEqual([])
    expect(toolsLine(now)).toBe('Off')
    // Jon allowed his Cursor to read only: switching suggest_context on gives it nothing more.
    const jon = (await api.listAgentConnections()).find((r) => r.who === 'Jon Abara')!
    await api.setAgentTool({ id: jon.id, tool: 'suggest_context', on: true })
    now = (await api.listAgentConnections()).find((r) => r.id === jon.id)!
    expect(toolsOn(now)).not.toContain('suggest_context')
    // An access key can never have suggest_context.
    await api.createAccessKey({ name: 'Nightly export' })
    const key = (await api.listAgentConnections()).find((r) => r.kind === 'key')!
    await expect(
      api.setAgentTool({ id: key.id, tool: 'suggest_context', on: true }),
    ).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('lets only an admin change an agent, and shows anyone else only their own apps', async () => {
    const { api } = createMockApi()
    await api.signIn({ name: 'Ines Duarte', fresh: false })
    const mine = await api.listAgentConnections()
    expect(mine.map((r) => r.who)).toEqual(['Ines Duarte'])
    await expect(
      api.setAgentTool({ id: mine[0]!.id, tool: 'get_context', on: false }),
    ).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(api.createAccessKey({ name: 'Mine' })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await api.revokeAgent({ id: mine[0]!.id })
    expect(await api.listAgentConnections()).toEqual([])
  })
})
