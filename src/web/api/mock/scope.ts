import { searchScope, type ScopeUsage } from '@domain/scope-search'
import type { Term } from '@domain/vocabulary'
import type { ScopeSearch, ScopeSearchInput } from '../client'
import type { Fact, ScopeTerm } from '@/model/items'
import { markets, metrics } from './data/world'

/*
  The "Applies to" picker's search over the demo world, by the service's own rule
  (src/domain/scope-search.ts): the metrics, and the dimensions with their values as the demo
  install seeds them (db/seed/fixtures/reference-data.ts), the 2,400 invented campaigns included,
  so the picker meets a dimension too large to list in the mock as it does on the service.
*/

/** A name as a key's id: "First-time buyers" is `first_time_buyers`. */
const idOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** The other names the demo gives a market. */
const marketAliases: Record<string, string[]> = {
  Norway: ['Norge'],
  Spain: ['Espana'],
  Poland: ['Polska'],
  Germany: ['Deutschland'],
  'United Kingdom': ['Great Britain', 'UK'],
  'United States': ['USA', 'United States of America'],
}

const campaignEvents = [
  'Spring Sale',
  'Summer Trail',
  'Autumn Gear Up',
  'Winter Warmth',
  'Black Friday',
  'Festival Season',
  'Late Night Sale',
  'New Season',
  'Clearance',
  'Welcome Back',
]
const campaignFormats = ['Search', 'Social', 'Video', 'Display', 'Email']
const campaignYears = [2023, 2024, 2025, 2026]
const campaigns = markets.flatMap((market) =>
  campaignEvents.flatMap((event) =>
    campaignYears.flatMap((year) =>
      campaignFormats.map((format) => `${market} ${event} ${year} ${format}`),
    ),
  ),
)

const dimensions: { name: string; values: string[]; aliases?: Record<string, string[]> }[] = [
  { name: 'Market', values: markets, aliases: marketAliases },
  { name: 'Product', values: ['Footwear', 'Clothing', 'Camping', 'Climbing'] },
  { name: 'Channel', values: ['Marketplace', 'Paid search', 'Email', 'Organic'] },
  { name: 'Platform', values: ['Web', 'iOS', 'Android'] },
  { name: 'Campaign', values: campaigns },
]

const term = (
  key: string,
  kind: Term['kind'],
  name: string,
  parentKey: string | null = null,
  aliases: string[] = [],
): Term => ({ key, kind, name, aliases, parentKey, areaId: null, definitionRefs: [] })

/** The demo's vocabulary as the service's terms. */
const terms: Term[] = [
  ...metrics.map((m) => term(`metric:${idOf(m.name)}`, 'metric', m.name)),
  ...dimensions.flatMap((d) => {
    const key = `dim:${idOf(d.name)}`
    return [
      term(key, 'dimension', d.name),
      ...d.values.map((v) =>
        term(`val:${idOf(d.name)}/${idOf(v)}`, 'dimension_value', v, key, d.aliases?.[v] ?? []),
      ),
    ]
  }),
]
const byKey = new Map(terms.map((t) => [t.key, t]))

/** A term as "Applies to" holds it. */
function scopeTermOf(t: Term): ScopeTerm {
  if (t.kind === 'metric') return { key: t.key, kind: 'metric', name: t.name }
  if (t.kind === 'dimension') return { key: t.key, kind: 'dimension', name: t.name }
  return {
    key: t.key,
    kind: 'value',
    name: t.name,
    dimension: byKey.get(t.parentKey ?? '')?.name ?? '',
  }
}

/**
 * The scope of a demo item, whose fixtures name it in words: a metric, a dimension or a market by
 * its name. A word the vocabulary does not hold is left out.
 */
export function scopeOfWhere(where: readonly string[]): ScopeTerm[] {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  return where.flatMap((name) => {
    const found =
      terms.find((t) => t.kind !== 'dimension_value' && same(t.name, name)) ??
      terms.find((t) => t.parentKey === 'dim:market' && same(t.name, name))
    return found ? [scopeTermOf(found)] : []
  })
}

/** An item with its scope by key. */
export const withScope = (fact: Fact): Fact =>
  fact.scope ? fact : { ...fact, scope: scopeOfWhere(fact.where) }

/** The demo's search: the person's recent terms are those they published or suggested this visit. */
export function createScopeSearch() {
  let recent: string[] = []
  return {
    /** Remembers the terms of a scope the person just published or suggested, newest first. */
    used(scope: readonly ScopeTerm[] | undefined) {
      const keys = (scope ?? []).map((t) => t.key)
      recent = [...keys, ...recent.filter((k) => !keys.includes(k))].slice(0, 20)
    },
    search(input: ScopeSearchInput, facts: readonly Fact[]): ScopeSearch {
      const uses: Record<string, number> = {}
      for (const fact of facts) {
        if (fact.status === 'Draft' || fact.status === 'Archived') continue
        const keys = new Set(
          withScope(fact).scope!.flatMap((t) =>
            t.kind === 'value' ? [t.key, `dim:${t.key.slice(4, t.key.indexOf('/'))}`] : [t.key],
          ),
        )
        for (const key of keys) uses[key] = (uses[key] ?? 0) + 1
      }
      const usage: ScopeUsage = { recent, uses }
      return searchScope(terms, usage, {
        query: input.q,
        ...(input.dimension === undefined ? {} : { dimension: input.dimension }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      })
    },
  }
}
