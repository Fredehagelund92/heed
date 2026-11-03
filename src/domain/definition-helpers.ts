import { contentDigest } from './canonical.ts'

/*
  What every definitions connector does the same way, as pure functions it imports: the other
  names a tool lists, a description cut to its copy, a domain read through the source's domain
  names, and the change mark of a meaning (docs/connectors/authoring.md, "Mapping rules"). Cube,
  the static list and the template use them, so a new connector gets these rules by calling them,
  not by writing them again.
*/

/** The most other names Heed keeps for one definition: as many as a term may have (FR-107). */
export const SYNONYMS_MAX = 20
/** The longest other name Heed keeps, in characters. */
export const SYNONYM_LENGTH_MAX = 200
/** The longest description copy, in characters (CON-207). */
export const DESCRIPTION_COPY_MAX = 500

/** A Heed domain id: what a domain hint must be. */
export const domainIdPattern = /^[a-z][a-z0-9_]{1,39}$/

/**
 * The other names a tool lists for a definition (Cube's `meta.synonyms`), trimmed, with inner
 * spaces made one, each once whatever its case, at most as many as a term may have. Anything
 * else there (a number, an empty or overlong name) is left out.
 */
export function synonymsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().replace(/\s+/g, ' ')
    if (!name || Array.from(name).length > SYNONYM_LENGTH_MAX || seen.has(name.toLowerCase()))
      continue
    seen.add(name.toLowerCase())
    names.push(name)
  }
  return names.slice(0, SYNONYMS_MAX)
}

/**
 * A description as Heed keeps it: its first 500 characters, as a copy, and whether it was cut,
 * so the connector warns that it was (its own `description_cut`). Null for none or an empty one.
 */
export function descriptionCopy(text: string | null | undefined): {
  copy: string | null
  cut: boolean
} {
  if (!text) return { copy: null, cut: false }
  const characters = Array.from(text)
  return {
    copy: characters.slice(0, DESCRIPTION_COPY_MAX).join(''),
    cut: characters.length > DESCRIPTION_COPY_MAX,
  }
}

/**
 * The domain a definition's own value names, read through the source's domain names (CON-206):
 * a hint when it is a domain id, nothing when the tool names none, and nothing, said as
 * `invalid`, when it names something that is not a domain id. The connector warns
 * `invalid_domain` on an invalid one; it never guesses a domain.
 */
export function domainHint(
  value: unknown,
  domainNames: Readonly<Record<string, string>> = {},
): { areaHint: string | null; domainSource: 'source' | 'none'; invalid: boolean } {
  if (value === undefined || value === null)
    return { areaHint: null, domainSource: 'none', invalid: false }
  const domain =
    typeof value === 'string' && Object.hasOwn(domainNames, value) ? domainNames[value] : value
  return typeof domain === 'string' && domainIdPattern.test(domain)
    ? { areaHint: domain, domainSource: 'source', invalid: false }
    : { areaHint: null, domainSource: 'none', invalid: true }
}

/** True for a value that says nothing: null, false, an empty text, list or object. */
const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === false ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && Object.keys(value).length === 0)

/**
 * A meaning without the parts that say nothing: every key whose value is null, false, an empty
 * text, list or object, at every depth, so two shapes of the same meaning (a key absent in one,
 * null or empty in the other) are the same. A list keeps its order and its entries.
 */
export function withoutEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEmpty)
  if (typeof value !== 'object' || value === null) return value
  const kept: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const normal = withoutEmpty(entry)
    if (!isEmpty(normal)) kept[key] = normal
  }
  return kept
}

/**
 * The change mark of a definition: the SHA-256 of its meaning as canonical JSON, keys in order,
 * with the parts that say nothing left out (`withoutEmpty`). Put in what it means (its
 * calculation, with the meanings of the records it is built from, its type, title and
 * description); leave out its domain, its other names, its file and anything that names where
 * the tool was built. `keepEmpty` hashes the meaning as it is: for a connector whose marks were
 * first computed that way, so they stay as they were without a `markVersion` bump.
 */
export function meaningMark(
  meaning: unknown,
  options: { keepEmpty?: boolean } = {},
): Promise<string> {
  return contentDigest(options.keepEmpty ? meaning : withoutEmpty(meaning))
}
