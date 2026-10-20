/** Proposal states from requirements section 4.2. Kept apart from the schema so the web app can import them without zod schemas. */
export const proposalStates = [
  'draft',
  'submitted',
  'in_review',
  'changes_requested',
  'accepted',
  'rejected',
  'withdrawn',
] as const
export type ProposalState = (typeof proposalStates)[number]
