import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Edition } from '@/api'
import type { Person } from '@domain/item'
import { editionFeedPagesQuery, editionFeedQuery } from '@/api/edition-queries'
import { areasQuery, editionListQuery, peopleQuery } from '@/api/queries'
import {
  CalendarCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleStopIcon,
  GitCommitHorizontalIcon,
  GitCompareArrowsIcon,
  InfoIcon,
  PlayIcon,
  UserRoundIcon,
  type Icon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { Owner } from '@/components/item/item-marks'
import { AudienceGate } from '@/components/page/audience-gate'
import { openRowClass, useDockMode } from '@/components/page/dock-panel'
import { gridCell, gridRowControl } from '@/components/page/grid'
import { Page, PageContent, PageToolbar } from '@/components/page/page'
import { toolbarViewClass } from '@/components/page/toolbar'
import { dockFitWidth, useDockList } from '@/components/page/use-dock-list'
import { LoadError } from './load-error'
import { EditionLabel } from '@/components/proposal/edition-label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useElementWidth } from '@/hooks/use-element-size'
import { panelRowHistory } from '@/lib/history'
import type { EditionSummary } from '@/lib/edition-diff'
import { editionChanges } from '@/lib/edition-feed'
import { editionReason, editionsRefusal, shortDigest } from '@/lib/editions'
import { formatMoment } from '@/lib/library'
import type { EditionsSearch } from '@/lib/search-params'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'
import { EditionRowMenu, ExportButton } from './edition-actions'
import { EditionFeed, LiveMark, useRangeLinks } from './edition-feed'
import { EditionPanel } from './edition-panel'
import { ResumeDeliveryDialog } from './release-dialogs'
import { LastReleaseAction } from './release-history'
import { useStops, type NamedStop } from './use-stops'

/** Editions on one page of the table. */
export const EDITIONS_PER_PAGE = 50

/** Editions the feed reads at a time. */
const FEED_PAGE = 20

/*
  The width the table needs: its fixed columns (sealed 128, reason 200, by 156, the row button
  40) and 200 for the edition. Below it the table is one row per edition with its facts under
  the number, as on a phone. The feed reads at any width; below 672 its rows are a phone's.
*/
const GRID_MIN = 724
const FEED_NARROW = 672

const personName = (people: Person[] | undefined, id: string | null) =>
  id ? (people?.find((person) => person.id === id) ?? null) : null

/**
 * The live edition and whether delivery is on (contract 6.5): the page's first card. What it
 * changed is the card's first action, with the last days as ranges beside it, so what changed is
 * where a person starts. It is an outline button: on a list page the header's Add context is the
 * one filled button (contract 8.10), and an open edition's panel brings its own. Stop delivery sits in the card's overflow menu (Editions design, slice
 * S5), and the card's last line is the history log's record of the last going back or stop.
 */
function LiveCard({
  live,
  entry,
}: {
  live: Edition | undefined
  /** The live edition as the feed writes it, once it is read. */
  entry: EditionSummary | undefined
}) {
  const { isAdmin } = usePermissions()
  const { stops } = useStops()
  const [resuming, setResuming] = useState<NamedStop | null>(null)
  const rangeLinks = useRangeLinks(live)
  return (
    <section
      aria-labelledby="live-edition-title"
      data-slot="live-edition"
      className="flex flex-col gap-4 rounded-lg border bg-card p-6 @max-md:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 @md:flex-nowrap">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="live-edition-title" className="text-dense font-bold text-muted-foreground">
              What agents get today
            </h2>
            <span className="text-caption">
              <HelpLink to="editions#what-live-means">What live means</HelpLink>
            </span>
            {stops.length === 0 ? (
              <Badge form="bare" tone="success" icon={CircleCheckIcon}>
                Shared with agents
              </Badge>
            ) : (
              <Badge form="soft" tone="warning" icon={CircleStopIcon}>
                Sharing is stopped
              </Badge>
            )}
          </div>
          {live ? (
            <EditionLabel label={live.label} size="lg" />
          ) : (
            <p className="text-body text-muted-foreground">No edition is live yet.</p>
          )}
          {live && entry?.edition.label === live.label ? (
            <p className="text-body break-words">{entry.sentence}</p>
          ) : null}
          {live ? (
            <p className="text-dense text-muted-foreground">
              Saved {formatMoment(live.sealedAt ?? live.createdAt)} · {editionReason(live)}
              {live.digest ? (
                <>
                  {' '}
                  · digest{' '}
                  <span className="font-mono" title={live.digest} translate="no">
                    {shortDigest(live.digest)}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
          {live ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                variant="outline"
                render={<Link to="/editions/compare" search={editionChanges(live.label)} />}
                className="@max-md:w-full"
              >
                <GitCompareArrowsIcon aria-hidden />
                What changed
              </Button>
              <nav
                aria-label="What changed over the last days"
                className="flex flex-wrap items-center gap-1"
              >
                {rangeLinks.map((range) =>
                  range.search ? (
                    <Link
                      key={range.id}
                      to="/editions/compare"
                      search={range.search}
                      className={toolbarViewClass}
                    >
                      {range.title}
                    </Link>
                  ) : (
                    <Button
                      key={range.id}
                      variant="ghost"
                      size="toolbar"
                      disabled
                      className={toolbarViewClass}
                    >
                      {range.title}
                    </Button>
                  ),
                )}
              </nav>
            </div>
          ) : null}
        </div>
        {live ? (
          <div className="flex shrink-0 gap-2 @max-md:w-full">
            <ExportButton label={live.label} className="@max-md:flex-1" />
            <EditionRowMenu edition={live} place="card" />
          </div>
        ) : null}
      </div>
      {stops.length > 0 ? (
        <ul aria-label="Stops that are on" className="flex flex-col divide-y border-t">
          {stops.map((stop) => (
            <li
              key={`${stop.scope}:${stop.areaId ?? ''}:${stop.itemId ?? ''}`}
              className="flex flex-wrap items-center justify-between gap-3 pt-3 [&+li]:pb-0 [&:not(:last-child)]:pb-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-body font-bold">
                  Stopped for{' '}
                  {stop.target.scope === 'all'
                    ? 'everything'
                    : stop.target.scope === 'area'
                      ? (stop.target.areaName ?? 'one domain')
                      : (stop.target.itemTitle ?? 'one fact')}
                </p>
                <p className="text-dense text-muted-foreground">
                  Since {formatMoment(stop.at)}
                  {stop.reason ? <>. Why: {stop.reason}</> : null}
                </p>
              </div>
              {isAdmin ? (
                <Button variant="outline" onClick={() => setResuming(stop)}>
                  <PlayIcon aria-hidden />
                  Start again…
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <LastReleaseAction className="border-t pt-4" />
      {resuming ? (
        <ResumeDeliveryDialog
          stop={resuming}
          open
          onOpenChange={(open) => {
            if (!open) setResuming(null)
          }}
        />
      ) : null}
    </section>
  )
}

function HeaderCell({
  icon: Glyph,
  title,
  className,
}: {
  icon: Icon
  title: string
  className: string
}) {
  return (
    <div role="columnheader" className={cn(gridCell, className)}>
      <span className="inline-flex min-w-0 items-center gap-2">
        <Glyph aria-hidden className="size-icon-sm shrink-0 heed-ink" />
        <span className="truncate">{title}</span>
      </span>
    </div>
  )
}

/** The link that opens an edition in the docked panel, from a row of the table. */
type RowOpen = { list: EditionsSearch; openLabel: string | null }

function RowLink({
  edition,
  open,
  className,
  children,
}: {
  edition: Edition
  open: RowOpen
  className: string
  children: ReactNode
}) {
  return (
    <Link
      to="/editions"
      search={{ ...open.list, edition: edition.label }}
      {...panelRowHistory(open.openLabel !== null)}
      resetScroll={false}
      data-row-link
      aria-label={`Edition ${edition.label}`}
      className={className}
      translate="no"
    >
      {children}
    </Link>
  )
}

/**
 * The editions as the bordered table: the number with Live beside it, when it was sealed, what
 * made it and who. The number opens the edition in the docked panel; the row button holds What
 * changed, its page, export and going back.
 */
function EditionsGrid({
  editions,
  people,
  open,
}: {
  editions: Edition[]
  people: Person[] | undefined
  open: RowOpen
}) {
  return (
    <div
      role="table"
      aria-label="All editions"
      data-slot="editions-grid"
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-dense"
    >
      <div role="rowgroup">
        <div
          role="row"
          className="flex h-table-header items-stretch border-b border-border-subtle bg-background text-caption text-muted-foreground"
        >
          <HeaderCell icon={GitCommitHorizontalIcon} title="Edition" className="min-w-0 flex-1" />
          <HeaderCell icon={CalendarCheckIcon} title="Saved" className="w-column-optional" />
          <HeaderCell icon={InfoIcon} title="Reason" className="w-column-about" />
          <HeaderCell icon={UserRoundIcon} title="By" className="w-column-owner" />
          <div role="columnheader" className={cn(gridCell, 'w-row-button')}>
            <span className="sr-only">Actions</span>
          </div>
        </div>
      </div>
      <div role="rowgroup" className="flex flex-col divide-y divide-border-subtle">
        {editions.map((edition) => {
          const person = personName(people, edition.actorId)
          return (
            <div
              key={edition.seq}
              role="row"
              data-row-id={edition.label}
              data-open={open.openLabel === edition.label || undefined}
              data-live={edition.live || undefined}
              className={cn(
                'group/row relative flex h-row items-stretch -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
                openRowClass,
              )}
            >
              <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 gap-3')}>
                <RowLink
                  edition={edition}
                  open={open}
                  className="truncate font-mono text-dense tabular-nums outline-none after:absolute after:inset-0"
                >
                  {edition.label}
                </RowLink>
                {edition.live ? <LiveMark /> : null}
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-optional tabular-nums')}>
                {formatMoment(edition.sealedAt ?? edition.createdAt)}
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-about')}>
                <span className="truncate" title={edition.note ?? undefined}>
                  {editionReason(edition)}
                </span>
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-owner')}>
                {person ? (
                  <Owner
                    name={person.name}
                    personId={person.id}
                    initials={person.initials}
                    size="sm"
                  />
                ) : (
                  <span className="text-muted-foreground">Automatic</span>
                )}
              </div>
              <div
                role="cell"
                className={cn(gridCell, 'relative z-raised w-row-button justify-center px-0')}
              >
                <EditionRowMenu edition={edition} className={gridRowControl} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One row per edition on a narrow page: the number, then when, why and who; it opens the edition. */
function EditionsList({
  editions,
  people,
  open,
}: {
  editions: Edition[]
  people: Person[] | undefined
  open: RowOpen
}) {
  return (
    <ul
      aria-label="All editions"
      data-slot="editions-list"
      className="flex flex-col divide-y rounded-lg border bg-card"
    >
      {editions.map((edition) => {
        const person = personName(people, edition.actorId)
        return (
          <li
            key={edition.seq}
            data-row-id={edition.label}
            data-open={open.openLabel === edition.label || undefined}
            className={cn(
              'relative flex min-h-row-phone items-center gap-3 px-4 py-3 -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
              openRowClass,
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <RowLink
                  edition={edition}
                  open={open}
                  className="font-mono text-row-phone font-normal tabular-nums outline-none after:absolute after:inset-0"
                >
                  {edition.label}
                </RowLink>
                {edition.live ? <LiveMark /> : null}
              </span>
              <span className="truncate text-dense text-muted-foreground">
                {formatMoment(edition.sealedAt ?? edition.createdAt)} · {editionReason(edition)}
                {person ? ` · ${person.name}` : ''}
              </span>
            </span>
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </li>
        )
      })}
    </ul>
  )
}

function Pager({
  search,
  page,
  hasOlder,
  shown,
}: {
  search: EditionsSearch
  page: number
  hasOlder: boolean
  shown: number
}) {
  const first = (page - 1) * EDITIONS_PER_PAGE + 1
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-dense text-muted-foreground">
      <p>
        {shown === 0
          ? 'No editions on this page.'
          : `Editions ${first.toLocaleString('en')} to ${(first + shown - 1).toLocaleString('en')}, newest first.`}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          render={
            page <= 1 ? undefined : (
              <Link
                to="/editions"
                search={{
                  ...search,
                  view: 'table',
                  edition: undefined,
                  tab: undefined,
                  page: page - 1 > 1 ? page - 1 : undefined,
                }}
              />
            )
          }
        >
          <ChevronLeftIcon aria-hidden />
          Newer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasOlder}
          render={
            hasOlder ? (
              <Link
                to="/editions"
                search={{
                  ...search,
                  view: 'table',
                  edition: undefined,
                  tab: undefined,
                  page: page + 1,
                }}
              />
            ) : undefined
          }
        >
          Older
          <ChevronRightIcon aria-hidden data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function GridSkeleton() {
  return (
    <div role="status" aria-label="Loading the editions" className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-row-comfortable w-full" />
      ))}
    </div>
  )
}

const views = [
  { id: 'feed', title: 'Feed' },
  { id: 'table', title: 'Table' },
] as const

/** The two ways to read the editions: the feed of release notes, or the table. */
function EditionsViews({ view }: { view: 'feed' | 'table' }) {
  return (
    <nav aria-label="How to show the editions" className="flex items-center gap-1">
      {views.map((candidate) => (
        <Link
          key={candidate.id}
          to="/editions"
          search={
            candidate.id === 'table' ? { view: 'table' } : { view: undefined, page: undefined }
          }
          // The feed has no `view`: without this, TanStack would also call it current while the
          // table shows, whose address holds everything the feed's link holds.
          activeOptions={{ explicitUndefined: true }}
          aria-current={candidate.id === view ? 'page' : undefined}
          className={toolbarViewClass}
        >
          {candidate.title}
        </Link>
      ))}
    </nav>
  )
}

/**
 * The editions (FR-215, FR-217, FR-805; Editions design, slice S3): the live edition with what it
 * changed one click away, whether delivery is on, export and the stop switch; then every edition,
 * newest first, as release notes (or as the table); and the edition open in the docked panel,
 * with what it changed field by field.
 */
function EditionsOverview({ search }: { search: EditionsSearch }) {
  const navigate = useNavigate({ from: '/editions' })
  const view = search.view ?? (search.page ? 'table' : 'feed')
  const page = search.page ?? 1
  const { data: people } = useQuery(peopleQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const newest = useQuery(editionListQuery({ limit: 1 }))
  const feed = useInfiniteQuery({
    ...editionFeedPagesQuery({ limit: FEED_PAGE }),
    enabled: view === 'feed',
  })
  const table = useQuery({
    ...editionListQuery({
      limit: EDITIONS_PER_PAGE + 1,
      offset: (page - 1) * EDITIONS_PER_PAGE,
    }),
    enabled: view === 'table',
  })
  const entries: EditionSummary[] = useMemo(
    () => feed.data?.pages.flatMap((one) => one.entries) ?? [],
    [feed.data],
  )
  const editions = useMemo(() => table.data?.slice(0, EDITIONS_PER_PAGE) ?? [], [table.data])
  const hasOlder = (table.data?.length ?? 0) > EDITIONS_PER_PAGE
  const live = newest.data?.find((edition) => edition.live) ?? table.data?.find((e) => e.live)
  // The live edition's sentence: the feed's first entry, or on the table its own read.
  const newestEntry = useQuery({ ...editionFeedQuery({ limit: 1 }), enabled: view === 'table' })
  const first = view === 'feed' ? entries[0] : newestEntry.data?.entries[0]
  const liveEntry = first?.edition.live ? first : undefined

  // ---- the edition open in the docked panel, and the list's keys ----
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const openLabel = search.edition ?? null
  const ids = useMemo(
    () =>
      view === 'feed'
        ? entries.map((entry) => entry.edition.label)
        : editions.map((edition) => edition.label),
    [view, entries, editions],
  )
  // The list, and what its rows open an edition with: the panel's tab stays from one to the next.
  const list: EditionsSearch = { ...search, edition: undefined, tab: undefined }
  const rows: EditionsSearch = { ...list, tab: search.tab }
  const openEdition = (label: string) =>
    void navigate({
      to: '/editions',
      search: { ...rows, edition: label },
      replace: true,
      state: true,
      resetScroll: false,
    })
  const dock = useDockList({
    region,
    ids,
    panelId: openLabel,
    open: openEdition,
    close: () =>
      void navigate({ to: '/editions', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: view === 'feed' ? feed.isSuccess : table.isSuccess,
  })
  const rowOpen: RowOpen = { list: rows, openLabel }

  const mode = useDockMode()
  const width = dockFitWidth(useElementWidth(region), openLabel !== null && mode === 'docked')
  const listHidden = openLabel !== null && mode === 'full'

  let body: ReactNode
  if (view === 'feed') {
    body = (
      <EditionFeed
        entries={entries}
        pending={feed.isPending}
        error={feed.error}
        onRetry={() => void feed.refetch()}
        hasMore={feed.hasNextPage}
        loadingMore={feed.isFetchingNextPage}
        onMore={() => void feed.fetchNextPage()}
        areas={areas}
        list={rows}
        openLabel={openLabel}
        narrow={width > 0 && width < FEED_NARROW}
      />
    )
  } else {
    body = (
      <>
        {table.isPending ? (
          <GridSkeleton />
        ) : table.isError ? (
          <LoadError
            what="the editions"
            onRetry={() => void table.refetch()}
            detail={table.error.message}
          />
        ) : width > 0 && width < GRID_MIN ? (
          <EditionsList editions={editions} people={people} open={rowOpen} />
        ) : (
          <EditionsGrid editions={editions} people={people} open={rowOpen} />
        )}
        {table.isSuccess ? (
          <Pager search={list} page={page} hasOlder={hasOlder} shown={editions.length} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col" inert={listHidden || undefined}>
        <PageToolbar aria-label="Editions">
          <EditionsViews view={view} />
        </PageToolbar>
        <PageContent width="overview">
          <div ref={setRegion} className="flex min-w-0 flex-col gap-6">
            <LiveCard live={live} entry={liveEntry} />
            <section aria-labelledby="all-editions" className="flex min-w-0 flex-col gap-4">
              <h2 id="all-editions" className="sr-only">
                All editions
              </h2>
              {body}
            </section>
          </div>
        </PageContent>
      </div>
      {openLabel ? (
        <EditionPanel
          label={openLabel}
          placeholder={entries.find((entry) => entry.edition.label === openLabel)}
          position={dock.position}
          onPrevious={dock.previousId ? () => openEdition(dock.previousId!) : undefined}
          onNext={dock.nextId ? () => openEdition(dock.nextId!) : undefined}
          onClose={dock.closePanel}
          tab={search.tab ?? 'changes'}
          onTabChange={(tab) =>
            void navigate({
              to: '/editions',
              search: { ...rows, edition: openLabel, tab: tab === 'changes' ? undefined : tab },
              replace: true,
              state: true,
              resetScroll: false,
            })
          }
        />
      ) : null}
    </>
  )
}

/**
 * Editions, among the main places for owners, deputies and administrators (navigation
 * decision, 12 October 2026): the page of the retired Evals and releases screen's first tab.
 * Everyone it is for reads and exports; only administrators stop delivery and go back.
 */
export function EditionsPage({ search }: { search: EditionsSearch }) {
  return (
    <AudienceGate audience="quality" title="Editions" refusal={editionsRefusal}>
      <Page title="Editions">
        <EditionsOverview search={search} />
      </Page>
    </AudienceGate>
  )
}
