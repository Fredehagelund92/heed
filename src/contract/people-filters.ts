import * as z from 'zod/mini'

/*
  The People page's filters, apart from the rest of the people contract: the address's search
  schema (web/lib/search-params.ts) reads them on the first load; the rest is only for the page,
  which loads later. The roles are auth.ts's, and tests/unit/people-filters.test.ts keeps them so.
*/

/** The role filter: any role across Heed or in an area, or none at all ("contributor only"). */
export const peopleRoleFilterSchema = z.enum([
  'administrator',
  'auditor',
  'owner',
  'approver',
  'none',
])

/** When a person last signed in: within a week, within 30 days, longer ago, or never. */
export const peopleSignInFilterSchema = z.enum(['week', 'month', 'older', 'never'])
