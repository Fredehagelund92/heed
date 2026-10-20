import type { Area, ItemKind, Person, Vocabulary } from '@domain/item'
import { itemDisplayStatus, lastValidDay, needsALook, type ItemDisplayStatus } from '@domain/status'
import type { LibraryIndex, LibraryItem } from '@/api'

/*
  The parts of the library's row model that the app's first load needs: the rows and how they
  are built, the views, the kinds' names, the sorts and groups the address's search params name,
  and the sidebar's count beside Needs a look. Part of lib/library.ts, which re-exports it; kept
  apart only so the first load does not carry the list's filters, search, sorting and words.
*/

export type LibraryRow = LibraryItem & {
  displayStatus: ItemDisplayStatus
  areaName: string
  areaLabel: Area['label']
  ownerName: string
  ownerInitials: string
  /** Where it applies, as names: metrics first, then dimension values. */
  about: string[]
  /** The last day it applies (inclusive), or null when it is ongoing. */
  until: string | null
}

/**
 * Who reads the library, for the views that depend on the person: Mine, and Needs a look, which
 * starts with the domains the person looks after (heed-ux A8).
 */
export type LibraryViewer = {
  personId: string | undefined
  /** The domains the person is owner or deputy of. */
  areaIds: readonly string[]
  /** An owner, deputy or administrator: someone who can act on what needs a look. */
  maintains: boolean
}

export type LibraryContext = {
  areas: Area[]
  people: Person[]
  vocabulary: Vocabulary
}

/** The built-in views. They live in the sidebar under the library, like views in Linear. */
export const libraryViews = [
  { id: 'all', title: 'All facts', hint: 'Every fact you can read' },
  { id: 'mine', title: 'Mine', hint: 'Facts you wrote or own' },
  {
    id: 'attention',
    title: 'Needs checking',
    hint: 'The check date passed, or the source changed or is gone',
  },
] as const
export type LibraryViewId = (typeof libraryViews)[number]['id']

export const kindNames: Record<ItemKind, string> = {
  event: 'Event',
  note: 'Note',
  guide: 'Guide',
  example: 'Example',
  issue: 'Issue',
}

export const sortOptions = [
  { id: 'updated', title: 'Last checked', defaultDir: 'desc' },
  { id: 'title', title: 'Title', defaultDir: 'asc' },
  { id: 'start', title: 'Starts', defaultDir: 'desc' },
  { id: 'until', title: 'Ends', defaultDir: 'asc' },
  { id: 'status', title: 'Status', defaultDir: 'asc' },
  { id: 'domain', title: 'Domain', defaultDir: 'asc' },
  { id: 'owner', title: 'Owner', defaultDir: 'asc' },
] as const
export type LibrarySort = (typeof sortOptions)[number]['id']
export const librarySorts = sortOptions.map((option) => option.id) as [
  LibrarySort,
  ...LibrarySort[],
]

export const groupOptions = [
  { id: 'kind', title: 'Kind' },
  { id: 'domain', title: 'Domain' },
  { id: 'status', title: 'Status' },
  { id: 'owner', title: 'Owner' },
] as const
export type LibraryGroup = (typeof groupOptions)[number]['id']
export const libraryGroups = groupOptions.map((option) => option.id) as [
  LibraryGroup,
  ...LibraryGroup[],
]

/**
 * A dimension with any value, as people say it: "Any market". The first letter goes lower case
 * unless the name starts with an abbreviation ("Any UK region").
 */
export function anyValueWords(dimension: string): string {
  const lower = /^\p{Lu}\p{Ll}/u.test(dimension)
    ? dimension.charAt(0).toLowerCase() + dimension.slice(1)
    : dimension
  return `Any ${lower}`
}

/** The same inside a sentence: "It replaces any market." */
export const anyValueInSentence = (dimension: string) => `a${anyValueWords(dimension).slice(1)}`

/** Builds the rows once per index: names, the display status and the inclusive last day. */
export function buildRows(index: LibraryIndex, context: LibraryContext): LibraryRow[] {
  const areas = new Map(context.areas.map((area) => [area.id, area]))
  const people = new Map(context.people.map((person) => [person.id, person]))
  const metrics = new Map(context.vocabulary.metrics.map((metric) => [metric.id, metric.name]))
  const values = new Map(
    context.vocabulary.dimensions.flatMap((dimension) =>
      dimension.values.map((value) => [`${dimension.id}:${value.id}`, value.name] as const),
    ),
  )
  const dimensions = new Map(
    context.vocabulary.dimensions.map((dimension) => [dimension.id, dimension.name]),
  )
  return index.items.map((item) => {
    const area = areas.get(item.areaId)
    const owner = people.get(item.ownerId)
    return {
      ...item,
      displayStatus: itemDisplayStatus(item, index.today),
      areaName: area?.name ?? 'Unknown domain',
      areaLabel: area?.label ?? 'gray',
      ownerName: owner?.name ?? 'No owner',
      ownerInitials: owner?.initials ?? '?',
      about: [
        ...item.scope.metrics.map((id) => metrics.get(id) ?? id),
        ...item.scope.dimensionValues.map(
          ({ dimension, value }) => values.get(`${dimension}:${value}`) ?? value,
        ),
        // Last, so the names stay in step with `aboutKeys`.
        ...item.scope.dimensions.map((id) => anyValueWords(dimensions.get(id) ?? id)),
      ],
      until: item.validity.end === null ? null : lastValidDay(item.validity.end),
    }
  })
}

/**
 * Whether Needs a look shows only the person's domains: for an owner or deputy, until they ask
 * for every domain. Everyone else sees every domain.
 */
export function attentionInMyDomains(viewer: LibraryViewer, allDomains: boolean): boolean {
  return viewer.areaIds.length > 0 && !allDomains
}

export function inView(
  row: LibraryRow,
  view: LibraryViewId,
  viewer: LibraryViewer,
  allDomains = false,
) {
  if (view === 'mine') return row.ownerId === viewer.personId || row.proposerId === viewer.personId
  if (view === 'attention')
    return (
      needsALook(row.displayStatus) &&
      (!attentionInMyDomains(viewer, allDomains) || viewer.areaIds.includes(row.areaId))
    )
  return true
}

/**
 * The sidebar's count beside Needs a look: what the view shows when it opens, for the people who
 * can act on it. Null for everyone else, who still has the view but no count to chase (A8).
 */
export function needsALookCount(rows: LibraryRow[], viewer: LibraryViewer): number | null {
  if (!viewer.maintains || !rows.length) return null
  return rows.filter((row) => inView(row, 'attention', viewer)).length
}

/** An issue that still applies today: the one kind whose icon turns amber (Home rule 9). */
export function isLiveIssueRow(row: Pick<LibraryRow, 'kind' | 'displayStatus'>): boolean {
  return row.kind === 'issue' && row.displayStatus !== 'expired' && row.displayStatus !== 'retired'
}
