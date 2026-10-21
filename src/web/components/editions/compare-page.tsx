import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EditionChangeKind } from '@domain/editions'
import { itemKinds, riskLevels } from '@domain/item'
import { toApiError, type EditionComparison } from '@/api'
import {
  editionComparisonPagesQuery,
  editionComparisonQuery,
  editionFeedPagesQuery,
} from '@/api/edition-queries'
import type { EditionChangesFilter } from '@/api/queries'
import { areasQuery, peopleQuery } from '@/api/queries'
import {
  CheckCheckIcon,
  GitCommitHorizontalIcon,
  HeedDomainIcon,
  HeedRiskIcon,
  SearchXIcon,
  ShapesIcon,
  SplitIcon,
  XIcon,
} from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { DomainBadge, KindBadge } from '@/components/item/item-marks'
import {
  ListError,
  ListLoading,
  ListMessage,
  useDelayedFlag,
} from '@/components/library/list-state'
import { AudienceGate } from '@/components/page/audience-gate'
import { useDockMode } from '@/components/page/dock-panel'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'
import { Page, PageContent, PageToolbar } from '@/components/page/page'
import { PageToolbarDivider, toolbarCount } from '@/components/page/toolbar'
import { dockFitWidth, useDockList } from '@/components/page/use-dock-list'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useElementHeight, useElementWidth } from '@/hooks/use-element-size'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  compareColumnSpecs,
  compareEntries,
  compareGroupOrder,
  fitCompareColumns,
  groupStartsClosed,
  viewedKey,
  type CompareGroup,
  type ComparedItem,
} from '@/lib/edition-compare'
import {
  changeCountParts,
  changeLabels,
  type EditionSummary,
  type ItemChange,
} from '@/lib/edition-diff'
import { editionsRefusal } from '@/lib/editions'
import { kindNames } from '@/lib/library'
import type { EditionCompareSearch } from '@/lib/search-params'
import { useEditionViewed } from '@/lib/use-edition-viewed'
import { cn } from '@/lib/utils'
import { EditionChangeBadge, EditionChangeCounts } from './change-card'
import { CompareHeaderRow, CompareList } from './compare-list'
import { CompareItemPanel, type PanelPlaceholder } from './compare-panel'
import { CompareRangeBar, CompareViews } from './compare-range'
import { CompareSteps, stepRowId } from './compare-steps'

const TITLE = 'What changed between editions'

/**
 * What changed between two editions (Editions design, slice S2): any two editions, Since and
 * Until, read like a pull request: a sentence that says what changed, the changed items grouped
 * by the kind of change as one windowed list, filters, a Viewed box on each item and the item
 * open in the docked panel field by field. Or edition by edition, as each one was made. For
 * owners, deputies and administrators, like the rest of Editions.
 */
export function EditionComparePage({ search }: { search: EditionCompareSearch }) {
  return (
    <AudienceGate audience="quality" title={TITLE} refusal={editionsRefusal}>
      <CompareView search={search} />
    </AudienceGate>
  )
}

type Filters = Pick<EditionChangesFilter, 'change' | 'areaId' | 'kind' | 'riskLevel'>

/** One group's pages: read while its kind has items and the list shows it. */
function useChangeGroup(
  kind: EditionChangeKind,
  range: { from?: string; to: string } | null,
  filters: Filters,
  enabled: boolean,
) {
  return useInfiniteQuery({
    ...editionComparisonPagesQuery({ ...range!, ...filters, change: kind }),
    enabled: range !== null && enabled,
  })
}

function CompareView({ search }: { search: EditionCompareSearch }) {
  const navigate = useNavigate({ from: '/editions/compare' })
  const queryClient = useQueryClient()
  const steps = search.view === 'steps'
  const asked = {
    ...(search.since ? { from: search.since } : {}),
    ...(search.until ? { to: search.until } : {}),
  }
  const summary = useQuery(editionComparisonQuery({ ...asked, limit: 1 }))
  const data = summary.data

  // A comparison is a link: once the service names the two editions, the address holds them.
  useEffect(() => {
    if (!data) return
    const since = data.from?.label
    const until = data.to.label
    if (search.since === since && search.until === until) return
    if (search.since !== undefined && search.until !== undefined) return
    queryClient.setQueryData(
      editionComparisonQuery({ ...(since ? { from: since } : {}), to: until, limit: 1 }).queryKey,
      data,
    )
    void navigate({
      to: '/editions/compare',
      // Since before Until, however the link that opened the page put them.
      search: ({ since: _since, until: _until, ...previous }) => ({ since, until, ...previous }),
      replace: true,
    })
  }, [data, search.since, search.until, navigate, queryClient])

  const range = data ? { ...(data.from ? { from: data.from.label } : {}), to: data.to.label } : null
  const filters: Filters = {
    ...(search.change ? { change: search.change } : {}),
    ...(search.area ? { areaId: search.area } : {}),
    ...(search.kind ? { kind: search.kind } : {}),
    ...(search.risk ? { riskLevel: search.risk } : {}),
  }
  const { change: _change, ...narrowing } = filters
  const narrowed = Object.keys(narrowing).length > 0
  const shows = (kind: EditionChangeKind) =>
    !steps &&
    data !== undefined &&
    data.facets.change[kind] > 0 &&
    (!search.change || search.change === kind)

  // One read per kind of change, so each group knows its count, opens and closes on its own and
  // pages only when someone scrolls through it.
  const changed = useChangeGroup('changed', range, narrowing, shows('changed'))
  const added = useChangeGroup('added', range, narrowing, shows('added'))
  const retired = useChangeGroup('retired', range, narrowing, shows('retired'))
  const removed = useChangeGroup('removed', range, narrowing, shows('removed'))
  const checked = useChangeGroup('checked', range, narrowing, shows('checked'))
  const resaved = useChangeGroup('resaved', range, narrowing, shows('resaved'))
  const reads = { changed, added, retired, removed, checked, resaved }

  const [open, setOpen] = useState<ReadonlySet<EditionChangeKind>>(() => new Set())
  const [closed, setClosed] = useState<ReadonlySet<EditionChangeKind>>(() => new Set())
  const isCollapsed = (kind: EditionChangeKind) =>
    closed.has(kind) || (groupStartsClosed(kind) && !open.has(kind))
  const toggleGroup = (kind: EditionChangeKind) => {
    const collapsed = isCollapsed(kind)
    setOpen((previous) => toggled(previous, kind, collapsed))
    setClosed((previous) => toggled(previous, kind, !collapsed))
  }

  const groups: CompareGroup[] = compareGroupOrder
    .filter((kind) => shows(kind))
    .map((kind) => {
      const read = reads[kind]
      const items = read.data?.pages.flatMap((page) => page.items) ?? []
      const total = narrowed ? (read.data?.pages[0]?.total ?? null) : data!.facets.change[kind]
      return { kind, total, items, collapsed: isCollapsed(kind) }
    })
  const entries = compareEntries(groups)
  const listItems = entries.flatMap((entry) => (entry.type === 'item' ? [entry.item] : []))
  const shownTotal = groups.reduce((sum, group) => sum + (group.total ?? 0), 0)
  const allTotal = data
    ? compareGroupOrder.reduce((sum, kind) => sum + data.facets.change[kind], 0)
    : 0

  // A placeholder in view reads its group's next page; one read at a time per group.
  const latestReads = useRef(reads)
  useLayoutEffect(() => {
    latestReads.current = reads
  })
  const needMore = useCallback((kind: EditionChangeKind) => {
    const read = latestReads.current[kind]
    if (read.hasNextPage && !read.isFetchingNextPage && !read.isError) void read.fetchNextPage()
  }, [])

  // ---- the feed, edition by edition ----
  const backwards = data?.backwards ?? false
  const later = backwards ? data?.from?.label : data?.to.label
  const earlier = backwards ? data?.to.label : data?.from?.label
  const feed = useInfiniteQuery({
    ...editionFeedPagesQuery({
      ...(earlier ? { after: earlier } : {}),
      ...(later ? { through: later } : {}),
      limit: 20,
    }),
    enabled: steps && data !== undefined,
  })
  const feedEntries: EditionSummary[] = useMemo(
    () => feed.data?.pages.flatMap((page) => page.entries) ?? [],
    [feed.data],
  )

  // ---- the viewed marks ----
  const { viewed, toggle } = useEditionViewed()
  const toggleViewed = (change: Pick<ComparedItem, 'itemId' | 'from' | 'to'>) =>
    toggle(viewedKey(change))
  const viewedCount = listItems.filter((item) => viewed.has(viewedKey(item))).length

  // ---- the open item, and the list's keys ----
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const [stickyBlock, setStickyBlock] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelId = search.item
    ? steps
      ? stepRowId(search.step ?? '', search.item)
      : search.item
    : null
  const stepItems = useMemo(
    () =>
      feedEntries.flatMap((entry) =>
        entry.items.map((item) => ({ id: stepRowId(entry.edition.label, item.itemId), item })),
      ),
    [feedEntries],
  )
  const ids = steps ? stepItems.map((row) => row.id) : listItems.map((item) => item.itemId)
  const list: EditionCompareSearch = { ...search, item: undefined, step: undefined, tab: undefined }
  // The next item opens on the panel's tab, as the rows' links do.
  const openRow = (id: string) => {
    const [step, item] = steps ? id.split('|') : [undefined, id]
    void navigate({
      to: '/editions/compare',
      search: { ...list, item, step, tab: search.tab },
      replace: true,
      state: true,
      resetScroll: false,
    })
  }
  const rowChange = (id: string): ItemChange | ComparedItem | undefined =>
    steps
      ? stepItems.find((row) => row.id === id)?.item
      : listItems.find((item) => item.itemId === id)
  const dock = useDockList({
    region,
    ids,
    panelId,
    open: openRow,
    close: () =>
      void navigate({ to: '/editions/compare', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: data !== undefined,
    toggleViewed: (id) => {
      const change = rowChange(id)
      if (change) toggleViewed(change)
    },
  })

  // ---- the grid's columns ----
  const fitMode = useDockMode()
  const width = dockFitWidth(useElementWidth(region), Boolean(search.item) && fitMode === 'docked')
  const stickyHeight = useElementHeight(stickyBlock)
  const gutter = useMediaQuery('(min-width: 48rem)') ? 24 : 16
  const fit = fitCompareColumns(width || 1200, gutter)
  const narrow = width > 0 && fit.narrow
  const listHidden = search.item !== undefined && fitMode === 'full'

  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const lookups = useMemo(
    () => ({
      areas,
      personOf: (id: string) => people.find((person) => person.id === id) ?? null,
    }),
    [areas, people],
  )

  // A filter is a new entry and keeps the open item, as the library's filters do.
  const updateSearch = (patch: Partial<EditionCompareSearch>) =>
    void navigate({
      to: '/editions/compare',
      search: (previous) => ({ ...previous, ...patch }),
      resetScroll: false,
    })
  const clearFilters = () =>
    updateSearch({ change: undefined, area: undefined, kind: undefined, risk: undefined })

  const loading = summary.isPending
  const showLoading = useDelayedFlag(loading)
  const failed = summary.isError && !data
  const notFound = failed && toApiError(summary.error).kind === 'not-found'
  const nothing = data !== undefined && allTotal === 0
  const firstPageFailed = groups.find((group) => reads[group.kind].isError && !group.items.length)

  let body: ReactNode
  if (notFound) {
    body = (
      <ListMessage
        icon={GitCommitHorizontalIcon}
        title="One of these editions doesn't exist"
        action={
          <Button variant="outline" render={<Link to="/editions/compare" />} nativeButton={false}>
            See the latest edition&apos;s changes
          </Button>
        }
      >
        We couldn&apos;t find edition {[search.since, search.until].filter(Boolean).join(' or ')}. A
        number may be mistyped, or the edition was never saved.
      </ListMessage>
    )
  } else if (failed) {
    body = (
      <ListError
        title="We couldn't load what changed"
        safe="Nothing is lost."
        error={summary.error}
        onRetry={() => void summary.refetch()}
        detail={summary.error.message}
      />
    )
  } else if (loading) {
    body = showLoading ? (
      <ListLoading
        label="Loading what changed"
        columns={fit.columns.map((id) => ({ id, widthClass: compareColumnSpecs[id].widthClass }))}
        header={<CompareHeaderRow columns={fit.columns} />}
        narrow={narrow}
        selectable={false}
        rowButton={false}
        rows={8}
      />
    ) : null
  } else if (steps) {
    body = (
      <PageContent width="overview">
        <CompareSteps
          entries={feedEntries}
          pending={feed.isPending}
          error={feed.error}
          onRetry={() => void feed.refetch()}
          hasMore={feed.hasNextPage}
          loadingMore={feed.isFetchingNextPage}
          onMore={() => void feed.fetchNextPage()}
          backwards={backwards}
          areas={areas}
          actions={{
            openId: panelId,
            viewed,
            onToggleViewed: toggleViewed,
            narrow,
          }}
        />
      </PageContent>
    )
  } else if (nothing) {
    body = <NothingChanged comparison={data} />
  } else if (shownTotal === 0 && groups.every((group) => group.total !== null)) {
    body = (
      <ListMessage
        icon={SearchXIcon}
        title="No changed fact matches"
        action={
          <Button variant="outline" onClick={clearFilters}>
            Clear the filters
          </Button>
        }
      >
        Clear the filters to see every fact that changed between these editions.
      </ListMessage>
    )
  } else if (firstPageFailed) {
    body = (
      <ListError
        title="We couldn't load the changed facts"
        safe="Nothing is lost."
        error={reads[firstPageFailed.kind].error}
        onRetry={() => void reads[firstPageFailed.kind].refetch()}
      />
    )
  } else {
    body = (
      <div role="table" aria-label="Changed facts" data-slot="compare-list">
        {narrow ? null : <CompareHeaderRow columns={fit.columns} />}
        <CompareList
          entries={entries}
          columns={fit.columns}
          narrow={narrow}
          actions={{
            openId: search.item ?? null,
            viewed,
            onToggleViewed: toggleViewed,
          }}
          lookups={lookups}
          stickyOffset={stickyHeight}
          onToggleGroup={toggleGroup}
          onNeedMore={needMore}
        />
      </div>
    )
  }

  // ---- the item open in the panel ----
  const openChange = panelId ? rowChange(panelId) : undefined
  const placeholder: PanelPlaceholder | undefined = openChange

  return (
    <Page
      title={TITLE}
      data-template="list"
      ref={setRegion}
      // The column header sticks under the shell header and the filter bar (custom property only).
      style={
        {
          '--list-sticky-top': `calc(var(--header-height) + ${stickyHeight}px)`,
        } as CSSProperties
      }
    >
      <div inert={listHidden || undefined} className="flex flex-col">
        <CompareRangeBar search={search} since={data?.from ?? null} until={data?.to ?? null} />
        <Summary comparison={data} loading={loading} />
      </div>
      <div
        ref={setStickyBlock}
        inert={listHidden || undefined}
        className="sticky top-header z-sticky bg-background"
      >
        {!steps && data && !nothing ? (
          <CompareFilters
            comparison={data}
            search={search}
            onSearch={updateSearch}
            shown={shownTotal}
            all={allTotal}
            viewedCount={viewedCount}
          />
        ) : (
          <PageToolbar aria-label="Changed facts">
            <CompareViews view={steps ? 'steps' : 'net'} />
          </PageToolbar>
        )}
      </div>
      <div className="flex flex-col" inert={listHidden || undefined}>
        {body}
      </div>
      {search.item && data ? (
        <CompareItemPanel
          key={panelId}
          itemId={search.item}
          to={steps ? (search.step ?? data.to.label) : data.to.label}
          from={steps ? undefined : data.from?.label}
          placeholder={placeholder}
          position={dock.position}
          onPrevious={dock.previousId ? () => openRow(dock.previousId!) : undefined}
          onNext={dock.nextId ? () => openRow(dock.nextId!) : undefined}
          onClose={dock.closePanel}
          tab={search.tab ?? 'changes'}
          onTabChange={(tab) =>
            void navigate({
              to: '/editions/compare',
              search: (previous) => ({ ...previous, tab: tab === 'changes' ? undefined : tab }),
              replace: true,
              state: true,
              resetScroll: false,
            })
          }
          viewed={openChange ? viewed.has(viewedKey(openChange)) : null}
          onToggleViewed={(comparison) => {
            if (comparison.change) toggleViewed(comparison.change)
          }}
        />
      ) : null}
    </Page>
  )
}

function toggled<T>(set: ReadonlySet<T>, value: T, on: boolean): ReadonlySet<T> {
  const next = new Set(set)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

/**
 * The comparison in one sentence (what changed, across how many editions), its counts, and
 * what reading it backwards means. The service writes the sentence from a template.
 */
function Summary({
  comparison,
  loading,
}: {
  comparison: EditionComparison | undefined
  loading: boolean
}) {
  // One edition against itself has nothing to sum up; the page says so in its place.
  if (comparison && comparison.from?.label === comparison.to.label) return null
  if (!comparison)
    return loading ? (
      <div
        role="status"
        aria-label="Loading the summary"
        data-layout="content"
        className="flex flex-col gap-3 border-b px-gutter py-4"
      >
        <Skeleton className="h-4 w-2/3 max-w-reading" />
        <Skeleton className="h-5 w-1/3 max-w-reading rounded-badge" />
      </div>
    ) : null
  return (
    <section
      aria-label="Summary"
      data-layout="content"
      data-slot="compare-summary"
      className="flex flex-col gap-3 border-b px-gutter py-4"
    >
      <p className="max-w-reading text-reading break-words">{comparison.sentence}</p>
      <EditionLinks comparison={comparison} />
      {changeCountParts(comparison.facets.change).length ? (
        <EditionChangeCounts counts={comparison.facets.change} />
      ) : null}
      {comparison.backwards ? (
        <p className="flex max-w-reading items-start gap-2 text-dense text-muted-foreground">
          <SplitIcon aria-hidden="true" className="size-4 shrink-0" />
          Until is older than Since, so this reads as what going back from {
            comparison.from?.label
          }{' '}
          to {comparison.to.label} would change.
        </p>
      ) : null}
    </section>
  )
}

/**
 * The two editions compared, each a link to its page: the way back to the edition this was
 * opened from, and on to the other one.
 */
function EditionLinks({ comparison }: { comparison: EditionComparison }) {
  const sides = [
    { word: 'Since', edition: comparison.from },
    { word: 'Until', edition: comparison.to },
  ].flatMap(({ word, edition }) => (edition ? [{ word, label: edition.label }] : []))
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-dense text-muted-foreground">
      {sides.map(({ word, label }) => (
        <span key={word}>
          {word} edition{' '}
          <Link
            to="/editions/$label"
            params={{ label }}
            className="font-mono text-foreground tabular-nums underline-offset-4 hover:underline"
            translate="no"
          >
            {label}
          </Link>
        </span>
      ))}
    </p>
  )
}

/** Nothing changed between the two editions: say why, and offer the latest edition's changes. */
function NothingChanged({ comparison }: { comparison: EditionComparison }) {
  const same = comparison.from?.label === comparison.to.label
  const other = comparison.vocabulary > 0
  // The latest edition against the one before it is where the button would lead.
  const latest = comparison.to.live && comparison.editions === 1 && !comparison.backwards
  return (
    <ListMessage
      icon={CheckCheckIcon}
      title={same ? 'These are the same edition' : 'No fact changed between these editions'}
      action={
        latest ? undefined : (
          <Button variant="outline" render={<Link to="/editions/compare" />} nativeButton={false}>
            See the latest edition&apos;s changes
          </Button>
        )
      }
    >
      {same
        ? 'Since and Until name one edition, so nothing can differ. Pick an earlier edition under Since.'
        : other
          ? 'Agents get the same facts in both. The sentence above says what else changed.'
          : comparison.withheld > 0
            ? "Only facts that some groups can see changed, and those aren't shown here."
            : 'Agents get exactly the same facts in both editions.'}
    </ListMessage>
  )
}

/**
 * The bar over the list: Filter by change, domain, kind and risk, with how many items each value
 * holds, the filters that are on as chips, and how many items the list shows and how many of
 * those the person has viewed.
 */
function CompareFilters({
  comparison,
  search,
  onSearch,
  shown,
  all,
  viewedCount,
}: {
  comparison: EditionComparison
  search: EditionCompareSearch
  onSearch: (patch: Partial<EditionCompareSearch>) => void
  shown: number
  all: number
  viewedCount: number
}) {
  const [open, setOpen] = useState(false)
  const { data: areas = [] } = useQuery(areasQuery())
  const area = (id: string) => areas.find((candidate) => candidate.id === id)
  const { facets } = comparison
  const pick = <K extends 'change' | 'area' | 'kind' | 'risk'>(
    key: K,
    value: NonNullable<EditionCompareSearch[K]>,
  ) => onSearch({ [key]: search[key] === value ? undefined : value })

  const fields: FilterMenuField[] = [
    {
      id: 'change',
      title: 'Change',
      icon: GitCommitHorizontalIcon,
      on: search.change ? 1 : 0,
      options: compareGroupOrder
        .filter((kind) => facets.change[kind] > 0)
        .map((kind) => ({
          key: kind,
          name: changeLabels[kind],
          checked: search.change === kind,
          count: facets.change[kind],
          onChange: () => pick('change', kind),
          children: <EditionChangeBadge change={kind} />,
        })),
    },
    {
      id: 'area',
      title: 'Domain',
      icon: HeedDomainIcon,
      on: search.area ? 1 : 0,
      options: facets.areas.map(({ areaId, count }) => {
        const found = area(areaId)
        return {
          key: areaId,
          name: found?.name ?? 'Unknown domain',
          checked: search.area === areaId,
          count,
          onChange: () => pick('area', areaId),
          children: found ? (
            <DomainBadge name={found.name} label={found.label} size="sm" />
          ) : (
            'Unknown domain'
          ),
        }
      }),
    },
    {
      id: 'kind',
      title: 'Kind',
      icon: ShapesIcon,
      on: search.kind ? 1 : 0,
      options: itemKinds
        .map((kind) => ({ kind, count: facets.kinds.find((k) => k.kind === kind)?.count ?? 0 }))
        .filter(({ count }) => count > 0)
        .map(({ kind, count }) => ({
          key: kind,
          name: kindNames[kind],
          checked: search.kind === kind,
          count,
          onChange: () => pick('kind', kind),
          children: <KindBadge kind={kind} size="sm" />,
        })),
    },
    {
      id: 'risk',
      title: 'Risk',
      icon: HeedRiskIcon,
      on: search.risk ? 1 : 0,
      options: riskLevels
        .map((level) => ({
          level,
          count: facets.risks.find((r) => r.riskLevel === level)?.count ?? 0,
        }))
        .filter(({ count }) => count > 0)
        .map(({ level, count }) => ({
          key: level,
          name: `${level.charAt(0).toUpperCase()}${level.slice(1)} risk`,
          checked: search.risk === level,
          count,
          onChange: () => pick('risk', level),
          children: <RiskBadge level={level} size="sm" />,
        })),
    },
  ]
  const active = fields.reduce((sum, field) => sum + field.on, 0)

  const chips: {
    key: string
    text: string
    label: ReactNode
    clear: Partial<EditionCompareSearch>
  }[] = []
  if (search.change)
    chips.push({
      key: 'change',
      text: `Change: ${changeLabels[search.change]}`,
      label: <>Change: {changeLabels[search.change]}</>,
      clear: { change: undefined },
    })
  if (search.area) {
    const found = area(search.area)
    chips.push({
      key: 'area',
      text: `Domain: ${found?.name ?? 'Unknown domain'}`,
      label: found ? (
        <>
          Domain:
          <DomainBadge name={found.name} label={found.label} form="bare" />
        </>
      ) : (
        'Domain: Unknown domain'
      ),
      clear: { area: undefined },
    })
  }
  if (search.kind)
    chips.push({
      key: 'kind',
      text: `Kind: ${kindNames[search.kind]}`,
      label: <>Kind: {kindNames[search.kind]}</>,
      clear: { kind: undefined },
    })
  if (search.risk)
    chips.push({
      key: 'risk',
      text: `Risk: ${search.risk}`,
      label: <>Risk: {search.risk}</>,
      clear: { risk: undefined },
    })

  return (
    <>
      <PageToolbar role="search" aria-label="Changed facts">
        <CompareViews view="net" />
        <PageToolbarDivider />
        <FilterMenu fields={fields} activeCount={active} open={open} onOpenChange={setOpen} />
        <span className="min-w-0 flex-1" />
        <span
          data-slot="viewed-progress"
          className="shrink-0 text-caption whitespace-nowrap text-muted-foreground tabular-nums"
        >
          <span className="font-bold text-foreground">{viewedCount.toLocaleString('en')}</span> of{' '}
          {shown.toLocaleString('en')} viewed
        </span>
        <span aria-live="polite" className={cn(toolbarCount, 'w-auto')}>
          {active > 0 ? (
            <>
              <span className="font-bold text-foreground">{shown.toLocaleString('en')}</span> of{' '}
              {all.toLocaleString('en')} facts
            </>
          ) : (
            `${all.toLocaleString('en')} ${all === 1 ? 'fact' : 'facts'}`
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
              onClick={() => onSearch(chip.clear)}
              aria-label={`Remove filter ${chip.text}`}
              className="gap-2 rounded-full"
            >
              {chip.label}
              <XIcon className="text-muted-foreground" />
            </Button>
          ))}
        </div>
      ) : null}
    </>
  )
}
