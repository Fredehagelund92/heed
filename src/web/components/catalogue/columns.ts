/**
 * The catalogue grid's columns and their budget (design contract 5, "The catalogue"). Name always
 * shows and never gets narrower than its minimum. Domain shows only A to Z: grouped by domain,
 * the group row already names it. Status is wider than the library's, to fit "Definition changed"
 * (the words name no tool; the detail line does). Changed is the first to leave: it needs a roomier Name, so
 * it drops on a rail page
 * (1,024 wide) and stays from 1,280. Below 768 pixels, or when even the smallest table does not
 * fit, the list becomes the narrow row. The widths equal the `--column-*` tokens in tokens.css;
 * tests/lint/tokens.test.ts keeps them equal.
 */

export const catalogueColumnIds = ['domain', 'context', 'status', 'changed'] as const
export type CatalogueColumnId = (typeof catalogueColumnIds)[number]

export type CatalogueColumnSpec = {
  title: string
  /** Width in CSS pixels, equal to the token behind `widthClass`. */
  width: number
  widthClass: string
  numeric?: boolean
}

export const catalogueColumnSpecs: Record<CatalogueColumnId, CatalogueColumnSpec> = {
  domain: {
    title: 'Domain',
    width: 192,
    widthClass: 'w-column-domain',
  },
  context: {
    title: 'Context',
    width: 112,
    widthClass: 'w-column-context',
    numeric: true,
  },
  status: {
    title: 'Status',
    width: 184,
    widthClass: 'w-column-term-status',
  },
  changed: {
    title: 'Definition changed',
    width: 160,
    widthClass: 'w-column-changed',
    numeric: true,
  },
}

/** The narrowest Name column (the library's title minimum). */
export const NAME_MIN_WIDTH = 440
/** The Name width Changed needs beside it: it leaves first. */
export const NAME_ROOM_FOR_CHANGED = 520

export type CatalogueColumnFit = {
  columns: CatalogueColumnId[]
  /** True when even the smallest table does not fit: show the narrow row. */
  narrow: boolean
}

/**
 * Picks the columns that fit a container. `gutter` is the page gutter (24, or 16 below 768).
 * `grouped` leaves Domain out, because the group row names it.
 */
export function fitCatalogueColumns(
  containerWidth: number,
  gutter: number,
  { grouped }: { grouped: boolean },
): CatalogueColumnFit {
  const outside = gutter * 2
  const width = (columns: CatalogueColumnId[]) =>
    columns.reduce((sum, id) => sum + catalogueColumnSpecs[id].width, outside)
  let columns = catalogueColumnIds.filter((id) => !(grouped && id === 'domain'))
  if (containerWidth - width(columns) < NAME_ROOM_FOR_CHANGED)
    columns = columns.filter((id) => id !== 'changed')
  if (containerWidth - width(columns) < NAME_MIN_WIDTH)
    columns = columns.filter((id) => id !== 'domain')
  return { columns, narrow: containerWidth - width(columns) < NAME_MIN_WIDTH }
}
