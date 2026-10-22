import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from '@/components/icons'
import { DomainBadge, KindIcon, Owner } from '@/components/item/item-marks'
import { fieldIcons } from '@/components/library/item-list'
import { gridCell, gridRowTitle, phoneRowTitle } from '@/components/page/grid'
import { RowStatus, StatusIcon } from '@/components/library/status-icon'
import { PersonPreview } from '@/components/preview/preview-link'
import { isEndedIssueRow, isLiveIssueRow, type LibraryRow } from '@/lib/library'
import type { LibrarySearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'

/*
  The Context tab of a term page: the library's own list filtered by the term (`about`), in the
  grid's grammar (lines on both axes, a field icon per column, rows of 40), cut to the newest
  items, with the way to the whole list in the library. A phone gets the library's narrow row.
*/

const columns = [
  { id: 'domain', title: 'Domain', width: 'w-column-domain' },
  { id: 'status', title: 'Status', width: 'w-column-status' },
  { id: 'owner', title: 'Owner', width: 'w-column-owner' },
] as const

const titleLink = cn(gridRowTitle, 'focus-visible:underline')

function Row({ row, search }: { row: LibraryRow; search: LibrarySearch | undefined }) {
  const calm = isEndedIssueRow(row)
  return (
    <li
      data-row-id={row.id}
      className="group/row relative flex border-t border-border-subtle -outline-offset-2 first:border-t-0 hover:bg-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring"
    >
      {/* Wide: one row of cells. */}
      <div className="hidden h-row w-full items-stretch text-dense @3xl:flex">
        <div className={cn(gridCell, 'flex-1 shrink gap-3')}>
          <KindIcon kind={row.kind} active={isLiveIssueRow(row)} />
          <Link
            to="/library/$itemId"
            params={{ itemId: row.id }}
            search={search}
            className={cn(titleLink, calm && 'text-muted-foreground')}
          >
            {row.title}
          </Link>
        </div>
        <div className={cn(gridCell, 'w-column-domain')}>
          <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
        </div>
        <div className={cn(gridCell, 'w-column-status')}>
          <StatusIcon status={row.displayStatus} />
        </div>
        <div className={cn(gridCell, 'w-column-owner')}>
          <PersonPreview personId={row.ownerId} tabIndex={-1}>
            <Owner
              name={row.ownerName}
              personId={row.ownerId}
              initials={row.ownerInitials}
              size="sm"
            />
          </PersonPreview>
        </div>
      </div>
      {/* Narrow: the library's phone row, status words only for warnings. */}
      <div className="flex min-h-row-phone w-full items-start gap-3 px-4 py-3 @3xl:hidden">
        <KindIcon kind={row.kind} active={isLiveIssueRow(row)} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Link
            to="/library/$itemId"
            params={{ itemId: row.id }}
            search={search}
            className={cn(phoneRowTitle, calm && 'text-muted-foreground')}
          >
            {row.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
            <RowStatus status={row.displayStatus} />
            <Owner
              name={row.ownerName}
              personId={row.ownerId}
              initials={row.ownerInitials}
              showName={false}
              className="ml-auto"
            />
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * The newest items about a term in the library's grid, and the count and the way to all of them:
 * "Newest first. Showing 10 of 92." and "Show all 92 in the library".
 */
export function TermItems({
  name,
  rows,
  total,
  search,
}: {
  name: string
  rows: LibraryRow[]
  total: number
  /**
   * The library's list of the term: every link carries it, so an item page steps through it. A
   * dimension has none (an item names one of its values), so it has no Show all.
   */
  search?: LibrarySearch
}) {
  return (
    <div
      data-slot="term-items"
      className="flex flex-col overflow-hidden rounded-lg border bg-card text-body"
    >
      <div
        aria-hidden="true"
        className="hidden h-table-header items-stretch border-b border-border-subtle bg-background text-caption text-muted-foreground @3xl:flex"
      >
        <div className={cn(gridCell, 'flex-1 gap-2')}>
          <fieldIcons.title className="size-icon-sm shrink-0 heed-ink" />
          Title
        </div>
        {columns.map((column) => {
          const Glyph = fieldIcons[column.id]
          return (
            <div key={column.id} className={cn(gridCell, column.width, 'gap-2')}>
              <Glyph className="size-icon-sm shrink-0 heed-ink" />
              {column.title}
            </div>
          )
        })}
      </div>
      <ul aria-label={`Context about ${name}`} className="flex flex-col">
        {rows.map((row) => (
          <Row key={row.id} row={row} search={search} />
        ))}
      </ul>
      <div
        data-slot="term-items-footer"
        className="flex min-h-control-touch flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-muted px-4 py-2 text-dense text-muted-foreground"
      >
        <span className="tabular-nums">
          Newest first. Showing {rows.length.toLocaleString('en')} of {total.toLocaleString('en')}.
        </span>
        {search ? (
          <Link
            to="/library"
            search={search}
            className="inline-flex items-center gap-1 font-bold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Show all {total.toLocaleString('en')} in the library
            <ArrowRightIcon aria-hidden="true" className="size-icon-sm" />
          </Link>
        ) : null}
      </div>
    </div>
  )
}
