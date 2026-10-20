import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { EditionChangeKind } from '@domain/editions'
import type { Area, Person } from '@domain/item'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  HeedDomainIcon,
  HeedRiskIcon,
  TypeIcon,
  UserRoundCheckIcon,
  type Icon,
} from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { DomainBadge, KindIcon, Owner } from '@/components/item/item-marks'
import { openRowClass } from '@/components/page/dock-panel'
import {
  gridCell,
  gridGroupRow,
  gridHeaderRow,
  gridRow,
  gridRowTitle,
  phoneRowTitle,
} from '@/components/page/grid'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  compareColumnSpecs,
  viewedKey,
  type CompareColumnId,
  type CompareEntry,
  type ComparedItem,
} from '@/lib/edition-compare'
import { panelRowHistory } from '@/lib/history'
import { changeLabels } from '@/lib/edition-diff'
import { cn } from '@/lib/utils'
import { EditionChangeBadge } from './change-card'

/*
  The changed items between two editions as one windowed grid (Editions design, S2): a group per
  kind of change, each a header that opens and closes, then 40 pixel rows on the shared grid
  classes: the item, its domain, its risk, who decided and the Viewed box. Below the smallest
  table every item is the narrow row. The page scrolls, not a box inside it, so a comparison of
  thousands of items stays one list; rows that are not loaded yet are placeholders, and one that
  scrolls into view asks for its group's next page. A row opens its item in the docked panel.
*/

const headerIcons: Record<CompareColumnId | 'title', Icon> = {
  title: TypeIcon,
  domain: HeedDomainIcon,
  risk: HeedRiskIcon,
  by: UserRoundCheckIcon,
  viewed: EyeIcon,
}

/** Who decided a change: the last accept or retire by an owner, deputy or administrator. */
export function decidedBy(item: Pick<ComparedItem, 'why'>): string | null {
  const deciding = item.why.decisions.filter((decision) => decision.capacity !== 'approver')
  return (deciding.at(-1) ?? item.why.decisions.at(-1))?.decidedBy ?? null
}

export function CompareHeaderRow({ columns }: { columns: readonly CompareColumnId[] }) {
  const cell = (id: CompareColumnId | 'title', title: string, className: string) => {
    const Glyph = headerIcons[id]
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
        {cell('title', 'Fact', 'min-w-0 flex-1')}
        {columns.map((column) =>
          cell(column, compareColumnSpecs[column].title, compareColumnSpecs[column].widthClass),
        )}
      </div>
    </div>
  )
}

/** How a row opens its item in the docked panel, and marks it viewed. */
export type CompareRowActions = {
  /** The item open in the panel. */
  openId: string | null
  viewed: ReadonlySet<string>
  onToggleViewed: (item: ComparedItem) => void
}

/** The link that opens an item in the docked panel, keeping the range, the view and the filters. */
function ItemLink({
  item,
  actions,
  className,
}: {
  item: ComparedItem
  actions: CompareRowActions
  className?: string
}) {
  return (
    <Link
      from="/editions/compare"
      to="/editions/compare"
      search={(previous) => ({ ...previous, item: item.itemId, step: undefined })}
      {...panelRowHistory(actions.openId !== null)}
      resetScroll={false}
      data-row-link
      className={className}
    >
      {item.title}
    </Link>
  )
}

function ViewedBox({
  item,
  actions,
  className,
}: {
  item: ComparedItem
  actions: CompareRowActions
  className?: string
}) {
  return (
    <Checkbox
      checked={actions.viewed.has(viewedKey(item))}
      onCheckedChange={() => actions.onToggleViewed(item)}
      aria-label={`Viewed: ${item.title}`}
      className={cn('relative z-raised', className)}
    />
  )
}

type Lookups = {
  areas: readonly Area[]
  personOf: (id: string) => Person | null
}

function Cell({
  column,
  item,
  actions,
  lookups,
}: {
  column: CompareColumnId
  item: ComparedItem
  actions: CompareRowActions
  lookups: Lookups
}) {
  const spec = compareColumnSpecs[column]
  let content
  switch (column) {
    case 'domain': {
      const area = lookups.areas.find((candidate) => candidate.id === item.areaId)
      content = area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null
      break
    }
    case 'risk':
      content = <RiskBadge level={item.riskLevel} size="sm" />
      break
    case 'by': {
      const id = decidedBy(item)
      const person = id ? lookups.personOf(id) : null
      content = person ? (
        <Owner name={person.name} initials={person.initials} size="sm" />
      ) : (
        <span className="truncate text-muted-foreground">{id ? 'Someone' : 'No decision'}</span>
      )
      break
    }
    case 'viewed':
      content = <ViewedBox item={item} actions={actions} />
      break
  }
  return (
    <div
      role="cell"
      className={cn(gridCell, spec.widthClass, column === 'viewed' && 'justify-center')}
    >
      {content}
    </div>
  )
}

function GroupRow({
  kind,
  total,
  collapsed,
  narrow,
  onToggle,
}: {
  kind: EditionChangeKind
  total: number | null
  collapsed: boolean
  /** On the narrow rows the header starts at the gutter; in the grid it lines up with the titles. */
  narrow: boolean
  onToggle: () => void
}) {
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon
  return (
    <div role="row" data-group={kind} className={cn(gridGroupRow, 'h-row')}>
      <div role="rowheader" className={cn('flex min-w-0 flex-1 items-center', !narrow && 'px-3')}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${changeLabels[kind]}, ${total === null ? 'counting' : total.toLocaleString('en')} ${total === 1 ? 'fact' : 'facts'}`}
          className={cn(
            'inline-flex h-control-sm min-w-0 items-center gap-2 rounded-sm text-dense font-bold -outline-offset-2',
            narrow && 'min-h-control-touch',
          )}
        >
          <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <EditionChangeBadge change={kind} />
          <span className="text-caption font-normal text-muted-foreground tabular-nums">
            {total === null ? '' : total.toLocaleString('en')}
          </span>
        </button>
      </div>
    </div>
  )
}

function ItemRow({
  item,
  columns,
  narrow,
  actions,
  lookups,
}: {
  item: ComparedItem
  columns: readonly CompareColumnId[]
  narrow: boolean
  actions: CompareRowActions
  lookups: Lookups
}) {
  const viewed = actions.viewed.has(viewedKey(item))
  if (narrow) {
    const area = lookups.areas.find((candidate) => candidate.id === item.areaId)
    const by = decidedBy(item)
    const person = by ? lookups.personOf(by) : null
    return (
      <>
        <div role="cell" className="flex shrink-0" data-edge="start">
          <KindIcon kind={item.kind} />
        </div>
        <div role="cell" className="flex min-w-0 flex-1 flex-col gap-2">
          <ItemLink
            item={item}
            actions={actions}
            className={cn(phoneRowTitle, viewed && 'text-muted-foreground')}
          />
          <div className="flex flex-wrap items-center gap-2">
            {area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null}
            {item.riskLevel === 'high' ? <RiskBadge level="high" size="sm" /> : null}
            {person ? (
              <span className="text-caption text-muted-foreground">{person.name}</span>
            ) : null}
          </div>
        </div>
        <div role="cell" className="flex shrink-0 items-center self-center">
          <ViewedBox item={item} actions={actions} />
        </div>
      </>
    )
  }
  return (
    <>
      <div role="cell" className={cn(gridCell, 'flex-1 shrink gap-3')}>
        <KindIcon kind={item.kind} className="relative" />
        <ItemLink
          item={item}
          actions={actions}
          className={cn(gridRowTitle, viewed && 'text-muted-foreground')}
        />
      </div>
      {columns.map((column) => (
        <Cell key={column} column={column} item={item} actions={actions} lookups={lookups} />
      ))}
    </>
  )
}

function PendingRow({ columns, narrow }: { columns: readonly CompareColumnId[]; narrow: boolean }) {
  if (narrow)
    return (
      <div className="flex flex-1 flex-col gap-2 pt-1" aria-hidden="true">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-5 w-1/2 rounded-badge" />
      </div>
    )
  return (
    <>
      <div className={cn(gridCell, 'flex-1 shrink gap-3')} aria-hidden="true">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      {columns.map((column) => (
        <div key={column} className={cn(gridCell, compareColumnSpecs[column].widthClass)}>
          {column === 'viewed' ? null : <Skeleton className="h-3 w-2/3" />}
        </div>
      ))}
    </>
  )
}

const rowHeight = (entry: CompareEntry | undefined, narrow: boolean) =>
  entry?.type === 'group' || !narrow ? 40 : 88

export function CompareList({
  entries,
  columns,
  narrow,
  actions,
  lookups,
  stickyOffset,
  onToggleGroup,
  onNeedMore,
}: {
  entries: readonly CompareEntry[]
  columns: readonly CompareColumnId[]
  narrow: boolean
  actions: CompareRowActions
  lookups: Lookups
  /** How much of the window the sticky bars above the rows cover. */
  stickyOffset: number
  onToggleGroup: (kind: EditionChangeKind) => void
  /** A placeholder of this group scrolled into view: read its next page. */
  onNeedMore: (kind: EditionChangeKind) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return
    const measure = () => setScrollMargin(element.getBoundingClientRect().top + window.scrollY)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [])

  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: (index) => rowHeight(entries[index], narrow),
    getItemKey: (index) => {
      const entry = entries[index]
      if (!entry) return index
      return entry.type === 'group'
        ? `group:${entry.kind}`
        : entry.type === 'item'
          ? entry.item.itemId
          : `pending:${entry.kind}:${entry.index}`
    },
    overscan: 12,
    scrollMargin,
    scrollPaddingStart: stickyOffset,
    scrollPaddingEnd: 72,
  })
  const shown = virtualizer.getVirtualItems()

  // A placeholder in view (or just below it) asks for its group's next page.
  const wanted = [
    ...new Set(
      shown
        .map((virtual) => entries[virtual.index])
        .filter((entry) => entry?.type === 'pending')
        .map((entry) => entry.kind),
    ),
  ].join(',')
  // Asked again as each page arrives: the next placeholders may still be in view.
  const loaded = entries.reduce((count, entry) => count + (entry.type === 'item' ? 1 : 0), 0)
  useEffect(() => {
    for (const kind of wanted ? wanted.split(',') : []) onNeedMore(kind as EditionChangeKind)
  }, [wanted, loaded, onNeedMore])

  // The item open in the panel stays in view as j and k move it.
  const openIndex = entries.findIndex(
    (entry) => entry.type === 'item' && entry.item.itemId === actions.openId,
  )
  useEffect(() => {
    if (openIndex === -1) return
    const measured = virtualizer.measurementsCache[openIndex]
    if (!measured) return
    const top = measured.start - window.scrollY
    if (top < stickyOffset || top + measured.size > window.innerHeight)
      virtualizer.scrollToIndex(openIndex, { align: 'auto' })
    // Only when another item opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndex])

  return (
    <div
      ref={listRef}
      role="rowgroup"
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {shown.map((virtual) => {
        const entry = entries[virtual.index]
        if (!entry) return null
        const position = { transform: `translateY(${virtual.start - scrollMargin}px)` }
        if (entry.type === 'group')
          return (
            <div
              key={virtual.key}
              data-index={virtual.index}
              className="absolute top-0 left-0 w-full"
              style={position}
            >
              <GroupRow
                kind={entry.kind}
                total={entry.total}
                collapsed={entry.collapsed}
                narrow={narrow}
                onToggle={() => onToggleGroup(entry.kind)}
              />
            </div>
          )
        const item = entry.type === 'item' ? entry.item : null
        return (
          <div
            key={virtual.key}
            ref={narrow ? virtualizer.measureElement : undefined}
            data-index={virtual.index}
            // A placeholder is not a row yet: the list's status says it is loading.
            role={item ? 'row' : undefined}
            data-row-id={item?.itemId}
            data-pending={item ? undefined : true}
            data-open={(item && item.itemId === actions.openId) || undefined}
            data-viewed={(item && actions.viewed.has(viewedKey(item))) || undefined}
            data-layout={narrow && virtual.index === 0 ? 'content' : undefined}
            className={cn(
              narrow
                ? 'min-h-row-phone items-start gap-3 border-b border-border-subtle py-3'
                : cn(gridRow, 'h-row', item && 'hover:bg-accent'),
              'group/row absolute top-0 left-0 flex w-full px-gutter -outline-offset-2 has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
              openRowClass,
            )}
            style={position}
          >
            {item ? (
              <ItemRow
                item={item}
                columns={columns}
                narrow={narrow}
                actions={actions}
                lookups={lookups}
              />
            ) : (
              <PendingRow columns={columns} narrow={narrow} />
            )}
          </div>
        )
      })}
    </div>
  )
}
