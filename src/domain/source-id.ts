/**
 * The id of a source an administrator adds, from its name: `Cube in Git` is `cube-in-git`, and
 * one already taken gets `-2`, `-3` and so on. It never changes once the source exists: its
 * definitions, reads and page address keep it.
 */
export function sourceIdFrom(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = (/^[a-z]/.test(slug) ? slug : `source-${slug}`).slice(0, 34).replace(/-+$/, '')
  const start = base.length >= 2 ? base : 'source'
  for (let n = 1; ; n++) {
    const id = n === 1 ? start : `${start}-${n}`
    if (!taken.has(id)) return id
  }
}

/** Ids no added source may take: the server's own sources' and the API's own path words. */
export const reservedSourceIds: readonly string[] = [
  'cube',
  'demo',
  'types',
  'test',
  'flags',
  'stale-links',
]
