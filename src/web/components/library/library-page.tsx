import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { areasQuery } from '@/api/queries'
import { useListScope } from '@/components/app-shell/command-scope'
import { useShellActions } from '@/components/app-shell/shell-actions'
import { LinkIcon, SearchIcon, Trash2Icon, XIcon } from '@/components/icons'
import { useDockMode } from '@/components/page/dock-panel'
import { Page } from '@/components/page/page'
import { SelectionBar, SelectionBarButton } from '@/components/page/selection-bar'
import { toolbarSearchField } from '@/components/page/toolbar'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useElementHeight, useElementWidth } from '@/hooks/use-element-size'
import { useHeaderHeight } from '@/hooks/use-header-height'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { ListScope } from '@/lib/commands'
import {
  activeFilterCount,
  attentionInMyDomains,
  filtersOf,
  groupRows,
  kindNames,
  libraryViews,
  queryTerms,
  sortStateOf,
  statusNames,
  viewTotal,
  type LibrarySort,
} from '@/lib/library'
import { panelOpenedHere } from '@/lib/history'
import { hiddenEndedIssues, visibleRows } from '@/lib/library-search'
import { listKey, listSearch, rememberCursor, rememberedCursor } from '@/lib/list-memory'
import { selectionRange } from '@/lib/list-selection'
import { defaultDensity, isDensity, usePreference } from '@/lib/preferences'
import type { ItemTab, LibraryRouteSearch, LibrarySearch } from '@/lib/search-params'
import { useLibrary } from '@/lib/use-library'
import { usePermissions } from '@/lib/use-session'
import { MoveToBinDialog, type BinSubject } from './bin-dialogs'
import { defaultColumns, fitColumns, isColumnList, type ColumnId } from './columns'
import { ItemPanel } from './item-panel'
import { AddRow, ColumnHeader, ItemList, ListFooter, type ItemListHandle } from './item-list'
import {
  ListEmpty,
  ListError,
  ListLoading,
  ListNoResults,
  ListStale,
  useDelayedFlag,
} from './list-state'
import { LibraryBar } from './library-bar'

/** "“orders” with Kind: Event", naming what is on, for the no-results message (9.5). */
function describeFilters(search: LibrarySearch, areaName: (id: string) => string) {
  const filters = filtersOf(search)
  const parts: string[] = []
  if (filters.kinds.length)
    parts.push(`Kind: ${filters.kinds.map((kind) => kindNames[kind]).join(', ')}`)
  if (filters.statuses.length)
    parts.push(`Status: ${filters.statuses.map((status) => statusNames[status]).join(', ')}`)
  if (filters.area) parts.push(`Domain: ${areaName(filters.area)}`)
  if (filters.about) parts.push('Where it applies: one metric or market')
  const query = search.q?.trim()
  const view = libraryViews.find((candidate) => candidate.id === (search.view ?? 'all'))
  const scope = search.view ? ` in ${view?.title ?? 'this view'}` : ''
  if (query && parts.length) return `Nothing${scope} matches “${query}” with ${parts.join('; ')}.`
  if (query) return `Nothing${scope} matches “${query}”. Try fewer or shorter words.`
  return `Nothing${scope} matches ${parts.join('; ')}.`
}

/**
 * The context library (contract 5 "List page", 8.1 to 8.8, 9.5). One calm list under the action
 * bar (8.3): View, Filter, Sort, Group, Display and the search field, with the filters that are on
 * as chips under it. Opening a row opens the item in the docked panel beside the list (design
 * round 3, direction A), in the address as `?panel=`, so the list keeps its place while items
 * are read; j and k step the panel through the rows and Escape closes it, back to the row. The
 * panel's expand opens the item page, which keeps the list's params, so coming back restores
 * the same list, the same position and the same cursor.
 */
export function LibraryPage({ search }: { search: LibraryRouteSearch }) {
  const navigate = useNavigate({ from: '/library/' })
  const router = useRouter()
  const library = useLibrary()
  const { data: areas = [] } = useQuery(areasQuery())
  const { copyLinks } = useShellActions()
  const [density, setDensity] = usePreference('cl.library.density', defaultDensity, isDensity)
  const [chosenColumns, setChosenColumns] = usePreference<ColumnId[]>(
    'cl.library.columns',
    defaultColumns,
    isColumnList,
  )
  const coarse = useMediaQuery('(pointer: coarse)')
  // A touch screen never gets the compact rows: 40 is below the 44 pixel touch target.
  const effectiveDensity = coarse && density === 'compact' ? 'comfortable' : density

  const view = search.view ?? 'all'
  const viewInfo = libraryViews.find((candidate) => candidate.id === view)
  const title = view === 'all' ? 'Library' : (viewInfo?.title ?? 'Library')
  const key = listKey(search)
  const carried = useMemo(() => listSearch(search), [search])

  // ---- the row model ----
  const rows = useMemo(
    () => visibleRows(library.rows, search, library.viewer),
    [library.rows, search, library.viewer],
  )
  const hiddenIssues = useMemo(
    () => hiddenEndedIssues(library.rows, search, library.viewer),
    [library.rows, search, library.viewer],
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const entries = useMemo(
    () => groupRows(rows, search.group, collapsed),
    [rows, search.group, collapsed],
  )
  const itemIds = useMemo(
    () => entries.flatMap((entry) => (entry.type === 'item' ? [entry.row.id] : [])),
    [entries],
  )
  const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? 'Unknown domain'

  // ---- the item open in the docked panel ----
  const panelId = search.panel ?? null
  const panelTab: ItemTab = search.tab ?? 'read'
  const dockMode = useDockMode()
  const panelDocked = panelId !== null && dockMode === 'docked'

  // ---- layout: columns by container width (8.1) ----
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const [stickyBlock, setStickyBlock] = useState<HTMLDivElement | null>(null)
  const width = useElementWidth(region)
  // The column fit stays docked until the list has measured the width the closed panel left:
  // a frame fitted to the docked width without the panel's rule would show narrow rows.
  const [dockedWidth, setDockedWidth] = useState<number | null>(null)
  if (panelDocked && dockedWidth !== width) setDockedWidth(width)
  if (!panelDocked && dockedWidth !== null && dockedWidth !== width) setDockedWidth(null)
  const stickyHeight = useElementHeight(stickyBlock)
  const headerHeight = useHeaderHeight()
  const gutter = useMediaQuery('(min-width: 48rem)') ? 24 : 16
  const fit = fitColumns(chosenColumns, width || 1200, gutter, {
    oneDomain: Boolean(search.area) || areas.length === 1,
    selectable: !coarse,
    docked: panelDocked || dockedWidth !== null,
  })
  const narrow = width > 0 && fit.narrow
  const selectable = !narrow && !coarse

  // ---- cursor and selection ----
  const listRef = useRef<ItemListHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [cursorId, setCursorId] = useState<string | null>(
    () => panelId ?? rememberedCursor(search) ?? null,
  )
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  // An administrator moves the selection, or one row from its menu, to the Bin.
  const { isAdmin } = usePermissions()
  const [binning, setBinning] = useState<readonly BinSubject[]>([])
  const [binOpen, setBinOpen] = useState(false)
  const moveToBin = (subjects: readonly BinSubject[]) => {
    setBinning(subjects)
    setBinOpen(true)
  }
  const [lastKey, setLastKey] = useState(key)
  if (lastKey !== key) {
    // A different list: start fresh, or where the person last was in that list.
    setLastKey(key)
    setSelected(new Set())
    setAnchor(null)
    setCursorId(rememberedCursor(search) ?? null)
  }

  // Coming back to a list: put focus on the row the person was on (contract 11, Keyboard), or
  // on the row of the item a link opened in the panel.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || itemIds.length === 0) return
    restored.current = true
    const remembered = search.panel ?? rememberedCursor(search)
    if (!remembered || !itemIds.includes(remembered)) return
    // After the router has restored the scroll position (it does so as the page renders), so
    // the row only scrolls into view when previous and next moved the person past the screen.
    // No key moved the focus here, so the row takes it without the keyboard's ring.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => listRef.current?.focusRow(remembered, { visible: false })),
    )
  }, [itemIds, search])

  const moveCursor = (id: string) => {
    setCursorId(id)
    listRef.current?.focusRow(id)
  }

  // ---- the docked panel ----
  const [lastPanel, setLastPanel] = useState(panelId)
  if (lastPanel !== panelId) {
    setLastPanel(panelId)
    if (panelId) setCursorId(panelId)
  }
  // When the panel closes (Escape, its close button or Back), focus returns to its row.
  const previousPanel = useRef(panelId)
  useEffect(() => {
    const closed = previousPanel.current
    previousPanel.current = panelId
    if (panelId || !closed) return
    requestAnimationFrame(() => listRef.current?.focusRow(closed))
  }, [panelId])
  const openPanel = (id: string) =>
    void navigate({
      to: '/library',
      search: { ...carried, panel: id, tab: search.tab },
      replace: true,
      state: true,
      resetScroll: false,
    })
  // Closing goes Back when the entry behind is the list the panel opened over (lib/history.ts).
  const closePanel = () => {
    if (panelOpenedHere(router.history.location.state)) {
      router.history.back()
      return
    }
    void navigate({ to: '/library', search: carried, replace: true, resetScroll: false })
  }
  const showPanelTab = (tab: ItemTab) =>
    void navigate({
      to: '/library',
      search: { ...carried, panel: panelId ?? undefined, tab: tab === 'read' ? undefined : tab },
      replace: true,
      state: true,
      resetScroll: false,
    })
  const panelIndex = panelId ? itemIds.indexOf(panelId) : -1
  const panelPrevious = panelIndex > 0 ? itemIds[panelIndex - 1] : undefined
  const panelNext = panelIndex >= 0 ? itemIds[panelIndex + 1] : undefined
  // On a phone the panel fills the screen: the list under it is out of reach until it closes.
  const listHidden = panelId !== null && dockMode === 'full'

  const selectRange = (to: string) => {
    const from = anchor ?? cursorId ?? to
    const range = selectionRange(itemIds, from, to)
    if (range.length === 0) return
    setSelected((current) => new Set([...current, ...range]))
  }

  const toggleSelected = (id: string, range: boolean) => {
    if (range) {
      selectRange(id)
      return
    }
    setAnchor(id)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const scopeRef = useRef<ListScope | null>(null)
  const latestScope: ListScope = {
    move: (delta, extend) => {
      if (itemIds.length === 0) return
      const index = cursorId ? itemIds.indexOf(cursorId) : -1
      const nextIndex =
        index === -1
          ? delta > 0
            ? 0
            : itemIds.length - 1
          : Math.min(itemIds.length - 1, Math.max(0, index + delta))
      const next = itemIds[nextIndex]
      if (!next) return
      if (extend && selectable) {
        if (!anchor) setAnchor(cursorId ?? next)
        selectRange(next)
      }
      moveCursor(next)
      // With the panel open, j and k read the next item in it.
      if (panelId && !extend && next !== panelId) openPanel(next)
    },
    moveTo: (edge) => {
      const next = edge === 'first' ? itemIds[0] : itemIds[itemIds.length - 1]
      if (!next) return
      moveCursor(next)
      if (panelId && next !== panelId) openPanel(next)
    },
    toggleSelected: () => {
      if (cursorId && selectable) toggleSelected(cursorId, false)
    },
    clear: () => {
      // Escape closes the panel first, then clears the selection, then the cursor.
      if (panelId) {
        closePanel()
        return true
      }
      if (selected.size > 0) {
        setSelected(new Set())
        setAnchor(null)
        return true
      }
      if (cursorId) {
        setCursorId(null)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return true
      }
      return false
    },
    focusSearch: () => setSearchOpen(true),
    cursorItemId: () => cursorId,
  }
  useLayoutEffect(() => {
    scopeRef.current = latestScope
  })
  // One stable scope object for the command registry; it reads the latest state through the ref.
  const scope = useMemo<ListScope>(
    () => ({
      move: (delta, extend) => scopeRef.current?.move(delta, extend),
      moveTo: (edge) => scopeRef.current?.moveTo(edge),
      toggleSelected: () => scopeRef.current?.toggleSelected(),
      clear: () => scopeRef.current?.clear() ?? false,
      focusSearch: () => scopeRef.current?.focusSearch(),
      cursorItemId: () => scopeRef.current?.cursorItemId() ?? null,
    }),
    [],
  )
  useListScope(library.pending || library.failed ? null : scope)

  // ---- URL updates ----
  // A new search or filter keeps the item open in the panel: the person is still reading it.
  const updateSearch = (patch: Partial<LibrarySearch>, replace = false) =>
    void navigate({
      to: '/library',
      search: (previous: LibraryRouteSearch) => ({
        ...listSearch({ ...previous, ...patch }),
        panel: previous.panel,
        tab: previous.tab,
      }),
      replace,
    })

  const [query, setQuery] = useState(search.q ?? '')
  // On a phone the search field opens from a button; it stays open while it holds a query.
  const [searchToggled, setSearchToggled] = useState(false)
  const searchOpen = searchToggled || Boolean(query)
  const setSearchOpen = (open: boolean) => {
    setSearchToggled(open)
    if (open) requestAnimationFrame(() => searchRef.current?.focus())
  }
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
    if (event.key === 'ArrowDown' && itemIds.length > 0) {
      event.preventDefault()
      const first = itemIds[0]
      if (first) moveCursor(first)
    } else if (event.key === 'Escape') {
      if (query) changeQuery('')
      else event.currentTarget.blur()
    }
  }

  const sortState = sortStateOf(search)
  const onSort = (sort: LibrarySort) => {
    if (sortState.sort === sort) {
      updateSearch({ dir: sortState.dir === 'asc' ? 'desc' : 'asc' })
    } else {
      updateSearch({ sort, dir: undefined })
    }
  }
  const clearAll = () =>
    updateSearch({
      q: undefined,
      kind: undefined,
      status: undefined,
      area: undefined,
      about: undefined,
    })

  const filterCount = activeFilterCount(search)
  const showLoading = useDelayedFlag(library.pending)

  // ---- states (contract 9.5) ----
  let body
  if (library.failed) {
    body = <ListError error={library.error} onRetry={library.refetch} />
  } else if (library.pending) {
    body = showLoading ? (
      <ListLoading
        columns={fit.columns}
        narrow={narrow}
        density={effectiveDensity}
        selectable={selectable}
        header={
          <ColumnHeader
            columns={fit.columns}
            sortState={sortState}
            onSort={onSort}
            selection={selectable ? { selected: 0, total: 0, onToggleAll: () => {} } : undefined}
          />
        }
      />
    ) : null
  } else if (rows.length === 0) {
    const filtered = Boolean(search.q?.trim()) || filterCount > 0
    if (filtered) {
      body = <ListNoResults description={describeFilters(search, areaName)} onClear={clearAll} />
    } else if (
      view === 'attention' &&
      attentionInMyDomains(library.viewer, search.domains === 'all')
    ) {
      body = (
        <ListEmpty
          title="Nothing to check in your domains"
          action={
            <Button
              variant="outline"
              render={<Link to="/library" search={{ view: 'attention', domains: 'all' }} />}
            >
              Show all domains
            </Button>
          }
        >
          Every fact you own is within its check date, and its sources are in place.
        </ListEmpty>
      )
    } else if (view === 'attention') {
      body = (
        <ListEmpty
          title="Nothing to check"
          action={
            <Button variant="outline" render={<Link to="/library" />}>
              Show all facts
            </Button>
          }
        >
          Every fact is within its check date, and its sources are in place.
        </ListEmpty>
      )
    } else if (view === 'mine') {
      body = (
        <ListEmpty title="Nothing of yours yet">
          Facts you write, or look after as an owner, show up here.
        </ListEmpty>
      )
    } else {
      body = (
        <ListEmpty title="Nothing here yet">
          No facts yet. A fact shows here once the owner of its domain accepts it.
        </ListEmpty>
      )
    }
  } else {
    body = (
      <ItemList
        ref={listRef}
        entries={entries}
        columns={fit.columns}
        narrow={narrow}
        density={effectiveDensity}
        today={library.today}
        terms={queryTerms(search.q)}
        linkSearch={carried}
        openId={panelId}
        panelTab={search.tab}
        cursorId={cursorId}
        selected={selected}
        selectable={selectable}
        stickyOffset={headerHeight + stickyHeight}
        collapsedGroups={collapsed}
        onToggleGroup={(groupKey) =>
          setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(groupKey)) next.delete(groupKey)
            else next.add(groupKey)
            return next
          })
        }
        onCursor={setCursorId}
        onToggleSelected={toggleSelected}
        onOpen={(id) => {
          rememberCursor(search, id)
        }}
        onMoveToBin={isAdmin ? (row) => moveToBin([row]) : undefined}
      />
    )
  }

  // Rows in the view before the search and the filters: "57 of 1,404 items".
  const total = useMemo(
    () => viewTotal(library.rows, view, filtersOf(search), library.viewer),
    [library.rows, view, search, library.viewer],
  )
  const searchField = (
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
        placeholder={view === 'all' ? 'Search the library' : `Search ${viewInfo?.title ?? ''}`}
        aria-label="Search the library"
        aria-describedby="library-count"
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
  )

  const showTable = !library.failed && !library.pending && rows.length > 0
  return (
    <Page
      title={title}
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
        {library.stale && library.loadedAt ? (
          <ListStale loadedAt={library.loadedAt} onRetry={library.refetch} />
        ) : null}
        <LibraryBar
          search={search}
          areas={areas}
          rows={library.rows}
          viewer={library.viewer}
          sortState={sortState}
          density={density}
          chosenColumns={chosenColumns}
          droppedColumns={fit.dropped}
          activeCount={filterCount}
          shown={rows.length}
          total={total}
          pending={library.pending}
          hiddenIssues={hiddenIssues}
          searchField={searchField}
          searchOpen={searchOpen}
          onSearchOpen={setSearchOpen}
          onSearch={updateSearch}
          onDensity={setDensity}
          onColumns={setChosenColumns}
        />
      </div>
      {showTable ? (
        // The totals sit under the table, outside it: they are a summary, not a row of items.
        <div className="flex flex-col" inert={listHidden || undefined}>
          <div
            role="table"
            aria-label={title}
            aria-rowcount={entries.length + 1}
            className="flex flex-col"
          >
            {narrow ? null : (
              <ColumnHeader
                columns={fit.columns}
                sortState={sortState}
                onSort={onSort}
                selection={
                  selectable
                    ? {
                        selected: itemIds.filter((id) => selected.has(id)).length,
                        total: itemIds.length,
                        // With any row selected it clears, as its label says; otherwise it selects all.
                        onToggleAll: () =>
                          setSelected((current) =>
                            itemIds.some((id) => current.has(id)) ? new Set() : new Set(itemIds),
                          ),
                      }
                    : undefined
                }
              />
            )}
            {body}
          </div>
          <AddRow
            columns={fit.columns}
            density={effectiveDensity}
            narrow={narrow}
            selectable={selectable}
          />
          {narrow ? null : (
            <ListFooter
              rows={rows}
              columns={fit.columns}
              selectable={selectable}
              today={library.today}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col">{body}</div>
      )}
      {selected.size > 0 && !listHidden ? (
        <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <SelectionBarButton onClick={() => copyLinks([...selected])}>
            <LinkIcon />
            Copy links
          </SelectionBarButton>
          {isAdmin ? (
            <SelectionBarButton
              onClick={() => moveToBin(library.rows.filter((row) => selected.has(row.id)))}
            >
              <Trash2Icon />
              Move to Bin
            </SelectionBarButton>
          ) : null}
        </SelectionBar>
      ) : null}
      {isAdmin ? (
        <MoveToBinDialog
          subjects={binning}
          open={binOpen}
          onOpenChange={setBinOpen}
          onMoved={() => {
            const moved = new Set(binning.map((row) => row.id))
            setSelected((current) => new Set([...current].filter((id) => !moved.has(id))))
            // A moved item open in the panel is gone: the panel closes with it.
            if (panelId && moved.has(panelId)) closePanel()
          }}
        />
      ) : null}
      {panelId ? (
        <ItemPanel
          itemId={panelId}
          tab={panelTab}
          onTabChange={showPanelTab}
          position={panelIndex >= 0 ? { index: panelIndex, total: itemIds.length } : null}
          onPrevious={panelPrevious ? () => openPanel(panelPrevious) : undefined}
          onNext={panelNext ? () => openPanel(panelNext) : undefined}
          onClose={closePanel}
          listSearch={carried}
        />
      ) : null}
    </Page>
  )
}
