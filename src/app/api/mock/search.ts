import type { SearchHits } from '../client'
import type { Definition } from '@/lib/definitions'
import type { Fact } from '@/model/items'
import type { Domain, Person } from '@/model/people'

/** The most a group of search everywhere returns, as the service's `search.all`. */
export const SEARCH_GROUP_MAX = 5

/**
 * Search everywhere over the demo world, by the service's rule (`search.all`): the library's
 * items (a draft is no item yet) whose title, summary or text has the words, definitions by name
 * or another name, domains and people still here by name. A name that starts with the words comes
 * first, then A to Z; a few of each.
 */
export function searchWorld(
  q: string,
  world: { facts: Fact[]; definitions: Definition[]; domains: Domain[]; people: Person[] },
): SearchHits {
  const words = q.trim().toLowerCase()
  if (!words) return { items: [], definitions: [], domains: [], people: [] }
  const has = (text: string | undefined) => !!text && text.toLowerCase().includes(words)
  const best = <T>(rows: T[], name: (row: T) => string) =>
    rows
      .map((row) => ({ row, starts: name(row).toLowerCase().startsWith(words) }))
      .sort(
        (a, b) =>
          Number(b.starts) - Number(a.starts) || name(a.row).localeCompare(name(b.row), 'en'),
      )
      .slice(0, SEARCH_GROUP_MAX)
      .map(({ row }) => row)
  return {
    items: best(
      world.facts.filter(
        (f) => f.status !== 'Draft' && (has(f.title) || has(f.summary) || has(f.body)),
      ),
      (f) => f.title,
    ).map((f) => ({ id: f.id, title: f.title, kind: f.kind, domain: f.domain })),
    definitions: best(
      world.definitions.filter((d) => has(d.name) || d.sourceNames.some(has)),
      (d) => d.name,
    ).map((d) => ({
      name: d.name,
      type: d.type,
      ...(d.sameAs ? { sameAs: d.sameAs } : {}),
      sourceNames: d.sourceNames,
    })),
    domains: best(
      world.domains.filter((d) => has(d.name)),
      (d) => d.name,
    ).map((d) => ({ id: d.id, name: d.name })),
    people: best(
      world.people.filter((p) => !p.invited && has(p.name)),
      (p) => p.name,
    ).map((p) => ({ name: p.name })),
  }
}
