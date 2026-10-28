import { inviteLinkOf } from '@contract/members'
import type { Invited } from '@/api/client'
import type { Fact } from '@/model/items'
import {
  describe,
  emailOf,
  excerptOf,
  soleOwnerOf,
  type Domain,
  type Domains,
} from '@/model/people'
import { domainIds, domains as seedDomains, people as seedPeople } from './data/world'

// The mock's workspace: its domains and people, as Settings, a domain page and People change
// them. Two roles only, as v1 has them: an admin or a member. Ownership is per domain and lives on
// the domain, so a person added as an owner on either page shows in both. Kept until the page
// reloads.

const seedText: Record<string, string> = {
  sales:
    'Orders, revenue and the basket: what customers buy and send back, and what we earn.\n\nHouse rules:\n\n- Money is in euros at the daily rate.\n- Weeks run Monday to Sunday; months are calendar months.\n- An order counts on the day it is paid, not the day it ships.',
  marketing:
    'Acquisition and discounts: spend, conversion, cost per acquisition and discount cost by campaign and channel.\n\nHouse rules:\n\n- Spend counts on the day the cost is booked.\n- Campaign names are the ones in the ad platform.',
  customer_value:
    'Customers over their lifetime: new and active customers, first-time buyers, repeat purchases, churn and lifetime value.\n\nHouse rules:\n\n- A customer is active with one paid order in the period.\n- Test and staff accounts are left out.',
  paid_media:
    'Paid media buying: return on ad spend by campaign, channel and market.\n\nHouse rules:\n\n- Attribution is the last click within 30 days.\n- Spend is in euros at the daily rate.',
  sandbox:
    'A place to try context before it goes anywhere.\n\nNothing written here reaches agents.',
}

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

export function createWorkspace() {
  const domains: Domains = Object.fromEntries(
    domainIds.map((id) => {
      const d = seedDomains[id]!
      return [
        id,
        {
          id,
          name: d.name,
          owners: [...d.owners],
          covers: d.covers,
          text: seedText[id] ?? d.covers,
          ...(id === 'sandbox' ? { sandbox: true } : {}),
        },
      ]
    }),
  )
  const order = [...domainIds]
  /** The address each invite link's token opens. */
  const links = new Map<string, string>()
  const linkFor = (email: string, origin: string) => {
    const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(43)), (b) =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charAt(b % 64),
    ).join('')
    links.set(token, email)
    return inviteLinkOf(origin, token)
  }
  const people = seedPeople.map((p) => ({
    ...p,
    owns: [...p.owns],
    lastActive: p.lastActive ?? (p.invited ? 'Not yet' : (seen[p.name] ?? 'A while ago')),
  }))

  /** Ownership lives on the domain; each person's list and line follow from it. */
  const syncOwnership = () => {
    for (const p of people) {
      p.owns = order.filter((d) => domains[d]?.owners.includes(p.name))
      p.role = describe(p, domains)
    }
  }

  return {
    domains: (): Domain[] => order.flatMap((id) => domains[id] ?? []),
    domainMap: () => domains,
    people: () => people,
    person: (name: string) => people.find((p) => p.name === name) ?? people[0],

    updateDomain(input: { id: string; name?: string; owners?: string[]; text?: string }) {
      const d = domains[input.id]
      if (!d) return
      if (input.name !== undefined) d.name = input.name
      if (input.owners !== undefined) {
        d.owners = input.owners
        syncOwnership()
      }
      if (input.text !== undefined) {
        d.text = input.text
        d.covers = excerptOf(input.text)
      }
    },

    /** A new domain, with the person creating it as its owner. */
    addDomain(input: { name: string; owners: string[]; text?: string }) {
      const base =
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || 'domain'
      let id = base
      for (let n = 2; domains[id]; n++) id = `${base}_${n}`
      const text = input.text ?? ''
      domains[id] = { id, name: input.name, owners: input.owners, covers: excerptOf(text), text }
      order.push(id)
      syncOwnership()
      return id
    },

    removeDomain(id: string) {
      const i = order.indexOf(id)
      if (i >= 0) order.splice(i, 1)
      delete domains[id]
      syncOwnership()
    },

    /** Make someone an owner of a domain, or not. A domain always keeps one owner. */
    setOwner(name: string, d: string, own: boolean): 'ok' | 'last' {
      const owners = domains[d]?.owners ?? []
      if (!own && owners.length === 1 && owners[0] === name) return 'last'
      if (!domains[d]) return 'ok'
      domains[d].owners = own ? [...new Set([...owners, name])] : owners.filter((o) => o !== name)
      syncOwnership()
      return 'ok'
    },

    setAdmin(name: string, admin: boolean) {
      const p = people.find((x) => x.name === name)
      if (!p) return
      p.admin = admin
      p.role = describe(p, domains)
    },

    /**
     * Invite people by address: a member or an admin, owners of the chosen domains from the start.
     * Each new invite gets a link, as the service gives one; an address already here is left out.
     */
    invite(emails: string[], admin: boolean, owns: string[], origin: string): Invited {
      const result: Invited = { links: [], skipped: [] }
      for (const email of emails) {
        const known = people.find((p) => emailOf(p) === email)
        if (known) {
          result.skipped.push({ email, why: known.invited ? 'pending' : 'member' })
          continue
        }
        result.links.push({ email, link: linkFor(email, origin) })
        people.push({
          name: email,
          email,
          role: 'Invited',
          owns: [],
          admin,
          invited: true,
          lastActive: 'Not yet',
        })
        for (const d of owns) if (domains[d]) domains[d].owners = [...domains[d].owners, email]
      }
      syncOwnership()
      return result
    },

    /** Sends an invite again: a new link, and the old one stops working. */
    resendInvite(name: string, origin: string) {
      const p = people.find((x) => x.name === name && x.invited)
      if (!p) return null
      for (const [token, email] of links) if (email === emailOf(p)) links.delete(token)
      return linkFor(emailOf(p), origin)
    },

    /** What an invite link's token opens: its address, role and domains; null for any other. */
    readInvite(token: string) {
      const email = links.get(token)
      const p = email ? people.find((x) => x.invited && emailOf(x) === email) : undefined
      if (!p) return null
      return {
        email: emailOf(p),
        admin: p.admin,
        domains: order
          .filter((d) => domains[d]?.owners.includes(p.name))
          .map((d) => domains[d]!.name),
      }
    },

    /** Take back an invite, or remove someone; only when they own no domain alone. Undo puts them back. */
    removePerson(name: string): { alone: string[] } | { restore: () => void } {
      const alone = soleOwnerOf(name, domains)
      if (alone.length) return { alone }
      const at = people.findIndex((p) => p.name === name)
      const gone = people[at]
      const owned = order.filter((d) => domains[d]?.owners.includes(name))
      for (const d of Object.values(domains)) d.owners = d.owners.filter((o) => o !== name)
      if (at >= 0) people.splice(at, 1)
      syncOwnership()
      return {
        restore: () => {
          if (!gone || people.some((p) => p.name === name)) return
          people.splice(at, 0, gone)
          for (const d of owned) if (domains[d]) domains[d].owners = [...domains[d].owners, name]
          syncOwnership()
        },
      }
    },

    /** A few quiet lines on what someone did lately: the context they checked. */
    activityOf(name: string, facts: Fact[]) {
      return facts
        .filter((f) => f.checkedBy === name)
        .slice(0, 3)
        .map((f) => ({ what: `Checked ${f.title}`, when: f.checkedOn }))
    },
  }
}

export type MockWorkspace = ReturnType<typeof createWorkspace>
