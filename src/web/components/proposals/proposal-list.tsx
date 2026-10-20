import { phoneRowTitle } from '@/components/page/grid'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CircleDashedIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
  HeedDomainIcon,
  TimerIcon,
  TypeIcon,
  type Icon,
} from '@/components/icons'
import { termKindGlyphs, termKindNames } from '@/components/catalogue/catalogue-marks'
import { DateBadge, DomainBadge, KindIcon, ProposalStatusBadge } from '@/components/item/item-marks'
import { DraftedMark } from '@/components/proposal/attribution'
import { highlight } from '@/components/library/item-list'
import {
  gridCell,
  gridFooter,
  gridGroupRow,
  gridHeaderRow,
  gridRow,
  gridRowControl,
  gridRowTitle,
} from '@/components/page/grid'
import { daysFrom, formatDay } from '@/lib/library'
import {
  changeLabel,
  proposalStageNames,
  type ProposalEntry,
  type ProposalRow,
} from '@/lib/proposals'
import { openRowClass } from '@/components/page/dock-panel'
import { Checkbox } from '@/components/ui/checkbox'
import { RowSelectCell } from './row-select'
import { cn } from '@/lib/utils'
import { panelLink, type RowPanel } from './row-panel'
import { proposalColumnSpecs, type ProposalColumnId } from './proposal-columns'

/*
  The proposal grid (direction A, frame C1 of the front end plan, on the shared grid classes):
  lines on both axes, 40 pixel rows, a 36 pixel header with a field icon per column, the kind icon in the title cell,
  group rows for where each proposal stands, and the totals under the grid. Below the smallest
  table every proposal is a narrow row: the tile, the title on up to two lines, the badges and
  one line of facts, the whole row one target.
*/

const fieldIcons: Record<ProposalColumnId | 'title', Icon> = {
  title: TypeIcon,
  change: GitCompareArrowsIcon,
  status: CircleDashedIcon,
  domain: HeedDomainIcon,
  due: TimerIcon,
  updated: HistoryIcon,
}

/** "Review due in 1 day", "2 days overdue" or nothing: the due day of a proposal that waits. */
function DueCell({ row, today }: { row: ProposalRow; today: string | null }) {
  if (!row.dueOn) return null
  return <DateBadge date={row.dueOn} today={today} deadline size="sm" />
}

function Cell({
  column,
  row,
  today,
}: {
  column: ProposalColumnId
  row: ProposalRow
  today: string | null
}) {
  const spec = proposalColumnSpecs[column]
  let content: ReactNode
  switch (column) {
    case 'change':
      content = <span className="text-muted-foreground">{changeLabel(row)}</span>
      break
    case 'status':
      content = row.drafted ? (
        <span className="flex min-w-0 items-center gap-2">
          <ProposalStatusBadge state={row.state} size="sm" />
          <DraftedMark by={row.drafted} />
        </span>
      ) : (
        <ProposalStatusBadge state={row.state} size="sm" />
      )
      break
    case 'domain':
      content = <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
      break
    case 'due':
      content = <DueCell row={row} today={today} />
      break
    case 'updated':
      content = (
        <span className="text-muted-foreground" title={formatDay(row.updatedAt, 'long')}>
          {formatDay(row.updatedAt)}
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

/**
 * The rows' selection, for someone who may decide proposals, on a screen wide enough to select
 * (FR-223): a row they may not decide (`canDecideInList`) shows why instead.
 */
export type ProposalSelection = {
  selected: ReadonlySet<string>
  /** Selects or unselects a row; `range` selects every row from the anchor to it (Shift). */
  onToggle: (id: string, range: boolean) => void
  onToggleAll: () => void
  /** Why the person cannot select a row, and who decides it; null when they can. */
  blocked: (row: ProposalRow) => string | null
  /** The header checkbox's name while nothing is selected: what Select all takes. */
  allLabel?: string
}

/** The title cell's left edge after the checkbox column (as the library's). */
const titleAfterSelect = 'border-l-0 pl-1'

/** The grid's column header, also kept over its loading rows. */
export function ProposalHeaderRow({
  columns,
  selection,
  rows = 0,
  rowButton = false,
}: {
  columns: ProposalColumnId[]
  selection?: ProposalSelection
  /** How many rows the selection can hold: the ones the person may decide. */
  rows?: number
  /** Whether the rows end in the row button's column (contract 8.2): Mine, for its drafts. */
  rowButton?: boolean
}) {
  const cell = (id: ProposalColumnId | 'title', title: string, className: string) => {
    const Glyph = fieldIcons[id]
    return (
      <div key={id} role="columnheader" className={cn(gridCell, className)}>
        <span className="inline-flex min-w-0 items-center gap-2">
          <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="truncate">{title}</span>
        </span>
      </div>
    )
  }
  const all = selection !== undefined && rows > 0 && selection.selected.size >= rows
  const some = selection !== undefined && selection.selected.size > 0 && !all
  return (
    <div role="rowgroup" className="sticky top-(--list-sticky-top) z-sticky">
      <div role="row" data-layout="content" className={cn('group/row', gridHeaderRow)}>
        {selection ? (
          <div
            role="columnheader"
            data-edge="start"
            className="flex w-column-select shrink-0 items-center justify-center"
          >
            {/* Nothing here is the person's to decide: the line above the list says why. */}
            {rows > 0 ? (
              <Checkbox
                checked={all}
                indeterminate={some}
                onCheckedChange={selection.onToggleAll}
                aria-label={
                  all || some
                    ? 'Clear the selection'
                    : (selection.allLabel ?? 'Select every proposal you can decide')
                }
                className={cn(!(all || some) && gridRowControl)}
              />
            ) : (
              <span className="sr-only">Select</span>
            )}
          </div>
        ) : null}
        {cell('title', 'Title', cn('min-w-0 flex-1', selection && titleAfterSelect))}
        {columns.map((column) =>
          cell(column, proposalColumnSpecs[column].title, proposalColumnSpecs[column].widthClass),
        )}
        {rowButton ? (
          <div role="columnheader" className={cn(gridCell, 'w-row-button')}>
            <span className="sr-only">Actions</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function GroupRow({
  entry,
  narrow,
  first,
}: {
  entry: Extract<ProposalEntry, { type: 'group' }>
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
          // In the grid the label lines up with the titles, in a narrow list with the tiles.
          !narrow && 'px-3',
        )}
      >
        <span className="truncate">{proposalStageNames[entry.stage]}</span>
        <span className="text-caption font-normal text-muted-foreground tabular-nums">
          {entry.count.toLocaleString('en')}
        </span>
      </div>
    </div>
  )
}

/** An item's kind, or a term's: the glyph the catalogue gives a metric or a dimension. */
function RowIcon({ row }: { row: ProposalRow }) {
  if (!row.term) return <KindIcon kind={row.kind} />
  const Glyph = termKindGlyphs[row.term]
  return (
    <Glyph
      role="img"
      aria-label={`${termKindNames[row.term]} name`}
      aria-hidden={false}
      data-slot="kind-icon"
      data-kind={`term-${row.term}`}
      className="size-4 shrink-0 text-muted-foreground"
    />
  )
}

function GridRow({
  row,
  columns,
  today,
  terms,
  panel,
  selection,
  menu,
}: {
  row: ProposalRow
  columns: ProposalColumnId[]
  today: string | null
  terms: string[]
  panel: RowPanel
  selection?: ProposalSelection
  /**
   * The row's own menu, in the row button's column; null keeps the column empty (only a draft
   * has a menu), and undefined leaves the column out.
   */
  menu?: ReactNode
}) {
  const selected = selection?.selected.has(row.id) ?? false
  return (
    <div
      role="row"
      data-row-id={row.id}
      data-state={row.state}
      data-open={row.id === panel.openId || undefined}
      data-selected={selected || undefined}
      aria-selected={selection ? selected : undefined}
      className={cn(
        'group/row',
        gridRow,
        'h-row -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring data-selected:bg-selected',
        openRowClass,
      )}
    >
      {selection ? (
        <RowSelectCell
          title={row.title}
          icon={<RowIcon row={row} />}
          selected={selected}
          blocked={selection.blocked(row)}
          onToggle={(range) => selection.onToggle(row.id, range)}
        />
      ) : null}
      <div
        role="cell"
        className={cn(gridCell, 'flex-1 shrink gap-3', selection && titleAfterSelect)}
      >
        {selection ? null : <RowIcon row={row} />}
        <Link
          {...panelLink(panel, row.id)}
          data-row-link
          onClick={(event) => {
            // Shift-click selects from the anchor to this row, as Linear does.
            if (selection && event.shiftKey) {
              event.preventDefault()
              selection.onToggle(row.id, true)
            }
          }}
          className={gridRowTitle}
        >
          {highlight(row.title, terms)}
        </Link>
      </div>
      {columns.map((column) => (
        <Cell key={column} column={column} row={row} today={today} />
      ))}
      {menu !== undefined ? (
        <div role="cell" className={cn(gridCell, 'w-row-button justify-center px-0')}>
          {menu ? <span className="relative z-raised flex">{menu}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function NarrowRow({
  row,
  today,
  terms,
  panel,
  menu,
}: {
  row: ProposalRow
  today: string | null
  terms: string[]
  panel: RowPanel
  /** The row's own menu, at its end; only a draft has one. */
  menu?: ReactNode
}) {
  const days = row.dueOn && today ? daysFrom(today, row.dueOn) : null
  return (
    <div
      role="row"
      data-row-id={row.id}
      data-state={row.state}
      data-open={row.id === panel.openId || undefined}
      className={cn(
        'group/row relative flex min-h-row-phone items-start gap-3 border-b border-border-subtle px-gutter py-3 -outline-offset-2 has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
        openRowClass,
      )}
    >
      <div role="cell" className="flex shrink-0">
        <RowIcon row={row} />
      </div>
      <div role="cell" className="flex min-w-0 flex-1 flex-col gap-2">
        <Link {...panelLink(panel, row.id)} data-row-link className={phoneRowTitle}>
          {highlight(row.title, terms)}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
          <ProposalStatusBadge
            state={row.state}
            size="sm"
            iconOnly={row.state === 'accepted' || row.state === 'withdrawn'}
          />
          {row.drafted ? <DraftedMark by={row.drafted} /> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground tabular-nums">
          <span>{changeLabel(row)}</span>
          {row.dueOn ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={cn(days !== null && days < 0 && 'text-status-danger-fg')}>
                {days === null
                  ? `Review due ${formatDay(row.dueOn)}`
                  : days < 0
                    ? `Review ${-days} ${days === -1 ? 'day' : 'days'} overdue`
                    : days === 0
                      ? 'Review due today'
                      : `Review due in ${days} ${days === 1 ? 'day' : 'days'}`}
              </span>
            </>
          ) : (
            <>
              <span aria-hidden="true">·</span>
              <span>Updated {formatDay(row.updatedAt)}</span>
            </>
          )}
        </p>
      </div>
      {menu ? (
        <div role="cell" className="relative z-raised flex shrink-0">
          {menu}
        </div>
      ) : null}
    </div>
  )
}

/** The totals under the grid (direction A), which follow the search and the filters. */
function Footer({
  rows,
  columns,
  today,
  selectable,
  rowButton,
}: {
  rows: readonly ProposalRow[]
  columns: ProposalColumnId[]
  today: string | null
  selectable: boolean
  rowButton: boolean
}) {
  const total = (value: number, one: string, many: string) => (
    <>
      <span className="font-bold text-foreground tabular-nums">{value.toLocaleString('en')}</span>
      {value === 1 ? one : many}
    </>
  )
  const overdue = rows.filter(
    (row) => row.dueOn !== null && today !== null && daysFrom(today, row.dueOn) < 0,
  ).length
  // Drafts are counted apart from what needs the person, as they are grouped apart.
  const drafts = rows.filter((row) => row.stage === 'draft').length
  const yours = rows.filter((row) => row.stage === 'yours').length
  const totals: Partial<Record<ProposalColumnId, ReactNode>> = {
    status: (
      <>
        {drafts ? total(drafts, 'draft', 'drafts') : null}
        {drafts && yours ? <span aria-hidden="true">·</span> : null}
        {yours || !drafts ? total(yours, 'needs you', 'need you') : null}
      </>
    ),
    // A term of no domain is in none.
    domain: total(
      new Set(rows.flatMap((row) => (row.areaId ? [row.areaId] : []))).size,
      'domain',
      'domains',
    ),
    due: overdue ? total(overdue, 'overdue', 'overdue') : null,
  }
  return (
    <div
      role="group"
      aria-label="Totals"
      data-slot="list-footer"
      data-launcher-clear
      className={gridFooter}
    >
      {selectable ? <div className="w-column-select shrink-0" /> : null}
      <div className={cn(gridCell, 'flex-1 gap-1', selectable && titleAfterSelect)}>
        {total(rows.length, 'proposal', 'proposals')}
      </div>
      {columns.map((column) => (
        <div key={column} className={cn(gridCell, 'gap-1', proposalColumnSpecs[column].widthClass)}>
          {totals[column] ?? null}
        </div>
      ))}
      {rowButton ? <div className={cn(gridCell, 'w-row-button')} /> : null}
    </div>
  )
}

/**
 * The person's proposals as the grid, or as narrow rows on a narrow screen, with the totals
 * under it. The page scrolls; the column header sticks under the page's toolbar.
 */
export function ProposalList({
  label,
  note,
  entries,
  rows,
  columns,
  narrow,
  today,
  terms,
  panel,
  selection,
  rowMenu,
}: {
  label: string
  /** The line above the list when the person cannot decide some of its proposals. */
  note?: ReactNode
  entries: readonly ProposalEntry[]
  rows: readonly ProposalRow[]
  columns: ProposalColumnId[]
  narrow: boolean
  /** The service's day, for the due badges. */
  today: string | null
  terms: string[]
  /** How a row opens its proposal in the docked panel. */
  panel: RowPanel
  /** The rows' selection; absent where rows are not selected (a phone, a touch screen). */
  selection?: ProposalSelection
  /**
   * A row's own menu, or null: the person's drafts have one (Continue editing, Discard). With it
   * the grid ends in the row button's column, as the library's does.
   */
  rowMenu?: (row: ProposalRow) => ReactNode
}) {
  const select = narrow ? undefined : selection
  return (
    <div className="flex flex-col">
      {note}
      <div role="table" aria-label={label} data-slot="proposal-list" className="flex flex-col">
        {narrow ? null : (
          <ProposalHeaderRow
            columns={columns}
            selection={select}
            rows={select ? rows.filter((row) => !select.blocked(row)).length : 0}
            rowButton={rowMenu !== undefined}
          />
        )}
        <div role="rowgroup" className="flex flex-col">
          {entries.map((entry, index) =>
            entry.type === 'group' ? (
              <GroupRow
                key={`group:${entry.stage}`}
                entry={entry}
                narrow={narrow}
                first={index === 0}
              />
            ) : narrow ? (
              <NarrowRow
                key={entry.row.id}
                panel={panel}
                row={entry.row}
                today={today}
                terms={terms}
                menu={rowMenu?.(entry.row)}
              />
            ) : (
              <GridRow
                key={entry.row.id}
                panel={panel}
                row={entry.row}
                columns={columns}
                today={today}
                terms={terms}
                selection={select}
                menu={rowMenu ? rowMenu(entry.row) : undefined}
              />
            ),
          )}
        </div>
      </div>
      {narrow ? null : (
        <Footer
          rows={rows}
          columns={columns}
          today={today}
          selectable={Boolean(select)}
          rowButton={rowMenu !== undefined}
        />
      )}
    </div>
  )
}
