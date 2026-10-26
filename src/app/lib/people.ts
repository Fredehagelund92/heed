import { domainIds, domains, facts, people, type DomainId, type Person } from '@/data/world'
import { changed, describe, syncOwnership } from '@/lib/domains'

// The people in the workspace, as Settings > People and a domain page change them. Two roles only,
// as v1 has them: an admin or a member. Ownership is per domain and lives on the domain, so a person
// added as an owner on either page shows in both, and in every list, mention and comment.

export const emailOf = (p: Person) =>
  p.email ?? `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@larchwood.example`

const seen: Record<string, string> = {
  'Jon Abara': 'Today',
  'Tomas Eriksen': 'Today',
  'Ines Duarte': 'Yesterday',
  'Ravi Kapoor': '2 days ago',
  'Maria Lindqvist': 'Yesterday',
  'Sofia Brandt': 'Today',
  'Noor Haddad': '3 days ago',
  'Alex Moreau': 'Last week',
  'Priya Nair': 'Yesterday',
  'Lars Dahl': '2 weeks ago',
  'Kofi Mensah': 'Today',
  'Ella Voss': 'Last month',
}
export const lastActiveOf = (p: Person) =>
  p.invited ? 'Not yet' : (p.lastActive ?? seen[p.name] ?? 'A while ago')

/** A few quiet lines on what they did lately: the context they checked. */
export function activityOf(name: string) {
  return facts
    .filter((f) => f.checkedBy === name)
    .slice(0, 3)
    .map((f) => ({ what: `Checked ${f.title}`, when: f.checkedOn }))
}

/** The domains only this person owns: they must hand those over before they can leave. */
export const soleOwnerOf = (name: string) =>
  domainIds.filter((d) => domains[d].owners.length === 1 && domains[d].owners[0] === name)

/** Make someone an owner of a domain, or not. A domain always keeps one owner. */
export function setOwner(name: string, d: DomainId, own: boolean): 'ok' | 'last' {
  const owners = domains[d].owners
  if (!own && owners.length === 1 && owners[0] === name) return 'last'
  domains[d].owners = own ? [...new Set([...owners, name])] : owners.filter((o) => o !== name)
  syncOwnership()
  changed()
  return 'ok'
}

export function setAdmin(name: string, admin: boolean) {
  const p = people.find((x) => x.name === name)
  if (!p) return
  p.admin = admin
  p.role = describe(p)
  changed()
}

/** Invite people by address: a member or an admin, owners of the chosen domains from the start. */
export function invite(emails: string[], admin: boolean, owns: DomainId[]) {
  for (const email of emails) {
    if (people.some((p) => emailOf(p) === email)) continue
    people.push({ name: email, email, role: 'Invited', owns: [], admin, invited: true })
    for (const d of owns) domains[d].owners = [...domains[d].owners, email]
  }
  syncOwnership()
  changed()
}

/** Take back an invite, or remove someone; only when they own no domain alone. */
export function removePerson(name: string): 'ok' | DomainId[] {
  const alone = soleOwnerOf(name)
  if (alone.length) return alone
  for (const d of domainIds) domains[d].owners = domains[d].owners.filter((o) => o !== name)
  const i = people.findIndex((p) => p.name === name)
  if (i >= 0) people.splice(i, 1)
  syncOwnership()
  changed()
  return 'ok'
}

/** Undo a removal (from the toast): put them back as they were. */
export function restorePerson(p: Person, owned: DomainId[], at: number) {
  people.splice(at, 0, p)
  for (const d of owned) if (domains[d]) domains[d].owners = [...domains[d].owners, p.name]
  syncOwnership()
  changed()
}
