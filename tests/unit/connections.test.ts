import { describe, expect, it } from 'vitest'
import { createHttpApi } from '@/api/http-api'
import type { PersonalLists } from '@/api/client'
import { createMockApi } from '@/api/mock-api'
import { MOCK_CONNECT_REQUEST } from '@/api/mock-connections'
import { createMockWorkflow, type MockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import type { PersonConnection } from '@/api'
import {
  appListWords,
  clientOrigin,
  connectionCountWords,
  endsWords,
  scopeSummary,
  searchConnections,
  sortConnections,
} from '@/lib/connections'

/*
  A person's own agents in the web app: the plain words of the consent screen, what the http
  binding sends (the local sign-in's fixed header, then the session's token on the answer), and
  the mock's one pending sign-in, which is answered once, and the apps people connected: each
  person's own, and everyone's for an administrator, who disconnects them with a reason.
*/

describe('the words', () => {
  it('names what an app may do in one phrase', () => {
    expect(scopeSummary(['read'])).toBe('Read')
    expect(scopeSummary(['read', 'feedback'])).toBe('Read and feedback')
    expect(scopeSummary(['read', 'feedback', 'propose'])).toBe('Read, feedback and suggest changes')
  })
  it('says how the agent is known and where the answer goes', () => {
    expect(
      clientOrigin({
        clientKind: 'document',
        clientHost: 'app.example',
        redirectHost: 'app.example',
      }),
    ).toBe(
      'The agent describes itself at app.example. Heed sends you back to app.example when you answer.',
    )
    expect(
      clientOrigin({
        clientKind: 'registered',
        clientHost: '127.0.0.1',
        redirectHost: '127.0.0.1',
      }),
    ).toBe(
      'The agent registered itself with Heed. Heed sends you back to 127.0.0.1 when you answer.',
    )
  })
})

describe('every person’s apps, for an administrator', () => {
  const app = (
    id: string,
    person: string,
    clientName: string,
    clientHost: string,
    connectedAt: string,
    lastUsedAt: string,
  ): PersonConnection => ({
    id,
    clientName,
    clientHost,
    scopes: ['read'],
    connectedAt,
    lastUsedAt,
    expiresAt: '2026-10-14T09:30:00.000Z',
    person: {
      id: person.toLowerCase().replace(' ', '_'),
      name: person,
      initials: '',
      email: `${person.split(' ')[0]!.toLowerCase()}@example.test`,
    },
  })
  const all = [
    app(
      '3',
      'Noor Haddad',
      'Claude Code',
      '127.0.0.1',
      '2026-10-07T09:05:00Z',
      '2026-10-07T09:12:00Z',
    ),
    app(
      '1',
      'Jon Abara',
      'Claude Desktop',
      '127.0.0.1',
      '2026-10-01T16:20:00Z',
      '2026-10-05T11:03:00Z',
    ),
    app(
      '2',
      'Jon Abara',
      'Claude Code',
      '127.0.0.1',
      '2026-10-06T07:12:00Z',
      '2026-10-07T07:40:00Z',
    ),
    app(
      '4',
      'Maria Lindqvist',
      'cursor',
      'cursor.com',
      '2026-10-04T14:05:00Z',
      '2026-10-07T08:52:00Z',
    ),
  ]
  const ids = (list: PersonConnection[]) => list.map((connection) => connection.id)

  it('sorts by any column either way, then by the person, the app and the id', () => {
    expect(ids(sortConnections(all, 'used', 'desc'))).toEqual(['3', '4', '2', '1'])
    expect(ids(sortConnections(all, 'used', 'asc'))).toEqual(['1', '2', '4', '3'])
    expect(ids(sortConnections(all, 'connected', 'desc'))).toEqual(['3', '2', '4', '1'])
    // Two of Jon's apps: the app's name decides between them.
    expect(ids(sortConnections(all, 'person', 'asc'))).toEqual(['2', '1', '4', '3'])
    expect(ids(sortConnections(all, 'person', 'desc'))).toEqual(['3', '4', '2', '1'])
    // Case does not matter: cursor sorts with the Cs.
    expect(ids(sortConnections(all, 'app', 'asc'))).toEqual(['2', '3', '1', '4'])
    expect(sortConnections(all, 'app', 'asc')).not.toBe(all)
  })

  it('finds every word in the person’s name or address, or the app’s name or address', () => {
    expect(ids(searchConnections(all, ''))).toEqual(['3', '1', '2', '4'])
    expect(ids(searchConnections(all, 'CLAUDE'))).toEqual(['3', '1', '2'])
    expect(ids(searchConnections(all, 'jon code'))).toEqual(['2'])
    expect(ids(searchConnections(all, 'maria@'))).toEqual(['4'])
    expect(ids(searchConnections(all, 'cursor.com'))).toEqual(['4'])
    expect(searchConnections(all, 'nobody')).toEqual([])
  })

  it('counts the apps and the people, or what a search kept', () => {
    expect(connectionCountWords(all, all)).toBe('4 agents for 3 people')
    expect(connectionCountWords(all.slice(0, 1), all.slice(0, 1))).toBe('1 agent for 1 person')
    expect(connectionCountWords(all.slice(0, 2), all)).toBe('2 of 4 agents')
  })

  it('lists apps in a sentence, and says when a connection ends', () => {
    expect(appListWords(all.slice(0, 1))).toBe('Claude Code')
    expect(appListWords(all.slice(0, 2))).toBe('Claude Code and Claude Desktop')
    expect(appListWords(all.slice(0, 3))).toBe('Claude Code, Claude Desktop and Claude Code')
    expect(endsWords('2026-10-14T09:30:00.000Z')).toBe('Ends 14 Oct')
  })
})

const personal: PersonalLists = {
  listFavorites: () => [],
  setFavorite: () => [],
  listRecent: () => [],
  recordVisit: () => [],
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the http binding', () => {
  it('signs in with the fixed header, then answers with the new session token', async () => {
    const sent: { path: string; csrf: string | null; body: string }[] = []
    const session = {
      person: {
        id: 'p',
        name: 'Maria',
        initials: 'M',
        permissions: { roles: [], assignments: [] },
      },
      csrfToken: 'a'.repeat(64),
    }
    const api = createHttpApi({
      baseUrl: 'http://heed.test/api/v1',
      personal,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const path = new URL(request.url).pathname.replace('/api/v1', '')
        sent.push({ path, csrf: request.headers.get('x-heed-csrf'), body: await request.text() })
        if (path === '/auth/sign-in') return json(200, session)
        if (path === '/connections/request/decision')
          return json(200, { redirectTo: 'http://127.0.0.1:1/cb?code=x' })
        if (path === '/connections/request') return json(404, { code: 'NOT_FOUND', message: 'No' })
        throw new Error(path)
      },
    })
    expect(await api.signIn('per_maria@example.test')).toEqual(session)
    expect(await api.getConnectRequest('r'.repeat(43))).toBeNull()
    expect(await api.decideConnectRequest({ id: 'r'.repeat(43), allow: true })).toEqual({
      redirectTo: 'http://127.0.0.1:1/cb?code=x',
    })
    expect(sent.map(({ path, csrf }) => [path, csrf])).toEqual([
      ['/auth/sign-in', 'dev-sign-in'],
      ['/connections/request', null],
      ['/connections/request/decision', 'a'.repeat(64)],
    ])
    expect(JSON.parse(sent[2]!.body)).toEqual({ id: 'r'.repeat(43), allow: true })
  })
})

describe('the mock', () => {
  // A world of its own for each test, so a disconnect in one does not reach the next.
  const world = () =>
    createMockWorkflow({
      today: FIXTURE_TODAY,
      areas,
      people,
      vocabulary,
      items: getFixtureItems,
      approvers: roleGrants.approvers,
      administrators: roleGrants.administrators,
      auditors: roleGrants.auditors,
      versionDays,
    })
  const as = (workflow: MockWorkflow, personId: string) =>
    createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })

  it('answers its one pending sign-in once, and lists and disconnects apps', async () => {
    const api = as(world(), 'per_maria')
    expect(await api.getConnectRequest('x'.repeat(43))).toBeNull()
    expect(await api.getConnectRequest(MOCK_CONNECT_REQUEST)).toMatchObject({
      clientName: 'Claude Desktop',
    })
    const before = await api.listConnections()
    await api.decideConnectRequest({ id: MOCK_CONNECT_REQUEST, allow: true })
    expect(await api.getConnectRequest(MOCK_CONNECT_REQUEST)).toBeNull()
    await expect(
      api.decideConnectRequest({ id: MOCK_CONNECT_REQUEST, allow: true }),
    ).rejects.toMatchObject({ kind: 'not-found' })
    const after = await api.listConnections()
    expect(after).toHaveLength(before.length + 1)
    await api.disconnectApp({ id: after[0]!.id })
    expect(await api.listConnections()).toHaveLength(before.length)
    await expect(api.disconnectApp({ id: after[0]!.id })).rejects.toMatchObject({
      kind: 'not-found',
    })
  })
  it('connects nothing when the person says no', async () => {
    const api = as(world(), 'per_maria')
    const before = await api.listConnections()
    await api.decideConnectRequest({ id: MOCK_CONNECT_REQUEST, allow: false })
    expect(await api.listConnections()).toEqual(before)
  })
  it('lists each person their own apps only, and nobody else’s', async () => {
    const workflow = world()
    const maria = await as(workflow, 'per_maria').listConnections()
    const jon = await as(workflow, 'per_jon').listConnections()
    expect(maria.map((app) => app.clientName)).toEqual(['Cursor'])
    expect(jon.map((app) => app.clientName)).toEqual(['Claude Code', 'Claude Desktop'])
    await expect(as(workflow, 'per_jon').disconnectApp({ id: maria[0]!.id })).rejects.toMatchObject(
      { kind: 'not-found' },
    )
  })
  it('shows an administrator everyone’s apps, the last used first, and refuses anyone else', async () => {
    const workflow = world()
    const listed = await as(workflow, 'per_ravi').listAiConnections()
    expect(listed.length).toBeGreaterThan(5)
    const used = listed.map((app) => app.lastUsedAt)
    expect(used).toEqual([...used].sort().reverse())
    expect(listed.find((app) => app.person.id === 'per_maria')).toMatchObject({
      clientName: 'Cursor',
      person: { name: 'Maria Lindqvist', initials: 'ML', email: 'per_maria@example.test' },
    })
    for (const personId of ['per_maria', 'per_jon', 'per_ella']) {
      const api = as(workflow, personId)
      await expect(api.listAiConnections()).rejects.toMatchObject({ kind: 'forbidden' })
      await expect(
        api.disconnectAiConnection({ id: listed[0]!.id, reason: 'Mine now' }),
      ).rejects.toMatchObject({ kind: 'forbidden' })
      await expect(
        api.disconnectPersonAiConnections({ personId: 'per_jon', reason: 'Mine now' }),
      ).rejects.toMatchObject({ kind: 'forbidden' })
    }
  })
  it('disconnects one app with a reason, which the history log keeps', async () => {
    const workflow = world()
    const ravi = as(workflow, 'per_ravi')
    const [cursor] = await as(workflow, 'per_maria').listConnections()
    await expect(ravi.disconnectAiConnection({ id: cursor!.id, reason: '' })).rejects.toMatchObject(
      { kind: 'bad-request' },
    )
    await expect(
      ravi.disconnectAiConnection({ id: cursor!.id, reason: 'token: password=hunter22' }),
    ).rejects.toMatchObject({ kind: 'invalid' })
    expect(
      await ravi.disconnectAiConnection({ id: cursor!.id, reason: ' Laptop was lost ' }),
    ).toEqual({ disconnected: 1 })
    expect(await as(workflow, 'per_maria').listConnections()).toEqual([])
    await expect(
      ravi.disconnectAiConnection({ id: cursor!.id, reason: 'Again' }),
    ).rejects.toMatchObject({ kind: 'not-found' })
    const { entries } = await ravi.searchAudit({ action: 'ai_client' })
    expect(entries[0]).toMatchObject({
      action: 'ai_client.disconnected',
      actorId: 'per_ravi',
      subjectId: cursor!.id,
      reason: 'Laptop was lost',
      batchId: null,
      details: { reason: 'disconnected_by_admin', client: 'Cursor', person: 'per_maria' },
    })
  })
  it('disconnects all of one person’s apps in one step', async () => {
    const workflow = world()
    const ravi = as(workflow, 'per_ravi')
    expect(
      await ravi.disconnectPersonAiConnections({ personId: 'per_jon', reason: 'Left the team' }),
    ).toEqual({ disconnected: 2 })
    expect(await as(workflow, 'per_jon').listConnections()).toEqual([])
    expect((await ravi.listAiConnections()).some((app) => app.person.id === 'per_jon')).toBe(false)
    const { entries } = await ravi.searchAudit({ action: 'ai_client.disconnected' })
    const step = entries.filter((entry) => entry.details.person === 'per_jon')
    expect(step).toHaveLength(2)
    expect(step[0]!.batchId).not.toBeNull()
    expect(step[0]!.batchId).toBe(step[1]!.batchId)
    expect(
      await ravi.disconnectPersonAiConnections({ personId: 'per_jon', reason: 'Left the team' }),
    ).toEqual({ disconnected: 0 })
  })
})
