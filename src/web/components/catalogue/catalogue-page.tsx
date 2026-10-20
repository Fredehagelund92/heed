import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { Catalogue } from '@/api'
import { areasQuery, catalogueQuery } from '@/api/queries'
import { useListScope } from '@/components/app-shell/command-scope'
import { InfoIcon, SearchIcon, TriangleAlertIcon, XIcon } from '@/components/icons'
import {
  ListEmpty,
  ListError,
  ListNoResults,
  ListStale,
  useDelayedFlag,
} from '@/components/library/list-state'
import { useDockMode } from '@/components/page/dock-panel'
import { Page, PageToolbar } from '@/components/page/page'
import {
  PageToolbarDivider,
  toolbarCount,
  toolbarSearchField,
  toolbarSearchSlot,
  toolbarViewClass,
} from '@/components/page/toolbar'
import { dockFitWidth, useDockList } from '@/components/page/use-dock-list'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useElementHeight, useElementWidth } from '@/hooks/use-element-size'
import { useHeaderHeight } from '@/hooks/use-header-height'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  catalogueEntries,
  catalogueFilterCount,
  catalogueFiltersOf,
  catalogueSources,
  catalogueStatusFilterName,
  catalogueTool,
  catalogueTotals,
  filterDomains,
  catalogueViews,
  inCatalogueView,
  NO_DOMAIN,
  searchedTerms,
  shelfTotals,
  viewCounts,
  visibleTerms,
  type CatalogueViewId,
} from '@/lib/catalogue'
import type { ListScope } from '@/lib/commands'
import { formatDay, queryTerms } from '@/lib/library'
import { usePreference } from '@/lib/preferences'
import type { CatalogueSearch } from '@/lib/search-params'
import { sourceSearch } from '@/lib/sources'
import { useLibrary } from '@/lib/use-library'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'
import { TermDomainBadge } from './catalogue-marks'
import { CatalogueDisplayMenu, CatalogueFilterMenu, CatalogueViewMenu } from './catalogue-menus'
import {
  CatalogueFooter,
  CatalogueHeader,
  CatalogueLoading,
  CatalogueRows,
  type CatalogueRowsHandle,
  isCatalogueDensity,
  SuggestTermRow,
  type CatalogueDensity,
} from './catalogue-table'
import { fitCatalogueColumns } from './columns'
import { TermPanel } from './term-panel'

/** The column header's height, the --table-header-height token. */
const COLUMN_HEADER_HEIGHT = 36

/** "Nothing matches “order” with Status: In sync", naming what is on (contract 9.5). */
function describeSearch(search: CatalogueSearch, areas: readonly Area[], tool: string) {
  const filters = catalogueFiltersOf(search)
  const parts: string[] = []
  if (filters.statuses.length)
    parts.push(
      `Status: ${filters.statuses.map((status) => catalogueStatusFilterName(status, tool)).join(', ')}`,
    )
  if (filters.area)
    parts.push(
      `Domain: ${
        filters.area === NO_DOMAIN
          ? 'No domain'
          : (areas.find((area) => area.id === filters.area)?.name ?? 'Unknown domain')
      }`,
    )
  const view = catalogueViews.find((candidate) => candidate.id === (search.kind ?? 'all'))
  const scope = search.kind ? ` in ${view?.title ?? 'this view'}` : ''
  const query = search.q?.trim()
  if (query && parts.length) return `Nothing${scope} matches “${query}” with ${parts.join('; ')}.`
  if (query) return `Nothing${scope} matches “${query}”. Try fewer or shorter words.`
  return `Nothing${scope} matches ${parts.join('; ')}.`
}

/** The filters that are on, as removable controls (table design 4.6). */
function AppliedFilters({
  search,
  areas,
  tool,
  onSearch,
}: {
  search: CatalogueSearch
  areas: readonly Area[]
  tool: string
  onSearch: (patch: Partial<CatalogueSearch>) => void
}) {
  const filters = catalogueFiltersOf(search)
  const chips: { key: string; text: string; label?: ReactNode; clear: Partial<CatalogueSearch> }[] =
    []
  if (filters.statuses.length)
    chips.push({
      key: 'status',
      text: `Status: ${filters.statuses.map((status) => catalogueStatusFilterName(status, tool)).join(', ')}`,
      clear: { status: undefined },
    })
  if (filters.area) {
    const area = areas.find((candidate) => candidate.id === filters.area)
    const name = filters.area === NO_DOMAIN ? 'No domain' : (area?.name ?? 'Unknown domain')
    chips.push({
      key: 'area',
      text: `Domain: ${name}`,
      label: area ? (
        <>
          Domain:
          <TermDomainBadge name={area.name} label={area.label} none={null} form="bare" />
        </>
      ) : undefined,
      clear: { area: undefined },
    })
  }
  if (chips.length === 0) return null
  return (
    <div
      role="group"
      aria-label="Filters on"
      className="flex flex-wrap items-center gap-2 border-b px-gutter py-2"
    >
      {chips.map((chip) => (
        <Button
          key={chip.key}
          variant="outline"
          size="sm"
          onClick={() => onSearch(chip.clear)}
          aria-label={`Remove filter ${chip.text}`}
          className={cn(chip.label && 'gap-2')}
        >
          {chip.label ?? chip.text}
          <XIcon className="text-muted-foreground" />
        </Button>
      ))}
      {chips.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSearch({ status: undefined, area: undefined })}
        >
          Clear all
        </Button>
      ) : null}
    </div>
  )
}

/** The view chips: All, Metrics and Dimensions, each with a quiet count (table design 4.6). */
function ViewChips({
  search,
  counts,
}: {
  search: CatalogueSearch
  counts: Record<CatalogueViewId, number> | null
}) {
  const current = search.kind ?? 'all'
  return (
    <nav aria-label="Catalogue views" className="flex shrink-0 items-center gap-1">
      {catalogueViews.map((view) => {
        const active = view.id === current
        return (
          <Link
            key={view.id}
            to="/catalogue"
            search={{ ...search, kind: view.id === 'all' ? undefined : view.id }}
            aria-current={active ? 'page' : undefined}
            className={toolbarViewClass}
          >
            {view.title}
            {counts ? (
              <span className="font-normal text-muted-foreground tabular-nums">
                {counts[view.id].toLocaleString('en')}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * The newest successful read of the definition sources, whether the latest attempt failed, and
 * the source to open in Sources: the failing one, or the only one.
 */
function sourceState(catalogue: Catalogue | undefined) {
  const sources = catalogueSources(catalogue)
  const readAt = sources
    .map((source) => source.readAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)
  const failing = sources.find((source) => source.failing)
  return {
    readAt: readAt ?? null,
    failing: failing !== undefined,
    open: failing ?? (sources.length === 1 ? sources[0] : undefined),
    tool: catalogueTool(catalogue),
  }
}

/** The way to the source's page in Sources, for the administrators who run it. */
function SeeTheSource({ id }: { id: string | undefined }) {
  const { isAdmin } = usePermissions()
  if (!id || !isAdmin) return null
  return (
    <Link
      to="/admin"
      search={sourceSearch(id)}
      data-slot="source-link"
      className="shrink-0 font-bold underline underline-offset-4 hover:decoration-2"
    >
      See the source
    </Link>
  )
}

/**
 * The line under the toolbar: what the catalogue is, and the age of the copies (CON-207). While
 * the source cannot be read, it says the copies are the last ones (CON-213). Administrators get
 * the way to the source's page in Sources.
 */
function SourceLine({ catalogue }: { catalogue: Catalogue }) {
  const { readAt, failing, open, tool } = sourceState(catalogue)
  if (failing) {
    return (
      <p
        role="status"
        data-layout="content"
        data-slot="source-line"
        className="flex min-h-control-lg flex-wrap items-center gap-x-3 gap-y-1 border-b border-status-warning-border bg-status-warning-bg px-gutter py-2 text-dense text-status-warning-fg"
      >
        <TriangleAlertIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-status-warning-icon"
        />
        <span className="min-w-0 flex-1">
          {readAt
            ? `We couldn't read ${tool} lately. The descriptions are the copies read on ${formatDay(readAt)}.`
            : `We couldn't read ${tool} yet, so there are no descriptions.`}
        </span>
        <SeeTheSource id={open?.id} />
      </p>
    )
  }
  return (
    <p
      data-layout="content"
      data-slot="source-line"
      className="flex items-start gap-2 border-b px-gutter py-2 text-dense text-muted-foreground"
    >
      <InfoIcon aria-hidden="true" className="size-icon-sm h-lh shrink-0" />
      <span className="min-w-0">
        Every metric and dimension AI apps can be told about. {tool} defines them; the library adds
        what we know about each.
        {readAt ? ` Descriptions are copies from ${tool}, read ${formatDay(readAt)}.` : null}{' '}
        <span className="text-brand-ink">
          <SeeTheSource id={open?.id} />
        </span>
      </span>
    </p>
  )
}

/**
 * The catalogue (FR-136; design contract 5, "The catalogue"): every metric and dimension of the
 * vocabulary in the library's grid, grouped by domain, with the copy of the source's description and
 * what the library holds about each. A window, not a store: the page shows a labelled copy and
 * never a formula (CON-207).
 */
export function CataloguePage({ search }: { search: CatalogueSearch }) {
  const navigate = useNavigate()
  const catalogue = useQuery(catalogueQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const library = useLibrary()
  const [density, setDensity] = usePreference<CatalogueDensity>(
    'cl.catalogue.density',
    'description',
    isCatalogueDensity,
  )
  // A touch screen never gets the compact rows: 40 is below the 44 pixel touch target.
  const coarse = useMediaQuery('(pointer: coarse)')
  const effectiveDensity = coarse ? 'description' : density
  const grouped = search.order !== 'az'
  const tool = catalogueTool(catalogue.data)

  // ---- the row model ----
  const allTerms = useMemo(() => catalogue.data?.terms ?? [], [catalogue.data])
  const searched = useMemo(() => searchedTerms(allTerms, search), [allTerms, search])
  const terms = useMemo(() => visibleTerms(allTerms, search), [allTerms, search])
  // The view's terms before the search and the filters, for the toolbar's "5 of 22 terms".
  const viewTotal = useMemo(
    () => allTerms.filter((term) => inCatalogueView(term, search.kind ?? 'all')).length,
    [allTerms, search.kind],
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const entries = useMemo(
    () => catalogueEntries(terms, areas, { grouped, collapsed }),
    [terms, areas, grouped, collapsed],
  )
  const domains = useMemo(
    () => filterDomains(allTerms, areas, search.area),
    [allTerms, areas, search.area],
  )
  const totals = catalogueTotals(terms)
  const shelf = useMemo(
    () =>
      library.pending || library.failed || library.today === null
        ? null
        : shelfTotals(library.rows, terms, library.today),
    [library.pending, library.failed, library.rows, library.today, terms],
  )

  // ---- layout: columns by container width ----
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const [stickyBlock, setStickyBlock] = useState<HTMLDivElement | null>(null)
  // Beside a docked panel the list fits the width it has once the sidebar has folded.
  const fitMode = useDockMode()
  const width = dockFitWidth(useElementWidth(region), Boolean(search.panel) && fitMode === 'docked')
  const stickyHeight = useElementHeight(stickyBlock)
  const headerHeight = useHeaderHeight()
  const wide = useMediaQuery('(min-width: 48rem)')
  const fit = fitCatalogueColumns(width || 1200, wide ? 24 : 16, { grouped })
  const narrow = !wide || (width > 0 && fit.narrow)

  // ---- cursor and keyboard (contract 9.2) ----
  const searchRef = useRef<HTMLInputElement>(null)
  const panelKey = search.panel ?? null
  const [cursorKey, setCursorKey] = useState<string | null>(panelKey)
  const [lastPanel, setLastPanel] = useState(panelKey)
  if (lastPanel !== panelKey) {
    setLastPanel(panelKey)
    if (panelKey) setCursorKey(panelKey)
  }
  const termKeys = useMemo(
    () => entries.flatMap((entry) => (entry.type === 'term' ? [entry.term.key] : [])),
    [entries],
  )

  // ---- the term open in the docked panel ----
  // The list's own params, without the panel and its tab: what makes it the same list.
  const list: CatalogueSearch = { ...search, panel: undefined, tab: undefined }
  const openPanel = (key: string) =>
    void navigate({
      to: '/catalogue',
      search: { ...list, panel: key, tab: search.tab },
      replace: true,
      state: true,
      resetScroll: false,
    })
  const dock = useDockList({
    region,
    ids: termKeys,
    panelId: panelKey,
    open: openPanel,
    close: () =>
      void navigate({ to: '/catalogue', search: list, replace: true, resetScroll: false }),
    searchRef,
    // The catalogue keeps its own keys below (a roving cursor that stays clear of the header).
    enabled: false,
  })
  // On a phone the panel fills the screen: the list under it is out of reach until it closes.
  const listHidden = panelKey !== null && fitMode === 'full'
  // The rows stay clear of the sticky header, toolbar and column header.
  const stickyOffset = headerHeight + stickyHeight + (narrow ? 0 : COLUMN_HEADER_HEIGHT)
  const rowsRef = useRef<CatalogueRowsHandle>(null)
  const focusTerm = (key: string) => {
    setCursorKey(key)
    rowsRef.current?.focusTerm(key)
  }
  const scopeRef = useRef<ListScope | null>(null)
  useLayoutEffect(() => {
    scopeRef.current = {
      move: (delta) => {
        if (termKeys.length === 0) return
        const index = cursorKey ? termKeys.indexOf(cursorKey) : -1
        const next =
          index === -1
            ? termKeys[delta > 0 ? 0 : termKeys.length - 1]
            : termKeys[Math.min(termKeys.length - 1, Math.max(0, index + delta))]
        if (!next) return
        focusTerm(next)
        // With the panel open, j and k read the next term in it.
        if (panelKey && next !== panelKey) openPanel(next)
      },
      moveTo: (edge) => {
        const next = edge === 'first' ? termKeys[0] : termKeys.at(-1)
        if (!next) return
        focusTerm(next)
        if (panelKey && next !== panelKey) openPanel(next)
      },
      // Terms are not selected: the catalogue only reads.
      toggleSelected: () => undefined,
      clear: () => {
        // Escape closes the panel first, then leaves the rows.
        if (panelKey) {
          dock.closePanel()
          return true
        }
        if (!cursorKey) return false
        setCursorKey(null)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return true
      },
      focusSearch: () => searchRef.current?.focus(),
      cursorItemId: () => null,
    }
  })
  const scope = useMemo<ListScope>(
    () => ({
      move: (delta, extend) => scopeRef.current?.move(delta, extend),
      moveTo: (edge) => scopeRef.current?.moveTo(edge),
      toggleSelected: () => scopeRef.current?.toggleSelected(),
      clear: () => scopeRef.current?.clear() ?? false,
      focusSearch: () => scopeRef.current?.focusSearch(),
      cursorItemId: () => null,
    }),
    [],
  )
  useListScope(catalogue.data ? scope : null)

  // ---- URL updates ----
  const updateSearch = (patch: Partial<CatalogueSearch>, replace = false) =>
    void navigate({
      to: '/catalogue',
      search: { ...search, ...patch },
      replace,
    })
  const [query, setQuery] = useState(search.q ?? '')
  const [lastQ, setLastQ] = useState(search.q)
  if (lastQ !== search.q) {
    setLastQ(search.q)
    setQuery(search.q ?? '')
  }
  const changeQuery = (value: string) => {
    setQuery(value)
    updateSearch({ q: value || undefined }, true)
  }
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && termKeys[0]) {
      event.preventDefault()
      focusTerm(termKeys[0])
    } else if (event.key === 'Escape') {
      if (query) changeQuery('')
      else event.currentTarget.blur()
    }
  }
  const clearAll = () => updateSearch({ q: undefined, status: undefined, area: undefined })
  const filterCount = catalogueFilterCount(search)

  // ---- states (contract 9.5) ----
  const failed = catalogue.isError && catalogue.data === undefined
  const stale = catalogue.isError && catalogue.data !== undefined
  const pending = catalogue.isPending
  const showLoading = useDelayedFlag(pending)
  let body
  if (failed) {
    body = (
      <ListError
        title="We couldn't load the catalogue"
        safe="Nothing is lost."
        error={catalogue.error}
        onRetry={() => void catalogue.refetch()}
      />
    )
  } else if (pending) {
    body = showLoading ? (
      <CatalogueLoading columns={fit.columns} narrow={narrow} density={effectiveDensity} />
    ) : null
  } else if (allTerms.length === 0) {
    body = (
      <ListEmpty
        title="No metrics or dimensions yet"
        action={
          <Button variant="outline" render={<Link to="/catalogue/suggest" />}>
            Suggest a name
          </Button>
        }
      >
        The catalogue lists the metrics and dimensions that {tool} defines. They show here once an
        owner adds them.
      </ListEmpty>
    )
  } else if (terms.length === 0) {
    const filtered = Boolean(search.q?.trim()) || filterCount > 0
    body = filtered ? (
      <ListNoResults
        title="No terms match"
        description={describeSearch(search, areas, tool)}
        onClear={clearAll}
      />
    ) : (
      <ListEmpty
        title={search.kind === 'dimension' ? 'No dimensions yet' : 'No metrics yet'}
        action={
          <Button variant="outline" render={<Link to="/catalogue" />}>
            Show all terms
          </Button>
        }
      >
        There are none of these yet. Suggest one, and an owner reviews it.
      </ListEmpty>
    )
  } else {
    body = (
      <CatalogueRows
        ref={rowsRef}
        stickyOffset={stickyOffset}
        entries={entries}
        columns={fit.columns}
        narrow={narrow}
        density={effectiveDensity}
        terms={queryTerms(search.q)}
        showDomain={!grouped}
        areas={areas}
        tool={tool}
        cursorKey={cursorKey}
        collapsedGroups={collapsed}
        onToggleGroup={(key) =>
          setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }
        onCursor={setCursorKey}
        panel={{ search: { ...list, tab: search.tab }, openKey: panelKey }}
      />
    )
  }

  const showTable = !failed && !pending && terms.length > 0
  const showHeader = showTable || (pending && showLoading)
  return (
    <Page
      title="Catalogue"
      data-template="list"
      ref={setRegion}
      // The column header sticks right under the shell header and this block (custom property only).
      style={
        { '--list-sticky-top': `calc(var(--header-height) + ${stickyHeight}px)` } as CSSProperties
      }
    >
      <div
        ref={setStickyBlock}
        inert={listHidden || undefined}
        className="sticky top-header z-sticky bg-background"
      >
        {stale ? (
          <ListStale
            loadedAt={new Date(catalogue.dataUpdatedAt).toISOString()}
            onRetry={() => void catalogue.refetch()}
          />
        ) : null}
        <PageToolbar role="search" aria-label="Catalogue" className="flex-wrap gap-y-2">
          <ViewChips search={search} counts={catalogue.data ? viewCounts(searched) : null} />
          <PageToolbarDivider />
          <div className="flex shrink-0 items-center gap-2 @max-2xl:hidden">
            <CatalogueFilterMenu
              search={search}
              domains={domains}
              tool={tool}
              activeCount={filterCount}
              onSearch={(patch) => updateSearch(patch)}
            />
            <CatalogueDisplayMenu
              search={search}
              density={density}
              onSearch={(patch) => updateSearch(patch)}
              onDensity={setDensity}
            />
          </div>
          <div className="@2xl:hidden">
            <CatalogueViewMenu
              search={search}
              domains={domains}
              tool={tool}
              activeCount={filterCount}
              density={density}
              onSearch={(patch) => updateSearch(patch)}
              onDensity={setDensity}
            />
          </div>
          <div className={toolbarSearchSlot}>
            <InputGroup className={toolbarSearchField}>
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search metrics and dimensions"
                aria-label="Search metrics and dimensions"
                aria-describedby="catalogue-count"
              />
              <InputGroupAddon align="inline-end">
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      changeQuery('')
                      searchRef.current?.focus()
                    }}
                    aria-label="Clear the search"
                    className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-4" />
                  </button>
                ) : (
                  <Kbd className="hidden font-mono @lg:inline-flex">/</Kbd>
                )}
              </InputGroupAddon>
            </InputGroup>
          </div>
          {/* The count ends the bar, as on the library, so the two search fields end together. */}
          <span id="catalogue-count" aria-live="polite" className={toolbarCount}>
            {!catalogue.data ? (
              ''
            ) : filterCount > 0 || search.q?.trim() ? (
              <>
                <span className="font-bold text-foreground">
                  {terms.length.toLocaleString('en')}
                </span>{' '}
                of {viewTotal.toLocaleString('en')} {viewTotal === 1 ? 'term' : 'terms'}
              </>
            ) : (
              `${terms.length.toLocaleString('en')} ${terms.length === 1 ? 'term' : 'terms'}`
            )}
          </span>
        </PageToolbar>
        <AppliedFilters
          search={search}
          areas={areas}
          tool={tool}
          onSearch={(patch) => updateSearch(patch)}
        />
      </div>
      {catalogue.data ? <SourceLine catalogue={catalogue.data} /> : null}
      <div className="flex flex-col" inert={listHidden || undefined}>
        <div
          role={showTable ? 'table' : undefined}
          aria-label={showTable ? 'Catalogue' : undefined}
          aria-rowcount={showTable ? entries.length + 1 : undefined}
          className="flex flex-col"
        >
          {showHeader && !narrow ? (
            <CatalogueHeader columns={fit.columns} tool={tool} decorative={!showTable} />
          ) : null}
          {body}
        </div>
        {showTable ? (
          <>
            <SuggestTermRow narrow={narrow} tool={tool} />
            {narrow ? null : (
              <CatalogueFooter columns={fit.columns} totals={totals} shelf={shelf} />
            )}
          </>
        ) : null}
      </div>
      {panelKey ? (
        <TermPanel
          termKey={panelKey}
          tab={search.tab ?? 'overview'}
          onTabChange={(tab) =>
            void navigate({
              to: '/catalogue',
              search: { ...list, panel: panelKey, tab: tab === 'overview' ? undefined : tab },
              replace: true,
              state: true,
              resetScroll: false,
            })
          }
          position={dock.position}
          onPrevious={dock.previousId ? () => openPanel(dock.previousId!) : undefined}
          onNext={dock.nextId ? () => openPanel(dock.nextId!) : undefined}
          onClose={dock.closePanel}
        />
      ) : null}
    </Page>
  )
}
