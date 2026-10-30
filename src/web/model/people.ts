import type { Permissions } from '@contract/auth'
import type { DomainId, Fact } from './items'

// The workspace's people and domains as the app reads them (src/app/api): two roles, an admin or
// a member, and ownership per domain, which lives on the domain. Pure types and the rules that
// follow from them.

export type Person = {
  name: string
  /** One line on what they do here, derived from what they own and whether they are an admin. */
  role: string
  owns: DomainId[]
  admin: boolean
  /** Their work address; derived from the name when not given. */
  email?: string
  /** Invited and not signed in yet. */
  invited?: boolean
  /** When they last used Heed, in words. */
  lastActive?: string
}

/** A domain: its name, who owns it, and its text in its own words (what it covers, then its house rules). */
export type Domain = {
  id: DomainId
  name: string
  owners: string[]
  /** The first paragraph of the text, plain: what the domain covers. */
  covers: string
  /** The whole text, light markdown with mentions. */
  text: string
  /** The sandbox, where people try context: agents never get it, and it is never deleted. */
  sandbox?: boolean
}

/** The domains by id, in the order the workspace lists them. */
export type Domains = Record<DomainId, Domain>

/** Who answers for an item: its own owners, or else its domain's. */
export const ownersOf = (f: Pick<Fact, 'owners' | 'domain'>, domains: Domains) =>
  f.owners?.length ? f.owners : (domains[f.domain]?.owners ?? [])

/** What a person holds in the server's words: administrator, and owner of each domain they own. */
export const toServerPermissions = (p: Person): Permissions => ({
  roles: p.admin ? ['administrator'] : [],
  assignments: p.owns.map((areaId) => ({ areaId, role: 'owner' })),
})

export const emailOf = (p: Person) =>
  p.email ?? `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@larchwood.example`

/** One line on what a person does here: what they own (the sandbox aside) and whether they are an admin. */
export function describe(p: Person, domains: Domains) {
  if (p.invited) return 'Invited'
  const owned = p.owns.filter((d) => domains[d] && !domains[d].sandbox).map((d) => domains[d]?.name)
  if (owned.length)
    return `Owner of ${owned.length > 1 ? `${owned.slice(0, -1).join(', ')} and ${owned.at(-1)}` : owned[0]}${p.admin ? ', admin' : ''}`
  return p.admin ? 'Admin' : 'Suggests context, owns no domain'
}

/** The domains only this person owns: they must hand those over before they can leave. */
export const soleOwnerOf = (name: string, domains: Domains) =>
  Object.values(domains)
    .filter((d) => d.owners.length === 1 && d.owners[0] === name)
    .map((d) => d.id)

/** The first paragraph of a domain's text, plain: what it covers, for pickers, hints and cards. */
export function excerptOf(text: string) {
  const first = text.split('\n\n')[0] ?? ''
  // Plain words: a mention reads as its label, and markdown marks drop away.
  return first
    .replace(/\[@ id="[^"]*" label="([^"]*)"\]/g, '$1')
    .replace(/\*\*|`|^[-#>] /gm, '')
    .trim()
}
