import type { ScopeHit, Vocabulary } from '@/api/client'
import type { ScopeTerm } from '@/model/items'

// "Applies to" (FR-107, FR-126): what an item applies to, each term by its vocabulary key. A
// dimension can be chosen on its own, as "any value", or by some of its values, never both.

/** A search hit as "Applies to" holds it. */
export function termOfHit(hit: ScopeHit): ScopeTerm {
  if (hit.kind === 'metric') return { key: hit.key, kind: 'metric', name: hit.name }
  if (hit.kind === 'dimension') return { key: hit.key, kind: 'dimension', name: hit.name }
  return { key: hit.key, kind: 'value', name: hit.name, dimension: hit.dimension?.name ?? '' }
}

/** A dimension with any value, as people read it: "Market: any value". */
export const anyValue = (dimension: string) => `${dimension}: any value`

/** A term in words, as its chip shows it: "Orders", "Market: any value", "Norway". */
export const termLabel = (t: ScopeTerm) => (t.kind === 'dimension' ? anyValue(t.name) : t.name)

/** A term in full words, its dimension named: "Channel: Email". For hints and screen readers. */
export const termWords = (t: ScopeTerm) =>
  t.kind === 'value' && t.dimension ? `${t.dimension}: ${t.name}` : termLabel(t)

/** The id of a value's dimension by its key: `val:market/norway` is `market`. */
export const dimensionIdOf = (key: string) =>
  key.startsWith('val:') ? key.slice(4, key.indexOf('/')) : key.replace(/^dim:/, '')

/** The same term: by key, or by name for a term known only by name. */
const same = (a: ScopeTerm, b: ScopeTerm) =>
  a.key || b.key ? a.key === b.key : a.kind === b.kind && a.name === b.name

/** Whether `terms` holds `t`. */
export const holds = (terms: readonly ScopeTerm[], t: ScopeTerm) => terms.some((x) => same(x, t))

/** Whether a term is a value of a dimension, or the dimension itself, by key or by name. */
function ofDimension(t: ScopeTerm, dimension: ScopeTerm) {
  if (t.kind !== 'value') return false
  return t.key && dimension.key
    ? dimensionIdOf(t.key) === dimensionIdOf(dimension.key)
    : t.dimension === dimension.name
}

/**
 * Adds a term, or takes it out when it is there. A dimension with any value replaces its values,
 * and a value replaces its dimension's "any value" (FR-126). Says what it replaced.
 */
export function toggleTerm(
  terms: readonly ScopeTerm[],
  t: ScopeTerm,
): { terms: ScopeTerm[]; removed: boolean; replaced: ScopeTerm[] } {
  if (holds(terms, t))
    return { terms: terms.filter((x) => !same(x, t)), removed: true, replaced: [] }
  const replaced = terms.filter((x) =>
    t.kind === 'dimension'
      ? ofDimension(x, t)
      : t.kind === 'value' && x.kind === 'dimension' && ofDimension(t, x),
  )
  return { terms: [...terms.filter((x) => !replaced.includes(x)), t], removed: false, replaced }
}

/**
 * Terms known only by their names, as older text and a few links give them ("Orders", "Norway"):
 * a metric, a dimension or a market by its name; any other word as a value of no known dimension.
 * The binding finds each by name when it saves.
 */
export function termsOfNames(names: readonly string[], vocabulary: Vocabulary): ScopeTerm[] {
  return names.map((name) =>
    vocabulary.metrics.some((m) => m.name === name)
      ? { key: '', kind: 'metric', name }
      : vocabulary.dimensions.some((d) => d.name === name)
        ? { key: '', kind: 'dimension', name }
        : vocabulary.markets.includes(name)
          ? { key: '', kind: 'value', name, dimension: 'Market' }
          : { key: '', kind: 'value', name },
  )
}
