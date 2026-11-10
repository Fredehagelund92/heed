import type { Topic } from '@/model/observability'

// The names of dimensions and their values, by key, as the service gave them: in the topics of a
// page, the list of dimensions and the values the filter read. A chip keeps keys only, so the bar
// names its values from here, and a key nothing has named yet reads from its own words ("alder_row"
// as "Alder row") until something does. Names are the definitions', the same for everyone.

const names = new Map<string, string>()

/** Keeps the names of what the service listed. */
export function rememberNames(entries: Iterable<{ key: string; name: string }>) {
  for (const e of entries) if (e.name) names.set(e.key, e.name)
}

/** Keeps the names a page's topics carry: their values and their dimensions'. */
export function rememberTopics(topics: readonly Topic[]) {
  for (const t of topics) {
    for (const v of t.values) names.set(v.value, v.name)
    for (const d of t.dimensions) names.set(d.dimension, d.name)
  }
}

/** A key's own words, for one nothing has named yet: `val:store/alder_row` reads "Alder row". */
export function wordsOfKey(key: string) {
  const id = key.slice(Math.max(key.indexOf(':'), key.indexOf('/')) + 1).replace(/_/g, ' ')
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** The name of a dimension or a value, by its key. */
export const nameOf = (key: string) => names.get(key) ?? wordsOfKey(key)

/** Whether the service named the key yet. */
export const named = (key: string) => names.has(key)
