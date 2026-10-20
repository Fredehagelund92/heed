import type { LibrarySort } from '@/lib/library'

/**
 * The library grid's columns and the column budget (design contract 8.1, direction A of the
 * table design). Title always shows and never gets narrower than its minimum. When the list's
 * container cannot fit every chosen column, columns leave in a fixed order, and below the
 * smallest table the list becomes the narrow row (8.5). The widths equal the `--column-*` tokens
 * in tokens.css; a test keeps them equal.
 *
 * At 1440 (a 1,184 container) the grid shows Title, Domain, Status, Valid until and Owner. Valid
 * until leaves below 1,164, Owner below 1,044, and the narrow row takes over below 888. About is
 * optional: the "with scope" density shows the same names under each title without a column.
 * Status is one 18 pixel glyph with its name in the tooltip, so its column is 128 wide.
 */

export const columnIds = [
  'domain',
  'about',
  'kind',
  'status',
  'until',
  'owner',
  'starts',
  'checked',
  'review',
  'version',
] as const
export type ColumnId = (typeof columnIds)[number]

export type ColumnSpec = {
  title: string
  /** Width in CSS pixels, equal to the token behind `widthClass`. */
  width: number
  widthClass: string
  sort?: LibrarySort
  /** Off by default, chosen in the Display menu. */
  optional: boolean
  numeric?: boolean
}

export const columnSpecs: Record<ColumnId, ColumnSpec> = {
  domain: {
    title: 'Domain',
    width: 192,
    widthClass: 'w-column-domain',
    sort: 'domain',
    optional: false,
  },
  about: { title: 'About', width: 200, widthClass: 'w-column-about', optional: true },
  kind: { title: 'Kind', width: 112, widthClass: 'w-column-kind', optional: true },
  status: {
    title: 'Status',
    width: 128,
    widthClass: 'w-column-status',
    sort: 'status',
    optional: false,
  },
  until: {
    title: 'Ends',
    width: 120,
    widthClass: 'w-column-until',
    sort: 'until',
    optional: false,
    numeric: true,
  },
  owner: {
    title: 'Owner',
    width: 156,
    widthClass: 'w-column-owner',
    sort: 'owner',
    optional: false,
  },
  starts: {
    title: 'Starts',
    width: 120,
    widthClass: 'w-column-until',
    sort: 'start',
    optional: true,
    numeric: true,
  },
  checked: {
    title: 'Last checked',
    width: 128,
    widthClass: 'w-column-optional',
    sort: 'updated',
    optional: true,
    numeric: true,
  },
  review: {
    title: 'Check again by',
    width: 128,
    widthClass: 'w-column-optional',
    optional: true,
    numeric: true,
  },
  version: {
    title: 'Version',
    width: 96,
    widthClass: 'w-column-version',
    optional: true,
    numeric: true,
  },
}

export const TITLE_MIN_WIDTH = 440
export const ROW_BUTTON_WIDTH = 40
/** The checkbox column that opens a row when rows can be selected (direction A). */
export const SELECT_WIDTH = 40

export const defaultColumns: ColumnId[] = ['domain', 'status', 'until', 'owner']

/** The order default columns leave in when there is no room, after the optional ones. */
const dropOrder: ColumnId[] = ['until', 'owner']

export function isColumnList(value: unknown): value is ColumnId[] {
  return Array.isArray(value) && value.every((id) => (columnIds as readonly unknown[]).includes(id))
}

export type ColumnFit = {
  /** The columns that show, in display order. */
  columns: ColumnId[]
  /** True when even the smallest table does not fit: show the narrow row. */
  narrow: boolean
  /** Chosen columns that do not fit at this width. */
  dropped: ColumnId[]
}

/**
 * Picks the columns that fit a container. `gutter` is the page gutter (24, or 16 below 768).
 * Domain is left out when the list shows one domain only (8.1). `selectable` adds the checkbox
 * column (rows cannot be selected on a touch screen). `docked` is a panel docked beside the
 * list: the panel shows the open item's domain, so Domain may leave last, before the list falls
 * back to the narrow row.
 */
export function fitColumns(
  chosen: readonly ColumnId[],
  containerWidth: number,
  gutter: number,
  {
    oneDomain = false,
    selectable = true,
    docked = false,
  }: { oneDomain?: boolean; selectable?: boolean; docked?: boolean } = {},
): ColumnFit {
  const outside = gutter * 2 + ROW_BUTTON_WIDTH + (selectable ? SELECT_WIDTH : 0)
  const wanted = columnIds.filter((id) => chosen.includes(id) && !(oneDomain && id === 'domain'))
  const width = (columns: ColumnId[]) =>
    outside + TITLE_MIN_WIDTH + columns.reduce((sum, id) => sum + columnSpecs[id].width, 0)

  let columns = [...wanted]
  const dropped: ColumnId[] = []
  // Optional columns leave first, the last one in the list first.
  const optional = [...wanted].reverse().filter((id) => columnSpecs[id].optional)
  for (const id of [...optional, ...dropOrder, ...(docked ? (['domain'] as const) : [])]) {
    if (width(columns) <= containerWidth) break
    if (!columns.includes(id)) continue
    columns = columns.filter((column) => column !== id)
    dropped.push(id)
  }
  return { columns, narrow: width(columns) > containerWidth, dropped }
}
