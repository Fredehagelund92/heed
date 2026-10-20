import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { RatingCounts } from '@/api'
import { ratingCountsQuery } from '@/api/queries'
import { CalendarIcon, HeedDomainIcon, ThumbsDownIcon, ThumbsUpIcon } from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { gridCell } from '@/components/page/grid'
import { GridHeaderCells, GridTable, type GridColumn } from '@/components/page/grid-table'
import { RecordSection } from '@/components/page/record-parts'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'

/*
  The assistant's ratings in Health (FR-712): the thumbs people gave its answers, per domain and
  week, as the service counts them. A rating keeps its verdict, the domain of the answer's metrics
  and the hour, never who gave it, the question or the answer. Each week is counted on its own and
  a count below the minimum shows as "Fewer than" it (FR-614), so no hidden count can be worked
  out from two periods. A domain's record shows its last eight weeks; the overview shows this
  week for every domain the person looks after, and, for an administrator, the answers about no
  one domain.
*/

export const RATING_WEEKS = 8

type Row = RatingCounts['rows'][number]

/** A count through the privacy rule: the number, or "Fewer than 5" in muted words. */
function RatingCount({ count, minimum }: { count: number | null; minimum: number }) {
  if (count !== null) return <span className="tabular-nums">{count.toLocaleString('en')}</span>
  return (
    <span
      data-slot="hidden-count"
      title={`Counts below ${minimum} are hidden, so no one can tell who rated.`}
      className="text-muted-foreground"
    >
      Fewer than {minimum}
    </span>
  )
}

/** What the counts are, and what is never kept. */
function RatingsNote({ minimum, more }: { minimum: number; more?: string }) {
  return (
    <p className="text-caption text-muted-foreground">
      From the thumbs under the assistant&apos;s answers. We keep only the counts, never who rated,
      the question or the answer. We hide counts below {minimum}, so nobody can tell who rated.
      {more ? ` ${more}` : null}
    </p>
  )
}

function Failed({ retry }: { retry: () => void }) {
  return (
    <p className="text-body text-muted-foreground">
      We couldn&apos;t load the ratings.{' '}
      <button type="button" className="underline" onClick={retry}>
        Try again
      </button>
    </p>
  )
}

/** The verdict columns: left-aligned like the domain grid's rates, clear of the launcher. */
const verdictColumns = [
  { icon: ThumbsUpIcon, title: 'Good answer', className: 'flex-1' },
  { icon: ThumbsDownIcon, title: 'Something was wrong', className: 'flex-1' },
] as const

/**
 * A grid of rating rows, on the bordered grid of the domains above it: the first column names
 * each row, then the two verdicts. On a phone the grid is a list without its header, so each
 * count says which verdict it is.
 */
function RatingsTable({
  label,
  first,
  rows,
  minimum,
}: {
  label: string
  /** The first column's heading and icon. */
  first: GridColumn
  rows: readonly { key: string; name: ReactNode; row: Row }[]
  minimum: number
}) {
  return (
    <GridTable
      label={label}
      slot="assistant-ratings"
      header={
        <GridHeaderCells
          columns={[{ ...first, className: 'w-column-domain' }, ...verdictColumns]}
        />
      }
    >
      {rows.map(({ key, name, row }) => (
        <div key={key} role="row" className="flex min-h-row items-stretch">
          <div role="rowheader" className={cn(gridCell, 'w-column-domain py-2')}>
            {name}
          </div>
          {verdictColumns.map((column, index) => (
            <div key={column.title} role="cell" className={cn(gridCell, 'flex-1 gap-1 py-2')}>
              <span data-phone-label aria-hidden="true" className="text-muted-foreground">
                {column.title}:
              </span>
              <RatingCount count={index === 0 ? row.helpful : row.wrong} minimum={minimum} />
            </div>
          ))}
        </div>
      ))}
    </GridTable>
  )
}

/** One domain's ratings week by week, newest first, in its record's overview. */
export function DomainRatings({ area }: { area: Area }) {
  const ratings = useQuery(ratingCountsQuery({ area: area.id, weeks: RATING_WEEKS }))
  const weeks = (ratings.data?.rows ?? []).filter((row) => row.area === area.id).reverse()
  return (
    <RecordSection title={`Assistant ratings, last ${RATING_WEEKS} weeks`} icon={ThumbsUpIcon}>
      {ratings.isPending ? (
        <Skeleton role="status" aria-label="Loading the ratings" className="h-16 w-full" />
      ) : !ratings.data ? (
        <Failed retry={() => void ratings.refetch()} />
      ) : weeks.every((row) => row.total === 0) ? (
        <p className="text-body text-muted-foreground">
          No ratings yet. People rate an answer with the thumbs under it in the assistant.
        </p>
      ) : (
        <>
          <RatingsTable
            label={`The assistant's ratings of answers about ${area.name}, by week, newest first`}
            first={{ icon: CalendarIcon, title: 'Week of' }}
            rows={weeks.map((row) => ({ key: row.week, name: formatDay(row.week), row }))}
            minimum={ratings.data.minimumCount}
          />
          <RatingsNote minimum={ratings.data.minimumCount} />
        </>
      )}
    </RecordSection>
  )
}

/** This week's ratings of every domain on the overview, and of answers about no one domain. */
export function RatingsOverview({
  areas,
  everyDomain,
}: {
  areas: readonly Area[]
  /** The overview shows every domain, not one picked: answers about no one domain belong too. */
  everyDomain: boolean
}) {
  const ratings = useQuery(ratingCountsQuery({ weeks: 1 }))
  const byArea = new Map(ratings.data?.rows.map((row) => [row.area, row]))
  const rows: { key: string; name: ReactNode; row: Row }[] = areas.flatMap((area) => {
    const row = byArea.get(area.id)
    return row
      ? [{ key: area.id, name: <DomainBadge name={area.name} label={area.label} size="sm" />, row }]
      : []
  })
  // Answers about no one domain come back for an administrator only, and show once there are some.
  const elsewhere = byArea.get(null)
  if (everyDomain && elsewhere && elsewhere.total !== 0)
    rows.push({
      key: 'none',
      name: <span className="text-muted-foreground">About no one domain</span>,
      row: elsewhere,
    })
  return (
    <RecordSection title="Assistant ratings this week" icon={ThumbsUpIcon}>
      {ratings.isPending ? (
        <Skeleton role="status" aria-label="Loading the ratings" className="h-16 w-full" />
      ) : !ratings.data ? (
        <Failed retry={() => void ratings.refetch()} />
      ) : rows.every(({ row }) => row.total === 0) ? (
        <p className="text-body text-muted-foreground">
          No ratings this week. People rate an answer with the thumbs under it in the assistant.
        </p>
      ) : (
        <>
          <RatingsTable
            label="The assistant's ratings this week, per domain"
            first={{ icon: HeedDomainIcon, title: 'Domain' }}
            rows={rows}
            minimum={ratings.data.minimumCount}
          />
          <RatingsNote
            minimum={ratings.data.minimumCount}
            more="Open a domain for its last eight weeks."
          />
        </>
      )}
    </RecordSection>
  )
}
