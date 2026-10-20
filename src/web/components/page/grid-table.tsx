import type { ReactNode } from 'react'
import { TriangleAlertIcon, type Icon } from '@/components/icons'
import { gridCell } from '@/components/page/grid'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import './grid-table.css'

/*
  The app's bordered grid table on an overview page (Home P, rules 6 and 7; Quality, direction
  C): a rounded box in the structure line, a 36 pixel header row of 12/400 muted labels with an
  icon per column, 40 pixel rows divided by the data line, the cells drawn with the shared
  `gridCell` so the lines match every other grid. State lives inside the cells, as words and the
  Reference badges. `slot` names the grid (`data-slot`), its message (`<slot>-message`) and its
  loading rows (`<slot>-loading`), so a test or a screenshot can wait for the one it means.
  The table is its own size container: a column that leaves when space is short (`@max-3xl:hidden`)
  answers to the table's width, not the page's, so a table in a narrow column keeps room for its
  first column.
*/

/** A column of a grid table: its header's icon and name, and its width class. */
export type GridColumn = { icon: Icon; title: string; className?: string }

export function GridHeaderCell({
  icon: Glyph,
  title,
  className,
}: {
  icon: Icon
  title: string
  className?: string
}) {
  return (
    <div role="columnheader" className={cn(gridCell, 'gap-2', className)}>
      <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
      <span className="truncate">{title}</span>
    </div>
  )
}

/** The header cells of a grid table, from its columns. */
export function GridHeaderCells({ columns }: { columns: readonly GridColumn[] }) {
  return columns.map((column) => (
    <GridHeaderCell
      key={column.title}
      icon={column.icon}
      title={column.title}
      className={column.className}
    />
  ))
}

export function GridTable({
  label,
  slot,
  header,
  children,
}: {
  label: string
  slot: string
  header: ReactNode
  children: ReactNode
}) {
  return (
    <div
      role="table"
      aria-label={label}
      data-slot={slot}
      className="phone-grid @container overflow-hidden rounded-lg border bg-card text-dense"
    >
      <div role="rowgroup">
        <div role="row" className={gridTableHeaderRow}>
          {header}
        </div>
      </div>
      <div role="rowgroup" className={gridTableBody}>
        {children}
      </div>
    </div>
  )
}

const gridTableHeaderRow =
  'flex h-table-header items-stretch bg-background text-caption text-muted-foreground'
const gridTableBody = 'divide-y divide-border-subtle border-t border-border-subtle'

/** A row that opens what its title links to: the whole row is the target, the title the link. */
export const gridRowClass =
  'relative flex min-h-row items-stretch -outline-offset-2 hover:bg-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring'
/** The title link of such a row: 14 at regular weight, over the whole row. */
export const gridRowLink =
  'text-body outline-none after:absolute after:inset-0 max-md:text-row-phone max-md:font-normal'

/** A quiet message in the grid's place: empty, failed or nothing yet. */
export function GridMessage({
  slot,
  icon: Glyph,
  title,
  children,
  action,
}: {
  slot: string
  icon: Icon
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      data-slot={`${slot}-message`}
      className="flex flex-col items-start gap-3 rounded-lg border px-4 py-6 @2xl:flex-row @2xl:items-center"
    >
      <Glyph aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body font-bold">{title}</p>
        <p className="text-dense text-muted-foreground">{children}</p>
      </div>
      {action}
    </div>
  )
}

export function GridLoading({ slot, label = 'Loading' }: { slot: string; label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex flex-col gap-2 rounded-lg border p-3"
      data-slot={`${slot}-loading`}
    >
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-control-lg w-full" />
      ))}
    </div>
  )
}

export function GridFailed({
  slot,
  what,
  retry,
}: {
  slot: string
  what: string
  retry: () => void
}) {
  return (
    <GridMessage
      slot={slot}
      icon={TriangleAlertIcon}
      title={`We couldn't load ${what}`}
      action={
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      }
    >
      Nothing is lost. Check your connection, then try again.
    </GridMessage>
  )
}
