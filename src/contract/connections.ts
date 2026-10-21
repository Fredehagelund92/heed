import * as z from 'zod/mini'

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
/** Kept in the history log for good, so it is required, trimmed and checked for sensitive text. */
const reason = z.string().check(z.trim(), z.minLength(1), z.maxLength(500))
export const adminDisconnectSchema = z.strictObject({ id: z.uuid(), reason })
export const adminDisconnectPersonSchema = z.strictObject({ personId: z.uuid(), reason })
/** How many connections ended: none when they had all ended already. */
export const adminDisconnectedSchema = z.object({ disconnected: z.number() })

export type ConnectionScope = z.infer<typeof connectionScopeSchema>
export type ConnectRequest = z.infer<typeof connectRequestSchema>
export type Connection = z.infer<typeof connectionSchema>
export type PersonConnection = z.infer<typeof personConnectionSchema>
export type AdminDisconnect = z.infer<typeof adminDisconnectSchema>
export type AdminDisconnectPerson = z.infer<typeof adminDisconnectPersonSchema>
