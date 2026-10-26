import * as React from "react"
import { domainIds, domains, people, type DomainId, type Person } from "@/data/world"

// The domains as people edit them in Settings: a name, owners, and a text in the domain's own words
// (what it covers, then its house rules). The world's `domains` record and `domainIds` list stay the
// one source every screen reads; edits change them in place and tell the app to draw again, so a new
// name or owner shows in lists, mentions, comments and pickers at once. Kept until the page reloads.

const seed: Record<string, string> = {
  sales:
    "Orders, revenue and the basket: what customers buy and send back, and what we earn.\n\nHouse rules:\n\n- Money is in euros at the daily rate.\n- Weeks run Monday to Sunday; months are calendar months.\n- An order counts on the day it is paid, not the day it ships.",
  marketing:
    "Acquisition and discounts: spend, conversion, cost per acquisition and discount cost by campaign and channel.\n\nHouse rules:\n\n- Spend counts on the day the cost is booked.\n- Campaign names are the ones in the ad platform.",
  customer_value:
    "Customers over their lifetime: new and active customers, first-time buyers, repeat purchases, churn and lifetime value.\n\nHouse rules:\n\n- A customer is active with one paid order in the period.\n- Test and staff accounts are left out.",
  paid_media:
    "Paid media buying: return on ad spend by campaign, channel and market.\n\nHouse rules:\n\n- Attribution is the last click within 30 days.\n- Spend is in euros at the daily rate.",
  sandbox: "A place to try context before it goes anywhere.\n\nNothing written here reaches agents.",
}
const texts: Record<string, string> = { ...seed }

let version = 0
const listeners = new Set<() => void>()
/** Tells the app a domain or a person changed. */
export const changed = () => {
  version += 1
  for (const l of listeners) l()
}

/** One line on what a person does here: what they own (the sandbox aside) and whether they are an admin. */
export function describe(p: Person) {
  if (p.invited) return "Invited"
  const owned = p.owns.filter((d) => d !== "sandbox" && domains[d]).map((d) => domains[d].name)
  if (owned.length) return `Owner of ${owned.length > 1 ? `${owned.slice(0, -1).join(", ")} and ${owned.at(-1)}` : owned[0]}${p.admin ? ", admin" : ""}`
  return p.admin ? "Admin" : "Suggests context, owns no domain"
}

/** Ownership lives on the domain; each person's list and line follow from it. */
export function syncOwnership() {
  for (const p of people) {
    p.owns = domainIds.filter((d) => domains[d]?.owners.includes(p.name))
    p.role = describe(p)
  }
}

/** Draws again when a domain changes. */
export function useDomains() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version
  )
}

export const domainText = (id: DomainId) => texts[id] ?? domains[id]?.covers ?? ""

/** The first paragraph, plain: what the domain covers, for pickers, hints and cards. */
export function excerptOf(id: DomainId) {
  const first = domainText(id).split("\n\n")[0] ?? ""
  // Plain words: a mention reads as its label, and markdown marks drop away.
  return first
    .replace(/\[@ id="[^"]*" label="([^"]*)"\]/g, "$1")
    .replace(/\*\*|`|^[-#>] /gm, "")
    .trim()
}

export function updateDomain(id: DomainId, patch: { name?: string; owners?: string[]; text?: string }) {
  const d = domains[id]
  if (!d) return
  if (patch.name !== undefined) d.name = patch.name
  if (patch.owners !== undefined) {
    d.owners = patch.owners
    syncOwnership()
  }
  if (patch.text !== undefined) {
    texts[id] = patch.text
    d.covers = excerptOf(id)
  }
  changed()
}

/** A new domain, with the person creating it as its owner. */
export function addDomain(name: string, owners: string[], text = "") {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "domain"
  let id = base
  for (let n = 2; domains[id as DomainId]; n++) id = `${base}_${n}`
  domains[id as DomainId] = { name, owners, covers: "" }
  texts[id] = text
  domains[id as DomainId].covers = excerptOf(id as DomainId)
  domainIds.push(id as DomainId)
  syncOwnership()
  changed()
  return id as DomainId
}

export function removeDomain(id: DomainId) {
  const i = domainIds.indexOf(id)
  if (i >= 0) domainIds.splice(i, 1)
  delete domains[id]
  delete texts[id]
  syncOwnership()
  changed()
}
