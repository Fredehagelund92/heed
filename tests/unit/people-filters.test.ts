import { describe, expect, it } from 'vitest'
import { areaRoleSchema, globalRoleSchema } from '../../src/contract/auth.ts'
import { peopleRoleFilterSchema } from '../../src/contract/people-filters.ts'

describe("the People page's role filter", () => {
  it('has every role and "none", in the order of the roles', () => {
    expect(peopleRoleFilterSchema.options).toEqual([
      ...globalRoleSchema.options,
      ...areaRoleSchema.options,
      'none',
    ])
  })
})
