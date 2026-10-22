import { phoneRowTitle } from '@/components/page/grid'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  GitCompareArrowsIcon,
  HeedRiskIcon,
  ListChecksIcon,
  TagIcon,
  TimerIcon,
  TypeIcon,
  UserRoundPenIcon,
  type Icon,
} from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import {
  DateBadge,
  DomainBadge,
  KindIcon,
  Owner,
  ProposalStatusBadge,
} from '@/components/item/item-marks'
import { highlight } from '@/components/library/item-list'
import {
  gridCell,
  gridGroupRow,
  gridHeaderRow,
  gridRow,
  gridRowControl,
  gridRowTitle,
} from '@/components/page/grid'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { RowSelectCell } from './row-select'
import { Kbd } from '@/components/ui/kbd'
import { checkLevelWords } from '@domain/bulk-review'
import { daysFrom, formatDay } from '@/lib/library'
import { queueChangeLabel, queueTotals, type QueueEntry, type QueueRow } from '@/lib/review'
import { openRowClass } from '@/components/page/dock-panel'
import { cn } from '@/lib/utils'
import { panelLink, type RowPanel } from './row-panel'
import { queueColumnSpecs, type QueueColumnId } from './queue-columns'

/*
  The To review queue (frame C1 of the front end plan): direction A's grid, grouped by domain
  (so the Domain column is dropped), ordered by risk, then by how long each has waited (FR-208).
  Status is soft only where it asks for a look, with the reviewer who holds it beside it; Due is
  soft amber when near and soft red when late; Risk is three bars. The totals under the grid
  replace the per-column footer. On a phone every proposal is a card, the whole card one target.
*/

const fieldIcons: Record<QueueColumnId | 'title', Icon> = {
  title: TypeIcon,
  change: GitCompareArrowsIcon,
  status: CircleDashedIcon,
  checks: ListChecksIcon,
  risk: HeedRiskIcon,
  due: TimerIcon,
  proposer: UserRoundPenIcon,
}

/** The icon of a row: the kind of context, or a tag for a vocabulary term. */
function RowIcon({ row, className }: { row: QueueRow; className?: string }) {
  if (row.kind) return <KindIcon kind={row.kind} className={className} />
  return (
    <TagIcon
      role="img"
      aria-label="Name in the Catalogue"
      aria-hidden={false}
      data-slot="kind-icon"
      className={cn('size-4 shrink-0 text-muted-foreground', className)}
    />
  )
}

/**
 * The required checks at a glance (FR-223): failed ones in danger with their count, the ones not
 * yet passed as waiting, or Passed; a term and a retirement have none. The levels are named in
 * the tooltip and for a screen reader.
 */
export function QueueChecks({ checks, size = 'sm' }: { checks: QueueRow['checks']; size?: 'sm' }) {
  if (!checks) return <span className="text-muted-foreground">-</span>
  const names = (levels: readonly (keyof typeof checkLevelWords)[]) =>
    levels.map((level) => checkLevelWords[level]).join(', ')
  if (checks.failed.length)
    return (
      <Badge
        size={size}
        form="soft"
        tone="danger"
        icon={CircleXIcon}
        title={`Failed: ${names(checks.failed)}`}
        data-slot="queue-checks"
        data-checks="failed"
      >
        {checks.failed.length} failed
        <span className="sr-only">: {names(checks.failed)}</span>
      </Badge>
    )
  if (checks.waiting.length)
    return (
      <Badge
        size={size}
        form="bare"
        quiet
        icon={CircleDashedIcon}
        title={`Not passed yet: ${names(checks.waiting)}`}
        data-slot="queue-checks"
        data-checks="waiting"
      >
        {checks.waiting.length} to come
        <span className="sr-only">: {names(checks.waiting)}</span>
      </Badge>
    )
  return (
    <Badge
      size={size}
      form="bare"
      tone="success"
      icon={CircleCheckIcon}
      data-slot="queue-checks"
      data-checks="passed"
    >
      Passed
    </Badge>
  )
}

/** The rows' selection, on a screen wide enough to select (FR-223). */
export type QueueSelection = {
  selected: ReadonlySet<string>
  /** Selects or unselects a row; `range` selects every row from the anchor to it (Shift). */
  onToggle: (id: string, range: boolean) => void
  onToggleAll: () => void
  /** Why the person cannot select a row, and who decides it; null when they can. */
  blocked: (row: QueueRow) => string | null
}

const firstName = (name: string) => name.split(' ')[0] ?? name

/** "you", or the first name of whoever holds it, beside the status. */
function Holder({ row, viewerId }: { row: QueueRow; viewerId: string }) {
  if (!row.claimedBy) return null
  return (
    <span className="truncate text-caption text-muted-foreground">
      {row.claimedBy === viewerId ? 'you' : firstName(row.claimedByName ?? 'someone')}
    </span>
  )
}

function Cell({
  column,
  row,
  today,
  viewerId,
}: {
  column: QueueColumnId
  row: QueueRow
  today: string | null
  viewerId: string
}) {
  const spec = queueColumnSpecs[column]
  let content: ReactNode
  switch (column) {
    case 'change':
      content = <span className="text-muted-foreground">{queueChangeLabel(row)}</span>
      break
    case 'checks':
      content = <QueueChecks checks={row.checks} />
      break
    case 'status':
      content = (
        <span className="flex min-w-0 items-center gap-2">
          <ProposalStatusBadge state={row.state} size="sm" />
          <Holder row={row} viewerId={viewerId} />
        </span>
      )
      break
    case 'risk':
      content = row.riskLevel ? (
        <RiskBadge level={row.riskLevel} form="bare" />
      ) : (
        <span className="text-muted-foreground">-</span>
      )
      break
    case 'due':
      content = row.dueOn ? <DateBadge date={row.dueOn} today={today} deadline size="sm" /> : null
      break
    case 'proposer':
      content = <Owner name={row.proposerName} personId={row.proposerId} size="sm" />
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
export function QueueHeaderRow({
  columns,
  selection,
  rows = 0,
}: {
  columns: QueueColumnId[]
  selection?: QueueSelection
  /** How many rows the selection can hold: the ones the person may decide. */
  rows?: number
}) {
  const cell = (id: QueueColumnId | 'title', title: string, className: string) => {
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
                  all || some ? 'Clear the selection' : 'Select every proposal you can decide'
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
          cell(column, queueColumnSpecs[column].title, queueColumnSpecs[column].widthClass),
        )}
      </div>
    </div>
  )
}

function GroupRow({
  entry,
  narrow,
  first,
}: {
  entry: Extract<QueueEntry, { type: 'group' }>
  narrow: boolean
  first: boolean
}) {
  return (
    <div
      role="row"
      data-layout={narrow && first ? 'content' : undefined}
      data-group={entry.areaId ?? 'none'}
      className={gridGroupRow}
    >
      <div
        role="rowheader"
        className={cn('flex min-w-0 flex-1 items-center gap-2 text-dense', !narrow && 'px-3')}
      >
        <DomainBadge name={entry.name} label={entry.label} form="bare" />
        <span className="text-caption text-muted-foreground tabular-nums">
          {entry.count.toLocaleString('en')}
        </span>
      </div>
    </div>
  )
}

/** The title cell's left edge after the checkbox column (as the library's). */
const titleAfterSelect = 'border-l-0 pl-1'

function GridRow({
  row,
  columns,
  today,
  terms,
  viewerId,
  panel,
  selection,
}: {
  row: QueueRow
  columns: QueueColumnId[]
  today: string | null
  terms: string[]
  viewerId: string
  panel: RowPanel
  selection?: QueueSelection
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
        <Cell key={column} column={column} row={row} today={today} viewerId={viewerId} />
      ))}
    </div>
  )
}

function dueWords(row: QueueRow, today: string | null) {
  if (!row.dueOn) return null
  const days = today ? daysFrom(today, row.dueOn) : null
  if (days === null) return { text: `Due ${formatDay(row.dueOn)}`, late: false }
  if (days < 0) return { text: `Overdue ${-days} ${days === -1 ? 'day' : 'days'}`, late: true }
  if (days === 0) return { text: 'Due today', late: false }
  return { text: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, late: false }
}

function NarrowRow({
  row,
  today,
  terms,
  viewerId,
  panel,
}: {
  row: QueueRow
  today: string | null
  terms: string[]
  viewerId: string
  panel: RowPanel
}) {
  const due = dueWords(row, today)
  const [first, ...rest] = row.proposerName.split(' ')
  return (
    <div
      role="row"
      data-row-id={row.id}
      data-state={row.state}
      data-open={row.id === panel.openId || undefined}
      className={cn(
        'relative flex min-h-row-phone items-start gap-3 border-b border-border-subtle px-gutter py-3 -outline-offset-2 has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
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
          {row.riskLevel === 'high' ? <RiskBadge level="high" size="sm" /> : null}
          <ProposalStatusBadge state={row.state} size="sm" />
          {row.checks?.failed.length ? <QueueChecks checks={row.checks} /> : null}
          {row.claimedBy ? (
            <span className="text-caption text-muted-foreground">
              {row.claimedBy === viewerId ? 'you' : firstName(row.claimedByName ?? 'someone')}
            </span>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground tabular-nums">
          <span>{queueChangeLabel(row)}</span>
          {due ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={cn(due.late && 'text-status-danger-fg')}>{due.text}</span>
            </>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-1">
            {first}
            {rest.length ? ` ${rest.at(-1)?.[0] ?? ''}.` : ''}
          </span>
        </p>
      </div>
    </div>
  )
}

/** The totals under the grid: how many, how many high risk, how many overdue, and the keys. */
function Footer({
  rows,
  today,
  selectable,
}: {
  rows: readonly QueueRow[]
  today: string | null
  selectable: boolean
}) {
  const totals = queueTotals(rows, today)
  const total = (value: number, words: string) => (
    <span className="inline-flex items-center gap-1">
      <span className="font-bold text-foreground tabular-nums">{value.toLocaleString('en')}</span>
      {words}
    </span>
  )
  return (
    <div
      role="group"
      aria-label="Totals"
      data-slot="list-footer"
      data-launcher-clear
      className="sticky bottom-0 z-sticky flex h-footer items-center gap-6 border-t border-border-subtle bg-background px-gutter text-caption text-muted-foreground"
    >
      <span className="flex items-center gap-6 px-3">
        {total(totals.count, totals.count === 1 ? 'proposal' : 'proposals')}
        {total(totals.high, 'high risk')}
        {total(totals.overdue, 'overdue')}
      </span>
      <span className="hidden items-center gap-1 @4xl:inline-flex">
        Enter opens one, <Kbd>j</Kbd> <Kbd>k</Kbd> move
        {selectable ? (
          <>
            , <Kbd>x</Kbd> selects, <Kbd>Shift</Kbd> <Kbd>j</Kbd> <Kbd>k</Kbd> select as they move
          </>
        ) : null}
      </span>
    </div>
  )
}

/** The queue as the grid, or as cards on a narrow screen, with the totals under it. */
export function QueueList({
  note,
  entries,
  rows,
  columns,
  narrow,
  today,
  terms,
  viewerId,
  panel,
  selection,
}: {
  /** The line above the list when the person cannot decide some of its proposals. */
  note?: ReactNode
  entries: readonly QueueEntry[]
  rows: readonly QueueRow[]
  columns: QueueColumnId[]
  narrow: boolean
  today: string | null
  terms: string[]
  viewerId: string
  /** How a row opens its proposal in the docked panel. */
  panel: RowPanel
  /** The rows' selection; absent where rows are not selected (a phone, a touch screen). */
  selection?: QueueSelection
}) {
  return (
    <div className="flex flex-col">
      {note}
      <div
        role="table"
        aria-label="Proposals to review"
        data-slot="review-queue"
        className="flex flex-col"
      >
        {narrow ? null : (
          <QueueHeaderRow
            columns={columns}
            selection={selection}
            rows={selection ? rows.filter((row) => !selection.blocked(row)).length : 0}
          />
        )}
        <div role="rowgroup" className="flex flex-col">
          {entries.map((entry, index) =>
            entry.type === 'group' ? (
              <GroupRow
                key={`group:${entry.areaId ?? 'none'}`}
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
                viewerId={viewerId}
              />
            ) : (
              <GridRow
                key={entry.row.id}
                panel={panel}
                row={entry.row}
                columns={columns}
                today={today}
                terms={terms}
                viewerId={viewerId}
                selection={narrow ? undefined : selection}
              />
            ),
          )}
        </div>
      </div>
      {narrow ? null : <Footer rows={rows} today={today} selectable={Boolean(selection)} />}
    </div>
  )
}
