/**
 * The To review queue's columns and their budget (frame C1 of the front end plan): grouped by
 * domain, so there is no Domain column. Title always shows. When the container cannot fit every
 * column, columns leave in a fixed order, and below the smallest table the queue becomes the
 * narrow row. The widths equal the `--column-*` tokens in tokens.css; a test keeps them equal.
 *
 * At 1440 with the sidebar open (a 1,184 container) Proposed by leaves first, then Change, then
 * Due; Checks always stays, so a bulk accept never hides a failed check (FR-223). With rows to
 * select, the checkbox column takes its 40 from the title. Below 768 the narrow row takes over.
 */

export const queueColumnIds = ['change', 'status', 'checks', 'risk', 'due', 'proposer'] as const
export type QueueColumnId = (typeof queueColumnIds)[number]

export type QueueColumnSpec = {
  title: string
  /** Width in CSS pixels, equal to the token behind `widthClass`. */
  width: number
  widthClass: string
  numeric?: boolean
}

export const queueColumnSpecs: Record<QueueColumnId, QueueColumnSpec> = {
  change: { title: 'Change', width: 120, widthClass: 'w-column-change' },
  status: { title: 'Status', width: 184, widthClass: 'w-column-proposal-status' },
  checks: { title: 'Checks', width: 128, widthClass: 'w-column-queue-checks' },
  risk: { title: 'Risk', width: 128, widthClass: 'w-column-risk' },
  due: { title: 'Due', width: 160, widthClass: 'w-column-queue-due', numeric: true },
  proposer: { title: 'Proposed by', width: 156, widthClass: 'w-column-owner' },
}

/** The title's narrowest width in the queue: one line of about 40 characters. */
export const QUEUE_TITLE_MIN_WIDTH = 320
/** The checkbox column, `--column-select`. */
const QUEUE_SELECT_WIDTH = 40

const dropOrder: QueueColumnId[] = ['proposer', 'change', 'due']

/** Below this container width the queue is the narrow row (contract 8.5, the phone row). */
const NARROW_BELOW = 768

/** Picks the columns that fit a container. `gutter` is the page gutter (24, or 16 below 768). */
export function fitQueueColumns(
  containerWidth: number,
  gutter: number,
  { selectable = false }: { selectable?: boolean } = {},
): { columns: QueueColumnId[]; narrow: boolean } {
  const width = (columns: QueueColumnId[]) =>
    gutter * 2 +
    QUEUE_TITLE_MIN_WIDTH +
    (selectable ? QUEUE_SELECT_WIDTH : 0) +
    columns.reduce((sum, id) => sum + queueColumnSpecs[id].width, 0)
  let columns = [...queueColumnIds]
  for (const id of dropOrder) {
    if (width(columns) <= containerWidth) break
    columns = columns.filter((column) => column !== id)
  }
  return {
    columns,
    narrow: containerWidth < NARROW_BELOW || width(columns) > containerWidth,
  }
}
