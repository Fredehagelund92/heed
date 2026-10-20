import { ORPCError } from '@orpc/client'
import type {
  PeoplePage,
  PeopleSearchInput,
  PersonGrant,
  PersonRow,
  PersonSheet,
  RoleChange,
} from '../../../contract/people.ts'
import type { Person } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'

/** People as the front end names them: owners, proposers and the signed-in person. */
export interface PeopleService {
  /** Everyone, by name. Erased people keep their id and their pseudonymised name, so history still reads. */
  list(): Promise<Person[]>
  /**
   * The People page and the person pickers: people by name or email, a page at a time, with the
   * roles they hold now and when they last signed in. Active people unless asked otherwise.
   */
  search(input: PeopleSearchInput): Promise<PeoplePage>
  /** A person's sheet: every role they hold and every change to their roles; null if unknown. */
  sheet(id: string): Promise<PersonSheet | null>
}

/**
 * The first letter of the first and the last word of a name: "Maria Lindqvist" is "ML". A word
 * that starts with neither a letter nor a digit, such as "(invented)", does not count.
 */
export function initialsOf(name: string): string {
  const all = name.trim().split(/\s+/)
  const named = all.filter((word) => /^[\p{L}\p{N}]/u.test(word))
  const words = named.length ? named : all
  const first = [...(words[0] ?? '')][0] ?? ''
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : ''
  return (first + last).toUpperCase()
}

export const toPerson = (row: { id: string; name: string }): Person => ({
  id: row.id,
  name: row.name,
  initials: initialsOf(row.name),
})

const PAGE = 50
const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** Words as a LIKE pattern that matches them literally: `%`, `_` and `\` are not wildcards. */
const literal = (words: string) => words.replace(/[\\%_]/g, (char) => `\\${char}`)

/** The roles a person holds now, global ones first, as one JSON array per row. */
const heldRoles = `coalesce((
  select jsonb_agg(r order by r->>'areaId' nulls first, r->>'role') from (
    select jsonb_build_object('role', g.role, 'areaId', null) r from global_role_grants g
     where g.person_id = p.id and g.valid_at @> now()
    union all
    select jsonb_build_object('role', a.role, 'areaId', a.area_id) from area_assignments a
     where a.person_id = p.id and a.valid_at @> now()) held), '[]'::jsonb)`

const rowColumns = `p.id::text, p.display_name as name,
  case when p.erased_at is null then p.email end as email,
  case when p.erased_at is not null then 'erased' when p.deactivated_at is not null then 'left' else 'active' end as status,
  ${iso('p.last_signed_in_at')} as "lastSignedInAt", ${heldRoles} as roles`

type Row = Omit<PersonRow, 'initials'>
const toRow = (row: Row): PersonRow => ({ ...row, initials: initialsOf(row.name) })

export function createPeopleService(database: Queryable): PeopleService {
  return {
    async list() {
      const rows = await database.query<{ id: string; name: string }>(
        `select id::text, display_name as name from people
          order by display_name collate "en-x-icu", id`,
      )
      return rows.map(toPerson)
    },

    async search(input) {
      const limit = input.limit ?? PAGE
      const offset = input.offset ?? 0
      const values: unknown[] = []
      const add = (value: unknown) => `$${values.push(value)}`
      const clauses: string[] = []
      const status = input.status ?? 'active'
      if (status === 'active') clauses.push('p.deactivated_at is null and p.erased_at is null')
      if (status === 'left')
        clauses.push('(p.deactivated_at is not null or p.erased_at is not null)')

      // An erased person's address is gone, so only their pseudonymised name is searched.
      const words = input.q?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
      if (words)
        clauses.push(
          `(lower(p.display_name) || ' ' || case when p.erased_at is null then p.email else '' end) like ${add(`%${literal(words)}%`)}`,
        )

      const role = input.role
      const area = input.areaId ? add(input.areaId) : null
      if (role === 'none') {
        clauses.push(`not exists (select 1 from global_role_grants g where g.person_id = p.id and g.valid_at @> now())
          and not exists (select 1 from area_assignments a where a.person_id = p.id and a.valid_at @> now()${area ? ` and a.area_id = ${area}` : ''})`)
      } else if (role === 'administrator' || role === 'auditor') {
        clauses.push(
          `exists (select 1 from global_role_grants g where g.person_id = p.id and g.valid_at @> now() and g.role = ${add(role)})`,
        )
        if (area)
          clauses.push(
            `exists (select 1 from area_assignments a where a.person_id = p.id and a.valid_at @> now() and a.area_id = ${area})`,
          )
      } else if (role || area) {
        clauses.push(`exists (select 1 from area_assignments a where a.person_id = p.id and a.valid_at @> now()
          ${role ? `and a.role = ${add(role)}` : ''} ${area ? `and a.area_id = ${area}` : ''})`)
      }

      if (input.signedIn === 'never') clauses.push('p.last_signed_in_at is null')
      else if (input.signedIn === 'week')
        clauses.push("p.last_signed_in_at >= now() - interval '7 days'")
      else if (input.signedIn === 'month')
        clauses.push("p.last_signed_in_at >= now() - interval '30 days'")
      else if (input.signedIn === 'older')
        clauses.push("p.last_signed_in_at < now() - interval '30 days'")

      const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
      const [counted] = await database.query<{ total: number }>(
        `select count(*)::int as total from people p ${where}`,
        values,
      )
      const total = counted?.total ?? 0
      // The start of the name or the email first, then the start of a word in the name, then the rest.
      const rank = words
        ? `case when lower(p.display_name) like ${add(`${literal(words)}%`)} or (p.erased_at is null and p.email like $${values.length}) then 0
            when lower(p.display_name) like ${add(`% ${literal(words)}%`)} then 1 else 2 end, `
        : ''
      const rows =
        offset < total
          ? await database.query<Row>(
              `select ${rowColumns} from people p ${where}
                order by ${rank}p.display_name collate "en-x-icu", p.id
                limit ${add(limit)} offset ${add(offset)}`,
              values,
            )
          : []
      return {
        people: rows.map(toRow),
        total,
        next: offset + rows.length < total ? offset + rows.length : null,
        readAt: new Date().toISOString(),
      }
    },

    async sheet(id) {
      const [person] = await database.query<Row & { createdAt: string }>(
        `select ${rowColumns}, ${iso('p.created_at')} as "createdAt" from people p where p.id = $1`,
        [id],
      )
      if (!person) return null
      const grants = await database.query<PersonGrant>(
        `select role::text, null as "areaId", ${iso('lower(valid_at)')} as since, granted_by::text as "grantedBy"
           from global_role_grants where person_id = $1 and valid_at @> now()
         union all
         select role::text, area_id, ${iso('lower(valid_at)')}, granted_by::text
           from area_assignments where person_id = $1 and valid_at @> now()
         order by 2 nulls first, 1`,
        [id],
      )
      // Row security shows the log to administrators and auditors only (0012); this is theirs.
      const history = await database.query<RoleChange>(
        `select a.seq::float8 as seq, ${iso('a.at')} as at, split_part(a.action, '.', 2) as change,
                -- The log is never rewritten: an entry from before 0086 names the owner steward.
                case a.details->>'role' when 'steward' then 'owner' else a.details->>'role' end as role,
                a.area_id as "areaId", a.actor_id::text as "actorId",
                x.display_name as "actorName", a.reason
           from audit_log a left join people x on x.id = a.actor_id
          where a.subject_type = 'person' and a.subject_id = $1
            and a.action in ('role.granted', 'role.revoked', 'assignment.granted', 'assignment.revoked')
          order by a.seq desc limit 200`,
        [id],
      )
      return {
        person: { ...toRow(person), createdAt: person.createdAt },
        grants,
        history,
        readAt: new Date().toISOString(),
      }
    },
  }
}

/** A person's sheet, or the service's NOT_FOUND. */
export async function personSheet(service: PeopleService, id: string): Promise<PersonSheet> {
  const sheet = await service.sheet(id)
  if (!sheet) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this person." })
  return sheet
}
