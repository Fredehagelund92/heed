import { lazy, Suspense, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Verdict } from '@domain/golden-question'
import type { Area } from '@domain/item'
import type { TestQuestion } from '@/api'
import { evalRunsQuery, qualityHistoryQuery } from '@/api/queries'
import { ChartColumnIcon } from '@/components/icons'
import { RecordSection } from '@/components/page/record-parts'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDay } from '@/lib/library'
import {
  formatRate,
  isActive,
  questionTitle,
  runStateWords,
  runTitle,
  type FixAction,
} from '@/lib/quality'
import { DomainRatings } from './assistant-ratings'
import { FixNextList } from './domains-view'
import { ChangeMark, VerdictBadge } from './quality-marks'
import { Figure, Figures, RecordLink, type LinkTo } from './panel-parts'
import { HISTORY_RUNS, type HealthState } from './use-quality'

/*
  A domain's record body, without a frame (Workbench plan, slice W6a): its figures against the
  time before, its trend over the weekly runs with the numbers beside it, the assistant's ratings
  of answers about it, what to fix next in it,
  and its test questions and runs. The Workbench's domain record shows it.
*/

// Recharts is loaded only when a domain's record draws its trend (contract 7.1).
const TrendChart = lazy(() => import('./trend-chart'))

/** The domain's figures, its trend and what to fix next in it. */
export function DomainOverview({
  area,
  health,
  questions,
  maintains,
  areaOf,
  onWrite,
  linkTo,
}: {
  area: Area
  /** The domain's health, from `useDomainHealth` over this one domain. */
  health: HealthState
  /** The domain's test questions the person may read. */
  questions: readonly TestQuestion[]
  maintains: boolean
  areaOf: (id: string | null) => Area | undefined
  onWrite: (action?: Extract<FixAction, { kind: 'write' }>) => void
  linkTo: LinkTo
}) {
  const row = health.state === 'ready' ? health.rows[0] : undefined
  return (
    <>
      {health.state === 'pending' ? (
        <Skeleton role="status" aria-label="Loading the figures" className="h-chart w-full" />
      ) : health.state === 'failed' ? (
        <p className="text-body text-muted-foreground">
          We couldn&apos;t load the figures.{' '}
          <button type="button" className="underline" onClick={health.retry}>
            Try again
          </button>
        </p>
      ) : row ? (
        <Figures label={`${area.name} figures`}>
          <Figure
            label="Right facts"
            hint={
              row.retrieval
                ? `${row.retrieval.passed} of ${row.retrieval.questions} test questions`
                : 'Not measured yet'
            }
          >
            <span className="flex flex-col">
              <span className="font-bold tabular-nums">
                {formatRate(row.retrieval?.rate) ?? 'None'}
              </span>
              <ChangeMark change={row.retrieval?.change ?? null} />
            </span>
          </Figure>
          <Figure
            label="Right answers"
            hint={
              row.answers
                ? `${row.answers.passed} of ${row.answers.questions}, weekly run`
                : 'No weekly run yet'
            }
          >
            <span className="flex flex-col">
              <span className="font-bold tabular-nums">
                {formatRate(row.answers?.rate) ?? 'None'}
              </span>
              <ChangeMark change={row.answers?.change ?? null} />
            </span>
          </Figure>
          <Figure
            label="Facts kept in answers"
            hint={
              row.caveats
                ? 'Hidden test questions, target 90%'
                : 'No hidden test question checks this yet'
            }
          >
            <span className="flex flex-col">
              <span className="font-bold tabular-nums">
                {formatRate(row.caveats?.rate) ?? 'None'}
              </span>
              <ChangeMark change={row.caveats?.change ?? null} />
            </span>
          </Figure>
          <Figure
            label="Facts with no test"
            hint={
              row.untestedRequired
                ? `${row.untestedRequired} of them events or examples, which need one`
                : `${row.openGaps ?? 0} open gaps, ${row.pastReview ?? 0} past their check date`
            }
          >
            <span className="font-bold tabular-nums">
              {row.untested === null ? 'Not known' : row.untested.toLocaleString('en')}
            </span>
          </Figure>
        </Figures>
      ) : null}
      <DomainTrend areaId={area.id} />
      <DomainRatings area={area} />
      <FixNextList
        area={area.id}
        questions={new Map(questions.map((question) => [question.id, question]))}
        linkTo={linkTo}
        onWrite={(action) => onWrite(action)}
        canWrite={() => maintains}
        areaOf={areaOf}
        title={`Fix next in ${area.name}`}
        level={3}
        limit={5}
      />
    </>
  )
}

/** The domain's test questions, each with its newest verdict. */
export function DomainQuestions({
  area,
  questions,
  verdicts,
  linkTo,
}: {
  area: Area
  /** The domain's test questions the person may read. */
  questions: readonly TestQuestion[]
  verdicts: ReadonlyMap<string, { verdict: Verdict | null }>
  linkTo: LinkTo
}) {
  if (questions.length === 0)
    return (
      <p className="text-body text-muted-foreground">
        {area.name} has no test questions yet. A weekly run tests a domain once it has some.
      </p>
    )
  return (
    <ul aria-label={`Test questions of ${area.name}`} className="flex flex-col divide-y">
      {questions.map((question) => (
        <li key={question.id} className="flex items-start justify-between gap-3 py-3">
          <span className="flex min-w-0 flex-col">
            <RecordLink
              linkTo={linkTo}
              record={`question:${question.id}`}
              className="text-body font-bold"
            >
              {questionTitle(question, question.id)}
            </RecordLink>
            <span className="truncate font-mono text-caption text-muted-foreground">
              {question.id}
            </span>
          </span>
          <VerdictBadge
            verdict={isActive(question) ? (verdicts.get(question.id)?.verdict ?? null) : null}
            size="sm"
          />
        </li>
      ))}
    </ul>
  )
}

/** The weekly runs as a chart, with the same numbers as a table. */
function DomainTrend({ areaId }: { areaId: string }) {
  const history = useQuery(qualityHistoryQuery({ area: areaId, limit: HISTORY_RUNS }))
  const points = useMemo(
    () =>
      [...(history.data ?? [])]
        .filter((point) => point.area === areaId)
        .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt)),
    [history.data, areaId],
  )
  return (
    <RecordSection title={`Trend, last ${HISTORY_RUNS} weekly runs`} icon={ChartColumnIcon}>
      {history.isPending ? (
        <Skeleton role="status" aria-label="Loading the trend" className="h-chart w-full" />
      ) : points.length === 0 ? (
        <p className="text-body text-muted-foreground">
          No weekly run has finished yet. The first one starts on a Monday morning.
        </p>
      ) : (
        <>
          <Suspense fallback={<Skeleton className="h-chart w-full" />}>
            <TrendChart
              points={points.map((point) => ({
                label: formatDay(point.finishedAt).replace(/ \d{4}$/, ''),
                answers: point.rates.pass,
                retrieval: point.retrieval?.rate ?? null,
              }))}
            />
          </Suspense>
          <table className="w-full text-dense tabular-nums">
            <caption className="sr-only">The weekly runs, newest first</caption>
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-normal">
                  Week
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Right answers
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Right facts
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...points].reverse().map((point) => (
                <tr key={point.run}>
                  <th scope="row" className="py-2 text-left font-normal">
                    {formatDay(point.finishedAt)}
                  </th>
                  <td className="py-2 text-right">{formatRate(point.rates.pass) ?? 'None'}</td>
                  <td className="py-2 text-right">{formatRate(point.retrieval?.rate) ?? 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </RecordSection>
  )
}

/** The domain's newest runs, each with its state. */
export function DomainRuns({ areaId, linkTo }: { areaId: string; linkTo: LinkTo }) {
  const runs = useQuery(evalRunsQuery({ area: areaId, limit: 20 }))
  if (runs.isPending)
    return <Skeleton role="status" aria-label="Loading the runs" className="h-16 w-full" />
  if (runs.isError && !runs.data)
    return (
      <p className="text-body text-muted-foreground">
        We couldn&apos;t load the runs.{' '}
        <button type="button" className="underline" onClick={() => void runs.refetch()}>
          Try again
        </button>
      </p>
    )
  if (runs.data.length === 0)
    return (
      <p className="text-body text-muted-foreground">
        No run of this domain yet. A weekly run starts every Monday morning once it has test
        questions.
      </p>
    )
  return (
    <ul aria-label="Runs" className="flex flex-col divide-y">
      {runs.data.map((run) => (
        <li key={run.id} className="flex items-center justify-between gap-3 py-3">
          <RecordLink linkTo={linkTo} record={`run:${run.id}`} className="text-body font-bold">
            {runTitle(run)}
          </RecordLink>
          <span className="text-dense text-muted-foreground">{runStateWords[run.state]}</span>
        </li>
      ))}
    </ul>
  )
}
