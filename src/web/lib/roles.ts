import type { Area } from '@domain/item'
import type {
  AssignmentInput,
  GrantChange,
  GrantsApplied,
  HeldRole,
  PeopleRoleFilter,
  PeopleSignInFilter,
  PersonStatus,
  RoleInput,
} from '@/api'

/*
  The words for roles and for the people who hold them, on the People page, a person's sheet and
  the Give a role dialog (people and roles decision, option C, slice 1, 13 October 2026), and the
  role changes a screen sends as one step (slice 2, FR-804): giving, removing and replacing all go
  through `applyGrants`, so the service checks and records a whole step at once.
*/

export type GlobalRole = RoleInput['role']
export type AreaRole = AssignmentInput['role']
export type Role = GlobalRole | AreaRole

export const globalRoleWords: Record<GlobalRole, { name: string; about: string }> = {
  administrator: {
    name: 'Admin',
    about:
      'Sets up domains, people and settings, and decides which AI apps connect and what they get.',
  },
  auditor: { name: 'Auditor', about: 'Reads and exports the history log. Changes nothing.' },
}

export const areaRoleWords: Record<AreaRole, { name: string; about: string }> = {
  owner: {
    name: 'Owner',
    about: 'Accepts proposals for the domain and keeps its facts true. A domain can have several.',
  },
  approver: {
    name: 'Approver',
    about: 'Gives the second yes that a high-risk fact needs. A domain can have more than one.',
  },
}

export const roleWords: Record<Role, { name: string; about: string }> = {
  ...globalRoleWords,
  ...areaRoleWords,
}

export const isAreaRole = (role: Role): role is AreaRole => role in areaRoleWords

/**
 * A role as a sentence names it: "Admin", "Owner of Finance". A domain that is gone keeps its
 * id, so the role still reads. Code says administrator; people read admin.
 */
export function heldRoleName(
  held: Pick<HeldRole, 'areaId'> & { role: string },
  areaName: (id: string) => string | undefined,
): string {
  const name = roleWords[held.role as Role]?.name ?? held.role
  return held.areaId ? `${name} of ${areaName(held.areaId) ?? held.areaId}` : name
}

/** A role inside a sentence: "Remove Jon as owner of Finance", "Given: high-risk approver". */
export function roleInSentence(
  held: Pick<HeldRole, 'areaId'> & { role: string },
  areaName: (id: string) => string | undefined,
): string {
  const name = heldRoleName(held, areaName)
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/** The role filter's choices, in the order the menu shows them. */
export const roleFilterWords: Record<PeopleRoleFilter, string> = {
  administrator: 'Admins',
  auditor: 'Auditors',
  owner: 'Owners',
  approver: 'High-risk approvers',
  none: 'No role',
}

export const signInFilterWords: Record<PeopleSignInFilter, string> = {
  week: 'In the last 7 days',
  month: 'In the last 30 days',
  older: 'More than 30 days ago',
  never: 'Never',
}

export const statusFilterWords: Record<'active' | 'left' | 'all', string> = {
  active: 'Active',
  left: 'Left or erased',
  all: 'Everyone',
}

export const personStatusWords: Record<PersonStatus, string> = {
  active: 'Active',
  left: 'Left',
  erased: 'Erased',
}

/**
 * When a person last signed in, as a list reads it: "Today", "Yesterday", "3 days ago", then the
 * day. `now` is the moment the list was read.
 */
export function lastSignInWords(at: string | null, now: string): string {
  if (!at) return 'Never'
  const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const date = new Date(at)
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getUTCFullYear() === new Date(now).getUTCFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date)
}

/** A role's own name in a sentence: "owner", "high-risk approver". */
export const roleWord = (role: Role) => roleWords[role].name.toLowerCase()

/** A role's name with its article, as "Jon becomes an owner of Finance" reads it. */
export function aRoleWord(role: Role): string {
  const word = roleWord(role)
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
}

/**
 * The changes that give a role to people: across Heed, or in each of the domains. A domain may
 * have several owners and several approvers, so a role is only ever added beside others.
 */
export function giveChanges(
  people: readonly string[],
  role: Role,
  areaIds: readonly string[],
): GrantChange[] {
  if (!isAreaRole(role)) return people.map((personId) => ({ op: 'grant', personId, role }))
  return areaIds.flatMap((areaId) =>
    people.map((personId) => ({ op: 'grant' as const, personId, areaId, role })),
  )
}

/**
 * The domains a step would leave without an owner: those whose every owner it removes. A
 * domain may have several, so removing one of them leaves the others to review; the service
 * refuses a step that removes a domain's last one (FR-804).
 */
export function leftWithoutOwner<A extends Pick<Area, 'id' | 'name' | 'ownerIds'>>(
  removed: readonly (RoleInput | AssignmentInput)[],
  areas: readonly A[],
): A[] {
  const gone = new Set(
    removed.flatMap((grant) =>
      'areaId' in grant && grant.role === 'owner' ? [`${grant.areaId}.${grant.personId}`] : [],
    ),
  )
  return areas.filter(
    (area) =>
      area.ownerIds.length > 0 &&
      area.ownerIds.every((personId) => gone.has(`${area.id}.${personId}`)),
  )
}

/** A grant as a change, to remove it. */
export const removal = (grant: RoleInput | AssignmentInput): GrantChange => ({
  ...grant,
  op: 'revoke',
})

/** The key a grant goes by on a page: `owner.per_kofi`, `area_x.owner.per_kofi`. */
export const grantKey = (grant: RoleInput | AssignmentInput) =>
  'areaId' in grant
    ? `${grant.areaId}.${grant.role}.${grant.personId}`
    : `${grant.role}.${grant.personId}`

/** What a step did, in counts: given, removed, and asked for but already so. */
export function stepCounts(result: GrantsApplied) {
  const changed = result.changes.filter((change) => change.changed)
  return {
    given: changed.filter((change) => change.op === 'grant').length,
    removed: changed.filter((change) => change.op === 'revoke').length,
    unchanged: result.changes.length - changed.length,
  }
}

/** "3 roles", "1 role". */
export const rolesCount = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'role' : 'roles'}`
