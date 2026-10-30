import type { Invite, Member } from '@contract/members'
import { describe, type Domain, type Domains, type Person } from '@/model/people'

/*
  The workspace's people as the service has them (members.list and invites.list), in the app's
  shape: an Admin or a Member, the domains each owns, when they last signed in in words, and the
  open invites, each a person named by their address, who owns the invite's domains from the
  start. A domain lists its invited owners beside its owners, as the mockup draws them.
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

/** The people and the domains with their invited owners, as the app reads them. */
export function peopleOf(input: {
  members: readonly Member[]
  invites: readonly Invite[]
  domains: readonly Domain[]
  now: Date
}): { people: Person[]; domains: Domain[] } {
  const domains: Domain[] = input.domains.map((d) => ({
    ...d,
    owners: [
      ...d.owners,
      ...input.invites.filter((i) => i.areaIds.includes(d.id)).map((i) => i.email),
    ],
  }))
  const byId: Domains = Object.fromEntries(domains.map((d) => [d.id, d]))
  const members: Person[] = input.members.map((m) => {
    const person: Person = {
      name: m.name,
      role: '',
      owns: m.owns.filter((d) => byId[d]),
      admin: m.role === 'admin',
      email: m.email,
      lastActive: lastActiveOf(m.lastSignedInAt, input.now),
    }
    return { ...person, role: describe(person, byId) }
  })
  const invited: Person[] = input.invites.map((i) => ({
    name: i.email,
    role: 'Invited',
    owns: i.areaIds.filter((d) => byId[d]),
    admin: i.role === 'admin',
    email: i.email,
    invited: true,
    lastActive: 'Not yet',
  }))
  return { people: [...members, ...invited], domains }
}
