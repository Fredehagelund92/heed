import type { ConnectRequest } from '@contract/connections'
import type { Connected } from '@/lib/connect'
import {
  agentToolNames,
  toolScopes,
  toolsFor,
  type AgentKind,
  type AgentToolName,
} from '@domain/agents'

const everything = ['read', 'feedback', 'propose'] as const

/**
 * Every tool as an agent's row has it: switched on unless `off` names it, and allowed by the scopes
 * the person gave it, and for an access key never suggest_context.
 */
export function toolRows(
  kind: AgentKind,
  scopes: readonly string[],
  off: readonly AgentToolName[] = [],
): Connected['tools'] {
  const may = toolsFor(kind)
  return agentToolNames.map((tool) => ({
    tool,
    on: may.includes(tool) && !off.includes(tool),
    allowed: may.includes(tool) && scopes.includes(toolScopes[tool]),
  }))
}

/**
 * The agents people connected as the demo starts, the last used first (FR-420): each by its name,
 * the person it acts for and its tools. Jon Abara switched suggest_context off for Ines Duarte's;
 * Jon's own Cursor was allowed to read only when he connected it.
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
    tools: toolRows('app', everything),
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
    tools: toolRows('app', everything),
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
    tools: toolRows('app', everything, ['suggest_context']),
    setBy: { name: 'Jon Abara', on: '14 Oct 2026' },
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
    tools: toolRows('app', ['read', 'feedback']),
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
