/*
  The grammar every grid in the app shares (direction A of the table design, made quieter by the
  professional pass): lines on both axes in --border-subtle, a 36 pixel column header with 12/400
  muted labels, 40 pixel rows of 13 pixel text whose title reads in 14 at regular weight, and a
  36 pixel totals footer. Bold stays for titles of pages, panels and sections, the active nav item,
  buttons and important numbers. A grid composes these classes, so a change here reaches the
  library, the catalogue, proposals, the review queue, gaps and the admin grids at once.
*/

/** A cell: the line on its left, over the row's full height. The first cell has none. */
export const gridCell =
  'flex min-w-0 shrink-0 items-center self-stretch border-l border-border-subtle px-3 first:border-l-0'

/** The column header of a full-width grid, under the page's toolbar. */
export const gridHeaderRow =
  'flex h-table-header items-stretch border-b border-border-subtle bg-background px-gutter text-caption text-muted-foreground'

/** A data row of a full-width grid. The row's height comes with it (`h-row`, or a density's). */
export const gridRow =
  'relative flex items-stretch border-b border-border-subtle px-gutter text-dense'

/** The title of a row: the link that opens it, regular weight, the whole row its target. */
export const gridRowTitle =
  'block min-w-0 truncate text-body outline-none after:absolute after:inset-0'

/** A group header row inside a grid: a quiet band with the group's name and count. */
export const gridGroupRow =
  'flex h-row items-center border-b border-border-subtle bg-sidebar px-gutter'

/** The totals under a grid, stuck to the bottom of the window. */
export const gridFooter =
  'sticky bottom-0 z-sticky flex h-footer items-stretch border-t border-border-subtle bg-background px-gutter text-caption text-muted-foreground'

/**
 * A control that belongs to a row (its menu, its checkbox): shown while the row (`group/row`) is
 * hovered, focused from the keyboard or selected, while its own menu is open, and always on a
 * touch screen, which has no hover (the `row-control` utility in index.css). Transparent, it
 * stays in the accessibility tree and keeps its keyboard route.
 */
export const gridRowControl = 'row-control'

/** Phone list titles share the moderate pass's 15/400, with at most two lines. */
export const phoneRowTitle =
  'block min-w-0 line-clamp-2 text-row-phone font-normal outline-none after:absolute after:inset-0'
