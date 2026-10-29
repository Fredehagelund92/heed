import { createHash, randomBytes } from 'node:crypto'
import type { Queryable } from '../../db/database.ts'
import { TokenError, type Principal, type TokenVerifier } from '../../mcp/auth.ts'
import { initialsOf } from '../auth/index.ts'

/**
 * Access keys (docs/ai-sign-in.md): for a bot or a scheduled job that can't sign in. An
 * administrator creates one; it is shown once and kept only as its SHA-256. It names no person: it
 * acts as a service with the read and feedback scopes, under its own client label, and lasts until
 * an administrator revokes it, which ends it at once.
 */

/** The client label every access key shares in the MCP request log and client policies (FR-410). */
export const accessKeyClient = 'access-key'
/** What a key may do: read context and give feedback. Never `propose`, which needs a person. */
export const accessKeyScopes = ['read', 'feedback'] as const

const prefix = 'hak_'
/** The prefix and 32 random bytes as base64url: 256 bits nobody guesses. */
const keyPattern = /^hak_[A-Za-z0-9_-]{43}$/

/** Whether a bearer token is an access key, by its form: the MCP server checks it with its digest. */
export const isAccessKey = (token: string) => token.startsWith(prefix)

const digest = (key: string) => createHash('sha256').update(key).digest('hex')

/** A key as Connected agents lists it: who made it, when, and when it was last used. */
export interface AccessKey {
  id: string
  scopes: (typeof accessKeyScopes)[number][]
  createdAt: string
  /** Null until an agent first uses it. */
  lastUsedAt: string | null
  madeBy: { id: string; name: string; initials: string }
}

/** The signed-in administrator, as the database says it now; null for anyone else. */
async function administrator(tx: Queryable) {
  const [actor] = await tx.query<{ admin: boolean; id: string | null }>(
    'select cl_is_admin_now() as admin, cl_person()::text as id',
  )
  return actor?.admin && actor.id ? actor.id : null
}

/**
 * Creates a key for the signed-in administrator: the key itself is in this answer only. The
 * history log notes that a key was made, never the key or its digest. Null when the signed-in
 * person is no longer an administrator.
 */
export async function createAccessKey(
  tx: Queryable,
): Promise<{ id: string; key: string; createdAt: string } | null> {
  const actor = await administrator(tx)
  if (!actor) return null
  const key = `${prefix}${randomBytes(32).toString('base64url')}`
  const [row] = await tx.query<{ id: string; createdAt: Date }>(
    `insert into auth.access_keys(key_hash, created_by) values($1, $2)
     returning id::text, created_at as "createdAt"`,
    [digest(key), actor],
  )
  await tx.query(
    `insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details)
     values($1, 'person', 'access_key.created', 'access_key', $2, $3)`,
    [actor, row!.id, JSON.stringify({ scopes: accessKeyScopes })],
  )
  return { id: row!.id, key, createdAt: row!.createdAt.toISOString() }
}

/** Every key not revoked, newest first, with who made it. Never a key or its digest. */
export async function listAccessKeys(tx: Queryable): Promise<AccessKey[]> {
  const rows = await tx.query<{
    id: string
    createdAt: Date
    lastUsedAt: Date | null
    madeById: string
    madeByName: string
  }>(
    `select k.id::text, k.created_at as "createdAt", k.last_used_at as "lastUsedAt",
            p.id::text as "madeById", p.display_name as "madeByName"
       from auth.access_keys k join public.people p on p.id = k.created_by
      where k.revoked_at is null
      order by k.created_at desc, k.id`,
  )
  return rows.map((row) => ({
    id: row.id,
    scopes: [...accessKeyScopes],
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    madeBy: { id: row.madeById, name: row.madeByName, initials: initialsOf(row.madeByName) },
  }))
}

/**
 * An administrator revokes a key with a reason the history log keeps: it stops working at the
 * very next request. Whether it ended; false when it was revoked already or never was, null when
 * the signed-in person is no longer an administrator.
 */
export async function revokeAccessKey(
  tx: Queryable,
  id: string,
  reason: string,
): Promise<boolean | null> {
  const actor = await administrator(tx)
  if (!actor) return null
  const [ended] = await tx.query<{ id: string }>(
    `update auth.access_keys set revoked_at = now(), revoked_by = $2
      where id = $1 and revoked_at is null returning id::text`,
    [id, actor],
  )
  if (!ended) return false
  await tx.query(
    `insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, reason)
     values($1, 'person', 'access_key.revoked', 'access_key', $2, '{}', $3)`,
    [actor, ended.id, reason],
  )
  return true
}

/**
 * The MCP server's check of an access key (FR-402): its digest must be an open key, asked of the
 * database at every request, so a revoked key is refused at once. `check` answers for a digest
 * (serving_access_key). A key names a client label and scopes, never a person.
 */
export function createAccessKeyVerifier(
  check: (hash: string) => Promise<'open' | 'revoked' | null>,
): TokenVerifier {
  const principal: Principal = {
    client: accessKeyClient,
    scopes: accessKeyScopes,
    caller: 'agent',
    canSelectEdition: false,
  }
  return {
    async verify(token) {
      if (!keyPattern.test(token)) throw new TokenError('malformed', accessKeyClient)
      const state = await check(digest(token))
      if (state === 'open') return principal
      throw new TokenError(state === 'revoked' ? 'revoked' : 'unknown_key', accessKeyClient)
    },
  }
}

/**
 * The MCP server's verifier with access keys: a key goes to the key check, any other token to
 * `tokens`, which picks by issuer.
 */
export function withAccessKeys(tokens: TokenVerifier, keys: TokenVerifier): TokenVerifier {
  return { verify: (token) => (isAccessKey(token) ? keys : tokens).verify(token) }
}

/** The key check on the serving database, through the one function the serving role may call. */
export const servingKeyCheck =
  (database: Queryable) =>
  async (hash: string): Promise<'open' | 'revoked' | null> => {
    const [row] = await database.query<{ state: 'open' | 'revoked' | null }>(
      'select serving_access_key($1) as state',
      [hash],
    )
    return row?.state ?? null
  }
