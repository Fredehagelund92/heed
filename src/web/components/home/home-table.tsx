import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ClockIcon,
  FileTextIcon,
  HashIcon,
  HeedDomainIcon,
  HeedValidUntilIcon,
  ShapesIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { CountBadge, DateBadge, DomainBadge, KindIcon } from '@/components/item/item-marks'
import { gridCell } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridMessage,
  GridTable,
  gridRowClass,
  gridRowLink,
  type GridColumn,
} from '@/components/page/grid-table'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { homeTabs, RECENT_DAYS, type HomeTabId, type HomeTopic } from '@/lib/home'
import { formatDay, isLiveIssueRow, kindNames, type LibraryRow } from '@/lib/library'
import { cn } from '@/lib/utils'

/*
  Home's one table (Home P, rules 6 and 7): three text tabs over the app's bordered grid, the
  cells drawn with the shared `gridCell` so the lines match every other grid. State lives
  inside the cells, as words and the Reference badges, never in the page around them; the domain
  is its badge, as in every other grid. Below the container's 2xl width the optional columns
  leave and titles wrap to two lines.
*/

/** What a tab shows while its data loads, fails or is there. */
export type Loadable<T> =
  { state: 'pending' } | { state: 'failed'; retry: () => void } | { state: 'ready'; data: T }

const optional = '@max-2xl:hidden'
const SLOT = 'home-grid'

const recentColumns: GridColumn[] = [
  { icon: FileTextIcon, title: 'Title', className: 'flex-1' },
  { icon: HeedDomainIcon, title: 'Domain', className: cn('w-column-domain', optional) },
  { icon: ShapesIcon, title: 'Kind', className: cn('w-column-kind', optional) },
  { icon: ClockIcon, title: 'Updated', className: 'w-column-until justify-end' },
]
const issuesColumns: GridColumn[] = [
  { icon: FileTextIcon, title: 'Title', className: 'flex-1' },
  { icon: HeedDomainIcon, title: 'Domain', className: cn('w-column-domain', optional) },
  { icon: HeedValidUntilIcon, title: 'Until', className: 'w-column-until' },
]
const topicsColumns: GridColumn[] = [
  { icon: HashIcon, title: 'Topic', className: 'flex-1' },
  { icon: FileTextIcon, title: 'Facts', className: 'w-column-count justify-end' },
  {
    icon: TriangleAlertIcon,
    title: 'Known issues',
    className: cn('w-column-count-wide justify-end', optional),
  },
]

function FactTitle({ row }: { row: LibraryRow }) {
  return (
    <div role="cell" className={cn(gridCell, 'flex-1 shrink gap-3 py-2')}>
      <KindIcon kind={row.kind} active={isLiveIssueRow(row)} decorative />
      <Link
        to="/library/$itemId"
        params={{ itemId: row.id }}
        className={cn(gridRowLink, 'min-w-0 @2xl:truncate')}
      >
        {row.title}
      </Link>
    </div>
  )
}

function RecentTable({ rows, libraryEmpty }: { rows: LibraryRow[]; libraryEmpty: boolean }) {
  if (libraryEmpty) {
    return (
      <GridMessage
        slot={SLOT}
        icon={ClockIcon}
        title="No facts yet"
        action={
          <Button variant="outline" render={<Link to="/library/new" />}>
            Add a fact
          </Button>
        }
      >
        Nobody has written down a fact about the data yet. The first one you add shows here once the
        owner of its domain accepts it.
      </GridMessage>
    )
  }
  if (rows.length === 0) {
    return (
      <GridMessage
        slot={SLOT}
        icon={ClockIcon}
        title="Nothing changed lately"
        action={
          <Button variant="outline" render={<Link to="/library" />}>
            Open the library
          </Button>
        }
      >
        {`No fact was added or changed in the last ${RECENT_DAYS} days. Everything written before is still in the library.`}
      </GridMessage>
    )
  }
  return (
    <GridTable
      slot={SLOT}
      label="Recently changed"
      header={<GridHeaderCells columns={recentColumns} />}
    >
      {rows.map((row) => (
        <div key={row.id} role="row" data-row-id={row.id} className={gridRowClass}>
          <FactTitle row={row} />
          <div role="cell" className={cn(gridCell, 'w-column-domain', optional)}>
            <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
          </div>
          <div role="cell" className={cn(gridCell, 'w-column-kind', optional)}>
            {kindNames[row.kind]}
          </div>
          <div role="cell" className={cn(gridCell, 'w-column-until justify-end tabular-nums')}>
            {formatDay(row.updatedAt)}
          </div>
        </div>
      ))}
    </GridTable>
  )
}

function IssuesTable({ rows, today }: { rows: LibraryRow[]; today: string | null }) {
  if (rows.length === 0) {
    return (
      <GridMessage slot={SLOT} icon={TriangleAlertIcon} title="No known data issues">
        When an outage or a delay affects the numbers, it shows here until it ends.
      </GridMessage>
    )
  }
  return (
    <GridTable
      slot={SLOT}
      label="Known issues"
      header={<GridHeaderCells columns={issuesColumns} />}
    >
      {rows.map((row) => (
        <div key={row.id} role="row" data-row-id={row.id} className={gridRowClass}>
          <FactTitle row={row} />
          <div role="cell" className={cn(gridCell, 'w-column-domain', optional)}>
            <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
          </div>
          <div role="cell" className={cn(gridCell, 'w-column-until')}>
            <DateBadge date={row.until} today={today} size="sm" />
          </div>
        </div>
      ))}
    </GridTable>
  )
}

function TopicsTable({ topics }: { topics: HomeTopic[] }) {
  if (topics.length === 0) {
    return (
      <GridMessage
        slot={SLOT}
        icon={HashIcon}
        title="No topics yet"
        action={
          <Button variant="outline" render={<Link to="/catalogue" />}>
            Open the catalogue
          </Button>
        }
      >
        Topics are the groups of metrics in the catalogue. They show here once a metric has a group.
      </GridMessage>
    )
  }
  return (
    <GridTable slot={SLOT} label="Topics" header={<GridHeaderCells columns={topicsColumns} />}>
      {topics.map((topic) => (
        <div key={topic.key} role="row" className="flex min-h-row items-stretch">
          <div
            role="rowheader"
            className={cn(gridCell, 'flex-1 shrink flex-wrap content-center gap-x-3 gap-y-1 py-2')}
          >
            <span className="text-body">{topic.name}</span>
            <span className="flex min-w-0 flex-wrap gap-x-2 text-dense text-muted-foreground">
              {topic.metrics.map((metric, index) => (
                <span key={metric.id}>
                  <Link
                    to="/catalogue/metric/$id"
                    params={{ id: metric.id }}
                    className="inline-flex min-h-6 items-center rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {metric.name}
                  </Link>
                  {index < topic.metrics.length - 1 ? ',' : null}
                </span>
              ))}
            </span>
          </div>
          <div role="cell" className={cn(gridCell, 'w-column-count justify-end tabular-nums')}>
            {topic.facts.toLocaleString('en')}
          </div>
          <div role="cell" className={cn(gridCell, 'w-column-count-wide justify-end', optional)}>
            {topic.issues > 0 ? (
              <CountBadge count={topic.issues} tone="attention" />
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </div>
        </div>
      ))}
    </GridTable>
  )
}

function TabCount({ count }: { count: number | null }) {
  if (count === null) return null
  return (
    <span className="font-normal text-muted-foreground tabular-nums">
      {count.toLocaleString('en')}
    </span>
  )
}

/** The tabbed table: Recently changed, Known issues and Topics. */
export function HomeTable({
  tab,
  onTab,
  recent,
  issues,
  topics,
  today,
}: {
  tab: HomeTabId
  onTab: (tab: HomeTabId) => void
  recent: Loadable<{ rows: LibraryRow[]; libraryEmpty: boolean }>
  issues: Loadable<LibraryRow[]>
  topics: Loadable<HomeTopic[]>
  today: string | null
}) {
  const counts: Record<HomeTabId, number | null> = {
    recent: null,
    issues: issues.state === 'ready' ? issues.data.length : null,
    topics: topics.state === 'ready' ? topics.data.length : null,
  }
  const body = <T,>(
    value: Loadable<T>,
    what: string,
    render: (data: T) => ReactNode,
  ): ReactNode => {
    if (value.state === 'pending') return <GridLoading slot={SLOT} />
    if (value.state === 'failed') return <GridFailed slot={SLOT} what={what} retry={value.retry} />
    return render(value.data)
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTab(value as HomeTabId)}
      className="gap-3"
      data-slot="home-table"
    >
      <TabsList
        variant="line"
        aria-label="What to show"
        className="w-full justify-start gap-4 border-b"
      >
        {homeTabs.map((entry) => (
          <TabsTrigger
            key={entry.id}
            value={entry.id}
            className="px-0 group-data-[variant=line]/tabs-list:px-0 group-data-[variant=line]/tabs-list:after:inset-x-0"
          >
            {entry.title}
            <TabCount count={counts[entry.id]} />
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="recent" className="text-body">
        {body(recent, 'the facts', (data) => (
          <RecentTable rows={data.rows} libraryEmpty={data.libraryEmpty} />
        ))}
      </TabsContent>
      <TabsContent value="issues" className="text-body">
        {body(issues, 'the facts', (rows) => (
          <IssuesTable rows={rows} today={today} />
        ))}
      </TabsContent>
      <TabsContent value="topics" className="text-body">
        {body(topics, 'the topics', (data) => (
          <TopicsTable topics={data} />
        ))}
      </TabsContent>
    </Tabs>
  )
}
