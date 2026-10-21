import { scopeNames } from '@domain/catalogue'
import type { Area, ItemKind } from '@domain/item'
import type { CatalogueSource, CatalogueTermDetail } from '@/api'
import { ANY_SOURCE_TOOL } from '@/lib/catalogue'
import { formatCount, formatDay, formatMoment, type LibraryRow } from '@/lib/library'
import type { LibrarySearch } from '@/lib/search-params'
import { productName } from '@/lib/brand'

/**
 * The metric page's rules (design contract 5, "The catalogue", the term page; FR-136): the copy
 * of its header, its note line and its On the shelf card, and the rows it takes from the library
 * index. Pure, so the page, the stories and the tests share one answer. Heed shows a copy of the
 * source's description and keeps no formula (CON-207).
 */

/** The parts of a term page (the header shows on every one). Overview is the default. */
export const termTabs = ['overview', 'context', 'source'] as const
export type TermTab = (typeof termTabs)[number]

/**
 * The tool a term's definition comes from, as people say it ("Cube"), for the words on screen:
 * the source names it (CON-101: no vendor is named in the code). "the source" when the term
 * names no definition.
 */
export function termTool(term: Pick<CatalogueTermDetail, 'definition' | 'source'>): string {
  return term.definition?.tool ?? term.source?.tool ?? ANY_SOURCE_TOOL
}

/** The kinds in the order the shelf draws them: what happened first, then what to know and do. */
export const shelfKinds: readonly ItemKind[] = ['event', 'note', 'guide', 'example', 'issue']

const kindPlural: Record<ItemKind, [string, string]> = {
  event: ['event', 'events'],
  note: ['note', 'notes'],
  guide: ['guide', 'guides'],
  example: ['example', 'examples'],
  issue: ['issue', 'issues'],
}

/** "1 event", "28 events". */
export function kindCountText(kind: ItemKind, count: number): string {
  const [one, many] = kindPlural[kind]
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`
}

/** The kinds the shelf holds, in the shelf's order, without the empty ones. */
export function kindSegments(
  byKind: Record<ItemKind, number>,
): { kind: ItemKind; count: number }[] {
  return shelfKinds.flatMap((kind) => (byKind[kind] > 0 ? [{ kind, count: byKind[kind] }] : []))
}

/**
 * The one sentence under the shelf's bar: the newest change, how many have ended and how many
 * need a look. Null when the shelf is empty, which the card says in its own words.
 */
export function shelfSentence(shelf: CatalogueTermDetail['shelf']): string | null {
  if (shelf.items === 0) return null
  const parts: string[] = []
  if (shelf.lastUpdated) parts.push(`Newest change ${formatDay(shelf.lastUpdated)}.`)
  if (shelf.ended > 0)
    parts.push(
      `${shelf.ended.toLocaleString('en')} ${shelf.ended === 1 ? 'has' : 'have'} ended, and agents still get ${
        shelf.ended === 1 ? 'it' : 'them'
      } for ${shelf.ended === 1 ? 'its' : 'their'} period.`,
    )
  if (shelf.needsALook > 0)
    parts.push(
      `${shelf.needsALook.toLocaleString('en')} ${shelf.needsALook === 1 ? 'needs' : 'need'} checking.`,
    )
  return parts.length > 0 ? parts.join(' ') : null
}

/** The library list of a term: its accepted items, ended issues included, as the shelf counts them. */
export function termListSearch(term: Pick<CatalogueTermDetail, 'id'>): LibrarySearch {
  return { about: term.id, ended: 'show' }
}

/** The library rows about a term that the shelf counts: accepted items whose scope names it. */
export function shelfRows(rows: readonly LibraryRow[], key: string): LibraryRow[] {
  const names = scopeNames(key)
  return rows.filter((row) => row.status === 'accepted' && names(row))
}

/** The issues about a term that still apply, newest first. */
export function activeIssueRows(rows: readonly LibraryRow[], key: string): LibraryRow[] {
  return shelfRows(rows, key)
    .filter((row) => row.displayStatus === 'active_issue')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}

/** The newest items on the shelf, for the Context tab: newest change first. */
export function newestRows(rows: readonly LibraryRow[], key: string, limit: number): LibraryRow[] {
  return shelfRows(rows, key)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export type UsedWith = {
  /** `market:poland`, the library's `about` value for it. */
  about: string
  dimension: string
  value: string
  count: number
}

/**
 * The dimension values that items about a term also name ("Often used with"): most items first,
 * then by name. Names come from the library rows, which resolved them from the vocabulary.
 */
export function usedWith(
  rows: readonly LibraryRow[],
  key: string,
  dimensionName: (id: string) => string,
  limit = 8,
): UsedWith[] {
  const counts = new Map<string, UsedWith>()
  for (const row of shelfRows(rows, key)) {
    const count = (about: string, dimension: string, value: string) => {
      const entry = counts.get(about) ?? {
        about,
        dimension: dimensionName(dimension),
        value,
        count: 0,
      }
      entry.count += 1
      counts.set(about, entry)
    }
    // `about` lists the metrics first, then the values in scope order.
    row.scope.dimensionValues.forEach(({ dimension, value }, index) =>
      count(
        `${dimension}:${value}`,
        dimension,
        row.about[row.scope.metrics.length + index] ?? value,
      ),
    )
    for (const dimension of row.scope.dimensions) count(`${dimension}:*`, dimension, 'any value')
  }
  return [...counts.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.dimension.localeCompare(b.dimension, 'en') ||
        a.value.localeCompare(b.value, 'en'),
    )
    .slice(0, limit)
}

/**
 * Who acts for a term: the owners of its domain, the first named by name in sentences and the
 * rest beside it.
 */
export type TermOwner = {
  area: Area | null
  person: { name: string; initials: string } | null
  /** The domain's other owners, who decide its terms as well. */
  others: { name: string; initials: string }[]
}

/**
 * "Jon Abara, who owns Commercial," as the subject of a sentence (the closing comma ends the
 * apposition), or the role alone when nobody is named.
 */
export function ownerText({ area, person }: TermOwner): string {
  if (person && area) return `${person.name}, who owns ${area.name},`
  if (area) return `the owner of ${area.name}`
  return 'an owner'
}

/**
 * The names in the source, one per view that has the term ("segments.market",
 * "payments.market"): for people who query the source themselves.
 */
export function sourceNames(term: Pick<CatalogueTermDetail, 'definitions'>): string[] {
  return term.definitions.map((definition) => definition.name)
}

/** A short form of the model version: a Git tag stays whole, a digest keeps its first 12. */
export function shortVersion(version: string): string {
  return /^[0-9a-f]{40,}$/.test(version) ? version.slice(0, 12) : version
}

export type ReadChip = {
  /** "Copy read 7 Oct 2026". */
  label: string
  /** The newest read of the source failed: the copy is older than it should be (CON-213). */
  failing: boolean
  /** The lines the chip opens. */
  title: string
  line: string
}

/**
 * The chip that ends the badge row: when Heed last read the definition from the source, the
 * term's own date the way an item's validity chip is its period. It opens one detail line: the
 * name in the source and what Heed keeps. Null for a term that names no definition.
 */
export function readChip(term: CatalogueTermDetail): ReadChip | null {
  const { definition, source } = term
  if (!definition) return null
  const tool = termTool(term)
  const readAt = definition.readAt ?? source?.readAt ?? null
  const failing = source?.failing === true
  const label = readAt ? `Copy read ${formatDay(readAt)}` : 'Not read yet'
  const version = source?.sourceVersion
    ? `, model version ${shortVersion(source.sourceVersion)}`
    : ''
  const read = readAt ? `It was last read on ${formatMoment(readAt, 'long')}${version}.` : ''
  const line = failing
    ? `The newest read of ${tool} failed, so this is the last copy ${productName} kept. ${read}`
    : definition.state === 'missing'
      ? `${tool} no longer lists it. This is the last copy ${productName} kept. ${read}`
      : `${productName} shows a copy of ${tool}'s description, refreshed at every read, and keeps no formula. ${read}`
  return {
    label,
    failing,
    title: `From ${tool}`,
    line: line.trim(),
  }
}

export type TermNote =
  | { kind: 'gone'; text: string }
  | { kind: 'changed'; text: string }
  | {
      kind: 'issue'
      /** The one issue, linked by its title; null when there are several. */
      issue: { id: string; title: string } | null
      count: number
      lead: string
      tail: string
    }

/**
 * The one note line under the title while something asks for a look (the item page's note
 * line, contract 5): what agents do now and who acts. Most urgent first, as the status badge:
 * the definition is gone from the source, it changed there, or issues about the term apply.
 */
export function termNote(
  term: CatalogueTermDetail,
  context: { owner: TermOwner; issues: readonly LibraryRow[] },
): TermNote | null {
  const { definition, shelf, name } = term
  const tool = termTool(term)
  const who = ownerText(context.owner)
  const facts = formatCount(shelf.items, 'fact')
  if (definition?.state === 'missing') {
    const renamed = definition.renamedTo ? ` ${tool} names ${definition.renamedTo} instead.` : ''
    const agents =
      shelf.items > 0
        ? ` Agents are told the ${facts} about ${name} may be out of date until ${who} checks them.`
        : ` ${who.charAt(0).toUpperCase()}${who.slice(1)} decides what replaces it.`
    return {
      kind: 'gone',
      text: `${tool} no longer lists ${definition.name}.${renamed}${agents}`,
    }
  }
  if (definition?.state === 'changed') {
    const when = definition.changedAt ? ` on ${formatDay(definition.changedAt)}` : ''
    return {
      kind: 'changed',
      text: `${tool} changed ${definition.name}${when}. Agents are told the facts written before the change may be out of date until ${who} checks them.`,
    }
  }
  const issues = context.issues
  if (shelf.activeIssues > 0 && issues.length > 0) {
    const [only] = issues
    const one = issues.length === 1 && only
    return {
      kind: 'issue',
      issue: one ? { id: only.id, title: only.title } : null,
      count: issues.length,
      lead: one ? 'Agents warn about ' : `Agents warn about ${issues.length} active issues `,
      tail: `in answers that touch ${name}${
        one && only.until ? `, until ${formatDay(only.until)}` : ''
      }.`,
    }
  }
  return null
}

/** What the Source tab says about the source of the definition: the state and its last read. */
export function sourceStateText(term: CatalogueTermDetail, source: CatalogueSource | null) {
  const { definition } = term
  const tool = termTool(term)
  if (!definition) return `It names no definition, so ${productName} has no description to show.`
  const readAt = definition.readAt ?? source?.readAt ?? null
  const read = readAt ? formatDay(readAt) : null
  const model = source?.sourceVersion ? `, model version ${shortVersion(source.sourceVersion)}` : ''
  const names = term.definitions.length
  const one = names > 1 ? ` ${names} ${tool} names, one ${term.kind} in ${productName}.` : ''
  if (definition.state === 'missing')
    return `The newest read of ${tool} no longer lists ${names > 1 ? definition.name : 'it'}.${read ? ` The copy here is from ${read}.` : ''}`
  if (source?.failing)
    return `The newest read of ${tool} failed. The copy here is from ${read ?? 'an earlier read'}${model}.`
  return read ? `Read from ${tool} on ${read}${model}.${one}` : `Not read from ${tool} yet.`
}

/** Where a term's domain comes from, for the Domain row. */
export function domainSourceText(term: CatalogueTermDetail): string {
  const tool = termTool(term)
  switch (term.domain.source) {
    case 'vocabulary':
      return `Set in the vocabulary's domain map, which wins over the domain ${tool} gives.`
    case 'source':
      return `Read from the domain its view names in ${tool}. ${productName} does not change it.`
    case 'none':
      return term.kind === 'dimension'
        ? term.definitions.length > 1
          ? `Shared: ${tool} has it in views of more than one domain, or of none, so it belongs to no one domain.`
          : 'A dimension applies to every domain.'
        : `${tool} gives no domain for its view, and the vocabulary maps it to none.`
  }
}

/** "Number", "String": the value type the source gives, as a word. */
export function valueTypeText(valueType: string | null): string | null {
  if (!valueType) return null
  return valueType.charAt(0).toUpperCase() + valueType.slice(1)
}
