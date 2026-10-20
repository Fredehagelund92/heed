/**
 * The proposal grid's columns and their budget (the Proposals page, direction A of the table
 * design, frame C1 of the front end plan). Title always shows. When the container cannot fit
 * every column, columns leave in a fixed order, and below the smallest table the grid becomes
 * the narrow row. The widths equal the `--column-*` tokens in tokens.css; a test keeps them
 * equal.
 *
 * At 1440 (a 1,184 container) every column shows. Updated leaves first, then Due, then Domain,
 * and below 768 the narrow row takes over.
 */

export const proposalColumnIds = ['change', 'status', 'domain', 'due', 'updated'] as const
export type ProposalColumnId = (typeof proposalColumnIds)[number]

export type ProposalColumnSpec = {
  title: string
  /** Width in CSS pixels, equal to the token behind `widthClass`. */
  width: number
  widthClass: string
  numeric?: boolean
}

export const proposalColumnSpecs: Record<ProposalColumnId, ProposalColumnSpec> = {
  change: { title: 'Change', width: 120, widthClass: 'w-column-change' },
  status: { title: 'Status', width: 184, widthClass: 'w-column-proposal-status' },
  domain: { title: 'Domain', width: 192, widthClass: 'w-column-domain' },
  due: { title: 'Review due', width: 144, widthClass: 'w-column-due', numeric: true },
  updated: { title: 'Updated', width: 120, widthClass: 'w-column-until', numeric: true },
}

/** The title's narrowest width in the proposal grid: one line of about 40 characters. */
export const PROPOSAL_TITLE_MIN_WIDTH = 320

/** The checkbox column, `--column-select`, for someone who may decide proposals. */
const PROPOSAL_SELECT_WIDTH = 40

/** The order columns leave in when there is no room. */
const dropOrder: ProposalColumnId[] = ['updated', 'due', 'domain']

/** Below this container width the grid is the narrow row (contract 8.5, the phone row). */
const NARROW_BELOW = 768

/**
 * Picks the columns that fit a container. `gutter` is the page gutter (24, or 16 below 768).
 * Domain is left out when the list shows one domain only. With rows to select, the checkbox
 * column takes its 40 from the title. So does the row button's column in Mine, where the drafts
 * keep their menu, without counting: the person's drafts never cost them a column.
 */
export function fitProposalColumns(
  containerWidth: number,
  gutter: number,
  { oneDomain = false, selectable = false }: { oneDomain?: boolean; selectable?: boolean } = {},
): { columns: ProposalColumnId[]; narrow: boolean } {
  const width = (columns: ProposalColumnId[]) =>
    gutter * 2 +
    PROPOSAL_TITLE_MIN_WIDTH +
    (selectable ? PROPOSAL_SELECT_WIDTH : 0) +
    columns.reduce((sum, id) => sum + proposalColumnSpecs[id].width, 0)
  let columns = proposalColumnIds.filter((id) => !(oneDomain && id === 'domain'))
  for (const id of dropOrder) {
    if (width(columns) <= containerWidth) break
    columns = columns.filter((column) => column !== id)
  }
  return {
    columns,
    narrow: containerWidth < NARROW_BELOW || width(columns) > containerWidth,
  }
}
