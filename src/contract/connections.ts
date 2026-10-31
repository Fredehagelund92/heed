import * as z from 'zod/mini'
import { agentKinds, agentNameProblem, agentPermissions } from '../domain/agents.ts'

/**
 * A person's own agents (FR-403, docs/ai-sign-in.md): the consent screen for a sign-in in
 * progress, and the apps that hold a connection, which the person can disconnect.
 */
export const connectionScopes = ['read', 'feedback', 'propose'] as const
export const connectionScopeSchema = z.enum(connectionScopes)

/** A sign-in in progress is named by an opaque handle the login server put in the address. */
export const connectRequestIdSchema = z.object({
  id: z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/)),
})
export const connectRequestSchema = z.object({
  /** The app's own name for itself: shown as the app says it, never trusted. */
  clientName: z.string(),
  /** Known by a description the app publishes on its own site, or by a registration here. */
  clientKind: z.enum(['document', 'registered']),
  /** Where the app's description lives, or for a registration, where it sends the person back. */
  clientHost: z.string(),
  /** Where the browser goes after the answer. */
  redirectHost: z.string(),
  scopes: z.array(connectionScopeSchema),
  expiresAt: z.string(),
})
export const connectDecisionSchema = z.extend(connectRequestIdSchema, { allow: z.boolean() })
export const connectDecisionResultSchema = z.object({
  /** The app's own redirect address, with the code or the refusal. The page goes there. */
  redirectTo: z.string(),
})
export const connectionSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  clientHost: z.string(),
  scopes: z.array(connectionScopeSchema),
  connectedAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
})
export const connectionIdSchema = z.object({ id: z.uuid() })

/**
 * Every person's agents, for an administrator (FR-403, FR-807): each connection with the person
 * it acts as. The app's name is the one it gave itself; the host says where it came from.
 */
export const personConnectionSchema = z.extend(connectionSchema, {
  person: z.object({
    id: z.string(),
    name: z.string(),
    initials: z.string(),
    /** Null for an erased person: the address is gone with them. */
    email: z.nullable(z.string()),
  }),
})
/**
 * An access key an administrator made for a bot or a scheduled job that can't sign in. It names no
 * person and may read context and give feedback; it lasts until revoked. The key itself is never
 * in a read: only the answer that made it holds it.
 */
export const accessKeyConnectionSchema = z.object({
  kind: z.literal('access_key'),
  id: z.string(),
  /** The name an administrator gave it. */
  name: z.string(),
  scopes: z.array(connectionScopeSchema),
  createdAt: z.string(),
  /** Null until an agent first uses it. */
  lastUsedAt: z.nullable(z.string()),
  madeBy: z.object({ id: z.string(), name: z.string(), initials: z.string() }),
})
/** The agents an administrator sees: every person's connections, and the access keys. */
export const agentConnectionSchema = z.discriminatedUnion('kind', [
  z.extend(personConnectionSchema, { kind: z.literal('agent') }),
  accessKeyConnectionSchema,
])
/** A new access key: shown in this answer once, and kept only as its digest. */
export const createdAccessKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  createdAt: z.string(),
})
/** An agent's name as an administrator gives an access key one: trimmed plain text, 1 to 100 characters. */
export const agentNameSchema = z.string().check(
  z.trim(),
  z.refine((name) => agentNameProblem(name) === null, {
    message: 'Give it a name of 1 to 100 characters of plain text.',
  }),
)
export const createAccessKeySchema = z.strictObject({ name: agentNameSchema })
export const renameAccessKeySchema = z.strictObject({ id: z.uuid(), name: agentNameSchema })

/**
 * One agent (FR-420): an app a person signed in with, acting for them, or an access key, which
 * names no person. Its name, its kind, what an administrator lets it do, and what it may do now,
 * which is what it was allowed narrowed by that. Never a key, a token or a digest.
 */
export const agentSchema = z.object({
  id: z.string(),
  kind: z.enum(agentKinds),
  /** An app's name for itself, shown as it says it; an access key's, as an administrator gave it. */
  name: z.string(),
  /** Where an app came from, as a host; null for an access key. */
  host: z.nullable(z.string()),
  /** The person an app acts for; null for an access key. */
  person: z.nullable(
    z.object({
      id: z.string(),
      name: z.string(),
      initials: z.string(),
      /** Null for an erased person: the address is gone with them. */
      email: z.nullable(z.string()),
    }),
  ),
  /** Who made an access key; null for an app. */
  madeBy: z.nullable(z.object({ id: z.string(), name: z.string(), initials: z.string() })),
  /** What an administrator lets it do. */
  permission: z.enum(agentPermissions),
  /** Who last changed that, and when; null while it is as it started. */
  permissionSetBy: z.nullable(z.object({ name: z.string(), at: z.string() })),
  /** What it was allowed: by the person when an app connected, fixed for an access key. */
  allowed: z.array(connectionScopeSchema),
  /** What it may do now: what it was allowed, narrowed by its permission. */
  scopes: z.array(connectionScopeSchema),
  /** Since when: an app's oldest open connection, or when the key was made. */
  since: z.string(),
  /** Null until an agent first used it. */
  lastUsedAt: z.nullable(z.string()),
  /** What it sent: its suggestions in the last 30 days, and the latest few. */
  suggestions: z.object({
    lastDays: z.number(),
    recent: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        state: z.string(),
        at: z.string(),
      }),
    ),
  }),
})
/** Kept in the history log for good, so it is trimmed, required and checked for sensitive text. */
const agentReason = z.string().check(z.trim(), z.minLength(1), z.maxLength(500))
export const agentPermissionInputSchema = z.strictObject({
  id: z.uuid(),
  permission: z.enum(agentPermissions),
  reason: agentReason,
})
/** An administrator gives a reason the log keeps; a person ending their own app needs none. */
export const agentRevokeSchema = z.strictObject({ id: z.uuid(), reason: z.optional(agentReason) })
export const agentRevokedSchema = z.object({ revoked: z.boolean() })
/** Kept in the history log for good, so it is required, trimmed and checked for sensitive text. */
const reason = z.string().check(z.trim(), z.minLength(1), z.maxLength(500))
export const adminDisconnectSchema = z.strictObject({ id: z.uuid(), reason })
/** How many connections ended: none when they had all ended already. */
export const adminDisconnectedSchema = z.object({ disconnected: z.number() })

/**
 * Connect an agent's live line (FR-418): whether the signed-in person's own agent signed in, or
 * the person declined it in the browser, since the page began to wait. A wait is ten minutes on
 * the page, so a moment more than an hour ago reads as an hour ago.
 */
export const connectPendingInputSchema = z.strictObject({ since: z.iso.datetime() })
/** The newest outcome since then, with the agent's own name for itself; none is `waiting`. */
export const connectPendingSchema = z.object({
  state: z.enum(['waiting', 'connected', 'declined']),
  agent: z.nullable(z.string()),
  at: z.nullable(z.string()),
})

export type ConnectionScope = z.infer<typeof connectionScopeSchema>
export type ConnectRequest = z.infer<typeof connectRequestSchema>
export type Connection = z.infer<typeof connectionSchema>
export type PersonConnection = z.infer<typeof personConnectionSchema>
export type AccessKeyConnection = z.infer<typeof accessKeyConnectionSchema>
export type AgentConnection = z.infer<typeof agentConnectionSchema>
export type CreatedAccessKey = z.infer<typeof createdAccessKeySchema>
export type Agent = z.infer<typeof agentSchema>
export type AgentPermissionInput = z.infer<typeof agentPermissionInputSchema>
export type AdminDisconnect = z.infer<typeof adminDisconnectSchema>
