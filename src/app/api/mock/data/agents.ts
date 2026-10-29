import type { ConnectRequest } from '@contract/connections'
import type { Connected } from '@/lib/connect'

/** The agents people connected as the demo starts, newest sign-in first. */
export const seedAgents: readonly Connected[] = [
  { agent: 'Claude Code', who: 'Kofi Mensah', since: '20 Oct 2026', used: 'Yesterday' },
  { agent: 'Claude', who: 'Maria Lindqvist', since: '2 Oct 2026', used: 'Today' },
  { agent: 'Claude', who: 'Ines Duarte', since: '1 Oct 2026', used: 'Today' },
  { agent: 'Cursor', who: 'Jon Abara', since: '12 Sep 2026', used: 'Yesterday' },
]

/**
 * The demo's agent sign-in waiting at the consent page: open
 * /connect/approve?request=<this id> to answer it. A sign-in id is 43 characters, as the service's.
 */
export const MOCK_CONNECT_REQUEST = 'demo-agent-sign-in-waiting-for-your-answer0'

/** What the waiting sign-in asks: Claude Code, from its own description, for every tool. */
export const mockConnectRequest = {
  clientName: 'Claude Code',
  clientKind: 'document',
  clientHost: 'claude.ai',
  redirectHost: 'localhost',
  scopes: ['read', 'feedback', 'propose'],
  expiresAt: '2026-10-23T09:40:00.000Z',
} as const satisfies ConnectRequest
