/*
  Every agent has a name, a kind and what it may do (FR-420). An agent is an app a person signed
  in with, acting for that person, or an access key an admin made for a bot or a scheduled job,
  which names no person. What it may do is set per agent by an admin, and bounds what the person
  allowed when the app connected: it can only narrow it, never widen it. The service enforces it
  at every MCP request, and Settings, Agents and access shows it in these words.
*/

/** The two ways an agent gets in: an app a person signed in with, or an access key. */
export const agentKinds = ['app', 'key'] as const
export type AgentKind = (typeof agentKinds)[number]

/** What an agent may do, widest first. An access key never suggests: it names no person. */
export const agentPermissions = ['suggest', 'read', 'none'] as const
export type AgentPermission = (typeof agentPermissions)[number]

/** The scopes an agent may hold (FR-414). */
export const agentScopes = ['read', 'feedback', 'propose'] as const
export type AgentScope = (typeof agentScopes)[number]

/** The most each permission leaves an agent, whatever it was allowed when it connected. */
export const permissionScopes: Record<AgentPermission, readonly AgentScope[]> = {
  suggest: ['read', 'feedback', 'propose'],
  read: ['read', 'feedback'],
  none: [],
}

/** The permissions an agent of a kind can have, widest first. */
export const permissionsFor = (kind: AgentKind): readonly AgentPermission[] =>
  kind === 'key' ? ['read', 'none'] : agentPermissions

/** The scopes an agent holds: what it was allowed, narrowed by its permission. */
export const scopesWith = (allowed: readonly string[], permission: AgentPermission): AgentScope[] =>
  permissionScopes[permission].filter((scope) => allowed.includes(scope))

/** A permission in plain words: its name in the picker, and what it lets the agent do. */
export const permissionWords: Record<AgentPermission, { label: string; line: string }> = {
  suggest: {
    label: 'Read and suggest',
    line: 'Reads context, reports what is missing or wrong, and sends suggestions. An owner checks each one before anything changes.',
  },
  read: {
    label: 'Read only',
    line: 'Reads context and reports what is missing or wrong. It cannot suggest.',
  },
  none: {
    label: 'No access',
    line: 'Gets nothing until an admin changes this. Revoke ends it for good.',
  },
}

/** What each scope lets an agent do, as the list under an agent says it. */
export const scopeWords: Record<AgentScope, string> = {
  read: 'Read the context owners published',
  feedback: 'Report what is missing, wrong or unclear',
  propose: 'Suggest new context or a change, for an owner to check',
}

/** What no agent ever does, whatever it may do: the end of every agent's list. */
export const neverWords = 'It never publishes, never reads comments and never sees who asked.'

/** The plain list of what an agent may do now, from the scopes it holds. */
export const mayDo = (scopes: readonly string[]): string[] =>
  agentScopes.filter((scope) => scopes.includes(scope)).map((scope) => scopeWords[scope])

/** An agent's name: 1 to 100 characters of plain text, as an admin gives an access key one. */
export const agentNameProblem = (name: string): string | null => {
  const trimmed = name.trim()
  if (!trimmed) return 'Give it a name, such as what the job does.'
  if (trimmed.length > 100) return 'Keep the name to 100 characters.'
  // Control and format characters, bidirectional overrides among them, and line breaks.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(trimmed)) return 'Use plain text in the name.'
  return null
}
