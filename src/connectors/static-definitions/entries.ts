import type { CheckReport } from '../../domain/connector-runtime.ts'

/**
 * The entries of a static list of definitions, read from the JSON an admin wrote, and what a
 * check says of them. Pure, so the runtime reads and checks with it, and the web app's mock
 * answers a test the same way.
 */

export interface StaticEntry {
  kind: 'metric' | 'dimension'
  /** The member's name, with its view before the last dot: `payments.orders`. */
  name: string
  title: string | null
  description: string | null
  type: string | null
  domain: string | null
}

/** The most entries a list may have: the manifest's `limits.maxRecords`. */
export const STATIC_ENTRIES_MAX = 500
const namePattern = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/
const keys = new Set(['kind', 'name', 'title', 'description', 'type', 'domain'])

const optionalText = (value: unknown, max: number): string | null | undefined =>
  value === undefined || value === null
    ? null
    : typeof value === 'string' && [...value.trim()].length <= max
      ? value.trim() || null
      : undefined

/** The entries, or the first thing wrong with them, said for the person who wrote them. */
export function parseStaticEntries(text: string): { entries: StaticEntry[] } | { problem: string } {
  let list: unknown
  try {
    list = JSON.parse(text)
  } catch {
    return { problem: 'This is not JSON. Check the brackets, commas and quotes.' }
  }
  if (!Array.isArray(list))
    return { problem: 'Write a list: start with [ and end with ], one entry per definition.' }
  if (list.length === 0) return { problem: 'Write at least one definition.' }
  if (list.length > STATIC_ENTRIES_MAX)
    return { problem: `Write at most ${STATIC_ENTRIES_MAX} definitions.` }
  const entries: StaticEntry[] = []
  const names = new Set<string>()
  for (const [index, raw] of list.entries()) {
    const at = `Entry ${index + 1}`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return { problem: `${at} is not an entry: write it between { and }.` }
    const entry = raw as Record<string, unknown>
    const unknown = Object.keys(entry).find((key) => !keys.has(key))
    if (unknown !== undefined)
      return {
        problem: `${at} has ${unknown}, which a definition does not have. Use kind, name, title, description, type and domain.`,
      }
    if (entry.kind !== 'metric' && entry.kind !== 'dimension')
      return { problem: `${at} needs a kind: metric or dimension.` }
    if (typeof entry.name !== 'string' || !namePattern.test(entry.name) || entry.name.length > 200)
      return {
        problem: `${at} needs a name of letters, digits and underscores, with a dot before the view's part: payments.orders.`,
      }
    if (names.has(entry.name)) return { problem: `${at} repeats the name ${entry.name}.` }
    names.add(entry.name)
    const title = optionalText(entry.title, 200)
    const description = optionalText(entry.description, 5_000)
    const type = optionalText(entry.type, 50)
    const domain = optionalText(entry.domain, 200)
    if (title === undefined) return { problem: `${at}: write the title as text.` }
    if (description === undefined) return { problem: `${at}: write the description as text.` }
    if (type === undefined) return { problem: `${at}: write the type as text, such as number.` }
    if (domain === undefined) return { problem: `${at}: write the domain as text.` }
    entries.push({ kind: entry.kind, name: entry.name, title, description, type, domain })
  }
  return { entries }
}

const domainId = /^[a-z][a-z0-9_]{1,39}$/
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** An entry's domain: the domain its name maps to, or its own. */
export function staticDomainOf(
  entry: StaticEntry,
  names: Readonly<Record<string, string>>,
): string | null {
  if (entry.domain === null) return null
  return names[entry.domain] ?? entry.domain
}

/** What a check of the list says: what it holds, and whether each metric finds its domain. */
export function staticCheckReport(
  entries: readonly StaticEntry[],
  names: Readonly<Record<string, string>>,
): CheckReport {
  const metrics = entries.filter((entry) => entry.kind === 'metric')
  const unknown = entries.filter((entry) => {
    const domain = staticDomainOf(entry, names)
    return domain !== null && !domainId.test(domain)
  }).length
  const without = metrics.filter((entry) => staticDomainOf(entry, names) === null).length
  return {
    steps: [
      {
        id: 'read',
        title: 'Read the list',
        status: 'ok',
        detail: `${plural(metrics.length, 'metric')} and ${plural(entries.length - metrics.length, 'dimension')}.`,
      },
      unknown
        ? {
            id: 'domains',
            title: 'Find each domain',
            status: 'warning',
            detail: `${plural(unknown, 'entry', 'entries')} ${unknown === 1 ? 'names' : 'name'} a domain that is not a domain id.`,
            fix: 'Map the name to a domain under Domain names, or write the domain id.',
          }
        : without
          ? {
              id: 'domains',
              title: 'Find each domain',
              status: 'warning',
              detail: `${plural(without, 'metric')} ${without === 1 ? 'names' : 'name'} no domain.`,
              fix: 'Give each metric a domain, so its owners hear when it changes.',
            }
          : {
              id: 'domains',
              title: 'Find each domain',
              status: 'ok',
              detail: 'Every metric names its domain.',
            },
    ],
  }
}
