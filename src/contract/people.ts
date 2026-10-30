import * as z from 'zod/mini'
import { areaRoleSchema, globalRoleSchema } from './auth.ts'
import { peopleRoleFilterSchema, peopleSignInFilterSchema } from './people-filters.ts'

/** A person Heed knows: signed in at least once and still here, gone (deactivated), or erased. */
export const personStatusSchema = z.enum(['active', 'left', 'erased'])

export { peopleRoleFilterSchema, peopleSignInFilterSchema }

/** A role a person holds now; an area role names its area. */
export const heldRoleSchema = z.object({
  role: z.union([globalRoleSchema, areaRoleSchema]),
  areaId: z.nullable(z.string()),
})

export type PersonStatus = z.infer<typeof personStatusSchema>
export type PeopleRoleFilter = z.infer<typeof peopleRoleFilterSchema>
export type PeopleSignInFilter = z.infer<typeof peopleSignInFilterSchema>
export type HeldRole = z.infer<typeof heldRoleSchema>
