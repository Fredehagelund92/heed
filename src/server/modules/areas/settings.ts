import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type {
  AreaDetail,
  createAreaSchema,
  describeAreaSchema,
  updateAreaSchema,
} from '../../../contract/areas.ts'
import type { GrantChange } from '../../../contract/auth.ts'
import { textFindings } from '../../../domain/draft.ts'
import { domainHues, type DomainHue } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from '../admin/index.ts'
import { changeGrants, lockRoles } from '../auth/index.ts'

/**
 * Creating and editing an area from settings (FR-801), for administrators. The id never changes,
 * and who looks after the area moves with the role changes of auth/roles.ts, which creating an
 * area may make in the same step. Its summary and description its owners write too
 * (FR-813). Deleting one, and restoring it, is in deletion.ts (FR-814).
 */

const detail = `select a.id, a.name, a.label, a.review_days as "reviewDays", a.chat_channel as "chatChannel",
    a.owner_team as "ownerTeam", a.is_demo as demo, a.summary, a.description,
    array(select x.person_id::text from area_assignments x
      where x.area_id = a.id and x.role = 'owner' and x.valid_at @> now()
      order by lower(x.valid_at), x.person_id) as "ownerIds",
    array(select x.person_id::text from area_assignments x
      where x.area_id = a.id and x.role = 'approver' and x.valid_at @> now()
      order by x.person_id) as "approverIds",
    to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", a.revision
  from areas a
  where a.id = $1 and a.archived_at is null`

type Fields = Pick<
  AreaDetail,
  'name' | 'label' | 'reviewDays' | 'chatChannel' | 'ownerTeam' | 'summary' | 'description'
>
const fieldsOf = ({
  name,
  label,
  reviewDays,
  chatChannel,
  ownerTeam,
  summary,
  description,
}: Fields): Fields => ({
  name,
  label,
  reviewDays,
  chatChannel,
  ownerTeam,
  summary,
  description,
})
type Described = Pick<Fields, 'summary' | 'description'>

/**
 * Everyone, the assistant and agents read what a domain is, so it holds no email address, phone
 * number or secret (the checks of FR-117): it describes the domain, never a person.
 */
function plainAbout({ summary, description }: Described) {
  const findings = textFindings({ summary, description })
  if (findings.length)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message:
        'Remove the email address, phone number or secret from the summary or the description.',
      data: { findings },
    })
}

async function adminOnly(tx: Queryable) {
  const [actor] = await tx.query<{ allowed: boolean }>('select cl_is_admin_now() as allowed')
  if (!actor?.allowed) throw new ORPCError('FORBIDDEN', { message: 'Only an admin can do this.' })
}

/** A new domain's review time when nobody names one: working days an owner has to decide. */
const DEFAULT_REVIEW_DAYS = 2

/** The hue the fewest domains in use have, the first on the ring among equals. */
async function quietestHue(tx: Queryable): Promise<DomainHue> {
  const rows = await tx.query<{ label: string; n: number }>(
    'select label, count(*)::int as n from areas where archived_at is null group by label',
  )
  const used = new Map(rows.map((r) => [r.label, r.n]))
  return [...domainHues].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]!
}

/** Another area holds the name: names are unique, archived areas included. */
async function nameTaken(tx: Queryable, name: string, id: string) {
  const rows = await tx.query('select 1 from areas where lower(name) = lower($1) and id <> $2', [
    name,
    id,
  ])
  return rows.length > 0
}

export async function getArea(tx: Queryable, id: string): Promise<AreaDetail> {
  const [area] = await tx.query<AreaDetail>(detail, [id])
  if (!area)
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this domain. Someone may have deleted it.",
    })
  return area
}

/**
 * A new area is served from the start: its items reach agents as soon as they are accepted. The
 * history log records it. Its team, when named, is given in the same transaction as one batch with
 * the area's reason, so the area exists with its owners and approvers, or not at all.
 */
export async function createArea(
  tx: Queryable,
  input: z.infer<typeof createAreaSchema>,
): Promise<AreaDetail> {
  await adminOnly(tx)
  if (input.reason !== undefined) plainReason(input.reason)
  plainAbout(input)
  // One creation at a time, so two at once cannot both find the id or the name free.
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.areas',0))")
  // Before the first history entry, as a role change takes it: areas, then roles, then the log.
  await lockRoles(tx)
  // A deleted domain that history keeps holds its id and name (FR-814).
  const [archived] = await tx.query(
    'select 1 from areas where archived_at is not null and (id = $1 or lower(name) = lower($2))',
    [input.id, input.name],
  )
  if (archived)
    throw new ORPCError('CONFLICT', {
      message:
        'A deleted domain has this id or name. Restore it from Deleted domains, or choose another.',
    })
  const [existing] = await tx.query('select 1 from areas where id = $1', [input.id])
  if (existing)
    throw new ORPCError('CONFLICT', {
      message: 'Another domain already has this id. Choose another.',
    })
  if (await nameTaken(tx, input.name, input.id))
    throw new ORPCError('CONFLICT', {
      message: 'Another domain already has this name. Choose another.',
    })
  const fields = fieldsOf({
    ...input,
    label: input.label ?? (await quietestHue(tx)),
    reviewDays: input.reviewDays ?? DEFAULT_REVIEW_DAYS,
  })
  await tx.query(
    `insert into areas (id, name, label, review_days, chat_channel, owner_team, summary, description)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      fields.name,
      fields.label,
      fields.reviewDays,
      fields.chatChannel,
      fields.ownerTeam,
      fields.summary,
      fields.description,
    ],
  )
  await recordAudit(tx, {
    action: 'area.created',
    areaId: input.id,
    subjectType: 'area',
    subjectId: input.id,
    details: { ...fields, ...(input.reason === undefined ? {} : { reason: input.reason }) },
  })
  const { ownerIds = [], approverIds = [] } = input.team ?? {}
  const team: GrantChange[] = [
    ...ownerIds.map((personId) => ({
      op: 'grant' as const,
      personId,
      role: 'owner' as const,
    })),
    ...approverIds.map((personId) => ({
      op: 'grant' as const,
      personId,
      role: 'approver' as const,
    })),
  ].map((change) => ({ ...change, areaId: input.id }))
  if (team.length) await changeGrants(tx, team, { batch: true, reason: input.reason ?? null })
  return getArea(tx, input.id)
}

/** An edit names the revision it read; a newer one is a conflict, so no edit is lost unseen. */
export async function updateArea(
  tx: Queryable,
  input: z.infer<typeof updateAreaSchema>,
): Promise<AreaDetail> {
  await adminOnly(tx)
  plainReason(input.reason)
  plainAbout(input)
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.areas',0))")
  const before = await current(tx, input.id, input.revision)
  if (await nameTaken(tx, input.name, input.id))
    throw new ORPCError('CONFLICT', {
      message: 'Another domain already has this name. Choose another.',
    })
  return change(tx, input.id, before, fieldsOf(input), input.reason)
}

/**
 * What a domain is and what kind of data it holds (FR-813), written by one of its owners or an
 * administrator. It changes the domain's page, the assistant's list of domains and what AI
 * clients read about the domain, never what is served, so it is no edition.
 */
export async function describeArea(
  tx: Queryable,
  input: z.infer<typeof describeAreaSchema>,
): Promise<AreaDetail> {
  const [actor] = await tx.query<{ allowed: boolean }>(
    'select cl_is_admin_now() or cl_is_owner_now($1) as allowed',
    [input.id],
  )
  if (!actor?.allowed)
    throw new ORPCError('FORBIDDEN', {
      message: "Only the domain's owners and admins can describe it.",
    })
  plainAbout(input)
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.areas',0))")
  const before = await current(tx, input.id, input.revision)
  // Its owners rename it from its page too (FR-815), under the same rule as an admin's rename.
  if (input.name !== undefined && (await nameTaken(tx, input.name, input.id)))
    throw new ORPCError('CONFLICT', {
      message: 'Another domain already has this name. Choose another.',
    })
  const described: Described = { summary: input.summary, description: input.description }
  return change(
    tx,
    input.id,
    before,
    { ...before, ...described, name: input.name ?? before.name },
    null,
  )
}

/** The area's editable fields as stored, refused when it is gone or changed since it was read. */
async function current(tx: Queryable, id: string, revision: number): Promise<Fields> {
  const [row] = await tx.query<Fields & { revision: number }>(
    `select name, label, review_days as "reviewDays", chat_channel as "chatChannel",
       owner_team as "ownerTeam", summary, description, revision
     from areas where id = $1 and archived_at is null for update`,
    [id],
  )
  if (!row)
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this domain. Someone may have deleted it.",
    })
  if (row.revision !== revision)
    throw new ORPCError('CONFLICT', {
      message:
        'Someone changed this domain after you opened it. Look at the latest version, then try again.',
    })
  return fieldsOf(row)
}

/** Stores what differs as one more revision, and records the change with its reason, if any. */
async function change(
  tx: Queryable,
  id: string,
  before: Fields,
  after: Fields,
  reason: string | null,
): Promise<AreaDetail> {
  const changed = (Object.keys(after) as (keyof Fields)[]).filter(
    (key) => after[key] !== before[key],
  )
  if (!changed.length) return getArea(tx, id)
  await tx.query(
    `update areas set name = $2, label = $3, review_days = $4, chat_channel = $5, owner_team = $6,
       summary = $7, description = $8, revision = revision + 1
     where id = $1`,
    [
      id,
      after.name,
      after.label,
      after.reviewDays,
      after.chatChannel,
      after.ownerTeam,
      after.summary,
      after.description,
    ],
  )
  await recordAudit(tx, {
    action: 'area.changed',
    areaId: id,
    subjectType: 'area',
    subjectId: id,
    details: {
      from: Object.fromEntries(changed.map((key) => [key, before[key]])),
      to: Object.fromEntries(changed.map((key) => [key, after[key]])),
      ...(reason === null ? {} : { reason }),
    },
  })
  return getArea(tx, id)
}
