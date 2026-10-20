import type { Connection, ConnectRequest, ContextApi } from './client'
import { ApiError } from './errors'
import { refusals } from '../../contract/refusals.ts'
import { FIXTURE_TODAY } from '../mocks/reference-data.ts'

/**
 * People's AI apps, in the mock. The sign-in in progress that the consent screen can answer
 * (`/connect/approve?request=` and this id) is answered once: it connects the app for the
 * signed-in person, or not, and the address then answers like one that ended. The mock sends the
 * browser to Connect your AI, where the connected apps are listed, instead of to a real app.
 *
 * The apps already connected are the world's (mock-admin.ts keeps them): each person lists and
 * disconnects their own, and an administrator sees and disconnects everyone's.
 */
export const MOCK_CONNECT_REQUEST = 'mockSignInFromClaudeDesktop0000000000000000'

/** A connection with the person it acts as. */
export type MockConnection = Connection & { personId: string }

/** A moment `offset` days from `today`, at a time of day (UTC). */
const day = (today: string, offset: number, time = '09:30:00') => {
  const date = new Date(`${today}T${time}Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString()
}

const pending: ConnectRequest = {
  clientName: 'Claude Desktop',
  clientKind: 'registered',
  clientHost: '127.0.0.1',
  redirectHost: '127.0.0.1',
  scopes: ['read', 'feedback'],
  expiresAt: day(FIXTURE_TODAY, 0, '09:40:00'),
}

/**
 * The apps people have connected by the fixture day: apps that name themselves as they please,
 * local ones that registered from the person's own computer, one used minutes ago and one quiet
 * for days, and an administrator's own. A connection lasts seven days.
 */
export function mockConnectionSeed(today: string): MockConnection[] {
  const at = (offset: number, time?: string) => day(today, offset, time)
  const app = (
    personId: string,
    serial: string,
    clientName: string,
    clientHost: string,
    scopes: Connection['scopes'],
    connected: [number, string],
    used: [number, string],
  ): MockConnection => ({
    id: `0199a6c4-2f00-7000-8000-${serial.padStart(12, '0')}`,
    personId,
    clientName,
    clientHost,
    scopes,
    connectedAt: at(...connected),
    lastUsedAt: at(...used),
    expiresAt: at(connected[0] + 7, connected[1]),
  })
  return [
    app(
      'per_maria',
      'c0de',
      'Cursor',
      'cursor.com',
      ['read', 'feedback'],
      [-3, '14:05:00'],
      [0, '08:52:00'],
    ),
    app(
      'per_jon',
      'c101',
      'Claude Code',
      '127.0.0.1',
      ['read', 'feedback', 'propose'],
      [-1, '07:12:00'],
      [0, '07:40:00'],
    ),
    app(
      'per_jon',
      'c102',
      'Claude Desktop',
      '127.0.0.1',
      ['read', 'feedback'],
      [-6, '16:20:00'],
      [-2, '11:03:00'],
    ),
    app(
      'per_sofia',
      'c201',
      'ChatGPT',
      'chatgpt.com',
      ['read'],
      [-2, '10:45:00'],
      [-1, '15:30:00'],
    ),
    app(
      'per_tomas',
      'c301',
      'Cursor',
      'cursor.com',
      ['read', 'feedback'],
      [-5, '08:10:00'],
      [-5, '08:40:00'],
    ),
    app(
      'per_noor',
      'c401',
      'Claude Code',
      '127.0.0.1',
      ['read', 'feedback', 'propose'],
      [0, '09:05:00'],
      [0, '09:12:00'],
    ),
    app(
      'per_priya',
      'c501',
      'Visual Studio Code',
      '127.0.0.1',
      ['read'],
      [-4, '13:00:00'],
      [-3, '17:25:00'],
    ),
    app(
      'per_lars',
      'c601',
      'Research notebook',
      'notebooks.example.org',
      ['read', 'feedback'],
      [-2, '12:00:00'],
      [-2, '12:30:00'],
    ),
    app(
      'per_ravi',
      'c701',
      'Claude Code',
      '127.0.0.1',
      ['read', 'feedback', 'propose'],
      [-2, '08:00:00'],
      [0, '08:30:00'],
    ),
  ]
}

/** The consent screen's request and answer; an allowed app is connected through `connect`. */
export function createMockConnections(
  guard: () => void,
  wait: () => Promise<void>,
  connect: (connection: Connection) => Promise<void>,
): Pick<ContextApi, 'getConnectRequest' | 'decideConnectRequest'> {
  let answered = false
  const run = async <T>(step: () => T): Promise<T> => {
    await wait()
    guard()
    return step()
  }
  return {
    getConnectRequest: (id) =>
      run(() => (id === MOCK_CONNECT_REQUEST && !answered ? pending : null)),
    decideConnectRequest: async (input) => {
      const allow = await run(() => {
        if (input.id !== MOCK_CONNECT_REQUEST || answered)
          throw new ApiError('not-found', refusals.notFound, { status: 404 })
        answered = true
        return input.allow
      })
      if (allow)
        await connect({
          id: '0199a6c4-2f00-7000-8000-00000000d00d',
          clientName: pending.clientName,
          clientHost: pending.clientHost,
          scopes: pending.scopes,
          connectedAt: day(FIXTURE_TODAY, 0, '09:31:00'),
          lastUsedAt: day(FIXTURE_TODAY, 0, '09:31:00'),
          expiresAt: day(FIXTURE_TODAY, 7, '09:31:00'),
        })
      return { redirectTo: '/settings?section=connect' }
    },
  }
}
