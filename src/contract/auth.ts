import * as z from 'zod/mini'
import { areaSchema, personSchema } from '../domain/item.ts'

export const globalRoleSchema = z.enum(['administrator', 'auditor'])
export const areaRoleSchema = z.enum(['owner', 'approver'])
export const assignmentSchema = z.object({ areaId: z.string(), role: areaRoleSchema })
export const permissionsSchema = z.object({
  roles: z.array(globalRoleSchema),
  assignments: z.array(assignmentSchema),
})
export const meSchema = z.extend(personSchema, { permissions: permissionsSchema })
export const sessionSchema = z.object({ person: meSchema, csrfToken: z.string() })
/**
 * Someone the local sign-in offers (the dev identity connector), with the roles they hold now and
 * the domains those roles are in, so a person chooses whom to be by what they may do.
 */
export const signInPersonSchema = z.object({
  email: z.string(),
  name: z.string(),
  initials: z.string(),
  roles: z.array(globalRoleSchema),
  assignments: z.array(
    z.object({
      role: areaRoleSchema,
      area: z.pick(areaSchema, { id: true, name: true, label: true }),
    }),
  ),
})
export const roleInputSchema = z.object({ personId: z.uuid(), role: globalRoleSchema })
export const assignmentInputSchema = z.extend(roleInputSchema, {
  areaId: z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/)),
  role: areaRoleSchema,
})
/** One change of a batch: give or remove a role across Heed, or a role in one area. */
const op = z.enum(['grant', 'revoke'])
export const grantChangeSchema = z.union([
  z.strictObject({ op, personId: z.uuid(), role: globalRoleSchema }),
  z.strictObject({
    op,
    personId: z.uuid(),
    areaId: assignmentInputSchema.shape.areaId,
    role: areaRoleSchema,
  }),
])
/** The most changes one step may make; a whole domain's team, or a bulk change, fits well. */
export const GRANT_BATCH_MAX = 200

/**
 * Why a step that would leave a domain without an owner is refused, and what to do instead
 * (FR-804): a domain that has owners keeps at least one.
 */
export const lastOwnerMessage = (area: string) =>
  `${area} must keep at least one owner. Make someone else an owner first, or in the same step, then remove this one.`
/**
 * `grants.apply` (FR-804): many role changes in one step, all or none. Removals apply before
 * grants, so removing an area's owner and giving the seat to another replaces them at once.
 */
export const applyGrantsSchema = z.strictObject({
  changes: z.array(grantChangeSchema).check(z.minLength(1), z.maxLength(GRANT_BATCH_MAX)),
  /** Why, kept with every history entry of the step. */
  reason: z.optional(z.string().check(z.minLength(1), z.maxLength(500))),
})
export const grantsAppliedSchema = z.object({
  /** Shared by the history entries of this step. */
  batchId: z.string(),
  /** Each change as asked, in the same order, and whether it changed anything. */
  changes: z.array(
    z.union([
      z.object({
        op,
        personId: z.string(),
        role: globalRoleSchema,
        changed: z.boolean(),
      }),
      z.object({
        op,
        personId: z.string(),
        areaId: z.string(),
        role: areaRoleSchema,
        changed: z.boolean(),
      }),
    ]),
  ),
})
export const grantsSchema = z.object({
  roles: z.array(z.extend(roleInputSchema, { since: z.string() })),
  assignments: z.array(z.extend(assignmentInputSchema, { since: z.string() })),
})
export type Permissions = z.infer<typeof permissionsSchema>
export type Principal = z.infer<typeof meSchema>
export type SignInPerson = z.infer<typeof signInPersonSchema>
export type RoleInput = z.infer<typeof roleInputSchema>
export type AssignmentInput = z.infer<typeof assignmentInputSchema>
export type GrantChange = z.infer<typeof grantChangeSchema>
export type ApplyGrantsInput = z.infer<typeof applyGrantsSchema>
export type GrantsApplied = z.infer<typeof grantsAppliedSchema>
