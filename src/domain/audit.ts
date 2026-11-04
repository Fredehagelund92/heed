/*
  The audit (FR-720): the one read an analysis of the context's own records is made from. A model
  may choose its facets from this closed list; code computes every line, and a template says it.
*/

/** What an analysis can look at, one read with a closed list, so a new facet needs no new plan. */
export const auditFacets = [
  'no_context',
  'no_words',
  'no_domain',
  'unlinked',
  'source_changed',
  'asked_nothing',
  'asked_most',
  'due',
  'conflicts',
  'duplicates',
  'overlaps',
  'review',
] as const
export type AuditFacet = (typeof auditFacets)[number]
