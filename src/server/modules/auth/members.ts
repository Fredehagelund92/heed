import { ORPCError } from '@orpc/client'
import type { GrantChange } from '../../../contract/auth.ts'
import {
  ACTIVITY_SHOWN,
  type Member,
  type MemberActivity,
  type MemberRemoved,
  type MemberRole,
} from '../../../contract/members.ts'
import type { Queryable } from '../../db/database.ts'
import { initialsOf } from './people.ts'
import { changeGrants, lockRoles } from './roles.ts'

/*
  The people of a workspace as Heed v1 has them (docs/product.md, section 11): Admin or Member,
  and the domains each owns. An administrator grant is Admin; everyone else is a Member. Making
  someone either ends an auditor grant they hold, as v1 has no auditor role; the approver role is
  a domain's and stays until risk levels go.
*/

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** Everyone active, by name: their role, the domains they own now, and their last sign-in. */
export async function listMembers(tx: Queryable): Promise<Member[]> {
  const rows = await tx.query<Omit<Member, 'initials'>>(
    `select p.id::text, p.display_name as name, p.email,
            case when exists (select 1 from global_role_grants g where g.person_id=p.id
                                and g.role='administrator' and g.valid_at @> now())
                 then 'admin' else 'member' end as role,
            coalesce((select array_agg(a.id order by a.name collate "en-x-icu", a.id)
                        from area_assignments x join areas a on a.id=x.area_id and a.archived_at is null
                       where x.person_id=p.id and x.role='owner' and x.valid_at @> now()), '{}') as owns,
            ${iso('p.last_signed_in_at')} as "lastSignedInAt"
       from people p where p.deactivated_at is null and p.erased_at is null
      order by p.display_name collate "en-x-icu", p.id`,
  )
  return rows.map((row) => ({ ...row, initials: initialsOf(row.name) }))
}

/**
 * What someone did lately, as People shows it: the context items whose current version they
 * checked last, newest first. A check is the last acceptance of the version, by the rule the
 * library's "checked by" reads (a re-check is one; an approver's accept is not). Only items the
 * reader may read are named, so it says no more than each item's page already does.
 */
export async function memberActivity(
  tx: Queryable,
  input: { personId: string; limit?: number | undefined },
): Promise<MemberActivity> {
  const personId = await activePerson(tx, input.personId.toLowerCase())
  const entries = await tx.query<MemberActivity['entries'][number]>(
    `with listed as materialized (
       select i.id, i.entry->>'title' as title, v.id as version_id
         from v_item_index i
         join item_versions v on v.item_id = i.id and v.version_no = (i.entry->>'version')::int
        where cl_audience_allows(i.audience_groups)),
     checked as (
       select distinct on (d.item_version_id) d.item_version_id as version_id, d.id, d.decided_at,
              d.decided_by
         from decisions d join listed on listed.version_id = d.item_version_id
        where d.outcome = 'accept' and d.capacity <> 'approver'
        order by d.item_version_id, d.decided_at desc, d.id desc)
     select 'checked' as what, l.id as "itemId", l.title,
            to_char((c.decided_at at time zone 'UTC')::date, 'YYYY-MM-DD') as on
       from listed l join checked c on c.version_id = l.version_id
      where c.decided_by = $1::uuid
      order by c.decided_at desc, c.id desc
      limit $2`,
    [personId, input.limit ?? ACTIVITY_SHOWN],
  )
  return { entries }
}

async function actorOf(tx: Queryable) {
  const [actor] = await tx.query<{ admin: boolean; id: string | null }>(
    'select cl_is_admin_now() as admin, cl_person()::text as id',
  )
  if (!actor?.admin || !actor.id) throw new ORPCError('FORBIDDEN')
  return actor.id
}

async function activePerson(tx: Queryable, personId: string) {
  const [person] = await tx.query<{ id: string }>(
    'select id::text from people where id=$1 and deactivated_at is null and erased_at is null',
    [personId],
  )
  if (!person)
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this person, or they're no longer active.",
    })
  return person.id
}

/** Makes someone an Admin or a Member (FR-804). Not one's own role; an active admin always stays. */
export async function setMemberRole(
  tx: Queryable,
  input: { personId: string; role: MemberRole },
): Promise<{ changed: boolean }> {
  const personId = input.personId.toLowerCase()
  const actor = await actorOf(tx)
  if (personId === actor)
    throw new ORPCError('CONFLICT', {
      message: "You can't change your own role. Ask another admin.",
    })
  await activePerson(tx, personId)
  const changes: GrantChange[] = [
    { op: input.role === 'admin' ? 'grant' : 'revoke', personId, role: 'administrator' },
    { op: 'revoke', personId, role: 'auditor' },
  ]
  const result = await changeGrants(tx, changes, { batch: false })
  return { changed: result.changes.some((change) => change.changed) }
}

/**
 * The domains whose only owner is this person, by name: removing them waits until each has
 * another owner.
 */
export async function soleOwnerOf(tx: Queryable, personId: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `select a.id from areas a
      where a.archived_at is null
        and exists (select 1 from area_assignments x where x.area_id=a.id and x.person_id=$1
                      and x.role='owner' and x.valid_at @> now())
        and not exists (select 1 from area_assignments x where x.area_id=a.id and x.person_id<>$1
                          and x.role='owner' and x.valid_at @> now())
      order by a.name collate "en-x-icu", a.id`,
    [personId],
  )
  return rows.map((row) => row.id)
}

/**
 * Removes someone from the workspace: every role they hold ends, in one batch, and they can no
 * longer sign in. Their browser sessions end here; the caller ends their agents' connections in
 * the same transaction. Refused for oneself, and while a domain has them as its only owner. What
 * they wrote and decided stays, with their name.
 */
export async function removeMember(
  tx: Queryable,
  input: { personId: string },
): Promise<MemberRemoved> {
  const personId = input.personId.toLowerCase()
  const actor = await actorOf(tx)
  if (personId === actor)
    throw new ORPCError('CONFLICT', { message: "You can't remove yourself. Ask another admin." })
  await lockRoles(tx)
  await activePerson(tx, personId)
  const alone = await soleOwnerOf(tx, personId)
  if (alone.length)
    throw new ORPCError('CONFLICT', {
      message: 'Hand over first: they are the only owner of a domain.',
      data: { areas: alone },
    })
  const roles = await tx.query<{ role: 'administrator' | 'auditor' }>(
    `select role from global_role_grants where person_id=$1 and valid_at @> now() order by role`,
    [personId],
  )
  const assignments = await tx.query<{ areaId: string; role: 'owner' | 'approver' }>(
    `select area_id as "areaId", role from area_assignments
      where person_id=$1 and valid_at @> now() order by area_id, role`,
    [personId],
  )
  const changes: GrantChange[] = [
    ...roles.map(({ role }) => ({ op: 'revoke' as const, personId, role })),
    ...assignments.map(({ areaId, role }) => ({ op: 'revoke' as const, personId, areaId, role })),
  ]
  const { batchId } = await changeGrants(tx, changes, { batch: true })
  await tx.query('update people set deactivated_at=now() where id=$1', [personId])
  await tx.query('delete from auth.sessions where person_id=$1', [personId])
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,subject_type,subject_id,batch_id,source)
     values(cl_person(),'person','person.removed','person',$1,$2,'named')`,
    [personId, batchId],
  )
  return { removed: true, batchId: batchId! }
}

/**
 * Undoes a removal: the person is active again, with the roles their last removal ended, those
 * of a domain that still exists. Their sessions and agents stay ended: they sign in again.
 */
export async function restoreMember(
  tx: Queryable,
  input: { personId: string },
): Promise<{ changed: boolean }> {
  const personId = input.personId.toLowerCase()
  await actorOf(tx)
  await lockRoles(tx)
  const [person] = await tx.query<{ left: boolean }>(
    'select deactivated_at is not null as left from people where id=$1 and erased_at is null',
    [personId],
  )
  if (!person) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this person." })
  if (!person.left) return { changed: false }
  const [removal] = await tx.query<{ batchId: string }>(
    `select batch_id::text as "batchId" from audit_log
      where action='person.removed' and subject_type='person' and subject_id=$1
      order by seq desc limit 1`,
    [personId],
  )
  await tx.query('update people set deactivated_at=null where id=$1', [personId])
  const ended = removal
    ? await tx.query<{ role: string; areaId: string | null }>(
        `select l.details->>'role' as role, l.area_id as "areaId" from audit_log l
          where l.batch_id=$1 and l.subject_id=$2 and l.action in ('role.revoked','assignment.revoked')
            and (l.area_id is null or exists (select 1 from areas a where a.id=l.area_id and a.archived_at is null))
          order by l.seq`,
        [removal.batchId, personId],
      )
    : []
  const changes = ended.map(({ role, areaId }) =>
    areaId
      ? ({ op: 'grant', personId, areaId, role } as GrantChange)
      : ({ op: 'grant', personId, role } as GrantChange),
  )
  const { batchId } = await changeGrants(tx, changes, { batch: true })
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,subject_type,subject_id,batch_id,source)
     values(cl_person(),'person','person.restored','person',$1,$2,'named')`,
    [personId, batchId],
  )
  return { changed: true }
}
