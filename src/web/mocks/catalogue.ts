import {
  agreedDomain,
  catalogueStatus,
  definitionState,
  modelFileAddress,
  scopeNames,
  shelfOf,
  speakingDefinition,
  termDomain,
  type CatalogueTermKind,
} from '../../domain/catalogue.ts'
import type { ContextItem, Vocabulary } from '../../domain/item.ts'
import type {
  Catalogue,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueTerm,
  CatalogueTermDetail,
} from '../../contract/index.ts'
import {
  DEMO_MODEL_URL,
  DEMO_PREVIOUS_READ_AT,
  DEMO_READ_AT,
  DEMO_SOURCE_VERSION,
  changedDefinitions,
  definitionRefsOf,
  demoDefinitions,
  termAreas,
} from './cube-model.ts'
import { mentions } from './links.ts'

/** The demo model's connector and its newest read, as the bulk seed stores them. */
const source: CatalogueSource = {
  id: 'cube',
  name: 'Cube local model',
  tool: 'Cube',
  readAt: DEMO_READ_AT,
  sourceVersion: DEMO_SOURCE_VERSION,
  failing: false,
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')

/**
 * The catalogue (FR-136) over the fixtures, by the rules the service uses (src/domain/catalogue.ts):
 * the vocabulary, the demo Cube read the bulk seed stores, and the items. `gone` lists the
 * definitions the newest read no longer lists (a mock scenario: the demo model lists them all).
 * `modelUrl` is the `sources.cube_model_url` setting, on as the bulk seed sets it. `termRefs` gives
 * the definitions each term names, every view's member of a dimension's name by default.
 */
export function mockCatalogue(
  items: readonly ContextItem[],
  {
    vocabulary,
    today,
    gone = [],
    modelUrl = DEMO_MODEL_URL,
    termRefs = definitionRefsOf,
  }: {
    vocabulary: Vocabulary
    today: string
    gone?: readonly string[]
    modelUrl?: string | null
    termRefs?: (term: { key: string; group?: string }) => string[]
  },
) {
  const definitions = new Map(demoDefinitions.map((definition) => [definition.ref, definition]))
  // Counted as `items.list` with `mentions` counts them: accepted and retired items alike.
  const mentionedBy = (key: string) => items.filter((item) => mentions(item, key)).length

  function definitionOf(ref: string): CatalogueDefinition | null {
    const stored = definitions.get(ref)
    if (!stored) return null
    const changed = changedDefinitions[ref]
    const itemsWithOlderMark = items.filter(
      (item) =>
        item.status === 'accepted' &&
        ref in item.changeMarks &&
        item.changeMarks[ref] !== stored.changeMark,
    ).length
    const missing = gone.includes(ref)
    return {
      ref,
      name: stored.name,
      title: stored.title,
      descriptionCopy: stored.descriptionCopy,
      valueType: stored.valueType,
      state: definitionState({
        missing,
        changedSinceFirstRead: changed !== undefined,
        itemsWithOlderMark,
      }),
      renamedTo: null,
      changedAt: changed?.changedAt ?? null,
      // A definition the newest read no longer lists keeps the copy of the read before it.
      readAt: missing ? DEMO_PREVIOUS_READ_AT : DEMO_READ_AT,
      sourceId: source.id,
      tool: source.tool,
    }
  }

  const modelFileOf = (term: CatalogueTerm) =>
    modelFileAddress(
      modelUrl,
      (term.definition && definitions.get(term.definition.ref)?.modelFile) ?? null,
    )

  function term(
    key: string,
    name: string,
    group: { key: string; name: string } | null,
  ): CatalogueTerm {
    const refs = termRefs({ key, group: group?.name })
    const listed = refs.flatMap((ref) => definitionOf(ref) ?? [])
    const definition = speakingDefinition(listed)
    const shelf = shelfOf(items, scopeNames(key), today)
    return {
      key,
      kind: key.startsWith('metric:') ? 'metric' : 'dimension',
      id: key.slice(key.indexOf(':') + 1),
      name,
      // The fixture vocabulary gives metrics and dimensions no other names.
      aliases: [],
      group,
      domain: termDomain(
        termAreas[key] ?? null,
        agreedDomain(refs.map((ref) => definitions.get(ref)?.areaHint ?? null)),
      ),
      definition,
      definitions: listed,
      status: catalogueStatus(definition, shelf),
      // The fixtures hold no gaps.
      shelf: { ...shelf, gaps: 0, mentionedBy: mentionedBy(key) },
    }
  }

  const metrics = () =>
    [...vocabulary.metrics].sort(byName).map((metric) =>
      term(`metric:${metric.id}`, metric.name, {
        key: `group:${metric.group.toLowerCase()}`,
        name: metric.group,
      }),
    )
  const dimensions = () =>
    [...vocabulary.dimensions]
      .sort(byName)
      .map((dimension) => term(`dim:${dimension.id}`, dimension.name, null))

  return {
    list(): Catalogue {
      const listed = metrics()
      return {
        terms: [...listed, ...dimensions()],
        sources: [source],
        coverage: {
          metrics: listed.length,
          withoutDomain: listed.filter((metric) => metric.domain.areaId === null).length,
        },
        today,
      }
    },

    get(kind: CatalogueTermKind, id: string): CatalogueTermDetail | null {
      if (kind === 'metric') {
        const found = metrics().find((metric) => metric.id === id)
        return found ? { ...found, values: [], source, modelFile: modelFileOf(found), today } : null
      }
      const dimension = vocabulary.dimensions.find((candidate) => candidate.id === id)
      if (!dimension) return null
      const key = `dim:${id}`
      const found = term(key, dimension.name, null)
      return {
        ...found,
        values: [...dimension.values].sort(byName).map((value) => {
          const valueKey = `val:${id}/${value.id}`
          return {
            key: valueKey,
            id: value.id,
            name: value.name,
            aliases: value.aliases,
            items: shelfOf(items, scopeNames(valueKey), today).items,
            mentionedBy: mentionedBy(valueKey),
          }
        }),
        source,
        modelFile: modelFileOf(found),
        today,
      }
    },
  }
}
