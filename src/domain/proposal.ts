import * as z from 'zod/mini'
import { creationChannels } from './item.ts'
import { proposalStates, type ProposalState } from './proposal-state.ts'

export const proposalActions = ['create', 'change', 'retire', 'recheck'] as const
/**
 * The capacities a recorded decision names. `deputy` is history only: the role went on
 * 16 October 2026, every deputy became an owner of the same domain, and a decision made as
 * deputy before keeps the word it was made with. No new decision is made as deputy.
 */
export const decisionCapacities = ['owner', 'deputy', 'approver', 'administrator'] as const
export type DecisionCapacity = (typeof decisionCapacities)[number]
const id = z.string().check(z.minLength(1))
export const proposalSchema = z
  .strictObject({
    id,
    number: z.number().check(z.int(), z.minimum(1)),
    subject: z.enum(['item', 'vocabulary']),
    action: z.enum(proposalActions),
    state: z.enum(proposalStates),
    areaId: id,
    itemId: z.nullable(id),
    itemVersionId: z.nullable(id),
    vocabularyVersionId: z.nullable(id),
    proposerId: id,
    createdVia: z.enum(creationChannels),
    revision: z.number().check(z.int(), z.minimum(1)),
    reason: z.nullable(z.string().check(z.maxLength(500))),
    closedAt: z.nullable(z.string().check(z.iso.datetime())),
  })
  .check(
    z.refine(
      (p) =>
        p.subject === 'item'
          ? p.vocabularyVersionId === null
          : p.itemId === null && p.itemVersionId === null,
      'Version must match the proposal subject',
    ),
    z.refine(
      (p) =>
        p.state === 'draft' ||
        p.itemVersionId !== null ||
        p.vocabularyVersionId !== null ||
        p.action === 'retire',
      'A submitted proposal needs a version',
    ),
    z.refine(
      (p) =>
        p.action !== 'retire' || (p.subject === 'item' && p.itemId !== null && !!p.reason?.trim()),
      'Retirement needs an item and a reason',
    ),
    z.refine(
      (p) => ['accepted', 'rejected', 'withdrawn'].includes(p.state) === (p.closedAt !== null),
      'Closed states need a closing time',
    ),
  )
export type Proposal = z.infer<typeof proposalSchema>

/** Proposal transitions from requirements section 4.2. */
const transitions: Record<ProposalState, readonly ProposalState[]> = {
  draft: ['submitted'],
  submitted: ['in_review', 'accepted', 'changes_requested', 'rejected', 'withdrawn'],
  in_review: ['accepted', 'changes_requested', 'rejected', 'withdrawn'],
  changes_requested: ['submitted', 'withdrawn'],
  accepted: [],
  rejected: [],
  withdrawn: [],
}
export function canTransitionProposal(from: ProposalState, to: ProposalState): boolean {
  return transitions[from].includes(to)
}
