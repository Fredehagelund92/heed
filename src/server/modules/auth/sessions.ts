import { createHash, randomBytes } from 'node:crypto'
import type { Principal } from '../../../contract/auth.ts'
import type { Queryable } from '../../db/database.ts'
import { toPerson } from './people.ts'

/*
  Browser sessions, however a person signed in (the dev or demo picker, or OIDC). The cookie holds
  256 random bits; the database keeps their SHA-256, with the session's CSRF token, how it began,
  and two ends: after a stretch unused (the idle limit, slid forward as the person works) and an
  absolute end it never passes. Signing in always makes a new session and ends the one the browser
  had, so a session id planted before sign-in is worth nothing after it (session fixation).
*/

export type SessionMethod = 'dev' | 'demo' | 'oidc'

/** CL_SESSION_IDLE_HOURS and CL_SESSION_MAX_DAYS. */
export interface SessionLifetime {
  idleHours: number
  maxDays: number
}
export const defaultLifetime: SessionLifetime = { idleHours: 12, maxDays: 7 }

export interface Session {
  person: Principal
  csrfToken: string
}

export const SESSION_COOKIE = 'heed_session'
export function sessionToken(cookie: string | undefined): string | undefined {
  const values =
    cookie
      ?.split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${SESSION_COOKIE}=`)) ?? []
  if (values.length !== 1) return undefined
  const token = values[0]!.slice(SESSION_COOKIE.length + 1)
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** The session cookie: HttpOnly, SameSite=Strict, kept by the browser until the absolute end. */
export const sessionCookie = (token: string, secure: boolean, age: number) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`
export const cookieAge = (lifetime: SessionLifetime) => lifetime.maxDays * 86_400

const live = 's.expires_at > now() and s.absolute_expires_at > now()'

/** The person of a live session, or null; one indexed read, without the person's roles. */
export async function sessionPersonId(
  tx: Queryable,
  cookie: string | undefined,
): Promise<string | null> {
  const token = sessionToken(cookie)
  if (!token) return null
  const [row] = await tx.query<{ personId: string }>(
    `select s.person_id::text as "personId" from auth.sessions s where s.token_hash=$1 and ${live}`,
    [hash(token)],
  )
  return row?.personId ?? null
}

/**
 * A person with the roles they hold now, as columns of one row: every request reads it before it
 * does anything else, so it is one round trip, not one per kind of role.
 */
export const principalColumns = `p.id::text as id, p.display_name as name,
  coalesce((select array_agg(g.role::text order by g.role) from global_role_grants g
             where g.person_id=p.id and g.valid_at @> now()), '{}') as roles,
  coalesce((select json_agg(json_build_object('areaId', a.area_id, 'role', a.role) order by a.area_id, a.role)
             from area_assignments a where a.person_id=p.id and a.valid_at @> now()), '[]') as assignments`
export const activePerson = 'p.deactivated_at is null and p.erased_at is null'
type PrincipalRow = {
  id: string
  name: string
  roles: Principal['permissions']['roles']
  assignments: Principal['permissions']['assignments']
}
const toPrincipal = (row: PrincipalRow): Principal => ({
  ...toPerson(row),
  permissions: { roles: row.roles, assignments: row.assignments },
})

export async function principalFor(tx: Queryable, id: string): Promise<Principal | null> {
  const [row] = await tx.query<PrincipalRow>(
    `select ${principalColumns} from people p where p.id=$1 and ${activePerson}`,
    [id],
  )
  return row ? toPrincipal(row) : null
}

/**
 * The session the cookie names and its person, or null: ended, unused past the idle limit, past
 * its absolute end, or of a person no longer active. A session used again slides its idle end
 * forward, at most once a minute and never past the absolute end, in the same round trip.
 */
export async function currentSession(
  tx: Queryable,
  cookie: string | undefined,
  lifetime: SessionLifetime,
): Promise<Session | null> {
  const token = sessionToken(cookie)
  if (!token) return null
  const [row] = await tx.query<PrincipalRow & { csrfToken: string }>(
    `with touched as (
       update auth.sessions s set last_seen_at=now(),
              expires_at=least(now() + make_interval(hours => $2), s.absolute_expires_at)
        where s.token_hash=$1 and ${live} and s.last_seen_at < now() - interval '1 minute'
        returning s.token_hash)
     select s.csrf_token as "csrfToken", ${principalColumns}
       from auth.sessions s join people p on p.id=s.person_id and ${activePerson}
      where s.token_hash=$1 and ${live}`,
    [hash(token), lifetime.idleHours],
  )
  return row ? { person: toPrincipal(row), csrfToken: row.csrfToken } : null
}

/**
 * Starts a session for a person who has just signed in: ends the one this browser had (session
 * fixation) and every ended session, then makes a new one with a new token and CSRF token.
 */
export async function startSession(
  tx: Queryable,
  person: Principal,
  method: SessionMethod,
  lifetime: SessionLifetime,
  cookie: string | undefined,
): Promise<{ token: string; session: Session }> {
  await endSession(tx, cookie)
  await tx.query(
    'delete from auth.sessions where expires_at <= now() or absolute_expires_at <= now()',
  )
  const token = randomBytes(32).toString('hex')
  const csrfToken = randomBytes(32).toString('hex')
  await tx.query(
    `insert into auth.sessions(token_hash,person_id,csrf_token,method,expires_at,absolute_expires_at)
     values($1,$2,$3,$4,
            least(now() + make_interval(hours => $5), now() + make_interval(days => $6)),
            now() + make_interval(days => $6))`,
    [hash(token), person.id, csrfToken, method, lifetime.idleHours, lifetime.maxDays],
  )
  await tx.query('update people set last_signed_in_at=now() where id=$1', [person.id])
  return { token, session: { person, csrfToken } }
}

export async function endSession(tx: Queryable, cookie: string | undefined) {
  const token = sessionToken(cookie)
  if (token) await tx.query('delete from auth.sessions where token_hash=$1', [hash(token)])
}
