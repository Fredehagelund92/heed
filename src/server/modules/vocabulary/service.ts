import type { Vocabulary } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'

/** The vocabulary of the live edition, in the front end's shape, each list by name. */
export interface VocabularyService {
  get(): Promise<Vocabulary>
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

export function createVocabularyService(database: Queryable): VocabularyService {
  const terms = () =>
    database.query<Term>(
      `select key, kind::text as kind, parent_key, name, aliases
         from serving_vocabulary((select seq from live_edition))`,
    )
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
  }
}
