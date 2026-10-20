import { phoneRowTitle } from '@/components/page/grid'
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual'
import { Link } from '@tanstack/react-router'
import type { CatalogueTerm } from '@/api'
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  HeedDomainIcon,
  LibraryBigIcon,
  PlusIcon,
  TypeIcon,
  type Icon,
} from '@/components/icons'
import { highlight } from '@/components/library/item-list'
import { openRowClass } from '@/components/page/dock-panel'
import {
  gridCell,
  gridFooter,
  gridGroupRow,
  gridHeaderRow,
  gridRow,
  gridRowTitle,
} from '@/components/page/grid'
import { Skeleton } from '@/components/ui/skeleton'
import type { Area } from '@domain/item'
import type { CatalogueEntry, CatalogueGroupHeader } from '@/lib/catalogue'
import type { CatalogueSearch } from '@/lib/search-params'
import { groupCountText } from '@/lib/catalogue'
import { panelRowHistory } from '@/lib/history'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'
import { CatalogueStatusBadge, TermDomain, TermDomainBadge, TermTile } from './catalogue-marks'
import { catalogueColumnSpecs, catalogueColumnTitle, type CatalogueColumnId } from './columns'

/** The catalogue's two densities: a name with its description (64), or the name alone (40). */
export const catalogueDensities = ['description', 'compact'] as const
export type CatalogueDensity = (typeof catalogueDensities)[number]
export const isCatalogueDensity = (value: unknown): value is CatalogueDensity =>
  (catalogueDensities as readonly unknown[]).includes(value)

const rowClass: Record<CatalogueDensity, string> = {
  description: 'h-row-scope',
  compact: 'h-row',
}

/** One field, one icon: the library's glyphs for the fields they share (table design 4). */
const fieldIcons: Record<CatalogueColumnId | 'name', Icon> = {
  name: TypeIcon,
  domain: HeedDomainIcon,
  context: LibraryBigIcon,
  status: CircleDashedIcon,
  changed: CalendarIcon,
}

/**
 * How a row opens its term in the docked panel (design round 3, direction A): the list's own
 * params with the term as `panel`. While a panel is open the next row replaces the address, so
 * Back closes the panel instead of stepping through every term read.
 */
export type TermRowPanel = {
  /** The list's params and the panel's tab, which the next row opens on. */
  search: CatalogueSearch
  /** The term open in the panel, by its key. */
  openKey: string | null
}

/** The link that opens a term in the panel; the panel's expand opens its page. */
export function TermLink({
  term,
  panel,
  className,
  children,
  ...props
}: {
  term: Pick<CatalogueTerm, 'key'>
  panel: TermRowPanel
  className?: string
  children: ReactNode
  tabIndex?: number
  onFocus?: () => void
}) {
  return (
    <Link
      to="/catalogue"
      search={{ ...panel.search, panel: term.key }}
      {...panelRowHistory(panel.openKey !== null)}
      resetScroll={false}
      data-term-link
      data-row-link
      className={className}
      {...props}
    >
      {children}
    </Link>
  )
}

/** "92 items": the count in the foreground, the noun quiet. */
function ItemCount({ count }: { count: number }) {
  return (
    <span className="tabular-nums">
      <span className="text-foreground">{count.toLocaleString('en')}</span>{' '}
      <span className="text-dense text-muted-foreground">{count === 1 ? 'fact' : 'facts'}</span>
    </span>
  )
}

/** The description copy, or the plain words when the source gave none (contract 5). */
function description(term: CatalogueTerm, tool: string) {
  return term.definition?.descriptionCopy ?? `No description in ${term.definition?.tool ?? tool}`
}

/**
 * The column header: 36 high, a field icon before every name, lines between the cells. Over
 * the loading rows there is no table yet, so it is drawn without the table roles and hidden from
 * assistive technology: a row group outside a table is invalid.
 */
export function CatalogueHeader({
  columns,
  tool,
  decorative = false,
}: {
  columns: CatalogueColumnId[]
  /** The tool the definitions come from, for the Changed column. */
  tool: string
  decorative?: boolean
}) {
  const role = (name: string) => (decorative ? undefined : name)
  const cell = (id: CatalogueColumnId | 'name', title: string, className: string) => {
    const Glyph = fieldIcons[id]
    return (
      <div key={id} role={role('columnheader')} className={cn(gridCell, className)}>
        <span className="inline-flex min-w-0 items-center gap-2">
          <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="truncate">{title}</span>
        </span>
      </div>
    )
  }
  return (
    <div
      role={role('rowgroup')}
      aria-hidden={decorative || undefined}
      className="sticky top-(--list-sticky-top) z-sticky"
    >
      <div
        role={role('row')}
        aria-rowindex={decorative ? undefined : 1}
        data-layout="content"
        className={gridHeaderRow}
      >
        {cell('name', 'Name', 'min-w-0 flex-1')}
        {columns.map((id) =>
          cell(id, catalogueColumnTitle(id, tool), catalogueColumnSpecs[id].widthClass),
        )}
      </div>
    </div>
  )
}

function GroupRow({
  header,
  collapsed,
  narrow,
  onToggle,
  rowIndex,
}: {
  header: CatalogueGroupHeader
  collapsed: boolean
  narrow: boolean
  onToggle: () => void
  rowIndex: number
}) {
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon
  const count = narrow
    ? (header.metrics + header.dimensions).toLocaleString('en')
    : groupCountText(header)
  return (
    <div role="row" aria-rowindex={rowIndex} data-group={header.key} className={gridGroupRow}>
      <div role="cell" className="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="inline-flex h-control-sm min-w-0 items-center gap-2 rounded-sm text-dense font-bold -outline-offset-2"
        >
          <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <TermDomainBadge name={header.name} label={header.label} none={header.none} form="bare" />
          <span className="text-caption font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </button>
      </div>
    </div>
  )
}

function Cell({
  column,
  term,
  areas,
}: {
  column: CatalogueColumnId
  term: CatalogueTerm
  areas: readonly Area[]
}) {
  const spec = catalogueColumnSpecs[column]
  let content: ReactNode
  switch (column) {
    case 'domain':
      content = <TermDomain term={term} areas={areas} size="sm" />
      break
    case 'context':
      content = <ItemCount count={term.shelf.items} />
      break
    case 'status':
      content = (
        <CatalogueStatusBadge
          status={term.status}
          activeIssues={term.shelf.activeIssues}
          tool={term.definition?.tool}
          size="sm"
        />
      )
      break
    case 'changed':
      content = term.definition?.changedAt ? (
        formatDay(term.definition.changedAt)
      ) : (
        <span className="text-muted-foreground">None</span>
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

export type CatalogueRowsProps = {
  entries: CatalogueEntry[]
  columns: CatalogueColumnId[]
  narrow: boolean
  density: CatalogueDensity
  /** The words of the search, marked in the names. */
  terms: string[]
  /** Flat (A to Z): a phone row names the domain, since no group row does. */
  showDomain: boolean
  areas: readonly Area[]
  /** The tool the catalogue's definitions come from, for a term the source gave no words. */
  tool: string
  cursorKey: string | null
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (key: string) => void
  onCursor: (key: string) => void
  /** How a row opens its term in the docked panel. */
  panel: TermRowPanel
  /** What covers the top of the window over the rows: the header, the toolbar, the columns. */
  stickyOffset: number
}

export type CatalogueRowsHandle = {
  /** Moves focus to a term's name, scrolling its row clear of what sticks above the rows. */
  focusTerm: (key: string) => void
}

/** A group row's height and a phone row's first guess; the rows measure themselves. */
const GROUP_ROW_HEIGHT = 40
const PHONE_ROW_ESTIMATE = 112
const rowHeight: Record<CatalogueDensity, number> = { description: 64, compact: 40 }

/**
 * The catalogue's rows (contract 5, "The catalogue"): group rows per domain, then a row per
 * term. A large model has thousands of terms, so only the rows near the window are rendered, as
 * the library does: the page scrolls, not a box inside it, and each row is placed where its
 * measured height puts it. The list is one tab stop, the cursor row's name; j and k move it.
 */
export const CatalogueRows = forwardRef<CatalogueRowsHandle, CatalogueRowsProps>(
  function CatalogueRows(
    {
      entries,
      columns,
      narrow,
      density,
      terms,
      showDomain,
      areas,
      tool,
      cursorKey,
      collapsedGroups,
      onToggleGroup,
      onCursor,
      panel,
      stickyOffset,
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

    // The row a key moved to, and the row holding the list's tab stop, are always rendered,
    // wherever they are: focus lands on the first at once, and Tab always finds the second.
    const [pinned, setPinned] = useState<string | null>(null)
    const pinnedIndex = pinned
      ? entries.findIndex((entry) => entry.type === 'term' && entry.term.key === pinned)
      : -1
    const firstTerm = entries.find((entry) => entry.type === 'term')
    const tabStop =
      cursorKey && entries.some((entry) => entry.type === 'term' && entry.term.key === cursorKey)
        ? cursorKey
        : firstTerm?.type === 'term'
          ? firstTerm.term.key
          : null
    const tabStopIndex = entries.findIndex(
      (entry) => entry.type === 'term' && entry.term.key === tabStop,
    )
    const virtualizer = useWindowVirtualizer({
      count: entries.length,
      rangeExtractor: (range) => {
        const indexes = defaultRangeExtractor(range)
        const missing = [pinnedIndex, tabStopIndex].filter(
          (index, at, all) => index !== -1 && !indexes.includes(index) && all.indexOf(index) === at,
        )
        return missing.length === 0 ? indexes : [...indexes, ...missing].sort((a, b) => a - b)
      },
      estimateSize: (index) =>
        entries[index]?.type === 'group'
          ? GROUP_ROW_HEIGHT
          : narrow
            ? PHONE_ROW_ESTIMATE
            : rowHeight[density],
      getItemKey: (index) => {
        const entry = entries[index]
        return entry?.type === 'term' ? entry.term.key : `group:${entry?.key ?? index}`
      },
      overscan: 12,
      scrollMargin,
      scrollPaddingStart: stickyOffset,
      scrollPaddingEnd: 48,
    })

    useImperativeHandle(
      ref,
      () => ({
        focusTerm: (key) => {
          const index = entries.findIndex(
            (entry) => entry.type === 'term' && entry.term.key === key,
          )
          if (index === -1) return
          flushSync(() => setPinned(key))
          listRef.current
            ?.querySelector<HTMLAnchorElement>(
              `[data-term-key="${CSS.escape(key)}"] [data-term-link]`,
            )
            ?.focus({ preventScroll: true })
          // Then the window follows, keeping the row clear of what sticks above the rows.
          const measured = virtualizer.measurementsCache[index]
          const top = measured ? measured.start - window.scrollY : Number.NaN
          const shown =
            measured !== undefined &&
            top >= stickyOffset &&
            top + measured.size <= window.innerHeight - 48
          if (!shown) virtualizer.scrollToIndex(index, { align: 'auto' })
        },
      }),
      [entries, virtualizer, stickyOffset],
    )

    // A virtual row is placed, not stacked: after the row's own classes.
    const placed = 'absolute top-0 left-0 w-full'
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
          const index = virtual.index
          const position = { transform: `translateY(${virtual.start - scrollMargin}px)` }
          if (entry.type === 'group') {
            return (
              <div
                key={virtual.key}
                ref={virtualizer.measureElement}
                data-index={index}
                className={placed}
                style={position}
              >
                <GroupRow
                  header={entry}
                  collapsed={collapsedGroups.has(entry.key)}
                  narrow={narrow}
                  onToggle={() => onToggleGroup(entry.key)}
                  rowIndex={index + 2}
                />
              </div>
            )
          }
          const { term } = entry
          const linkProps = {
            term,
            panel,
            tabIndex: term.key === tabStop ? 0 : -1,
            onFocus: () => onCursor(term.key),
          }
          const text = description(term, tool)
          if (narrow) {
            return (
              <div
                key={virtual.key}
                ref={virtualizer.measureElement}
                data-index={index}
                role="row"
                aria-rowindex={index + 2}
                data-term-key={term.key}
                data-row-id={term.key}
                data-open={term.key === panel.openKey || undefined}
                data-layout={index === 0 ? 'content' : undefined}
                className={cn(
                  'relative flex min-h-row-phone items-start gap-3 border-b border-border-subtle px-gutter py-3 -outline-offset-2 has-[[data-term-link]:focus-visible]:outline-2 has-[[data-term-link]:focus-visible]:outline-ring',
                  openRowClass,
                  placed,
                )}
                style={position}
              >
                <div role="cell" className="flex shrink-0" data-edge="start">
                  <TermTile kind={term.kind} />
                </div>
                <div role="cell" className="flex min-w-0 flex-1 flex-col gap-1">
                  <TermLink {...linkProps} className={phoneRowTitle}>
                    {highlight(term.name, terms)}
                  </TermLink>
                  <p className="line-clamp-2 text-dense text-muted-foreground">{text}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-dense">
                    <ItemCount count={term.shelf.items} />
                    <CatalogueStatusBadge
                      iconOnly={term.status === 'in_sync'}
                      status={term.status}
                      activeIssues={term.shelf.activeIssues}
                      tool={term.definition?.tool}
                      size="sm"
                    />
                    {showDomain ? <TermDomain term={term} areas={areas} size="sm" /> : null}
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div
              key={virtual.key}
              ref={virtualizer.measureElement}
              data-index={index}
              role="row"
              aria-rowindex={index + 2}
              data-term-key={term.key}
              data-row-id={term.key}
              data-cursor={term.key === cursorKey || undefined}
              data-open={term.key === panel.openKey || undefined}
              className={cn(
                gridRow,
                '-outline-offset-2 hover:bg-accent has-[[data-term-link]:focus-visible]:outline-2 has-[[data-term-link]:focus-visible]:outline-ring data-cursor:bg-accent',
                openRowClass,
                rowClass[density],
                placed,
              )}
              style={position}
            >
              <div
                role="cell"
                className={cn(gridCell, 'flex-1 shrink', density === 'compact' ? 'gap-2' : 'gap-3')}
              >
                <TermTile kind={term.kind} size={density === 'compact' ? 'md' : 'lg'} />
                {density === 'description' ? (
                  <div className="flex min-w-0 flex-col">
                    <TermLink {...linkProps} className={gridRowTitle}>
                      {highlight(term.name, terms)}
                    </TermLink>
                    <span className="truncate text-dense text-muted-foreground" title={text}>
                      {text}
                    </span>
                  </div>
                ) : (
                  <TermLink {...linkProps} className={gridRowTitle}>
                    {highlight(term.name, terms)}
                  </TermLink>
                )}
              </div>
              {columns.map((column) => (
                <Cell key={column} column={column} term={term} areas={areas} />
              ))}
            </div>
          )
        })}
      </div>
    )
  },
)

const addLink =
  'flex items-center gap-3 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/**
 * The add row under the grid: Suggest a name, open to anyone signed in. An owner reviews the
 * request, and the term joins the vocabulary (FR-125), never the source.
 */
export function SuggestTermRow({ narrow, tool }: { narrow: boolean; tool: string }) {
  if (narrow) {
    return (
      <Link
        to="/catalogue/suggest"
        data-slot="add-row"
        className={cn(addLink, 'min-h-row-phone border-b px-gutter text-dense')}
      >
        <PlusIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="font-bold">Suggest a name</span> for an owner to review
        </span>
      </Link>
    )
  }
  return (
    <div
      data-slot="add-row"
      className="flex h-row items-stretch border-b border-border-subtle px-gutter"
    >
      <Link to="/catalogue/suggest" className={cn(addLink, gridCell, 'flex-1 text-dense')}>
        <PlusIcon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          <span className="font-bold">Suggest a name</span>{' '}
          <span className="@max-3xl:hidden">
            Not here yet? An owner reviews it. It joins the names we know, not {tool}.
          </span>
        </span>
      </Link>
    </div>
  )
}

/** A count in bold and its noun quiet, for the totals. */
function total(value: number, one: string, many: string) {
  return (
    <>
      <span className="font-bold text-foreground tabular-nums">{value.toLocaleString('en')}</span>
      {value === 1 ? one : many}
    </>
  )
}

/**
 * The totals under the grid (direction A): terms, domains, accepted items and the issues that
 * still apply. They follow the view, the search and the filters. The item totals wait for the
 * library index and count every item once.
 */
export function CatalogueFooter({
  columns,
  totals,
  shelf,
}: {
  columns: CatalogueColumnId[]
  totals: { terms: number; metrics: number; dimensions: number; domains: number }
  shelf: { items: number; activeIssues: number } | null
}) {
  const cells: Record<CatalogueColumnId, ReactNode> = {
    domain: total(totals.domains, ' domain', ' domains'),
    context: shelf ? total(shelf.items, ' fact', ' facts') : null,
    status: shelf ? total(shelf.activeIssues, ' active issue', ' active issues') : null,
    changed: null,
  }
  return (
    <div
      role="group"
      aria-label="Totals"
      data-slot="list-footer"
      data-launcher-clear
      className={gridFooter}
    >
      <div className={cn(gridCell, 'flex-1')}>
        <span className="truncate">
          {total(totals.terms, ' term', ' terms')}
          {totals.metrics > 0 && totals.dimensions > 0 ? `: ${groupCountText(totals)}` : null}
        </span>
      </div>
      {columns.map((column) => (
        <div
          key={column}
          className={cn(gridCell, 'truncate', catalogueColumnSpecs[column].widthClass)}
        >
          <span className="truncate">{cells[column]}</span>
        </div>
      ))}
    </div>
  )
}

/** Skeleton rows with the real row height, columns and hairlines (contract 9.5). */
export function CatalogueLoading({
  columns,
  narrow,
  density,
  rows = 12,
}: {
  columns: CatalogueColumnId[]
  narrow: boolean
  density: CatalogueDensity
  rows?: number
}) {
  return (
    <div role="status" aria-label="Loading the catalogue" className="flex flex-col">
      {Array.from({ length: rows }, (_, index) =>
        narrow ? (
          <div
            key={index}
            className="flex min-h-row-phone gap-3 border-b px-gutter py-3"
            data-layout={index === 0 ? 'content' : undefined}
          >
            <Skeleton className="size-7 rounded-md" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className={cn('h-4', index % 3 === 0 ? 'w-1/2' : 'w-2/3')} />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-5 w-1/3 rounded-badge" />
            </div>
          </div>
        ) : (
          <div
            key={index}
            className={cn('flex items-stretch border-b px-gutter', rowClass[density])}
            data-layout={index === 0 ? 'content' : undefined}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3 self-stretch px-3">
              <Skeleton
                className={cn(
                  'shrink-0',
                  density === 'compact' ? 'size-6 rounded-badge' : 'size-7 rounded-md',
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className={cn('h-3', index % 3 === 0 ? 'w-1/3' : 'w-1/4')} />
                {density === 'description' ? (
                  <Skeleton className={cn('h-3', index % 2 === 0 ? 'w-1/2' : 'w-2/3')} />
                ) : null}
              </div>
            </div>
            {columns.map((column) => (
              <div
                key={column}
                className={cn(
                  'flex shrink-0 items-center self-stretch border-l px-3',
                  catalogueColumnSpecs[column].widthClass,
                )}
              >
                <Skeleton
                  className={cn(
                    'w-2/3',
                    column === 'domain' || column === 'status' ? 'h-5 rounded-badge' : 'h-3',
                  )}
                />
              </div>
            ))}
          </div>
        ),
      )}
      <span className="sr-only">Loading</span>
    </div>
  )
}
