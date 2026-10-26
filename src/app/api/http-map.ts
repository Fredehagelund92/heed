/**
 * The http binding's reading of the service's answers into the shapes the screens read: the
 * library index into context items, the catalogue into definitions, and search everywhere into
 * its groups. Pure, so the rules are tested without a service.
 */
import type { CatalogueTerm, LibraryItem, SearchResults } from '@contract/index'
import type { Definition } from '@/lib/definitions'
import type { Fact, Kind, Status } from '@/model/items'
import { dateLabel, whenLabel, type Validity } from '@/model/validity'
import type { SearchHits } from './client'

/** Who the answers name by id: people and the owners of each domain. */
export type Names = {
  person: (id: string) => string
  domainOwners: (areaId: string) => string[]
}

/** The service's `example` kind, which the app does not offer, is left out of its lists. */
const offered = <T extends { kind: string }>(row: T): row is T & { kind: Kind } =>
  row.kind !== 'example'

/** A row's status in the app's words: retired is Archived; accepted is Live, or Needs checking when its trust says so. */
export function statusOf(row: Pick<LibraryItem, 'status' | 'trust'>): Status {
  if (row.status === 'retired') return 'Archived'
  return row.trust === 'needs_check' ? 'Needs checking' : 'Live'
}

/** The service's dates (an open end, and an issue that is still going on) as the app's. */
export function validityOf(row: Pick<LibraryItem, 'validity' | 'reviewQuestion'>): Validity {
  return {
    from: row.validity.start,
    ...(row.validity.end ? { until: row.validity.end } : {}),
    ...(row.reviewQuestion === 'still_going_on' ? { ongoing: true } : {}),
  }
}

/**
 * The library index as context items. The index carries no text, source or quote: an item's page
 * reads those. Its owner shows only when they are not one of the domain's owners.
 */
export function factsOf(rows: readonly LibraryItem[], names: Names): Fact[] {
  return rows.filter(offered).map((row) => {
    const valid = validityOf(row)
    const owner = names.person(row.ownerId)
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      domain: row.areaId,
      kind: row.kind,
      where: row.chips,
      valid,
      when: whenLabel(valid),
      status: statusOf(row),
      checkedBy: row.lastChecked ? names.person(row.lastChecked.personId) : '',
      checkedOn: row.lastChecked ? dateLabel(row.lastChecked.on) : '',
      source: '',
      quote: '',
      dontConclude: '',
      ...(names.domainOwners(row.areaId).includes(owner) ? {} : { owners: [owner] }),
    }
  })
}

/** The catalogue's metrics and dimensions as definitions: synced from the source, read-only here. */
export function definitionsOf(terms: readonly CatalogueTerm[]): Definition[] {
  return terms.map((term) => ({
    name: term.name,
    type: term.kind,
    definition: term.definition?.descriptionCopy ?? '',
    synced: true,
    ...(term.definition ? { tool: term.definition.tool } : {}),
    sourceNames: [...new Set(term.aliases)],
    ...(term.domain.areaId ? { domain: term.domain.areaId } : {}),
    ...(term.group ? { group: term.group.name } : {}),
    ...(term.definition?.changedAt
      ? { changed: dateLabel(term.definition.changedAt.slice(0, 10)) }
      : {}),
    updated: term.shelf.lastUpdated ? dateLabel(term.shelf.lastUpdated.slice(0, 10)) : '',
  }))
}

/** Search everywhere's groups in the app's words. */
export function hitsOf(results: SearchResults): SearchHits {
  return {
    items: results.items
      .filter(offered)
      .map((row) => ({ id: row.id, title: row.title, kind: row.kind, domain: row.areaId })),
    definitions: results.definitions.map((d) => ({
      name: d.name,
      type: d.kind,
      sourceNames: [...new Set(d.aliases)],
    })),
    domains: results.domains,
    people: results.people.map((p) => ({ name: p.name })),
  }
}
