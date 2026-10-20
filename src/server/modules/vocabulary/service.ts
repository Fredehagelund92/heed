import type { Vocabulary } from '../../../domain/item.ts'
import {
  describeScope,
  matchScope,
  searchScope,
  type ScopeHit,
  type ScopeMatch,
  type ScopeSearch,
  type ScopeSearchInput,
  type ScopeUsage,
} from '../../../domain/scope-search.ts'
import type { Term as VocabularyTerm } from '../../../domain/vocabulary.ts'
import type { Queryable } from '../../db/database.ts'

/** The vocabulary of the live edition, in the front end's shape, each list by name. */
export interface VocabularyService {
  get(): Promise<Vocabulary>
  /** A page of terms for the scope picker, recent and often used first (FR-107). */
  search(input: ScopeSearchInput): Promise<ScopeSearch>
  /** A pasted list, matched name by name. */
  match(entries: readonly string[], dimension?: string): Promise<ScopeMatch>
  /** The chips of a scope; a key the live vocabulary no longer holds is left out. */
  describe(keys: readonly string[]): Promise<ScopeHit[]>
}

type Term = {
  key: string
  kind: 'metric' | 'dimension' | 'dimension_value' | 'metric_group'
  parent_key: string | null
  name: string
  aliases: string[]
}

/** The part of a key after its prefix: `metric:orders` is `orders`, `val:market/x` is `x`. */
const idOf = (key: string) =>
  key
    .slice(key.indexOf(':') + 1)
    .split('/')
    .pop() ?? key
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')
const RECENT_DRAFTS = 20

export function createVocabularyService(database: Queryable): VocabularyService {
  const terms = () =>
    database.query<Term>(
      `select key, kind::text as kind, parent_key, name, aliases
         from serving_vocabulary((select seq from live_edition))`,
    )
  const searchTerms = async (): Promise<VocabularyTerm[]> =>
    (await terms()).map((term) => ({
      key: term.key,
      kind: term.kind,
      name: term.name,
      aliases: term.aliases,
      parentKey: term.parent_key,
      areaId: null,
      definitionRefs: [],
    }))
  /**
   * The person's recent terms come from their own newest drafts (row security shows them only
   * their own), and the uses from the live edition: a dimension counts every item about it.
   */
  const usage = async (): Promise<ScopeUsage> => {
    // One after the other: a transaction's client runs one query at a time.
    const recent = await database.query<{ key: string }>(
      `with mine as (
           select p.draft -> 'scope' as scope, p.updated_at from proposals p
            where p.proposer_id = cl_person()
              and p.draft is not null and p.discarded_at is null
            order by p.updated_at desc limit ${RECENT_DRAFTS}),
         keys as (
           select k.key, m.updated_at from mine m,
             lateral (select jsonb_array_elements_text(coalesce(m.scope -> 'metrics', '[]')) as key
                      union all select jsonb_array_elements_text(coalesce(m.scope -> 'dimensions', '[]'))
                      union all select v ->> 'value' from jsonb_array_elements(coalesce(m.scope -> 'dimensionValues', '[]')) v) k)
         select key from keys group by key order by max(updated_at) desc`,
    )
    const uses = await database.query<{ key: string; uses: number }>(
      `select key, count(distinct item_id)::int as uses from (
           select s.item_id, unnest(s.metrics || s.value_keys || s.dimension_keys
                  || array(select 'dim:' || split_part(substr(v, 5), '/', 1) from unnest(s.value_keys) v)) as key
             from serving_items((select seq from live_edition)) s where cl_audience_allows(s.audience_groups)) k
          group by key`,
    )
    return {
      recent: recent.map((row) => row.key),
      uses: Object.fromEntries(uses.map((row) => [row.key, row.uses])),
    }
  }
  return {
    async get() {
      const rows = await terms()
      const byKey = new Map(rows.map((term) => [term.key, term]))
      const metrics = rows
        .filter((term) => term.kind === 'metric')
        .map((term) => ({
          id: idOf(term.key),
          name: term.name,
          group: (term.parent_key && byKey.get(term.parent_key)?.name) ?? '',
        }))
      const dimensions = rows
        .filter((term) => term.kind === 'dimension')
        .map((dimension) => ({
          id: idOf(dimension.key),
          name: dimension.name,
          values: rows
            .filter((term) => term.kind === 'dimension_value' && term.parent_key === dimension.key)
            .map((value) => ({ id: idOf(value.key), name: value.name, aliases: value.aliases }))
            .sort(byName),
        }))
      return { metrics: metrics.sort(byName), dimensions: dimensions.sort(byName) }
    },
    async search(input) {
      const vocabulary = await searchTerms()
      const used = await usage()
      return searchScope(vocabulary, used, input)
    },
    async match(entries, dimension) {
      const vocabulary = await searchTerms()
      const used = await usage()
      return matchScope(vocabulary, used, entries, dimension)
    },
    async describe(keys) {
      if (!keys.length) return []
      const vocabulary = await searchTerms()
      const used = await usage()
      return describeScope(vocabulary, used, keys)
    },
  }
}
