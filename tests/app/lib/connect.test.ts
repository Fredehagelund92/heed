import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock'
import { CHECK_MS, HINT_MS, MOCK_SIGN_IN_MS, phaseAt, seenAt, STOP_MS } from '@/lib/connect'

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
