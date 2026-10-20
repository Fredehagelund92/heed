import { phoneRowTitle } from '@/components/page/grid'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CircleDashedIcon,
  HeedDomainIcon,
  HistoryIcon,
  MessageSquareIcon,
  SearchXIcon,
  ShapesIcon,
  TargetIcon,
  type Icon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { DomainBadge } from '@/components/item/item-marks'
import { highlight } from '@/components/library/item-list'
import { gridCell, gridFooter, gridGroupRow, gridHeaderRow, gridRow } from '@/components/page/grid'
import { panelRowHistory } from '@/lib/history'
import { formatDay } from '@/lib/library'
import {
  countText,
  gapStageNames,
  gapTypeNames,
  monthText,
  type GapEntry,
  type GapRow,
} from '@/lib/gaps'
import { openRowClass } from '@/components/page/dock-panel'
import { cn } from '@/lib/utils'
import { gapColumnSpecs, type GapColumnId } from './gap-columns'
import { FromPeopleBadge, GapCount, GapStatusBadge } from './gap-marks'

/*
  The gap grid (direction A of the table design, on the shared grid classes): lines on both
  axes, 40 pixel rows, a 36 pixel header with a field icon per column, the topic with its month, group rows for
  where each gap stands, and the totals under the grid. Below the smallest table every gap is a
  narrow row: the topic on up to two lines, the badges and one line of facts, the whole row one
  target. A row opens the gap in the docked panel; the address holds which one.
*/

export const gapFieldIcons: Record<GapColumnId | 'title', Icon> = {
  title: TargetIcon,
  type: ShapesIcon,
  status: CircleDashedIcon,
  domain: HeedDomainIcon,
  reports: MessageSquareIcon,
  noItemCalls: SearchXIcon,
  lastSeen: HistoryIcon,
}

/** A gap's domain, or a quiet line when its topic spans domains. */
export function GapDomain({ row, size = 'md' }: { row: GapRow; size?: 'md' | 'sm' }) {
  if (row.areaName === null || row.areaLabel === null)
    return <span className="text-muted-foreground">{row.domainsText}</span>
  return <DomainBadge name={row.areaName} label={row.areaLabel} size={size} />
}

function Cell({ column, row }: { column: GapColumnId; row: GapRow }) {
  const spec = gapColumnSpecs[column]
  let content: ReactNode
  switch (column) {
    case 'type':
      content = <span className="truncate text-muted-foreground">{gapTypeNames[row.type]}</span>
      break
    case 'status':
      content = <GapStatusBadge status={row.status} size="sm" />
      break
    case 'domain':
      content = <GapDomain row={row} size="sm" />
      break
    case 'reports':
      content = <GapCount count={row.reports} />
      break
    case 'noItemCalls':
      content = <GapCount count={row.noItemCalls} />
      break
    case 'lastSeen':
      content = (
        <span className="text-muted-foreground" title={formatDay(row.lastSeen, 'long')}>
          {formatDay(row.lastSeen)}
        </span>
      )
      break
  }
  return (
    <div
      role="cell"
      className={cn(gridCell, 'truncate', spec.widthClass, spec.numeric && 'tabular-nums')}
    >
      {content}
    </div>
  )
}

/** The grid's column header, also kept over its loading rows. */
export function GapHeaderRow({ columns }: { columns: GapColumnId[] }) {
  const cell = (id: GapColumnId | 'title', title: string, className: string) => {
    const Glyph = gapFieldIcons[id]
    return (
      <div key={id} role="columnheader" className={cn(gridCell, className)}>
        <span className="inline-flex min-w-0 items-center gap-2">
          <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="truncate">{title}</span>
        </span>
      </div>
    )
  }
  return (
    <div role="rowgroup" className="sticky top-(--list-sticky-top) z-sticky">
      <div role="row" data-layout="content" className={cn(gridHeaderRow, 'heed-ink')}>
        {cell('title', 'Topic', 'min-w-0 flex-1')}
        {columns.map((column) =>
          cell(column, gapColumnSpecs[column].title, gapColumnSpecs[column].widthClass),
        )}
      </div>
    </div>
  )
}

export function GroupRow({
  label,
  count,
  narrow,
  first,
}: {
  label: string
  count: number
  narrow: boolean
  /** The first row of a narrow list marks where the content starts (the left edge test). */
  first: boolean
}) {
  return (
    <div role="row" data-layout={narrow && first ? 'content' : undefined} className={gridGroupRow}>
      <div
        role="rowheader"
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 text-dense font-bold',
          // In the grid the label lines up with the topics.
          !narrow && 'px-3',
        )}
      >
        <span className="truncate">{label}</span>
        <span className="text-caption font-normal text-muted-foreground tabular-nums">
          {count.toLocaleString('en')}
        </span>
      </div>
    </div>
  )
}

export const rowLink =
  'block min-w-0 outline-none after:absolute after:inset-0 focus-visible:outline-none'

/**
 * How a row opens its gap in the docked panel: while a panel is open the next row replaces the
 * address, so Back closes the panel instead of stepping through every gap read.
 */
export type GapRowPanel = {
  /** The gap open in the panel. */
  openId: string | null
}

/** The link that opens a gap in the docked panel, keeping the list's search and filters. */
function GapLink({
  row,
  terms,
  panel,
  className,
}: {
  row: GapRow
  terms: string[]
  panel: GapRowPanel
  className?: string
}) {
  return (
    <Link
      from="/gaps"
      to="/gaps"
      search={(previous) => ({ ...previous, gap: row.id })}
      {...panelRowHistory(panel.openId !== null)}
      resetScroll={false}
      data-row-link
      aria-label={`${row.title}, ${monthText(row.month)}`}
      className={cn(rowLink, className)}
    >
      {highlight(row.title, terms)}
    </Link>
  )
}

function GridRow({
  row,
  columns,
  terms,
  panel,
}: {
  row: GapRow
  columns: GapColumnId[]
  terms: string[]
  panel: GapRowPanel
}) {
  return (
    <div
      role="row"
      data-row-id={row.id}
      data-status={row.status}
      data-open={row.id === panel.openId || undefined}
      className={cn(
        gridRow,
        'h-row -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
        openRowClass,
      )}
    >
      <div role="cell" className={cn(gridCell, 'flex-1 shrink gap-2')}>
        <GapLink row={row} terms={terms} panel={panel} className="truncate text-body" />
        <span className="shrink-0 text-dense text-muted-foreground">
          {monthText(row.month, 'short')}
        </span>
        {row.fromPeople ? <FromPeopleBadge size="sm" compact /> : null}
      </div>
      {columns.map((column) => (
        <Cell key={column} column={column} row={row} />
      ))}
    </div>
  )
}

function NarrowRow({ row, terms, panel }: { row: GapRow; terms: string[]; panel: GapRowPanel }) {
  return (
    <div
      role="row"
      data-row-id={row.id}
      data-status={row.status}
      data-open={row.id === panel.openId || undefined}
      className={cn(
        'relative flex min-h-row-phone items-start gap-3 border-b border-border-subtle px-gutter py-3 -outline-offset-2 has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
        openRowClass,
      )}
    >
      <div role="cell" className="flex min-w-0 flex-1 flex-col gap-2">
        <GapLink row={row} terms={terms} panel={panel} className={phoneRowTitle} />
        <div className="flex flex-wrap items-center gap-2">
          <GapStatusBadge status={row.status} size="sm" iconOnly={row.status === 'resolved'} />
          {row.areaName && row.areaLabel ? (
            <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
          ) : (
            <span className="text-caption text-muted-foreground">{row.domainsText}</span>
          )}
          {row.fromPeople ? <FromPeopleBadge size="sm" /> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground tabular-nums">
          <span>{monthText(row.month)}</span>
          <span aria-hidden="true">·</span>
          <span>{gapTypeNames[row.type]}</span>
          <span aria-hidden="true">·</span>
          <span>
            {row.noItemCalls.kind === 'value'
              ? `${countText(row.noItemCalls)} found nothing`
              : `Found nothing: ${countText(row.noItemCalls).toLowerCase()}`}
          </span>
          <span aria-hidden="true">·</span>
          <span>Last seen {formatDay(row.lastSeen)}</span>
        </p>
      </div>
    </div>
  )
}

/** The totals under the grid (direction A), which follow the search and the filters. */
function Footer({ rows, columns }: { rows: readonly GapRow[]; columns: GapColumnId[] }) {
  const total = (value: number, one: string, many: string) => (
    <>
      <span className="font-bold text-foreground tabular-nums">{value.toLocaleString('en')}</span>
      {value === 1 ? one : many}
    </>
  )
  const domains = new Set(rows.map((row) => row.areaId).filter((id) => id !== null)).size
  const totals: Partial<Record<GapColumnId, ReactNode>> = {
    status: total(rows.filter((row) => row.status === 'open').length, 'open', 'open'),
    domain: domains ? total(domains, 'domain', 'domains') : null,
  }
  return (
    <div
      role="group"
      aria-label="Totals"
      data-slot="list-footer"
      data-launcher-clear
      className={gridFooter}
    >
      <div className={cn(gridCell, 'flex-1 gap-1')}>{total(rows.length, 'gap', 'gaps')}</div>
      {columns.map((column) => (
        <div key={column} className={cn(gridCell, 'gap-1', gapColumnSpecs[column].widthClass)}>
          {totals[column] ?? null}
        </div>
      ))}
    </div>
  )
}

/**
 * The gaps as the grid, or as narrow rows on a narrow screen, with the totals under it. The page
 * scrolls; the column header sticks under the page's toolbar.
 */
export function GapList({
  entries,
  rows,
  columns,
  narrow,
  terms,
  panel,
  note,
}: {
  entries: readonly GapEntry[]
  rows: readonly GapRow[]
  columns: GapColumnId[]
  narrow: boolean
  terms: string[]
  /** The gap whose sheet is open, marked in the list. */
  /** How a row opens its gap in the docked panel. */
  panel: GapRowPanel
  /** Why some counts read "Hidden", under the list. */
  note: string
}) {
  return (
    <div className="flex flex-col">
      <div role="table" aria-label="Gaps" data-slot="gap-list" className="flex flex-col">
        {narrow ? null : <GapHeaderRow columns={columns} />}
        <div role="rowgroup" className="flex flex-col">
          {entries.map((entry, index) =>
            entry.type === 'group' ? (
              <GroupRow
                key={`group:${entry.stage}`}
                label={gapStageNames[entry.stage]}
                count={entry.count}
                narrow={narrow}
                first={index === 0}
              />
            ) : narrow ? (
              <NarrowRow key={entry.row.id} row={entry.row} terms={terms} panel={panel} />
            ) : (
              <GridRow
                key={entry.row.id}
                row={entry.row}
                columns={columns}
                terms={terms}
                panel={panel}
              />
            ),
          )}
        </div>
      </div>
      {narrow ? null : <Footer rows={rows} columns={columns} />}
      <p className="px-gutter pt-3 text-caption text-muted-foreground">
        {note} <HelpLink to="common-questions#why-are-some-counts-hidden">Why?</HelpLink>
      </p>
    </div>
  )
}
