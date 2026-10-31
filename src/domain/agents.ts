import { agentToolNames, type AgentToolName } from './mcp-text.ts'

/*
  Every agent has a name, a kind and the tools it may call (FR-420). An agent is an app a person
  signed in with, acting for that person, or an access key an admin made for a bot or a scheduled
  job, which names no person. An admin switches each tool on or off per agent. A switch only
  narrows what the person allowed when the app connected: it never widens it, an access key never
  gets suggest_context, and an agent with every tool off gets nothing. The service enforces it at
  every MCP request, and Settings, Agents and access shows it in these words.
*/

/** The two ways an agent gets in: an app a person signed in with, or an access key. */
export const agentKinds = ['app', 'key'] as const
export type AgentKind = (typeof agentKinds)[number]

/** The scopes an agent may hold (FR-414). */
export const agentScopes = ['read', 'feedback', 'propose'] as const
export type AgentScope = (typeof agentScopes)[number]

export { agentToolNames, type AgentToolName }

/** The scope each tool needs: what the person must have allowed for it to work at all. */
export const toolScopes: Record<AgentToolName, AgentScope> = {
  get_context: 'read',
  find_context: 'read',
  read_context: 'read',
  report: 'feedback',
  suggest_context: 'propose',
  get_related: 'read',
}

/** The tools an agent of a kind can ever have on: an access key names no person, so never suggest_context. */
export const toolsFor = (kind: AgentKind): AgentToolName[] =>
  agentToolNames.filter((tool) => kind === 'app' || tool !== 'suggest_context')

/** The tools an agent may call now: switched on, and allowed by the scopes it was given. */
export const toolsWith = (on: readonly string[], scopes: readonly string[]): AgentToolName[] =>
  agentToolNames.filter((tool) => on.includes(tool) && scopes.includes(toolScopes[tool]))

/** An agent's name: 1 to 100 characters of plain text, as an admin gives an access key one. */
export const agentNameProblem = (name: string): string | null => {
  const trimmed = name.trim()
  if (!trimmed) return 'Give it a name, such as what the job does.'
  if (trimmed.length > 100) return 'Keep the name to 100 characters.'
  // Control and format characters, bidirectional overrides among them, and line breaks.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(trimmed)) return 'Use plain text in the name.'
  return null
}
