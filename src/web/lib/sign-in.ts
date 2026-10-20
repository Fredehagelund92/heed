import type { SignInPerson } from '@/api'
import { roleTitles } from './permissions'

/**
 * The local sign-in's picker (the dev identity connector): what it says about each person, and
 * the person this browser chose last, so switching between the demo people starts from them.
 */

export type SignInArea = SignInPerson['assignments'][number]['area']

/** "Owner, High-risk approver": the person's roles, without their domains. */
export function signInRoles(person: SignInPerson): string {
  return titles(person).join(', ')
}

const titles = (person: SignInPerson) =>
  roleTitles({
    roles: person.roles,
    assignments: person.assignments.map(({ role, area }) => ({ role, areaId: area.id })),
  })

/** The domains the person holds a role in, each once, by name. */
export function signInDomains(person: SignInPerson): SignInArea[] {
  const byId = new Map(person.assignments.map(({ area }) => [area.id, area]))
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/** The role a person is listed under in the picker: the first of these they hold. */
export type SignInRole =
  'administrator' | 'owner' | 'deputy' | 'approver' | 'auditor' | 'contributor'

const roleOrder: readonly SignInRole[] = [
  'administrator',
  'owner',
  'deputy',
  'approver',
  'auditor',
  'contributor',
]

const roleTitle: Record<SignInRole, { one: string; many: string }> = {
  administrator: { one: 'Admin', many: 'Admins' },
  owner: { one: 'Owner', many: 'Owners' },
  // The deputy role went (migration 0073); a deputy is an owner now.
  deputy: { one: 'Owner', many: 'Owners' },
  approver: { one: 'High-risk approver', many: 'High-risk approvers' },
  auditor: { one: 'Auditor', many: 'Auditors' },
  contributor: { one: 'Contributor', many: 'Contributors' },
}

const holds = (person: SignInPerson, role: SignInRole) =>
  role === 'administrator' || role === 'auditor'
    ? person.roles.includes(role)
    : role === 'contributor' || person.assignments.some((assignment) => assignment.role === role)

export type SignInGroup = {
  role: SignInRole
  /** "Owners": the heading over the people listed under the role. */
  title: string
  people: SignInPerson[]
}

/**
 * The people grouped by the role they are listed under, administrators first and contributors
 * last, each group in the order the service gave. Empty groups are left out.
 */
export function signInGroups(people: readonly SignInPerson[]): SignInGroup[] {
  return roleOrder.flatMap((role) => {
    const listed = people.filter((person) => roleOrder.find((held) => holds(person, held)) === role)
    return listed.length ? [{ role, title: roleTitle[role].many, people: listed }] : []
  })
}

/** The domains a person holds one role in, each once, by name: what the picker shows beside them. */
export function signInRoleDomains(person: SignInPerson, role: SignInRole): SignInArea[] {
  return signInDomains({
    ...person,
    assignments: person.assignments.filter((assignment) => assignment.role === role),
  })
}

/** "Auditor, Owner": the roles a person holds besides the one they are listed under. */
export function signInOtherRoles(person: SignInPerson, role: SignInRole): string {
  return titles(person)
    .filter((title) => title !== roleTitle[role].one)
    .join(', ')
}

const LAST_KEY = 'cl.sign-in.last'

/** The person chosen last on this browser, when they are still offered; else the first. */
export function initialChoice(people: readonly SignInPerson[]): string | null {
  let last: string | null = null
  try {
    last = window.localStorage.getItem(LAST_KEY)
  } catch {
    // Storage blocked: start from the first person.
  }
  return people.find((person) => person.email === last)?.email ?? people[0]?.email ?? null
}

export function rememberChoice(email: string) {
  try {
    window.localStorage.setItem(LAST_KEY, email)
  } catch {
    // Storage blocked: the picker starts from the first person next time.
  }
}
