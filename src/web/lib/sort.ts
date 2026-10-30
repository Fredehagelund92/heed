// How a list is sorted: a key and a direction. Each key starts its own way (a title A to Z, a date
// newest first) and says both ways in words; a ranking (best match, coverage) has one way only and
// never flips. A click on the sorted column's header flips it; a click on another starts that one.

export type Dir = 'asc' | 'desc'

export type SortKey = {
  label: string
  /** The way it starts: A to Z is ascending, newest first is descending. */
  first: Dir
  /** Its direction in words, each way; a ranking has its first way only. */
  ways: Partial<Record<Dir, string>>
}

export type Sorting<K extends string> = { key: K; dir: Dir }

/** Whether a key can run both ways. */
export const flips = (k: SortKey) => Boolean(k.ways.asc && k.ways.desc)

/** A key chosen fresh, its own way. */
export const startOf = <K extends string>(keys: Record<K, SortKey>, key: K): Sorting<K> => ({
  key,
  dir: keys[key].first,
})

/** The direction in words, as the menu and the bar say it. */
export const wayOf = <K extends string>(keys: Record<K, SortKey>, s: Sorting<K>) =>
  keys[s.key].ways[s.dir] ?? keys[s.key].ways[keys[s.key].first] ?? ''

/** Whether the list runs against its key's own way: Z to A, oldest first. */
export const flipped = <K extends string>(keys: Record<K, SortKey>, s: Sorting<K>) =>
  s.dir !== keys[s.key].first

/** A header's click: the sorted column flips (a ranking stays), another column starts its own way. */
export function clicked<K extends string>(
  keys: Record<K, SortKey>,
  s: Sorting<K>,
  key: K,
): Sorting<K> {
  if (s.key !== key) return startOf(keys, key)
  return flips(keys[key]) ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s
}

/** The sorting the address asks for (`sort` and `dir`); anything it does not know falls back. */
export function sortingFrom<K extends string>(
  keys: Record<K, SortKey>,
  query: URLSearchParams,
  fallback: K,
): Sorting<K> {
  const asked = query.get('sort')
  const key = asked && Object.hasOwn(keys, asked) ? (asked as K) : fallback
  const dir = query.get('dir')
  return (dir === 'asc' || dir === 'desc') && flips(keys[key]) ? { key, dir } : startOf(keys, key)
}

/** The address for a sorting: the fallback key and a key's own way are left out. */
export const sortingTo = <K extends string>(
  keys: Record<K, SortKey>,
  s: Sorting<K>,
  fallback: K,
) => ({
  sort: s.key === fallback ? undefined : s.key,
  dir: flipped(keys, s) ? s.dir : undefined,
})
