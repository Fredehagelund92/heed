import {
  byName,
  dimensionOf,
  dimensionRows,
  valuePage,
  valueSearch,
  type Disclosed,
  type FilterTopic,
  type ObsTerm,
} from '@domain/obs-filters'
import type { Definition } from '@/lib/definitions'
import type { ObsData, Topic } from '@/model/observability'
import type { ObsDimensionList, ObsFilterView, ObsValueList, ObsValuesInput } from '../client'
import { termsOf } from './records'

// Overview's filter in the demo: the dimensions and their values counted for a view exactly as
// the service counts them (src/domain/obs-filters.ts), from the page's own topics after their
// disclosure pass (obs-page.ts), so a count here is only ever shown counts added up (FR-614).

/** What In the Inbox reads of a topic's gap, as the service keeps it. */
const gapOf = (t: Topic): FilterTopic['gap'] =>
  t.gap?.label === 'Draft ready'
    ? 'draft'
    : t.gap?.label === 'A suggestion waits'
      ? 'suggestion'
      : t.gap || t.in.notFound
        ? 'none'
        : null

/** A page's topics, subjects and domains as the filters count them. */
export function disclosedOf(page: ObsData): Disclosed {
  return {
    topics: page.topics.map((t) => ({
      id: t.id,
      domain: t.domain ?? null,
      subject: t.subject,
      month: t.month,
      metrics: t.metrics,
      values: t.values.map((v) => v.value),
      dimensions: t.dimensions.map((d) => d.dimension),
      answers: t.in.answers,
      notFound: t.in.notFound,
      reported: t.in.reported,
      gap: gapOf(t),
      total: t.total,
      atLeast: t.atLeast,
      counts: t.counts,
    })),
    subjects: page.subjects,
    domains: page.domains.map((d) => ({ ...d, domain: d.domain ?? null })),
  }
}

/**
 * The dimensions and values a filter offers: the definitions', and any other a topic of the page
 * names (a value a dimension's definition does not list, such as a campaign), by name.
 */
function termsFor(definitions: readonly Definition[], page: ObsData) {
  const terms = new Map<string, ObsTerm & { parent: string | null; kind: string }>()
  for (const t of termsOf(definitions))
    if (t.kind === 'dimension' || t.kind === 'dimension_value')
      terms.set(t.key, {
        key: t.key,
        name: t.name,
        aliases: t.aliases,
        parent: t.parentKey,
        kind: t.kind,
      })
  for (const t of page.topics) {
    for (const d of t.dimensions)
      if (!terms.has(d.dimension))
        terms.set(d.dimension, {
          key: d.dimension,
          name: d.name,
          aliases: [],
          parent: null,
          kind: 'dimension',
        })
    for (const v of t.values)
      if (!terms.has(v.value))
        terms.set(v.value, {
          key: v.value,
          name: v.name,
          aliases: [],
          parent: dimensionOf(v.value),
          kind: 'dimension_value',
        })
  }
  const list = [...terms.values()]
  const dimensions = list.filter((t) => t.kind === 'dimension').sort(byName)
  const valuesOf = new Map<string, ObsTerm[]>()
  for (const v of list.filter((t) => t.kind === 'dimension_value').sort(byName))
    if (v.parent) valuesOf.set(v.parent, [...(valuesOf.get(v.parent) ?? []), v])
  return { dimensions, valuesOf }
}

/** The filter's first step for a page: every dimension, the most asked about first. */
export function dimensionsOf(
  definitions: readonly Definition[],
  page: ObsData,
  input: ObsFilterView,
): Omit<ObsDimensionList, 'pinned'> {
  const terms = termsFor(definitions, page)
  if (page.state === 'empty' || page.state === 'quiet')
    return {
      state: page.state,
      dimensions: terms.dimensions.map((d) => ({
        key: d.key,
        name: d.name,
        values: terms.valuesOf.get(d.key)?.length ?? 0,
        asked: null,
      })),
    }
  return {
    state: page.state,
    dimensions: dimensionRows(disclosedOf(page), input.filters, terms.dimensions, terms.valuesOf),
  }
}

/** Its second step: one dimension's values a page at a time, or the words in every dimension. */
export function valuesOf(
  definitions: readonly Definition[],
  page: ObsData,
  input: ObsValuesInput,
): ObsValueList {
  if (page.state === 'empty' || page.state === 'quiet')
    return { state: page.state, groups: [], notAsked: 0, nextCursor: null }
  const terms = termsFor(definitions, page)
  const disclosed = disclosedOf(page)
  if (input.dimension) {
    const dimension = terms.dimensions.find((d) => d.key === input.dimension)
    if (!dimension) return { state: page.state, groups: [], notAsked: 0, nextCursor: null }
    const group = valuePage(
      disclosed,
      input.filters,
      dimension,
      terms.valuesOf.get(dimension.key) ?? [],
      input,
    )
    return { state: page.state, groups: [group], notAsked: group.notAsked, nextCursor: null }
  }
  return {
    state: page.state,
    ...valueSearch(disclosed, input.filters, terms.dimensions, terms.valuesOf, input),
  }
}
