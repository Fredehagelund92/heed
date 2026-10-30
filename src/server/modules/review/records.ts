import { ORPCError } from '@orpc/client'
import type { ReviewProposal } from '../../../contract/review.ts'
import type { Draft, FormatFinding } from '../../../domain/draft.ts'
import type { Provenance } from '../../../domain/provenance.ts'
import type { Queryable } from '../../db/database.ts'

export type LoadedProposal = ReviewProposal & {
  draft: Draft
  findings: FormatFinding[]
  provenance: Provenance | null
}
export type Role = 'owner' | 'approver'

const fields = `p.id::text,p.number::float8 as number,p.subject::text as subject,p.action::text as action,
  p.state::text as state,p.area_id as "areaId",p.item_id as "itemId",p.item_version_id::text as "itemVersionId",
  p.vocab_version_id::text as "vocabularyVersionId",tv.term_key as "termKey",
  coalesce(v.title,tv.name,p.draft->>'title','Untitled proposal') as title,v.risk::text as "riskLevel",
  p.proposer_id::text as "proposerId",p.channel::text as channel,p.revision,p.reason,
  p.claimed_by::text as "claimedBy",p.due_at::text as "dueAt",p.submitted_at::text as "submittedAt",
  p.closed_at::text as "closedAt",p.created_at::text as "createdAt",
  coalesce(p.draft,'{}'::jsonb) as draft,p.draft_findings as findings,p.provenance`
const from = `from proposals p left join item_versions v on v.id=p.item_version_id
  left join vocab_term_versions tv on tv.id=p.vocab_version_id`

/** The public record: the draft stays with the proposal write API. */
export function publicRecord({
  draft: _d,
  findings: _f,
  provenance: _p,
  ...record
}: LoadedProposal): ReviewProposal {
  return record
}

export async function loadProposal(tx: Queryable, id: string, lock = false) {
  const [row] = await tx.query<LoadedProposal>(
    `select ${fields} ${from} where p.id=$1 and p.discarded_at is null${lock ? ' for update of p' : ''}`,
    [id],
  )
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

/** `loadProposal` for many proposals in one read, in the order of `ids`. */
export async function loadProposals(tx: Queryable, ids: readonly string[], lock = false) {
  const rows = await tx.query<LoadedProposal>(
    `select ${fields} ${from} where p.id=any($1::uuid[]) and p.discarded_at is null
      order by p.id${lock ? ' for update of p' : ''}`,
    [ids],
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.map((id) => {
    const row = byId.get(id)
    if (!row) throw new ORPCError('NOT_FOUND')
    return row
  })
}

/** The person's active roles in an area. Deactivated or erased people hold none. */
export async function rolesIn(tx: Queryable, area: string | null): Promise<Set<Role>> {
  if (!area) return new Set()
  return (await rolesInAreas(tx, [area])).get(area) ?? new Set()
}

/** `rolesIn` for many areas in one read, by area; an area where the person has none is left out. */
async function rolesInAreas(
  tx: Queryable,
  areas: readonly (string | null)[],
): Promise<Map<string, Set<Role>>> {
  const ids = [...new Set(areas.filter((area): area is string => area !== null))]
  const roles = new Map<string, Set<Role>>()
  if (!ids.length) return roles
  const rows = await tx.query<{ areaId: string; role: Role }>(
    `select a.area_id as "areaId",a.role::text as role from area_assignments a join people p on p.id=a.person_id
      where a.area_id=any($1::text[]) and a.person_id=cl_person() and a.valid_at @> now()
        and p.deactivated_at is null and p.erased_at is null`,
    [ids],
  )
  for (const { areaId, role } of rows) {
    const held = roles.get(areaId) ?? new Set<Role>()
    held.add(role)
    roles.set(areaId, held)
  }
  return roles
}

/**
 * Who decides in an area, in one read for a decision: the person, whether they administer, and
 * their active roles there. Deactivated or erased people hold no area role.
 */
export async function deciderIn(
  tx: Queryable,
  area: string,
): Promise<{ person: string; admin: boolean; roles: Set<Role> }> {
  const [row] = await tx.query<{ person: string; admin: boolean; roles: Role[] }>(
    `select cl_person()::text as person,cl_is_admin_now() as admin,
            array(select a.role::text from area_assignments a join people p on p.id=a.person_id
                   where a.area_id=$1 and a.person_id=cl_person() and a.valid_at @> now()
                     and p.deactivated_at is null and p.erased_at is null) as roles`,
    [area],
  )
  return { person: row!.person, admin: row!.admin, roles: new Set(row!.roles) }
}

export async function isAdmin(tx: Queryable): Promise<boolean> {
  const [row] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
  return row?.admin ?? false
}

export { proposalEvent, proposalEvents } from '../proposals/index.ts'

/** The version of an item in the live edition, if any. */
export async function liveVersionId(tx: Queryable, itemId: string): Promise<string | null> {
  const [row] = await tx.query<{ id: string }>(
    `select version_id::text as id from item_version_service
      where item_id=$1 and editions @> (select seq from live_edition)`,
    [itemId],
  )
  return row?.id ?? null
}

type NewDecision = {
  proposalId: string | null
  itemVersionId?: string | null
  vocabularyVersionId?: string | null
  areaId: string | null
  capacity: Role | 'administrator'
  outcome: 'accept' | 'request_changes' | 'reject' | 'retire'
  reason: string
}

/**
 * A decision's round: how many of the same person's same decisions on the version were undone
 * (FR-227). An undone decision leaves room for a new one; a repeated one finds the first.
 */
const undoneBefore = (version: string, outcome: string) =>
  `(select count(*) from decisions d join decision_undos u on u.decision_id=d.id
     where d.item_version_id=${version} and d.decided_by=cl_person() and d.outcome=${outcome})`

/** The database refuses a decision its row rules do not permit (42501). */
const forbiddenDecision = (error: unknown) =>
  (error as { code?: string }).code === '42501'
    ? new ORPCError('FORBIDDEN', {
        message: "You can't make this decision. Ask an owner of the domain or an admin.",
      })
    : error

export async function insertDecision(tx: Queryable, decision: NewDecision) {
  try {
    const rows = await tx.query<{ id: string }>(
      `insert into decisions(proposal_id,item_version_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason,round)
       values($1,$2,$3,$4,cl_person(),$5,$6,$7,${undoneBefore('$2::uuid', '$6::decision_outcome')})
       on conflict do nothing returning id::text`,
      [
        decision.proposalId,
        decision.itemVersionId ?? null,
        decision.vocabularyVersionId ?? null,
        decision.areaId,
        decision.capacity,
        decision.outcome,
        decision.reason,
      ],
    )
    return rows[0]?.id ?? null
  } catch (error) {
    throw forbiddenDecision(error)
  }
}
