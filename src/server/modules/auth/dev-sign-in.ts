import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import * as z from 'zod'
import type { SignInPerson } from '../../../contract/auth.ts'
import type { Queryable } from '../../db/database.ts'
import { initialsOf } from './people.ts'
import {
  currentSession,
  defaultLifetime,
  endSession,
  principalFor,
  startSession,
  type Session,
  type SessionLifetime,
  type SessionMethod,
} from './sessions.ts'

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
export interface SignIn {
  /** How this install signs people in (CL_AUTH). */
  readonly method: SessionMethod
  readonly lifetime: SessionLifetime
  people: readonly DevPerson[]
  /**
   * Who the sign-in screen offers, in the file's order, with the roles each holds now and the
   * domains of those roles. A person not signed in yet shows the roles the file gives them. None
   * when people sign in with their company's provider.
   */
  choices(tx: Queryable): Promise<SignInPerson[]>
  initialize(tx: Queryable): Promise<void>
  currentSession(tx: Queryable, cookie: string | undefined): Promise<Session | null>
  /** The picker's sign-in, by email; null when there is no picker or nobody by that address. */
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
 * The picker (CL_AUTH=dev, or demo for demos): a person chooses whom to be from a local file.
 * Refused in production, where people sign in with their company's provider.
 */
export function createDevSignIn(
  people: readonly DevPerson[],
  nodeEnv = process.env.NODE_ENV,
  options: { method?: 'dev' | 'demo'; lifetime?: SessionLifetime } = {},
): SignIn {
  const method = options.method ?? 'dev'
  if (nodeEnv === 'production')
    throw new Error(
      `${method === 'dev' ? 'Dev' : 'Demo'} sign-in is refused when NODE_ENV=production`,
    )
  const lifetime = options.lifetime ?? defaultLifetime
  const allowed = people.length ? peopleSchema.parse(people) : []
  const auth: SignIn = {
    method,
    lifetime,
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
    currentSession: (tx, cookie) => currentSession(tx, cookie, lifetime),
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
      return startSession(tx, person, method, lifetime, cookie)
    },
    signOut: endSession,
    groups: () => Promise.resolve([]),
  }
  return auth
}
