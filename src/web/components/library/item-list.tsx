import { phoneRowTitle } from '@/components/page/grid'
import {
  forwardRef,
  Fragment,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from '@tanstack/react-router'
import type { ItemKind } from '@domain/item'
import { openRowClass } from '@/components/page/dock-panel'
import {
  gridCell,
  gridFooter,
  gridGroupRow,
  gridHeaderRow,
  gridRow,
  gridRowControl,
  gridRowTitle,
} from '@/components/page/grid'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { needsALook } from '@domain/status'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarCheckIcon,
  CalendarIcon,
  CalendarSyncIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  GitCommitHorizontalIcon,
  HeedDomainIcon,
  HeedValidUntilIcon,
  PlusIcon,
  ShapesIcon,
  TagIcon,
  TypeIcon,
  UserRoundIcon,
  type Icon,
} from '@/components/icons'
import {
  DateBadge,
  DomainBadge,
  KindBadge,
  KindIcon,
  Owner,
  StatusMark,
} from '@/components/item/item-marks'
import { PreviewLink } from '@/components/preview/preview-link'
import { Checkbox } from '@/components/ui/checkbox'
import { PersonPreview } from '@/components/preview/preview-link'
import {
  daysFrom,
  formatDay,
  isEndedIssueRow,
  isLiveIssueRow,
  type GroupHeader,
  type LibraryRow,
  type LibrarySort,
  type ListEntry,
  type SortState,
} from '@/lib/library'
import { panelRowHistory } from '@/lib/history'
import type { Density } from '@/lib/preferences'
import type { PreviewTarget } from '@/lib/preview'
import type { LibraryRouteSearch, LibrarySearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { columnSpecs, type ColumnId } from './columns'
import { RowMenu } from './row-menu'
import { RowStatus } from './status-icon'

/** Marks the words of a search in a title with the `mark` element (contract 8.2). */
export function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="bg-transparent font-bold text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

export type ItemListHandle = {
  /**
   * Scrolls a row into view below the sticky header, then focuses its link. `visible: false`
   * keeps the focus ring off when no key moved the focus (the ring is for the keyboard, 8.2).
   */
  focusRow: (id: string, options?: { scroll?: boolean; visible?: boolean }) => void
}

type ItemListProps = {
  entries: ListEntry[]
  columns: ColumnId[]
  narrow: boolean
  density: Density
  /** The service's day, for the date badges. */
  today: string | null
  terms: string[]
  /** The list's own params, carried to every row's panel link and the item page. */
  linkSearch: LibrarySearch
  /** The item open in the docked panel, and the panel's tab, which the next row opens on. */
  openId: string | null
  panelTab: LibraryRouteSearch['tab']
  cursorId: string | null
  selected: ReadonlySet<string>
  selectable: boolean
  /** Height of the sticky block above the rows (header, toolbar, column header). */
  stickyOffset: number
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (key: string) => void
  onCursor: (id: string) => void
  onToggleSelected: (id: string, range: boolean) => void
  onOpen: (id: string) => void
  /** An administrator's Move to Bin in a row's menu; left out for everyone else. */
  onMoveToBin?: (row: { id: string; kind: ItemKind; title: string }) => void
}

/** Row heights of the grid (contract 4.5, 8.2): compact 40 (the default), comfortable 48, with scope 64. */
export function rowHeight(density: Density) {
  return density === 'compact' ? 40 : density === 'scope' ? 64 : 48
}

const rowClass: Record<Density, string> = {
  compact: 'h-row',
  comfortable: 'h-row-comfortable',
  scope: 'h-row-scope',
}

/** One field, one icon: the same glyph in the column header, filters and the item's details. */
export const fieldIcons: Record<ColumnId | 'title', Icon> = {
  title: TypeIcon,
  domain: HeedDomainIcon,
  about: TagIcon,
  kind: ShapesIcon,
  status: CircleDashedIcon,
  until: HeedValidUntilIcon,
  owner: UserRoundIcon,
  starts: CalendarIcon,
  checked: CalendarCheckIcon,
  review: CalendarSyncIcon,
  version: GitCommitHorizontalIcon,
}

/*
  With a checkbox column the row's kind sits in it, and the title cell follows without a line, 4
  pixels in: the select column and the title read as one cell (the professional pass, rule 8).
*/
const titleAfterSelect = 'border-l-0 pl-1'

/**
 * Where an item applies, as names that link to their catalogue page and preview it (a metric, a
 * dimension and its value, or a dimension with any value), above the row's own link. `limit` shows the first names and the
 * count of the rest. The row owns the keyboard (arrows move the cursor, Enter opens the item), so
 * the names are for the pointer; the item's page lists the same chips for the keyboard.
 */
function AboutNames({
  row,
  limit,
  className,
}: {
  row: LibraryRow
  limit?: number
  className?: string
}) {
  const targets: PreviewTarget[] = [
    ...row.scope.metrics.map((id) => ({ type: 'metric' as const, id })),
    ...row.scope.dimensionValues.map(({ dimension, value }) => ({
      type: 'val' as const,
      dimension,
      value,
    })),
    ...row.scope.dimensions.map((id) => ({ type: 'dim' as const, id })),
  ]
  const shown = limit === undefined ? row.about : row.about.slice(0, limit)
  const rest = row.about.length - shown.length
  return (
    <span className={cn('block min-w-0 truncate text-muted-foreground', className)}>
      {shown.map((name, index) => {
        const target = targets[index]
        return (
          <Fragment key={`${index}-${name}`}>
            {index > 0 ? ' · ' : null}
            {target ? (
              <PreviewLink
                preview={target}
                tabIndex={-1}
                className="relative z-raised hover:text-foreground hover:underline hover:underline-offset-4"
              >
                {name}
              </PreviewLink>
            ) : (
              name
            )}
          </Fragment>
        )
      })}
      {rest > 0 ? <span title={row.about.slice(shown.length).join(', ')}> +{rest}</span> : null}
    </span>
  )
}

function Cell({ column, row, today }: { column: ColumnId; row: LibraryRow; today: string | null }) {
  const spec = columnSpecs[column]
  // Badges in rows are the 20 pixel form in every density (the professional pass, rule 5).
  const size = 'sm'
  let content: ReactNode
  switch (column) {
    case 'domain':
      content = <DomainBadge name={row.areaName} label={row.areaLabel} size={size} />
      break
    case 'about':
      content = <AboutNames row={row} limit={2} />
      break
    case 'kind':
      content = <KindBadge kind={row.kind} size={size} />
      break
    case 'status':
      // A calm status is one glyph, the name in its tooltip (round 2.1): a column of words read
      // as a wall. A status that asks for a look also says it in words, as on a phone (A8).
      content = <RowStatus status={row.displayStatus} short />
      break
    case 'until':
      content = <DateBadge date={row.until} today={today} size={size} />
      break
    case 'owner':
      content = (
        <PersonPreview personId={row.ownerId} tabIndex={-1}>
          <Owner
            name={row.ownerName}
            personId={row.ownerId}
            initials={row.ownerInitials}
            size="sm"
          />
        </PersonPreview>
      )
      break
    case 'starts':
      content = formatDay(row.validity.start)
      break
    case 'checked':
      content = formatDay(row.updatedAt)
      break
    case 'review':
      content = <DateBadge date={row.reviewDate} today={today} deadline empty="None" size={size} />
      break
    case 'version':
      content = `v${row.version}`
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
 * The column header (contract 8.1): 36 high, 12/400 muted labels, a field icon before every name
 * but Title, lines between the cells, sorting buttons with `aria-sort`, and a checkbox that
 * selects every row in the list. The checkbox shows while something is selected, or while the
 * header is hovered or focused from the keyboard.
 */
export function ColumnHeader({
  columns,
  sortState,
  onSort,
  selection,
}: {
  columns: ColumnId[]
  sortState: SortState
  onSort: (sort: LibrarySort) => void
  /** Present when rows can be selected: the header checkbox selects or clears them all. */
  selection?: { selected: number; total: number; onToggleAll: () => void }
}) {
  const sortCell = (
    title: string,
    sort: LibrarySort | undefined,
    Glyph: Icon | null,
    className: string,
    key?: string,
  ) => {
    const direction =
      sortState.sort !== 'relevance' && sort === sortState.sort ? sortState.dir : null
    const active = direction !== null
    const label = (
      <>
        {Glyph ? <Glyph aria-hidden="true" className="size-icon-sm shrink-0 heed-ink" /> : null}
        <span className="truncate">{title}</span>
      </>
    )
    return (
      <div
        key={key}
        role="columnheader"
        aria-sort={
          direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined
        }
        className={cn(gridCell, className)}
      >
        {sort ? (
          <button
            type="button"
            onClick={() => onSort(sort)}
            className={cn(
              'inline-flex h-control-sm min-w-0 items-center gap-2 rounded-sm -outline-offset-2 hover:text-foreground',
              active && 'text-foreground',
            )}
          >
            {label}
            {direction === 'asc' ? (
              <ArrowUpIcon aria-hidden="true" className="size-icon-sm shrink-0" />
            ) : direction === 'desc' ? (
              <ArrowDownIcon aria-hidden="true" className="size-icon-sm shrink-0" />
            ) : null}
          </button>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-2">{label}</span>
        )}
      </div>
    )
  }
  const all =
    selection !== undefined && selection.total > 0 && selection.selected === selection.total
  const some = selection !== undefined && selection.selected > 0 && !all
  return (
    <div role="rowgroup" className="sticky top-(--list-sticky-top) z-sticky">
      <div
        role="row"
        aria-rowindex={1}
        data-layout="content"
        className={cn('group/row', gridHeaderRow)}
      >
        {selection ? (
          <div
            role="columnheader"
            data-edge="start"
            className="flex w-column-select shrink-0 items-center justify-center"
          >
            <Checkbox
              checked={all}
              indeterminate={some}
              onCheckedChange={selection.onToggleAll}
              aria-label={all || some ? 'Clear the selection' : 'Select every fact in the list'}
              className={cn(!(all || some) && gridRowControl)}
            />
          </div>
        ) : null}
        {/* With a checkbox column the kinds sit in it, so Title needs no field icon of its own. */}
        {selection
          ? sortCell('Title', 'title', null, cn('min-w-0 flex-1', titleAfterSelect))
          : sortCell('Title', 'title', fieldIcons.title, 'min-w-0 flex-1')}
        {columns.map((column) =>
          sortCell(
            columnSpecs[column].title,
            columnSpecs[column].sort,
            fieldIcons[column],
            columnSpecs[column].widthClass,
            column,
          ),
        )}
        <div role="columnheader" className={cn(gridCell, 'w-row-button')}>
          <span className="sr-only">Actions</span>
        </div>
      </div>
    </div>
  )
}

/**
 * The add row under the last row of the grid (direction A): a link, outside the table and its row
 * count. With a checkbox column its plus sits where the rows show their kind.
 */
export function AddRow({
  columns,
  density,
  narrow,
  selectable,
}: {
  columns: ColumnId[]
  density: Density
  narrow: boolean
  selectable: boolean
}) {
  const link =
    'flex items-center gap-3 font-bold text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
  const plus = <PlusIcon className="size-4 shrink-0" aria-hidden />
  const text = <span className="truncate text-dense">Add a fact</span>
  const label = (
    <>
      {plus}
      {text}
    </>
  )
  if (narrow) {
    return (
      <Link
        to="/library/new"
        data-slot="add-row"
        className={cn(link, 'min-h-row-phone border-b px-gutter')}
      >
        {label}
      </Link>
    )
  }
  return (
    <div
      data-slot="add-row"
      className={cn(
        'flex items-stretch border-b border-border-subtle px-gutter',
        rowClass[density],
      )}
    >
      {selectable ? (
        <Link to="/library/new" className={cn(link, 'flex-1 gap-0')}>
          <span className="flex w-column-select shrink-0 justify-center">{plus}</span>
          <span className={cn(gridCell, 'flex-1', titleAfterSelect)}>{text}</span>
        </Link>
      ) : (
        <Link to="/library/new" className={cn(link, gridCell, 'flex-1')}>
          {label}
        </Link>
      )}
      {columns.map((column) => (
        <div key={column} className={cn(gridCell, columnSpecs[column].widthClass)} />
      ))}
      <div className={cn(gridCell, 'w-row-button')} />
    </div>
  )
}

/** The totals under the grid, which follow the search and the filters (direction A). */
export function ListFooter({
  rows,
  columns,
  selectable,
  today,
}: {
  rows: LibraryRow[]
  columns: ColumnId[]
  selectable: boolean
  today: string | null
}) {
  const count = (values: Iterable<unknown>) => new Set(values).size
  const total = (value: number, one: string, many: string) => (
    <>
      <span className="font-bold text-foreground tabular-nums">{value.toLocaleString('en')}</span>
      {value === 1 ? one : many}
    </>
  )
  const totals: Partial<Record<ColumnId, ReactNode>> = {
    domain: total(count(rows.map((row) => row.areaId)), 'domain', 'domains'),
    status: total(
      rows.filter((row) => needsALook(row.displayStatus)).length,
      'needs checking',
      'need checking',
    ),
    until: total(
      rows.filter((row) => {
        if (row.until === null || today === null) return false
        const days = daysFrom(today, row.until)
        return days >= 0 && days <= 30
      }).length,
      'ending soon',
      'ending soon',
    ),
    owner: total(count(rows.map((row) => row.ownerId)), 'owner', 'owners'),
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
        {total(rows.length, 'fact', 'facts')}
      </div>
      {columns.map((column) => (
        <div key={column} className={cn(gridCell, 'gap-1', columnSpecs[column].widthClass)}>
          {totals[column] ?? null}
        </div>
      ))}
      <div className={cn(gridCell, 'w-row-button')} />
    </div>
  )
}

function GroupRow({
  header,
  collapsed,
  onToggle,
  rowIndex,
}: {
  header: GroupHeader
  collapsed: boolean
  onToggle: () => void
  rowIndex: number
}) {
  return (
    <div role="row" aria-rowindex={rowIndex} className={gridGroupRow}>
      <div role="cell" className="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="inline-flex h-control-sm min-w-0 items-center gap-2 rounded-sm text-dense font-bold -outline-offset-2"
        >
          {header.kind ? (
            <KindIcon kind={header.kind} decorative />
          ) : header.status ? (
            <StatusMark status={header.status} iconOnly />
          ) : null}
          {header.areaLabel ? (
            <DomainBadge name={header.label} label={header.areaLabel} form="bare" />
          ) : (
            <span className="truncate">{header.label}</span>
          )}
          <span className="text-caption text-muted-foreground tabular-nums">
            {header.count.toLocaleString('en')}
          </span>
          {collapsed ? (
            <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * The library list (contract 8.1, 8.2, 8.5): one continuous virtual list over the cached index.
 * The page scrolls, not a box inside it, so the header, toolbar, column header and rows all end
 * at the same right edge whatever the scrollbar takes, and the browser restores the position
 * when a person comes back. The list is one tab stop: the cursor row's title link.
 */
export const ItemList = forwardRef<ItemListHandle, ItemListProps>(function ItemList(
  {
    entries,
    columns,
    narrow,
    density,
    today,
    terms,
    linkSearch,
    openId,
    panelTab,
    cursorId,
    selected,
    selectable,
    stickyOffset,
    collapsedGroups,
    onToggleGroup,
    onCursor,
    onToggleSelected,
    onOpen,
    onMoveToBin,
  },
  ref,
) {
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

  const height = rowHeight(density)
  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: (index) => (entries[index]?.type === 'group' ? 40 : narrow ? 96 : height),
    getItemKey: (index) => {
      const entry = entries[index]
      return entry?.type === 'item' ? entry.row.id : `group:${entry?.key ?? index}`
    },
    overscan: 12,
    scrollMargin,
    scrollPaddingStart: stickyOffset,
    scrollPaddingEnd: 72,
  })

  useImperativeHandle(
    ref,
    () => ({
      focusRow: (id, { scroll = true, visible: ring } = {}) => {
        const index = entries.findIndex((entry) => entry.type === 'item' && entry.row.id === id)
        if (index === -1) return
        const find = () =>
          listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
        // Where the row is from the virtualiser's measurements, not the DOM: right after the
        // router restores the scroll position the row may not be rendered yet.
        const measured = virtualizer.measurementsCache[index]
        const top = measured ? measured.start - window.scrollY : Number.NaN
        const visible =
          measured !== undefined && top >= stickyOffset && top + measured.size <= window.innerHeight
        // Scroll only when the row is not already in view (the way j and k feel in Linear).
        if (scroll && !visible) virtualizer.scrollToIndex(index, { align: 'auto' })
        // The row may only exist after the virtualizer renders it.
        let tries = 0
        const attempt = () => {
          const link = find()?.querySelector<HTMLAnchorElement>('[data-row-link]')
          if (link) link.focus({ preventScroll: true, focusVisible: ring })
          else if (tries++ < 10) requestAnimationFrame(attempt)
        }
        attempt()
      },
    }),
    [entries, virtualizer, stickyOffset],
  )

  const itemIndexes = new Map<string, number>()
  let itemCount = 0
  for (const entry of entries) {
    if (entry.type === 'item') itemIndexes.set(entry.row.id, itemCount++)
  }
  const tabStop = cursorId && itemIndexes.has(cursorId) ? cursorId : null
  const firstId = entries.find((entry) => entry.type === 'item')

  return (
    <div
      ref={listRef}
      role="rowgroup"
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtual) => {
        const entry = entries[virtual.index]
        if (!entry) return null
        const position = { transform: `translateY(${virtual.start - scrollMargin}px)` }
        if (entry.type === 'group') {
          return (
            <div
              key={virtual.key}
              data-index={virtual.index}
              className="absolute top-0 left-0 w-full"
              style={position}
            >
              <GroupRow
                header={entry}
                collapsed={collapsedGroups.has(entry.key)}
                onToggle={() => onToggleGroup(entry.key)}
                rowIndex={virtual.index + 2}
              />
            </div>
          )
        }
        const row = entry.row
        const isCursor = row.id === cursorId
        const isSelected = selected.has(row.id)
        // An ended issue is history: a muted icon and a muted title, never the warning tone.
        const calm = isEndedIssueRow(row)
        const focusable =
          tabStop === row.id ||
          (tabStop === null && firstId?.type === 'item' && firstId.row.id === row.id)
        const isOpen = row.id === openId
        // A row opens its item in the docked panel. While one is open, the next replaces it, so
        // Back closes the panel instead of stepping through every item read (lib/history.ts). The router marks
        // the open row's link as the current page.
        const panelLink = {
          to: '/library',
          search: { ...linkSearch, panel: row.id, tab: panelTab },
          ...panelRowHistory(openId !== null),
          resetScroll: false,
          'data-row-link': true,
          tabIndex: focusable ? 0 : -1,
          onFocus: () => onCursor(row.id),
        } as const
        const link = (
          <Link
            {...panelLink}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return
              onOpen(row.id)
            }}
            className={cn(gridRowTitle, calm && 'text-muted-foreground')}
          >
            {highlight(row.title, terms)}
          </Link>
        )
        const untilDays = row.until && today ? daysFrom(today, row.until) : null
        return (
          <div
            key={virtual.key}
            ref={narrow ? virtualizer.measureElement : undefined}
            data-index={virtual.index}
            data-row-id={row.id}
            data-layout={narrow && virtual.index === 0 ? 'content' : undefined}
            role="row"
            aria-rowindex={virtual.index + 2}
            aria-selected={selectable ? isSelected : undefined}
            data-cursor={isCursor || undefined}
            data-selected={isSelected || undefined}
            data-open={isOpen || undefined}
            className={cn(
              narrow
                ? 'min-h-row-phone items-start gap-3 border-b border-border-subtle py-3'
                : cn(gridRow, rowClass[density], 'hover:bg-accent data-cursor:bg-accent'),
              // After the grid row's classes: a virtual row is placed, not stacked.
              'group/row absolute top-0 left-0 flex w-full px-gutter -outline-offset-2 has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
              // The row open in the panel: the cursor's tint and an ink line on its left edge.
              openRowClass,
              'data-selected:bg-selected',
            )}
            style={position}
          >
            {narrow ? (
              <>
                <div role="cell" className="flex shrink-0" data-edge="start">
                  <KindIcon kind={row.kind} active={isLiveIssueRow(row)} />
                </div>
                <div role="cell" className="flex min-w-0 flex-1 flex-col gap-2">
                  <Link
                    {...panelLink}
                    onClick={() => onOpen(row.id)}
                    className={cn(phoneRowTitle, calm && 'text-muted-foreground')}
                  >
                    {highlight(row.title, terms)}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
                    <RowStatus status={row.displayStatus} />
                    {untilDays !== null && untilDays >= 0 && untilDays <= 30 ? (
                      <DateBadge date={row.until} today={today} size="sm" />
                    ) : null}
                    <Owner
                      name={row.ownerName}
                      personId={row.ownerId}
                      initials={row.ownerInitials}
                      showName={false}
                      className="ml-auto"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                {selectable ? (
                  // The row's kind, which gives way to its checkbox while the row is hovered,
                  // focused from the keyboard or selected (the professional pass, rule 8).
                  <div
                    role="cell"
                    data-edge="start"
                    className="relative flex w-column-select shrink-0 items-center justify-center"
                  >
                    <KindIcon
                      kind={row.kind}
                      active={isLiveIssueRow(row)}
                      className="absolute row-rest"
                    />
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleSelected(row.id, false)}
                      onMouseDown={(event) => {
                        // Shift-click selects rows, not the text between their checkboxes.
                        if (event.shiftKey) event.preventDefault()
                      }}
                      onClick={(event) => {
                        if (event.shiftKey) {
                          event.preventDefault()
                          // The range owns this click; do not also toggle its endpoint.
                          event.preventBaseUIHandler()
                          onToggleSelected(row.id, true)
                        }
                      }}
                      tabIndex={-1}
                      aria-label={`Select ${row.title}`}
                      className={cn('relative z-raised', gridRowControl)}
                    />
                  </div>
                ) : null}
                <div
                  role="cell"
                  className={cn(gridCell, 'flex-1 shrink gap-3', selectable && titleAfterSelect)}
                >
                  {selectable ? null : (
                    <KindIcon kind={row.kind} active={isLiveIssueRow(row)} className="relative" />
                  )}
                  {density === 'scope' ? (
                    <div className="flex min-w-0 flex-col">
                      {link}
                      <AboutNames row={row} className="text-dense" />
                    </div>
                  ) : (
                    link
                  )}
                </div>
                {columns.map((column) => (
                  <Cell key={column} column={column} row={row} today={today} />
                ))}
                <div role="cell" className={cn(gridCell, 'w-row-button justify-center px-0')}>
                  <RowMenu
                    itemId={row.id}
                    title={row.title}
                    linkSearch={linkSearch}
                    onMoveToBin={onMoveToBin ? () => onMoveToBin(row) : undefined}
                    className={cn(
                      'relative z-raised group-data-open/row:opacity-100',
                      gridRowControl,
                    )}
                  />
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
})
