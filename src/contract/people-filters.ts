import * as z from 'zod/mini'

/*
  The People filters, apart from the rest of the people contract, so a client that reads them on
  its first load carries nothing else. The roles are auth.ts's, and
  tests/server/people-filters.test.ts keeps them so.
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
