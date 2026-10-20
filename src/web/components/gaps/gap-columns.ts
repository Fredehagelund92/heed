/**
 * The gap grid's columns and their budget (the Gaps page, direction A of the table design). The
 * topic always shows. When the container cannot fit every column, columns leave in a fixed order,
 * and below the smallest table the grid becomes the narrow row. The widths equal the
 * `--column-*` tokens in tokens.css; a test keeps them equal.
 *
 * Every column shows from a 1,216 container; at 1440 (a 1,184 container) Last seen has left.
 * Last seen leaves first, then Type, then Reports, then Domain, and below 768 the narrow row
 * takes over.
 */

export const gapColumnIds = [
  'type',
  'status',
  'domain',
  'reports',
  'noItemCalls',
  'lastSeen',
] as const
export type GapColumnId = (typeof gapColumnIds)[number]

/** The topic counts' columns: the week is the group, so it is not a column. */
export const topicColumnIds = ['domain', 'calls', 'noItemCalls', 'share'] as const
export type TopicColumnId = (typeof topicColumnIds)[number]

export type GapColumnSpec = {
  title: string
  /** Width in CSS pixels, equal to the token behind `widthClass`. */
  width: number
  widthClass: string
  numeric?: boolean
}

export const gapColumnSpecs: Record<GapColumnId, GapColumnSpec> = {
  type: { title: 'Type', width: 152, widthClass: 'w-column-gap-type' },
  status: { title: 'Status', width: 144, widthClass: 'w-column-gap-status' },
  domain: { title: 'Domain', width: 192, widthClass: 'w-column-domain' },
  reports: { title: 'Reports', width: 112, widthClass: 'w-column-count', numeric: true },
  noItemCalls: {
    title: 'Found nothing',
    width: 136,
    widthClass: 'w-column-count-wide',
    numeric: true,
  },
  lastSeen: { title: 'Last seen', width: 112, widthClass: 'w-column-seen', numeric: true },
}

export const topicColumnSpecs: Record<TopicColumnId, GapColumnSpec> = {
  domain: { title: 'Domain', width: 192, widthClass: 'w-column-domain' },
  calls: { title: 'Calls', width: 112, widthClass: 'w-column-count', numeric: true },
  noItemCalls: {
    title: 'Found nothing',
    width: 136,
    widthClass: 'w-column-count-wide',
    numeric: true,
  },
  share: { title: 'Share', width: 112, widthClass: 'w-column-count', numeric: true },
}

/** The topic's narrowest width: one line of about 40 characters, as on the Proposals page. */
export const GAP_TITLE_MIN_WIDTH = 320

/** Below this container width the grid is the narrow row (contract 8.5, the phone row). */
const NARROW_BELOW = 768

function fit<Id extends string>(
  ids: readonly Id[],
  specs: Record<Id, GapColumnSpec>,
  dropOrder: readonly Id[],
  containerWidth: number,
  gutter: number,
): { columns: Id[]; narrow: boolean } {
  const width = (columns: Id[]) =>
    gutter * 2 + GAP_TITLE_MIN_WIDTH + columns.reduce((sum, id) => sum + specs[id].width, 0)
  let columns = [...ids]
  for (const id of dropOrder) {
    if (width(columns) <= containerWidth) break
    columns = columns.filter((column) => column !== id)
  }
  return {
    columns,
    narrow: containerWidth < NARROW_BELOW || width(columns) > containerWidth,
  }
}

/**
 * Picks the gap columns that fit a container. `gutter` is the page gutter (24, or 16 below 768).
 * Domain is left out when the list shows one domain only.
 */
export function fitGapColumns(
  containerWidth: number,
  gutter: number,
  { oneDomain = false }: { oneDomain?: boolean } = {},
) {
  const ids = gapColumnIds.filter((id) => !(oneDomain && id === 'domain'))
  return fit(ids, gapColumnSpecs, ['lastSeen', 'type', 'reports', 'domain'], containerWidth, gutter)
}

export function fitTopicColumns(
  containerWidth: number,
  gutter: number,
  { oneDomain = false }: { oneDomain?: boolean } = {},
) {
  const ids = topicColumnIds.filter((id) => !(oneDomain && id === 'domain'))
  return fit(ids, topicColumnSpecs, ['share', 'domain'], containerWidth, gutter)
}
