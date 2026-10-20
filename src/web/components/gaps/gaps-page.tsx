import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { areasQuery, gapListQuery, topicCountsQuery, vocabularyQuery } from '@/api/queries'
import { HelpLink } from '@/components/help/help-link'
import { ChevronDownIcon, SearchIcon, XIcon } from '@/components/icons'
import { CountBadge, DomainBadge } from '@/components/item/item-marks'
import {
  ListEmpty,
  ListError,
  ListLoading,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useElementHeight, useElementWidth } from '@/hooks/use-element-size'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  describeGapFilters,
  gapFilterCount,
  gapOriginFilterNames,
  gapStatusNames,
  gapTypeNames,
  gapViewOf,
  gapViews,
  groupGapRows,
  groupTopicRows,
  privacyNote,
  toGapRow,
  toTopicRows,
  visibleGapRows,
  visibleTopicRows,
  type GapViewId,
} from '@/lib/gaps'
import { formatCount, queryTerms } from '@/lib/library'
import type { GapsSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { fitGapColumns, fitTopicColumns, gapColumnSpecs, topicColumnSpecs } from './gap-columns'
import { GapFilters } from './gap-filters'
import { GapHeaderRow, GapList } from './gap-list'
import { GapPanel } from './gap-panel'
import { TopicHeaderRow, TopicList } from './topic-list'

/** The service answers at most 200 gaps a page; the newest come first after the open ones. */
const GAPS_PAGE = { limit: 200 } as const

/**
 * The Gaps page (screen 8 of the front end plan, slice W9): topics where agents found nothing,
 * on the grid, grouped by where each stands, with a gap open in the docked panel beside them; and the topic counts
 * per week beside them. The view, the search, the filters and the open gap are in the address.
 * No count below the privacy minimum is ever printed (FR-614).
 */
export function GapsPage({ search }: { search: GapsSearch }) {
  const navigate = useNavigate({ from: '/gaps' })
  const view = gapViewOf(search)
  const gaps = useQuery(gapListQuery(GAPS_PAGE))
  const counts = useQuery(topicCountsQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: vocabulary } = useQuery(vocabularyQuery())
  // The minimum the service hid counts by; until it is known, every count but zero is hidden.
  const minimum = counts.data?.minimumCount ?? null

  const allGapRows = useMemo(
    () => (gaps.data ?? []).map((gap) => toGapRow(gap, { areas, vocabulary, minimum })),
    [gaps.data, areas, vocabulary, minimum],
  )
  const gapRows = useMemo(() => visibleGapRows(allGapRows, search), [allGapRows, search])
  const allTopicRows = useMemo(
    () => (counts.data ? toTopicRows(counts.data, { areas, vocabulary }) : []),
    [counts.data, areas, vocabulary],
  )
  const topicRows = useMemo(() => visibleTopicRows(allTopicRows, search), [allTopicRows, search])
  const terms = queryTerms(search.q)

  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const [stickyBlock, setStickyBlock] = useState<HTMLDivElement | null>(null)
  // Beside a docked panel the list fits the width it has once the sidebar has folded.
  const fitMode = useDockMode()
  const width = dockFitWidth(
    useElementWidth(region),
    Boolean(view === 'gaps' && search.gap) && fitMode === 'docked',
  )
  const stickyHeight = useElementHeight(stickyBlock)
  const gutter = useMediaQuery('(min-width: 48rem)') ? 24 : 16
  const oneDomain = Boolean(search.area)
  const gapFit = fitGapColumns(width || 1200, gutter, { oneDomain })
  const topicFit = fitTopicColumns(width || 1200, gutter, { oneDomain })
  const narrow = width > 0 && (view === 'gaps' ? gapFit.narrow : topicFit.narrow)

  const updateSearch = (patch: Partial<GapsSearch>, replace = false) =>
    void navigate({ to: '/gaps', search: (previous) => ({ ...previous, ...patch }), replace })

  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(search.q ?? '')
  const [lastQ, setLastQ] = useState(search.q)
  if (lastQ !== search.q) {
    setLastQ(search.q)
    setQuery(search.q ?? '')
  }
  const changeQuery = (value: string) => {
    setQuery(value)
    updateSearch({ q: value.trim() ? value : undefined }, true)
  }

  // ---- the gap open in the docked panel, and the list's keys (contract 9.2) ----
  const gapId = view === 'gaps' ? (search.gap ?? null) : null
  const gapIds = useMemo(() => gapRows.map((row) => row.id), [gapRows])
  const list: GapsSearch = { ...search, gap: undefined }
  const openGap = (id: string) =>
    void navigate({
      to: '/gaps',
      search: { ...list, gap: id },
      replace: true,
      state: true,
      resetScroll: false,
    })
  const dock = useDockList({
    region,
    ids: view === 'gaps' ? gapIds : [],
    panelId: gapId,
    open: openGap,
    close: () => void navigate({ to: '/gaps', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: !gaps.isPending && !counts.isPending,
  })
  // On a phone the panel fills the screen: the list under it is out of reach until it closes.
  const listHidden = gapId !== null && fitMode === 'full'

  const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? 'Unknown domain'
  const clearAll = () =>
    updateSearch({ q: undefined, status: undefined, type: undefined, area: undefined })

  const countGaps = useCallback(
    (patch: Partial<GapsSearch>) => visibleGapRows(allGapRows, { ...search, ...patch }).length,
    [allGapRows, search],
  )
  const countTopics = useCallback(
    (patch: Partial<GapsSearch>) => visibleTopicRows(allTopicRows, { ...search, ...patch }).length,
    [allTopicRows, search],
  )

  // The topic counts filter by domain only, so the status and type of the address stay unread.
  const filterCount = view === 'gaps' ? gapFilterCount(search) : search.area ? 1 : 0
  const loading = view === 'gaps' ? gaps.isPending || counts.isPending : counts.isPending
  const failed = view === 'gaps' ? gaps.isError && !gaps.data : counts.isError && !counts.data
  const stale =
    view === 'gaps'
      ? gaps.isError && gaps.data
        ? gaps
        : null
      : counts.isError && counts.data
        ? counts
        : null
  const showLoading = useDelayedFlag(loading)
  const shownRows = view === 'gaps' ? gapRows : topicRows
  const totalRows = view === 'gaps' ? allGapRows : allTopicRows
  const noun = view === 'gaps' ? 'gap' : 'topic week'

  let body
  if (failed) {
    body = (
      <ListError
        title={view === 'gaps' ? "We couldn't load the gaps" : "We couldn't load the topic counts"}
        safe="Nothing is lost."
        error={view === 'gaps' ? gaps.error : counts.error}
        onRetry={() => void (view === 'gaps' ? gaps.refetch() : counts.refetch())}
      />
    )
  } else if (loading) {
    const columns =
      view === 'gaps'
        ? gapFit.columns.map((id) => ({ id, widthClass: gapColumnSpecs[id].widthClass }))
        : topicFit.columns.map((id) => ({ id, widthClass: topicColumnSpecs[id].widthClass }))
    body = showLoading ? (
      <ListLoading
        label={view === 'gaps' ? 'Loading the gaps' : 'Loading the topic counts'}
        columns={columns}
        header={
          view === 'gaps' ? (
            <GapHeaderRow columns={gapFit.columns} />
          ) : (
            <TopicHeaderRow columns={topicFit.columns} />
          )
        }
        narrow={narrow}
        selectable={false}
        rowButton={false}
      />
    ) : null
  } else if (totalRows.length === 0) {
    body =
      view === 'gaps' ? (
        <ListEmpty
          title="No gaps yet"
          action={
            allTopicRows.length === 0 ? undefined : (
              <Button
                variant="outline"
                render={<Link to="/gaps" search={{ view: 'topics' }} />}
                nativeButton={false}
              >
                See what AI apps ask about
              </Button>
            )
          }
        >
          When AI apps ask about a topic and find nothing, or report that something is missing, the
          topic shows here, so its owners can add it.{' '}
          <HelpLink to="glossary#gap">What is a gap?</HelpLink>
        </ListEmpty>
      ) : (
        <ListEmpty title="No topic counts yet">
          A topic shows here once AI apps ask about it at least {minimum ?? 5} times in a week. We
          never show smaller counts, so nobody can tell who asked.
        </ListEmpty>
      )
  } else if (shownRows.length === 0) {
    body = (
      <ListNoResults
        title={view === 'gaps' ? 'No gaps match' : 'No topics match'}
        description={describeGapFilters(
          view === 'gaps' ? search : { q: search.q, area: search.area },
          areaName,
        )}
        onClear={clearAll}
      />
    )
  } else if (view === 'gaps') {
    body = (
      <GapList
        entries={groupGapRows(gapRows)}
        rows={gapRows}
        columns={gapFit.columns}
        narrow={narrow}
        terms={terms}
        panel={{ openId: gapId }}
        note={privacyNote(minimum)}
      />
    )
  } else {
    body = (
      <TopicList
        entries={groupTopicRows(topicRows)}
        rows={topicRows}
        hidden={counts.data?.hiddenTopicWeeks ?? 0}
        columns={topicFit.columns}
        narrow={narrow}
        terms={terms}
        note={privacyNote(minimum)}
      />
    )
  }

  const area = search.area ? areas.find((candidate) => candidate.id === search.area) : undefined
  const chips = [
    view === 'gaps' && search.status
      ? {
          key: 'status',
          text: `Status: ${gapStatusNames[search.status]}`,
          label: null,
          clear: { status: undefined },
        }
      : null,
    view === 'gaps' && search.type
      ? {
          key: 'type',
          text: `Type: ${gapTypeNames[search.type]}`,
          label: null,
          clear: { type: undefined },
        }
      : null,
    view === 'gaps' && search.origin
      ? {
          key: 'origin',
          text: `Origin: ${gapOriginFilterNames[search.origin]}`,
          label: null,
          clear: { origin: undefined },
        }
      : null,
    search.area
      ? {
          key: 'area',
          text: `Domain: ${area?.name ?? 'Unknown domain'}`,
          label: area ? (
            <>
              Domain:
              <DomainBadge name={area.name} label={area.label} form="bare" />
            </>
          ) : null,
          clear: { area: undefined },
        }
      : null,
  ].filter((chip) => chip !== null)

  const views = gapViews.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    count:
      candidate.id === 'gaps'
        ? gaps.data
          ? allGapRows.length
          : null
        : counts.data
          ? allTopicRows.length
          : null,
    // Open gaps the person can act on ask for a look.
    attention:
      candidate.id === 'gaps' && allGapRows.some((row) => row.canManage && row.status === 'open'),
  }))
  const shownGap = gapId ? gaps.data?.find((gap) => gap.id === gapId) : undefined

  return (
    <Page
      title="Gaps"
      data-template="list"
      ref={setRegion}
      // The column header sticks under the shell header and this block (custom property only).
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
            loadedAt={new Date(stale.dataUpdatedAt).toISOString()}
            onRetry={() => void stale.refetch()}
          />
        ) : null}
        <PageToolbar role="search" aria-label="Gaps" className="flex-wrap gap-y-2">
          <GapViewChips views={views} active={view} />
          <PageToolbarDivider />
          <GapFilters
            search={search}
            areas={areas}
            fields={view === 'gaps' ? ['status', 'type', 'origin', 'area'] : ['area']}
            count={view === 'gaps' ? countGaps : countTopics}
            activeCount={filterCount}
            onSearch={(patch) => updateSearch(patch)}
          />
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
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault()
                    changeQuery('')
                  }
                }}
                placeholder="Search topics"
                aria-label="Search topics"
                aria-describedby="gaps-count"
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
          <span id="gaps-count" aria-live="polite" className={toolbarCount}>
            {loading ? (
              ''
            ) : filterCount > 0 || search.q?.trim() ? (
              <>
                <span className="font-bold text-foreground">
                  {shownRows.length.toLocaleString('en')}
                </span>{' '}
                of {formatCount(totalRows.length, noun)}
              </>
            ) : (
              formatCount(shownRows.length, noun)
            )}
          </span>
        </PageToolbar>
        {chips.length ? (
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
                onClick={() => updateSearch(chip.clear)}
                aria-label={`Remove filter ${chip.text}`}
                className={cn('rounded-full', chip.label && 'gap-2')}
              >
                {chip.label ?? chip.text}
                <XIcon className="text-muted-foreground" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col" inert={listHidden || undefined}>
        {shownRows.length > 0 && !loading && !failed ? (
          body
        ) : (
          <div className="flex flex-col">{body}</div>
        )}
      </div>
      {gapId ? (
        <GapPanel
          gapId={gapId}
          placeholder={shownGap}
          minimum={minimum}
          position={dock.position}
          onPrevious={dock.previousId ? () => openGap(dock.previousId!) : undefined}
          onNext={dock.nextId ? () => openGap(dock.nextId!) : undefined}
          onClose={dock.closePanel}
        />
      ) : null}
    </Page>
  )
}

type ViewChip = { id: GapViewId; title: string; count: number | null; attention: boolean }

function Count({ chip }: { chip: ViewChip }) {
  if (chip.count === null) return null
  return <CountBadge count={chip.count} tone={chip.attention ? 'attention' : 'quiet'} />
}

/**
 * The page's two views as chips with a count, the Proposals page's view chips: the active chip
 * filled, a count of open gaps the person can act on in amber. Below a 672 pixel container the
 * chips become one menu button (contract 8.4). A view keeps the search and the domain.
 */
function GapViewChips({ views, active }: { views: readonly ViewChip[]; active: GapViewId }) {
  const navigate = useNavigate({ from: '/gaps' })
  const current = views.find((view) => view.id === active) ?? views[0]
  const searchFor = (id: GapViewId) => (previous: GapsSearch) => ({
    q: previous.q,
    area: previous.area,
    view: id === 'topics' ? ('topics' as const) : undefined,
  })
  return (
    <>
      <nav aria-label="Gap views" className="flex items-center gap-1 @max-2xl:hidden">
        {views.map((view) => (
          <Link
            key={view.id}
            from="/gaps"
            to="/gaps"
            search={searchFor(view.id)}
            // The Gaps view has no `view`: without this, TanStack would also call it current
            // on the topic counts, whose address holds everything the Gaps link holds.
            activeOptions={{ explicitUndefined: true }}
            aria-current={view.id === active ? 'page' : undefined}
            className={toolbarViewClass}
          >
            {view.title}
            <Count chip={view} />
          </Link>
        ))}
      </nav>
      {current ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="touch"
                aria-label={`View: ${current.title}`}
                className="@2xl:hidden"
              />
            }
          >
            {current.title}
            <Count chip={current} />
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={active}
              onValueChange={(value: GapViewId) =>
                void navigate({ to: '/gaps', search: searchFor(value) })
              }
            >
              {views.map((view) => (
                <DropdownMenuRadioItem key={view.id} value={view.id}>
                  <span className="flex-1">{view.title}</span>
                  <Count chip={view} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}
