import type { ConnectRequest } from '@contract/connections'
import type { Connected } from '@/lib/connect'

const everything = ['read', 'feedback', 'propose'] as const

/**
 * The agents people connected as the demo starts, the last used first (FR-420): each by its name,
 * the person it acts for and what an admin lets it do. Ines Duarte's is read only, as Jon Abara set it.
 */
export const seedAgents: readonly Connected[] = [
  {
    id: 'agent-claude-code-kofi',
    kind: 'app',
    agent: 'Claude Code',
    who: 'Kofi Mensah',
    host: 'claude.ai',
    since: '20 Oct 2026',
    used: 'Yesterday',
    permission: 'suggest',
    allowed: [...everything],
    scopes: [...everything],
    sent: 2,
    recent: [
      {
        id: 'agent-sent-1',
        title: 'Payment provider delays order data in Poland',
        state: 'submitted',
        on: '21 Oct 2026',
      },
      {
        id: 'agent-sent-2',
        title: 'Returns spike after the autumn sale',
        state: 'accepted',
        on: '20 Oct 2026',
      },
    ],
  },
  {
    id: 'agent-claude-maria',
    kind: 'app',
    agent: 'Claude',
    who: 'Maria Lindqvist',
    host: 'claude.ai',
    since: '2 Oct 2026',
    used: 'Today',
    permission: 'suggest',
    allowed: [...everything],
    scopes: [...everything],
    sent: 0,
    recent: [],
  },
  {
    id: 'agent-claude-ines',
    kind: 'app',
    agent: 'Claude',
    who: 'Ines Duarte',
    host: 'claude.ai',
    since: '1 Oct 2026',
    used: 'Today',
    permission: 'read',
    setBy: { name: 'Jon Abara', on: '14 Oct 2026' },
    allowed: [...everything],
    scopes: ['read', 'feedback'],
    sent: 0,
    recent: [],
  },
  {
    id: 'agent-cursor-jon',
    kind: 'app',
    agent: 'Cursor',
    who: 'Jon Abara',
    host: 'cursor.com',
    since: '12 Sep 2026',
    used: 'Yesterday',
    permission: 'suggest',
    allowed: ['read', 'feedback'],
    scopes: ['read', 'feedback'],
    sent: 0,
    recent: [],
  },
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
