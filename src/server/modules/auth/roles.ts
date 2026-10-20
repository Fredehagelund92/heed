import { ORPCError } from '@orpc/client'
import {
  lastOwnerMessage,
  type AssignmentInput,
  type GrantChange,
  type GrantsApplied,
  type RoleInput,
} from '../../../contract/auth.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason } from '../admin/index.ts'

export async function listGrants(tx: Queryable) {
  const roles = await tx.query<RoleInput & { since: string }>(
    `select person_id::text as "personId", role, lower(valid_at)::text as since from global_role_grants where valid_at @> now() order by person_id,role`,
  )
  const assignments = await tx.query<AssignmentInput & { since: string }>(
    `select person_id::text as "personId", area_id as "areaId", role, lower(valid_at)::text as since from area_assignments where valid_at @> now() order by area_id,person_id,role`,
  )
  return { roles, assignments }
}

/** One grant, whichever table holds it: a person, a role and, for an area role, the area. */
const grantKey = (change: RoleInput | AssignmentInput) =>
  `${change.personId}|${change.role}|${'areaId' in change ? change.areaId : ''}`

type Entry = { action: string; areaId: string | null; personId: string; role: string }
type Global = Extract<GrantChange, { role: RoleInput['role'] }>
type InArea = Extract<GrantChange, { areaId: string }>
const inArea = (change: GrantChange): change is InArea => 'areaId' in change

/*
  A batch is written a table at a time, whatever its size: one statement closes the held grants
  it removes and one opens those it gives, each returning what it changed. The person, role and
  area of each change travel as parallel arrays (`unnest`), and row security checks every row.
*/

/** Closes the held grants among `changes`; returns the keys of those it closed. */
async function closeGrants(tx: Queryable, changes: readonly GrantChange[]) {
  const closed = new Set<string>()
  const roles = changes.filter((change): change is Global => !inArea(change))
  if (roles.length) {
    const rows = await tx.query<{ person: string; role: string }>(
      `update global_role_grants g set valid_at=tstzrange(lower(g.valid_at),now(),'[)')
         from unnest($1::uuid[],$2::global_role[]) as c(person_id,role)
        where g.person_id=c.person_id and g.role=c.role and g.valid_at @> now()
        returning g.person_id::text as person, g.role::text as role`,
      [roles.map((change) => change.personId), roles.map((change) => change.role)],
    )
    for (const row of rows) closed.add(`${row.person}|${row.role}|`)
  }
  const assignments = changes.filter(inArea)
  if (assignments.length) {
    const rows = await tx.query<{ person: string; role: string; area: string }>(
      `update area_assignments a set valid_at=tstzrange(lower(a.valid_at),now(),'[)')
         from unnest($1::uuid[],$2::area_role[],$3::text[]) as c(person_id,role,area_id)
        where a.person_id=c.person_id and a.role=c.role and a.area_id=c.area_id
          and a.valid_at @> now()
        returning a.person_id::text as person, a.role::text as role, a.area_id as area`,
      [
        assignments.map((change) => change.personId),
        assignments.map((change) => change.role),
        assignments.map((change) => change.areaId),
      ],
    )
    for (const row of rows) closed.add(`${row.person}|${row.role}|${row.area}`)
  }
  return closed
}

/**
 * Opens the grants among `changes` that are not held; returns the keys of those it opened. A
 * grant the person holds already changes nothing. An area may have several owners and several
 * approvers, so giving one never needs another removed first.
 */
async function openGrants(tx: Queryable, changes: readonly GrantChange[]) {
  const opened = new Set<string>()
  const roles = changes.filter((change): change is Global => !inArea(change))
  if (roles.length) {
    const rows = await tx.query<{ person: string; role: string }>(
      `insert into global_role_grants(person_id,role,granted_by)
       select c.person_id,c.role,cl_person() from unnest($1::uuid[],$2::global_role[]) as c(person_id,role)
        where not exists (select 1 from global_role_grants g
                           where g.person_id=c.person_id and g.role=c.role and g.valid_at @> now())
       returning person_id::text as person, role::text as role`,
      [roles.map((change) => change.personId), roles.map((change) => change.role)],
    )
    for (const row of rows) opened.add(`${row.person}|${row.role}|`)
  }
  const assignments = changes.filter(inArea)
  if (assignments.length) {
    const rows = await tx.query<{ person: string; role: string; area: string }>(
      `insert into area_assignments(person_id,role,area_id,granted_by)
       select c.person_id,c.role,c.area_id,cl_person()
         from unnest($1::uuid[],$2::area_role[],$3::text[]) as c(person_id,role,area_id)
        where not exists (select 1 from area_assignments a
                           where a.area_id=c.area_id and a.role=c.role and a.valid_at @> now()
                             and a.person_id=c.person_id)
       returning person_id::text as person, role::text as role, area_id as area`,
      [
        assignments.map((change) => change.personId),
        assignments.map((change) => change.role),
        assignments.map((change) => change.areaId),
      ],
    )
    for (const row of rows) opened.add(`${row.person}|${row.role}|${row.area}`)
  }
  return opened
}

/** Every person and area a batch names exists, and is active where a role is given. */
async function checkNamed(tx: Queryable, changes: readonly GrantChange[]) {
  const personIds = [...new Set(changes.map((change) => change.personId))]
  const people = await tx.query<{ id: string; active: boolean }>(
    `select id::text, (deactivated_at is null and erased_at is null) as active
       from people where id = any($1::uuid[])`,
    [personIds],
  )
  const activePerson = new Map(people.map((row) => [row.id, row.active]))
  const areaIds = [
    ...new Set(changes.flatMap((change) => ('areaId' in change ? [change.areaId] : []))),
  ]
  const areas = areaIds.length
    ? await tx.query<{ id: string; active: boolean }>(
        'select id, archived_at is null as active from areas where id = any($1::text[])',
        [areaIds],
      )
    : []
  const activeArea = new Map(areas.map((row) => [row.id, row.active]))
  for (const change of changes) {
    const grant = change.op === 'grant'
    const person = activePerson.get(change.personId)
    if (person === undefined || (grant && !person))
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find this person, or they're no longer active.",
      })
    if ('areaId' in change) {
      const area = activeArea.get(change.areaId)
      if (area === undefined || (grant && !area))
        throw new ORPCError('NOT_FOUND', {
          message: "We couldn't find this domain, or it was deleted.",
        })
    }
  }
}

/** The history entries of a batch, in the order the changes were made, in one statement. */
async function recordChanges(
  tx: Queryable,
  entries: readonly Entry[],
  step: { batchId: string | null; reason: string | null },
) {
  if (!entries.length) return
  const values: unknown[] = [step.batchId, step.reason]
  const rows = entries.map((entry) => {
    values.push(entry.action, entry.areaId, entry.personId, JSON.stringify({ role: entry.role }))
    const n = values.length
    return `(cl_person(),'person',$${n - 3},$${n - 2},'person',$${n - 1},$${n}::jsonb,$1::uuid,$2,'named')`
  })
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details,batch_id,reason,source)
     values ${rows.join(',')}`,
    values,
  )
}

/**
 * One role change at a time. A transaction that also writes the history log takes this lock
 * before its first entry: the log's own lock comes after it, and two transactions taking the two
 * in opposite orders would deadlock. Where the areas lock is also taken, it comes first.
 */
export async function lockRoles(tx: Queryable) {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.roles',0))")
}

/**
 * Gives and removes roles in one transaction (FR-804): all of them, or none. Role changes are
 * serialized under one lock, the actor's authority is checked again, and each change writes its
 * own history entry in the same transaction, in a handful of statements whatever the batch's
 * size. Removals come first, so a batch that removes an
 * area's owner and gives the role to someone else replaces them at the same instant, with no
 * moment the area has none. An administrator removing their own administrator role comes last:
 * row security refuses every later change once they no longer hold it. Heed keeps an active
 * administrator after the whole batch, so a batch may hand the role from one person to another.
 *
 * `batchId` is null for a single change through `roles.*` and `assignments.*`; `grants.apply`
 * gives the entries of one step a shared id, with the reason given for it.
 */
export async function changeGrants(
  tx: Queryable,
  asked: readonly GrantChange[],
  options: {
    batch: boolean
    reason?: string | null
    /** False only where the area itself goes (archiving), which ends its whole team. */
    keepOwners?: boolean
  },
): Promise<{ batchId: string | null; changes: GrantsApplied['changes'] }> {
  // A person's id as PostgreSQL writes it, so the same person is the same key however it is sent.
  const changes = asked.map((change) => ({ ...change, personId: change.personId.toLowerCase() }))
  const reason = options.reason ?? null
  if (reason !== null) plainReason(reason)
  const seen = new Set<string>()
  for (const change of changes) {
    const key = grantKey(change)
    if (seen.has(key))
      throw new ORPCError('BAD_REQUEST', {
        message: 'The same role is in this change twice. Remove one, then try again.',
      })
    seen.add(key)
  }
  await lockRoles(tx)
  const [actor] = await tx.query<{ allowed: boolean; id: string }>(
    'select cl_is_admin_now() as allowed, cl_person()::text as id',
  )
  if (!actor?.allowed)
    throw new ORPCError('FORBIDDEN', { message: 'Only an admin can give or remove roles.' })
  let batchId: string | null = null
  if (options.batch) {
    const [row] = await tx.query<{ id: string }>('select uuidv7()::text as id')
    batchId = row!.id
  }
  await checkNamed(tx, changes)
  const ownAdministrator = (change: GrantChange) =>
    change.op === 'revoke' &&
    !inArea(change) &&
    change.role === 'administrator' &&
    change.personId === actor.id
  const removals = changes.filter((change) => change.op === 'revoke' && !ownAdministrator(change))
  const grants = changes.filter((change) => change.op === 'grant')
  const last = changes.filter(ownAdministrator)
  const changed = new Set([
    ...(await closeGrants(tx, removals)),
    ...(await openGrants(tx, grants)),
    ...(await closeGrants(tx, last)),
  ])
  const entries: Entry[] = [...removals, ...grants, ...last]
    .filter((change) => changed.has(grantKey(change)))
    .map((change) => ({
      action: `${inArea(change) ? 'assignment' : 'role'}.${change.op === 'grant' ? 'granted' : 'revoked'}`,
      areaId: inArea(change) ? change.areaId : null,
      personId: change.personId,
      role: change.role,
    }))
  await recordChanges(tx, entries, { batchId, reason })
  // An area that had an owner keeps one: removing the last is refused, whatever else the step
  // does, so its proposals never wait for nobody.
  const leftBy = [
    ...new Set(
      removals
        .filter(
          (change): change is InArea =>
            inArea(change) && change.role === 'owner' && changed.has(grantKey(change)),
        )
        .map((change) => change.areaId),
    ),
  ]
  if (leftBy.length && options.keepOwners !== false) {
    const [unstaffed] = await tx.query<{ name: string }>(
      `select a.name from areas a
        where a.id = any($1::text[]) and a.archived_at is null
          and not exists (select 1 from area_assignments x
                           where x.area_id=a.id and x.role='owner' and x.valid_at @> now())
        order by a.name limit 1`,
      [leftBy],
    )
    if (unstaffed) throw new ORPCError('CONFLICT', { message: lastOwnerMessage(unstaffed.name) })
  }
  const removesAdministrator = changes.some(
    (change) => change.op === 'revoke' && !inArea(change) && change.role === 'administrator',
  )
  if (removesAdministrator) {
    const [left] = await tx.query(
      `select 1 from global_role_grants g join people p on p.id=g.person_id
        where g.role='administrator' and g.valid_at @> now()
          and p.deactivated_at is null and p.erased_at is null limit 1`,
    )
    if (!left)
      throw new ORPCError('CONFLICT', {
        message: 'This would leave no active admin. Make someone else an admin first.',
      })
  }
  return {
    batchId,
    changes: changes.map((change) => ({ ...change, changed: changed.has(grantKey(change)) })),
  }
}

/** One role change through `roles.*` or `assignments.*`: a batch of one, without a batch id. */
export async function changeGrant(
  tx: Queryable,
  input: RoleInput | AssignmentInput,
  grant: boolean,
) {
  const op = grant ? 'grant' : 'revoke'
  const { changes } = await changeGrants(tx, [{ ...input, op }], { batch: false })
  return { changed: changes[0]!.changed }
}

/** `grants.apply`: many changes in one step, sharing a batch id and an optional reason. */
export async function applyGrants(
  tx: Queryable,
  input: { changes: readonly GrantChange[]; reason?: string | null },
): Promise<GrantsApplied> {
  const result = await changeGrants(tx, input.changes, { batch: true, reason: input.reason })
  return { batchId: result.batchId!, changes: result.changes }
}
