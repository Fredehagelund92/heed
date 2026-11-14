import type { Invite as InviteRow, Member } from '@contract/members'
import { describe, type Domain, type Domains, type Invite, type Person } from '@/model/people'

/*
  The workspace's people as the service has them (members.list and invites.list), in the app's
  shape: the members, each an Admin or a Member with the domains they own and when they last
  signed in in words; and the open invites, each with the domains it owns once taken. An invite
  is never among a domain's owners.
*/

const DAY = 86_400_000

/** When someone last signed in, in the People page's words: "Today", "3 days ago". */
export function lastActiveOf(at: string | null, now: Date): string {
  if (!at) return 'Not yet'
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const days = Math.round((day(now) - day(new Date(at))) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`
  if (days < 62) return 'Last month'
  return 'A while ago'
}

/** The members and the open invites, as the app reads them. */
export function peopleOf(input: {
  members: readonly Member[]
  invites: readonly InviteRow[]
  domains: readonly Domain[]
  now: Date
}): { people: Person[]; invites: Invite[] } {
  const byId: Domains = Object.fromEntries(input.domains.map((d) => [d.id, d]))
  const people: Person[] = input.members.map((m) => {
    const person: Person = {
      id: m.id,
      name: m.name,
      role: '',
      owns: m.owns.filter((d) => byId[d]),
      admin: m.role === 'admin',
      email: m.email,
      lastActive: lastActiveOf(m.lastSignedInAt, input.now),
    }
    return { ...person, role: describe(person, byId) }
  })
  const invites: Invite[] = input.invites.map((i) => ({
    id: i.id,
    email: i.email,
    admin: i.role === 'admin',
    willOwn: i.areaIds.filter((d) => byId[d]),
    sentBy: i.invitedBy,
  }))
  return { people, invites }
}
