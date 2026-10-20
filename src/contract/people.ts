import * as z from 'zod/mini'
import { areaRoleSchema, globalRoleSchema } from './auth.ts'
import { peopleRoleFilterSchema, peopleSignInFilterSchema } from './people-filters.ts'

const int = (min: number, max: number) => z.number().check(z.int(), z.minimum(min), z.maximum(max))
const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))

/** A person Heed knows: signed in at least once and still here, gone (deactivated), or erased. */
export const personStatusSchema = z.enum(['active', 'left', 'erased'])

export { peopleRoleFilterSchema, peopleSignInFilterSchema }

/**
 * Finding people (the People page, and every picker that chooses a person). Words match the
 * start of the name, of a word in it or of the email first, then anywhere in them. Active people
 * only unless `status` says otherwise, so a picker never offers a leaver.
 */
export const peopleSearchSchema = z.strictObject({
  q: z.optional(z.string().check(z.maxLength(200))),
  /** A role the person holds now; with `areaId`, the role in that area. */
  role: z.optional(peopleRoleFilterSchema),
  /** Holds a role in this area (any, or `role`). */
  areaId: z.optional(areaId),
  /** `active` by default; `left` is everyone gone or erased; `all` is everyone. */
  status: z.optional(z.enum(['active', 'left', 'all'])),
  signedIn: z.optional(peopleSignInFilterSchema),
  /** Rows to skip: the `next` of the page before. */
  offset: z.optional(int(0, 1_000_000)),
  limit: z.optional(int(1, 100)),
})

/** A role a person holds now; an area role names its area. */
export const heldRoleSchema = z.object({
  role: z.union([globalRoleSchema, areaRoleSchema]),
  areaId: z.nullable(z.string()),
})

export const personRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  /** Null for an erased person: the address is gone with them. */
  email: z.nullable(z.string()),
  status: personStatusSchema,
  /** The last time they signed in to Heed; null if never (or not since this was recorded). */
  lastSignedInAt: z.nullable(z.string()),
  roles: z.array(heldRoleSchema),
})

export const peoplePageSchema = z.object({
  people: z.array(personRowSchema),
  /** Every person the filters match, across the pages. */
  total: z.number(),
  /** The offset of the next page; null on the last. */
  next: z.nullable(z.number()),
  /** When the page was read: "3 days ago" counts from it. */
  readAt: z.string(),
})

export const personIdSchema = z.object({ id: z.string().check(z.uuid()) })

/** One role a person holds, since when and from whom (null: given when Heed was set up). */
export const personGrantSchema = z.extend(heldRoleSchema, {
  since: z.string(),
  grantedBy: z.nullable(z.string()),
})

/** One change to a person's roles, from the history log. */
export const roleChangeSchema = z.object({
  seq: z.number(),
  at: z.string(),
  change: z.enum(['granted', 'revoked']),
  role: z.string(),
  areaId: z.nullable(z.string()),
  actorId: z.nullable(z.string()),
  actorName: z.nullable(z.string()),
  /** Why, as given for the step the change was part of; null when none was given. */
  reason: z.nullable(z.string()),
})

/** A person's sheet: who they are, every role they hold and every change to their roles. */
export const personSheetSchema = z.object({
  person: z.extend(personRowSchema, { createdAt: z.string() }),
  grants: z.array(personGrantSchema),
  /** Newest first, the most recent 200. */
  history: z.array(roleChangeSchema),
  /** When the sheet was read: "3 days ago" counts from it. */
  readAt: z.string(),
})

export type PersonStatus = z.infer<typeof personStatusSchema>
export type PeopleRoleFilter = z.infer<typeof peopleRoleFilterSchema>
export type PeopleSignInFilter = z.infer<typeof peopleSignInFilterSchema>
export type PeopleSearchInput = z.infer<typeof peopleSearchSchema>
export type HeldRole = z.infer<typeof heldRoleSchema>
export type PersonRow = z.infer<typeof personRowSchema>
export type PeoplePage = z.infer<typeof peoplePageSchema>
export type PersonGrant = z.infer<typeof personGrantSchema>
export type RoleChange = z.infer<typeof roleChangeSchema>
export type PersonSheet = z.infer<typeof personSheetSchema>
