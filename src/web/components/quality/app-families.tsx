import { useQuery } from '@tanstack/react-query'
import { appFamilyNames } from '@domain/app-family'
import type { AppFamilyCounts } from '@/api'
import { appFamilyCountsQuery } from '@/api/queries'
import {
  BotIcon,
  CircleAlertIcon,
  CircleHelpIcon,
  HashIcon,
  SearchXIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { gridCell } from '@/components/page/grid'
import { GridHeaderCells, GridTable, type GridColumn } from '@/components/page/grid-table'
import { RecordSection } from '@/components/page/record-parts'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/*
  The AI apps that called Heed this week (FR-410), in Health and on the gateway's Activity tab:
  per app family, its tool calls and how many of them needed more detail, matched nothing, were
  malformed (arguments the tool could not read, the clearest sign of a weaker model) or failed
  on Heed's side. A family is the kind of app from a fixed list, never the app's own name, its
  version or who used it. Each week is counted on its own and a count below the minimum shows as
  "Fewer than" it (FR-614), so no hidden count can be worked out from two periods.
*/

type Row = AppFamilyCounts['rows'][number]
type Measure = 'needMoreDetail' | 'noMatch' | 'invalidInput' | 'errors'

const measures: (GridColumn & { key: Measure })[] = [
  { key: 'needMoreDetail', icon: CircleHelpIcon, title: 'Need detail', className: 'flex-1' },
  { key: 'noMatch', icon: SearchXIcon, title: 'Found nothing', className: 'flex-1' },
  { key: 'invalidInput', icon: TriangleAlertIcon, title: 'Unreadable', className: 'flex-1' },
  { key: 'errors', icon: CircleAlertIcon, title: 'Errors', className: 'flex-1' },
]
const columns: GridColumn[] = [
  { icon: BotIcon, title: 'AI app', className: 'w-column-domain' },
  { icon: HashIcon, title: 'Calls', className: 'flex-1' },
  ...measures,
]

/** A count through the privacy rule: the number, or "Fewer than 5" in muted words. */
function Count({ count, minimum }: { count: number | null; minimum: number }) {
  if (count !== null) return <span className="tabular-nums">{count.toLocaleString('en')}</span>
  return (
    <span
      data-slot="hidden-count"
      title={`Counts below ${minimum} are hidden, so no one can tell who used an app.`}
      className="text-muted-foreground"
    >
      Fewer than {minimum}
    </span>
  )
}

/** A count and, when it is above zero and the calls are shown, its share of the calls. */
function Share({
  count,
  calls,
  minimum,
}: {
  count: number | null
  calls: number | null
  minimum: number
}) {
  // One inline run, so the space between the count and its share is read out too.
  return (
    <span>
      <Count count={count} minimum={minimum} />
      {count && calls ? (
        <>
          {' '}
          <span className="text-muted-foreground tabular-nums">
            ({Math.round((100 * count) / calls)}%)
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Most calls first, hidden ones after them, then by name. */
const ordered = (rows: readonly Row[]) =>
  [...rows].sort(
    (a, b) =>
      (b.calls ?? -1) - (a.calls ?? -1) ||
      appFamilyNames[a.family].localeCompare(appFamilyNames[b.family]),
  )

/**
 * This week's calls per AI app, with the states of its read: loading, failed, none yet. The
 * caller gives the heading.
 */
export function AppFamiliesThisWeek() {
  const counts = useQuery(appFamilyCountsQuery({ weeks: 1 }))
  if (counts.isPending)
    return <Skeleton role="status" aria-label="Loading the AI apps" className="h-16 w-full" />
  if (!counts.data)
    return (
      <p className="text-body text-muted-foreground">
        We couldn't load the AI apps.{' '}
        <button type="button" className="underline" onClick={() => void counts.refetch()}>
          Try again
        </button>
      </p>
    )
  const { minimumCount: minimum } = counts.data
  const rows = ordered(counts.data.rows)
  if (!rows.length)
    return (
      <p className="text-body text-muted-foreground">
        No AI app has called the tools this week. Calls are counted here once an app such as Claude
        Code or ChatGPT uses them.
      </p>
    )
  return (
    <>
      <GridTable
        label="Tool calls this week per AI app"
        slot="app-families"
        header={<GridHeaderCells columns={columns} />}
      >
        {rows.map((row) => (
          <div
            key={row.family}
            role="row"
            data-app-family={row.family}
            className="flex min-h-row items-stretch"
          >
            <div role="rowheader" className={cn(gridCell, 'w-column-domain py-2')}>
              <span className="truncate">{appFamilyNames[row.family]}</span>
            </div>
            <div role="cell" className={cn(gridCell, 'flex-1 gap-1 py-2')}>
              <span data-phone-label aria-hidden="true" className="text-muted-foreground">
                Calls:
              </span>
              <Count count={row.calls} minimum={minimum} />
            </div>
            {measures.map((measure) => (
              <div key={measure.key} role="cell" className={cn(gridCell, 'flex-1 gap-1 py-2')}>
                <span data-phone-label aria-hidden="true" className="text-muted-foreground">
                  {measure.title}:
                </span>
                <Share count={row[measure.key]} calls={row.calls} minimum={minimum} />
              </div>
            ))}
          </div>
        ))}
      </GridTable>
      <p className="text-caption text-muted-foreground">
        We count each app by its kind, from a fixed list, never by its own name or who used it.
        Unreadable calls had arguments the tool couldn&apos;t read. Less capable AI apps send more
        of them. We hide counts below {minimum}, so nobody can tell who used an app.
      </p>
    </>
  )
}

/** Health's overview of every domain: this week's AI apps, under the assistant's ratings. */
export function AppFamiliesOverview() {
  return (
    <RecordSection title="AI apps this week" icon={BotIcon}>
      <AppFamiliesThisWeek />
    </RecordSection>
  )
}
