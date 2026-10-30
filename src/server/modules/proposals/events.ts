import type { ReviewProposal } from '../../../contract/review.ts'
import type { Queryable } from '../../db/database.ts'

/** One change of one proposal: its timeline kind, what to record with it and its history action. */
export type ProposalChange = {
  p: Pick<ReviewProposal, 'id' | 'areaId' | 'state' | 'revision'>
  kind: string
  data?: Record<string, unknown>
  audit?: string
}

/** One timeline row, one outbox event (ids and states only) and one history entry per change. */
export async function proposalEvent(
  tx: Queryable,
  p: Pick<ReviewProposal, 'id' | 'areaId' | 'state' | 'revision'>,
  kind: string,
  data: Record<string, unknown> = {},
  audit: string = `proposal.${kind}`,
) {
  await proposalEvents(tx, [{ p, kind, data, audit }])
}

/**
 * The rows of `proposalEvent` for many changes at once, in their order: three statements, however
 * many proposals one step changes (a batch of terms is hundreds), so the step costs a few round
 * trips to the database rather than three per proposal.
 */
export async function proposalEvents(tx: Queryable, changes: readonly ProposalChange[]) {
  if (!changes.length) return
  const rows = JSON.stringify(
    changes.map(({ p, kind, data = {}, audit = `proposal.${kind}` }) => ({
      id: p.id,
      areaId: p.areaId,
      kind,
      data,
      topic: `proposal.${kind}`,
      payload: { id: p.id, state: p.state, revision: p.revision },
      audit,
      details: { revision: p.revision, ...data },
    })),
  )
  const each = `from jsonb_array_elements($1::jsonb) with ordinality as e(row, n)`
  await tx.query(
    `insert into proposal_events(proposal_id,actor_id,kind,data)
     select (row->>'id')::uuid,cl_person(),row->>'kind',row->'data' ${each} order by n`,
    [rows],
  )
  await tx.query(
    `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
     select row->>'topic',row->>'areaId','proposal',row->>'id',row->'payload' ${each} order by n`,
    [rows],
  )
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
     select cl_person(),'person',row->>'audit',row->>'areaId','proposal',row->>'id',row->'details'
     ${each} order by n`,
    [rows],
  )
}
