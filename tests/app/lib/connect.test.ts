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
  usedLine,
} from '@/lib/connect'

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
    await api.revokeAgentConnection({ agent: row.agent, who: row.who })
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
  const agent = { agent: 'Cursor', who: 'Jon Abara', since: '12 Sep 2026', used: 'Yesterday' }
  const key = { agent: 'Access key', who: 'Jon Abara', since: '23 Oct 2026', used: 'Never' }

  it('counts the keys beside Create an access key, and says where they are', () => {
    expect(keysHint([agent])).toBe('None yet.')
    expect(keysHint([agent, { ...key, key: 'k1' }])).toBe('1 key, in Connected agents above.')
    expect(keysHint([{ ...key, key: 'k1' }, agent, { ...key, key: 'k2' }])).toBe(
      '2 keys, in Connected agents above.',
    )
  })

  it('says how many agents and keys the list holds, in one line', () => {
    expect(connectedLine([])).toBe('None yet.')
    expect(connectedLine([agent])).toBe('1 agent people have connected.')
    expect(connectedLine([agent, agent, { ...key, key: 'k1' }])).toBe(
      '2 agents people have connected, and 1 access key.',
    )
    expect(
      connectedLine([
        { ...key, key: 'k1' },
        { ...key, key: 'k2' },
      ]),
    ).toBe('2 access keys.')
  })

  it('says a key no agent used yet was never used', () => {
    expect(usedLine(key)).toBe('never used')
    expect(usedLine(agent)).toBe('used yesterday')
  })

  it('lists a new key in the mock, revokes it alone, and keeps the agents', async () => {
    const { api } = createMockApi()
    await api.signIn({ name: 'Jon Abara', fresh: false })
    const before = await api.listAgentConnections()
    await api.createAccessKey()
    await api.createAccessKey()
    const rows = await api.listAgentConnections()
    const keys = rows.filter((r) => r.key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatchObject({ agent: 'Access key', who: 'Jon Abara', fresh: true })
    await api.revokeAgentConnection({ agent: 'Access key', who: 'Jon Abara', key: keys[0]!.key! })
    const after = await api.listAgentConnections()
    expect(after.filter((r) => r.key).map((r) => r.key)).toEqual([keys[1]!.key])
    expect(after.filter((r) => !r.key)).toHaveLength(before.length)
  })
})
