import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { Comparison, EvalRun } from '@/api'
import { editionListQuery, evalRunsQuery } from '@/api/queries'
import { DomainBadge } from '@/components/item/item-marks'
import { PageToolbar } from '@/components/page/page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDay } from '@/lib/library'
import { comparable, runKindWords } from '@/lib/quality'
import { cn } from '@/lib/utils'
import type { ScopeSummary, Tally } from '@/lib/workbench-scope'
import { DomainOptionText, domainOptionProps } from '@/components/item/domain-option'

/*
  The scope strip (Workbench plan, 3.2): the page's toolbar row. The domain in scope (the ones the
  person looks after; every one for an administrator), the live edition, the run the newest one
  is compared with, and three numbers: the retrieval and answer results and how many questions
  got worse. A domain with no test questions yet says so, with the way to them. No window: runs
  and retrieval passes have none.
*/

/** Runs the comparison picker offers, newest first. */
const RUNS = 50

/** A run as the strip names it: its kind and day, then its edition in the mono face. */
function RunName({ run }: { run: Pick<EvalRun, 'kind' | 'edition' | 'finishedAt'> }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">
        {runKindWords[run.kind]}, {formatDay(run.finishedAt ?? '')}
      </span>
      <span className="font-mono text-muted-foreground tabular-nums" translate="no">
        {run.edition}
      </span>
    </span>
  )
}

function Count({ label, tally }: { label: string; tally: Tally | null }) {
  return (
    <li className="whitespace-nowrap">
      {label}{' '}
      {tally ? (
        <b className="font-bold text-foreground tabular-nums">
          {tally.passed.toLocaleString('en')}
          <span aria-hidden="true">/</span>
          <span className="sr-only"> of </span>
          {tally.questions.toLocaleString('en')}
        </b>
      ) : (
        'not run yet'
      )}
    </li>
  )
}

function Summary({ summary, failed }: { summary: ScopeSummary; failed?: () => void }) {
  if (failed)
    return (
      <p className="text-caption text-muted-foreground">
        We couldn&apos;t read the results.{' '}
        <button
          type="button"
          onClick={failed}
          className="text-foreground underline underline-offset-3"
        >
          Try again
        </button>
      </p>
    )
  if (summary.state === 'pending')
    return (
      <Skeleton
        role="status"
        aria-label="Loading the results"
        className="h-4 w-full max-w-popover"
      />
    )
  if (summary.state === 'not_started')
    return (
      <p className="text-caption text-muted-foreground">
        No test questions yet.{' '}
        <Link
          to="/health"
          search={{
            area: summary.area.id,
            open: `domain:${summary.area.id}`,
            tab: 'questions',
          }}
          className="text-brand-ink underline underline-offset-3"
        >
          Test questions
        </Link>
      </p>
    )
  return (
    <ul
      aria-label="Results"
      data-slot="scope-summary"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground"
    >
      <Count label="Right facts" tally={summary.retrieval} />
      <Count label="Right answers" tally={summary.answers} />
      <li className="whitespace-nowrap">
        {summary.worse === null ? (
          'Not compared yet'
        ) : (
          <>
            <b className="font-bold text-foreground tabular-nums">
              {summary.worse.toLocaleString('en')}
            </b>{' '}
            got worse
          </>
        )}
      </li>
    </ul>
  )
}

/** The run the newest one is compared with: the run before, or one the person picks. */
function ComparedWith({
  area,
  latest,
  comparison,
  onAgainst,
}: {
  area: string
  latest: { run: string; finishedAt: string }
  comparison: Comparison | undefined
  onAgainst: (run: string | undefined) => void
}) {
  const runs = useQuery(evalRunsQuery({ area, limit: RUNS }))
  const earlier = (runs.data ?? []).filter(
    (candidate) =>
      candidate.id !== latest.run &&
      comparable(candidate) &&
      candidate.areaId === area &&
      (candidate.finishedAt ?? '') < latest.finishedAt,
  )
  if (comparison?.against === null || (runs.data && earlier.length === 0))
    return <span className="text-dense text-muted-foreground">No earlier run to compare with</span>
  const chosen = comparison?.against?.id ?? ''
  return (
    <Select value={chosen} onValueChange={(value: string | null) => onAgainst(value || undefined)}>
      <SelectTrigger aria-label="Compared with" className="h-control-sm w-auto min-w-0">
        <span className="text-muted-foreground">Compared with</span>
        <SelectValue>
          {(value: string) => {
            const found = earlier.find((candidate) => candidate.id === value)
            if (found) return <RunName run={found} />
            if (comparison?.against) return <RunName run={comparison.against} />
            return 'The run before'
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {earlier.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id}>
            <SelectItemText>
              <RunName run={candidate} />
            </SelectItemText>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ScopeStrip({
  areas,
  area,
  summary,
  failed,
  latest,
  comparison,
  onArea,
  onAgainst,
}: {
  /** The domains the person looks after; every one for an administrator. */
  areas: readonly Area[]
  /** The domain in scope, or every one. */
  area: Area | undefined
  summary: ScopeSummary
  /** Retries the reads behind the numbers, when they failed. */
  failed?: () => void
  /** The newest weekly run of the domain in scope, which the comparison starts from. */
  latest: { run: string; finishedAt: string } | null
  /** The domain's comparison with the chosen run, or the run before; undefined while it is read. */
  comparison: Comparison | undefined
  onArea: (area: string | undefined) => void
  onAgainst: (run: string | undefined) => void
}) {
  const editions = useQuery(editionListQuery({ limit: 1 }))
  const live = editions.data?.find((edition) => edition.live)
  return (
    <PageToolbar
      aria-label="Domain and runs"
      role="toolbar"
      data-slot="scope-strip"
      className="gap-x-4"
    >
      {areas.length > 1 ? (
        <Select
          value={area?.id ?? ''}
          onValueChange={(value: string | null) => onArea(value || undefined)}
        >
          <SelectTrigger aria-label="Domain" className="h-control-sm w-auto min-w-0">
            <SelectValue>
              {(value: string) =>
                value
                  ? (areas.find((entry) => entry.id === value)?.name ?? 'Unknown domain')
                  : 'All domains'
              }
            </SelectValue>
          </SelectTrigger>
          {/* Wide enough for each domain's summary line under its name. */}
          <SelectContent className="w-popover">
            <SelectItem value="">
              <SelectItemText>All domains</SelectItemText>
            </SelectItem>
            {areas.map((entry) => (
              <SelectItem
                key={entry.id}
                value={entry.id}
                {...domainOptionProps(entry, 'scope-domain')}
              >
                <DomainOptionText area={entry} list="scope-domain">
                  <SelectItemText>{entry.name}</SelectItemText>
                </DomainOptionText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : area ? (
        <DomainBadge name={area.name} label={area.label} />
      ) : null}
      <span className="flex min-w-0 items-center gap-2 text-dense text-muted-foreground">
        {live ? (
          <span>
            Agents get the facts as of{' '}
            <span className="text-foreground">{formatDay(live.sealedAt ?? live.createdAt)}</span>
          </span>
        ) : editions.data ? (
          <span>Agents get no facts yet</span>
        ) : (
          <Skeleton className="h-4 w-16" />
        )}
      </span>
      {area && latest ? (
        <span className="@max-2xl:hidden">
          <ComparedWith
            area={area.id}
            latest={latest}
            comparison={comparison}
            onAgainst={onAgainst}
          />
        </span>
      ) : null}
      {/* On a phone the overview gives the numbers; a domain with no questions still says so. */}
      <div
        className={cn(
          'flex min-w-0 flex-1 justify-end',
          (summary.state === 'ready' || summary.state === 'pending') && '@max-2xl:hidden',
        )}
      >
        <Summary summary={summary} failed={failed} />
      </div>
    </PageToolbar>
  )
}
