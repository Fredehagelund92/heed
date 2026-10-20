import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import * as z from 'zod'
import type { Principal, SignInPerson } from '../../../contract/auth.ts'
import type { Queryable } from '../../db/database.ts'
import { initialsOf, toPerson } from './people.ts'

const personSchema = z
  .object({
    email: z.email().toLowerCase(),
    name: z.string().trim().min(1),
    roles: z.array(z.enum(['administrator', 'auditor'])).default([]),
  })
  .strict()
const peopleSchema = z
  .array(personSchema)
  .min(1)
  .superRefine((people, ctx) => {
    if (new Set(people.map((p) => p.email)).size !== people.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate dev person email' })
  })
export type DevPerson = z.infer<typeof personSchema>
export async function readDevPeople(path: string): Promise<DevPerson[]> {
  return peopleSchema.parse(parse(await readFile(path, 'utf8')))
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
export const sessionCookie = (token: string, secure: boolean, age = 28800) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`

/** The person of a live session, or null; one indexed read, without the person's roles. */
export async function sessionPersonId(
  tx: Queryable,
  cookie: string | undefined,
): Promise<string | null> {
  const token = sessionToken(cookie)
  if (!token) return null
  const [row] = await tx.query<{ personId: string }>(
    'select person_id::text as "personId" from auth.sessions where token_hash=$1 and expires_at > now()',
    [hash(token)],
  )
  return row?.personId ?? null
}

export interface Session {
  person: Principal
  csrfToken: string
}
export interface SignIn {
  people: readonly DevPerson[]
  /**
   * Who the sign-in screen offers, in the file's order, with the roles each holds now and the
   * domains of those roles. A person not signed in yet shows the roles the file gives them.
   */
  choices(tx: Queryable): Promise<SignInPerson[]>
  initialize(tx: Queryable): Promise<void>
  currentSession(tx: Queryable, cookie: string | undefined): Promise<Session | null>
  signIn(
    tx: Queryable,
    email: string,
    cookie: string | undefined,
  ): Promise<{ token: string; session: Session } | null>
  signOut(tx: Queryable, cookie: string | undefined): Promise<void>
  /**
   * The person's audience groups (FR-405, CON-401). The dev connector knows none, so a person
   * reads the items for everyone only (CON-403).
   */
  groups(tx: Queryable, personId: string): Promise<readonly string[]>
}
/**
 * A person with the roles they hold now, as columns of one row: every request reads it before it
 * does anything else, so it is one round trip, not one per kind of role.
 */
const principalColumns = `p.id::text as id, p.display_name as name,
  coalesce((select array_agg(g.role::text order by g.role) from global_role_grants g
             where g.person_id=p.id and g.valid_at @> now()), '{}') as roles,
  coalesce((select json_agg(json_build_object('areaId', a.area_id, 'role', a.role) order by a.area_id, a.role)
             from area_assignments a where a.person_id=p.id and a.valid_at @> now()), '[]') as assignments`
const activePerson = 'p.deactivated_at is null and p.erased_at is null'
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
export function createDevSignIn(
  people: readonly DevPerson[],
  nodeEnv = process.env.NODE_ENV,
): SignIn {
  if (nodeEnv === 'production') throw new Error('Dev sign-in is refused when NODE_ENV=production')
  const allowed = people.length ? peopleSchema.parse(people) : []
  const auth: SignIn = {
    people: allowed,
    async choices(tx) {
      const known = await tx.query<{ id: string; email: string; name: string }>(
        'select id::text, email, display_name as name from people where email = any($1) and deactivated_at is null and erased_at is null',
        [allowed.map((p) => p.email)],
      )
      const ids = known.map((p) => p.id)
      const roles = await tx.query<{ personId: string; role: DevPerson['roles'][number] }>(
        'select person_id::text as "personId", role from global_role_grants where person_id = any($1::uuid[]) and valid_at @> now() order by role',
        [ids],
      )
      const assignments = await tx.query<{
        personId: string
        role: SignInPerson['assignments'][number]['role']
        id: string
        name: string
        label: SignInPerson['assignments'][number]['area']['label']
      }>(
        `select g.person_id::text as "personId", g.role, a.id, a.name, a.label
           from area_assignments g join areas a on a.id = g.area_id
          where g.person_id = any($1::uuid[]) and g.valid_at @> now()
          order by a.name, g.role`,
        [ids],
      )
      return allowed.map((person) => {
        const row = known.find((p) => p.email === person.email)
        const name = row?.name ?? person.name
        return {
          email: person.email,
          name,
          initials: initialsOf(name),
          roles: row ? roles.filter((r) => r.personId === row.id).map((r) => r.role) : person.roles,
          assignments: row
            ? assignments
                .filter((a) => a.personId === row.id)
                .map(({ role, id, name, label }) => ({ role, area: { id, name, label } }))
            : [],
        }
      })
    },
    async initialize(tx) {
      for (const person of allowed)
        await tx.query('select auth.bootstrap_person($1,$2,$3::global_role[])', [
          person.email,
          person.name,
          person.roles,
        ])
    },
    async currentSession(tx, cookie) {
      const token = sessionToken(cookie)
      if (!token) return null
      // The session and its person in one read, as every request starts with it.
      const [row] = await tx.query<PrincipalRow & { csrfToken: string }>(
        `select s.csrf_token as "csrfToken", ${principalColumns}
           from auth.sessions s join people p on p.id=s.person_id and ${activePerson}
          where s.token_hash=$1 and s.expires_at > now()`,
        [hash(token)],
      )
      return row ? { person: toPrincipal(row), csrfToken: row.csrfToken } : null
    },
    async signIn(tx, email, cookie) {
      if (!allowed.some((p) => p.email === email)) return null
      await auth.initialize(tx)
      const [row] = await tx.query<{ id: string }>(
        'select id::text from people where email=$1 and deactivated_at is null and erased_at is null',
        [email],
      )
      if (!row) return null
      const person = await principalFor(tx, row.id)
      if (!person) return null
      await auth.signOut(tx, cookie)
      await tx.query('delete from auth.sessions where expires_at <= now()')
      const token = randomBytes(32).toString('hex')
      const csrfToken = randomBytes(32).toString('hex')
      await tx.query(
        "insert into auth.sessions(token_hash,person_id,csrf_token,expires_at) values($1,$2,$3,now()+interval '8 hours')",
        [hash(token), person.id, csrfToken],
      )
      await tx.query('update people set last_signed_in_at=now() where id=$1', [person.id])
      return { token, session: { person, csrfToken } }
    },
    async signOut(tx, cookie) {
      const token = sessionToken(cookie)
      if (token) await tx.query('delete from auth.sessions where token_hash=$1', [hash(token)])
    },
    groups: () => Promise.resolve([]),
  }
  return auth
}
