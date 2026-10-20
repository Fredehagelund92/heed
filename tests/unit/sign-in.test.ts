import { afterEach, describe, expect, it } from 'vitest'
import type { SignInPerson } from '../../src/web/api/client.ts'
import {
  initialChoice,
  rememberChoice,
  signInDomains,
  signInGroups,
  signInOtherRoles,
  signInRoleDomains,
  signInRoles,
} from '../../src/web/lib/sign-in.ts'

const commercial = { id: 'area_commercial', name: 'Commercial', label: 'teal' } as const
const sandbox = { id: 'area_sandbox', name: 'Sandbox', label: 'stone' } as const
const person = (over: Partial<SignInPerson>): SignInPerson => ({
  email: 'per_maria@example.test',
  name: 'Maria Lindqvist',
  initials: 'ML',
  roles: [],
  assignments: [],
  ...over,
})

afterEach(() => window.localStorage.clear())

describe('the sign-in picker', () => {
  it('names the roles without their domains, Contributor when there are none', () => {
    expect(signInRoles(person({}))).toBe('Contributor')
    expect(
      signInRoles(
        person({
          roles: ['auditor', 'administrator'],
          assignments: [
            { role: 'approver', area: commercial },
            { role: 'owner', area: sandbox },
            { role: 'owner', area: commercial },
          ],
        }),
      ),
    ).toBe('Admin, Auditor, Owner, High-risk approver')
  })

  it('lists each domain once, by name', () => {
    const domains = signInDomains(
      person({
        assignments: [
          { role: 'owner', area: sandbox },
          { role: 'owner', area: commercial },
          { role: 'approver', area: commercial },
        ],
      }),
    )
    expect(domains.map((area) => area.name)).toEqual(['Commercial', 'Sandbox'])
  })

  it('starts from the person chosen last on this browser, while they are still offered', () => {
    const people = [person({}), person({ email: 'per_jon@example.test', name: 'Jon Abara' })]
    expect(initialChoice(people)).toBe('per_maria@example.test')
    rememberChoice('per_jon@example.test')
    expect(initialChoice(people)).toBe('per_jon@example.test')
    rememberChoice('gone@example.test')
    expect(initialChoice(people)).toBe('per_maria@example.test')
    expect(initialChoice([])).toBeNull()
  })

  it('groups the people by their first role, administrators first and contributors last', () => {
    const maria = person({})
    const jon = person({
      email: 'per_jon@example.test',
      assignments: [{ role: 'owner', area: commercial }],
    })
    const lars = person({
      email: 'per_lars@example.test',
      assignments: [{ role: 'approver', area: commercial }],
    })
    const ella = person({ email: 'per_ella@example.test', roles: ['auditor'] })
    const ravi = person({
      email: 'per_ravi@example.test',
      roles: ['administrator'],
      assignments: [{ role: 'owner', area: sandbox }],
    })
    const groups = signInGroups([maria, jon, lars, ella, ravi])
    expect(groups.map((group) => [group.title, group.people.map((p) => p.email)])).toEqual([
      ['Admins', ['per_ravi@example.test']],
      ['Owners', ['per_jon@example.test']],
      ['High-risk approvers', ['per_lars@example.test']],
      ['Auditors', ['per_ella@example.test']],
      ['Contributors', ['per_maria@example.test']],
    ])
  })

  it('shows beside a person the domains of the role they are listed under, and their other roles', () => {
    const tomas = person({
      assignments: [
        { role: 'owner', area: sandbox },
        { role: 'approver', area: commercial },
      ],
    })
    expect(signInRoleDomains(tomas, 'owner').map((area) => area.name)).toEqual(['Sandbox'])
    expect(signInOtherRoles(tomas, 'owner')).toBe('High-risk approver')
    expect(signInOtherRoles(person({}), 'contributor')).toBe('')
  })
})
