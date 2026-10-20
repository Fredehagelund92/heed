import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { TestQuestion } from '@/api'
import { fixNextQuery } from '@/api/queries'
import {
  ArrowRightLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FlaskConicalIcon,
  GaugeIcon,
  HeedDomainIcon,
  HeedRecheckDueIcon,
  ListChecksIcon,
  SearchIcon,
  SearchXIcon,
  TargetIcon,
  type Icon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { DomainBadge } from '@/components/item/item-marks'
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
import { openRowClass } from '@/components/page/dock-panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDay } from '@/lib/library'
import {
  fixEntryView,
  verdictOf,
  type DomainHealth,
  type FixAction,
  type Verdict,
} from '@/lib/quality'
import type { WorkbenchSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { AreaBadge, DomainStateMark, FixKindBadge, FlipsMark, RateValue } from './quality-marks'
import type { LinkTo } from './panel-parts'
import type { HealthState } from './use-quality'

/*
  The domain overview (Quality design, direction C; the Workbench's record pane with nothing
  open): one line that says whether answers are better than last time, the health of each domain
  on the bordered grid, and, in a domain's record, one ranked list of what to fix next. A
  domain's row opens it as a record. Below a 768 pixel container the grid keeps the domain,
  retrieval and answers; below 1,024 it leaves out the counts.
*/

const SLOT = 'quality-grid'
const fromMedium = '@max-3xl:hidden'
const fromWide = '@max-5xl:hidden'

const healthColumns: GridColumn[] = [
  { icon: HeedDomainIcon, title: 'Domain', className: 'w-column-domain' },
  { icon: GaugeIcon, title: 'State', className: cn('w-column-term-status', fromMedium) },
  { icon: SearchIcon, title: 'Right facts', className: 'flex-1' },
  { icon: FlaskConicalIcon, title: 'Right answers', className: 'flex-1' },
  { icon: ArrowRightLeftIcon, title: 'Changes', className: cn('flex-1', fromMedium) },
  { icon: SearchXIcon, title: 'Open gaps', className: cn('flex-1 justify-end', fromWide) },
  { icon: HeedRecheckDueIcon, title: 'Check due', className: cn('flex-1 justify-end', fromWide) },
  { icon: ListChecksIcon, title: 'No test', className: cn('flex-1 justify-end', fromWide) },
]

const verdictGlyphs: Record<Verdict['tone'], Icon> = {
  better: CircleCheckIcon,
  worse: CircleAlertIcon,
  unclear: ArrowRightLeftIcon,
  same: ArrowRightLeftIcon,
  none: GaugeIcon,
}

/** The one line above the grid: are we better than last time? */
export function VerdictLine({ verdict, summary }: { verdict: Verdict; summary: string | null }) {
  const Glyph = verdictGlyphs[verdict.tone]
  return (
    <section
      aria-label="Verdict"
      data-slot="quality-verdict"
      data-tone={verdict.tone}
      className="flex items-start gap-3"
    >
      <Glyph
        aria-hidden="true"
        className={cn(
          'size-5 shrink-0',
          verdict.tone === 'better'
            ? 'text-status-success-icon'
            : verdict.tone === 'worse'
              ? 'text-status-danger-icon'
              : 'text-muted-foreground',
        )}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-large font-bold">{verdict.text}</p>
        {verdict.detail || summary ? (
          <p className="text-body text-muted-foreground">
            {[verdict.detail, summary].filter(Boolean).join(' ')}
            {verdict.tone === 'unclear' ? (
              <>
                {' '}
                <HelpLink to="read-health#when-a-run-says-no-clear-change">
                  What this means
                </HelpLink>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function VerdictLoading() {
  return (
    <div role="status" aria-label="Loading the verdict" className="flex flex-col gap-2">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

/** A count cell: the number, or a word when the read has none. */
function CountCell({
  count,
  attention = false,
  className,
}: {
  count: number | null
  attention?: boolean
  className?: string
}) {
  return (
    <div role="cell" className={cn(gridCell, 'flex-1 justify-end tabular-nums', className)}>
      {count === null ? (
        <span className="text-dense text-muted-foreground">Not known</span>
      ) : count === 0 ? (
        <span className="text-muted-foreground">0</span>
      ) : (
        <span className={cn(attention && 'font-bold')}>{count.toLocaleString('en')}</span>
      )}
    </div>
  )
}

function HealthRow({ row, workbench }: { row: DomainHealth; workbench: WorkbenchSearch }) {
  const id = `domain:${row.area.id}`
  const linkProps = {
    replace: true,
    resetScroll: false,
    'data-row-link': true,
    'aria-label': `${row.area.name}, ${row.state.kind === 'not_started' ? 'no test questions yet' : 'open'}`,
    className: cn(gridRowLink, 'min-w-0'),
  }
  const badge = <DomainBadge name={row.area.name} label={row.area.label} size="sm" />
  const link = (
    <Link to="/health" search={{ ...workbench, open: id, tab: undefined }} {...linkProps}>
      {badge}
    </Link>
  )
  const open = workbench.open === id
  if (row.state.kind === 'not_started')
    return (
      <div
        role="row"
        data-row-id={`domain:${row.area.id}`}
        data-open={open || undefined}
        className={cn(gridRowClass, openRowClass)}
      >
        <div role="rowheader" className={cn(gridCell, 'w-column-domain py-2')}>
          {link}
        </div>
        <div role="cell" className={cn(gridCell, 'flex-1 text-muted-foreground')}>
          No test questions yet.
        </div>
      </div>
    )
  const answersDrop = (row.answers?.change?.points ?? 0) <= -5
  const retrievalDrop = (row.retrieval?.change?.points ?? 0) <= -5
  return (
    <div
      role="row"
      data-row-id={`domain:${row.area.id}`}
      data-open={open || undefined}
      className={cn(gridRowClass, openRowClass)}
    >
      <div role="rowheader" className={cn(gridCell, 'w-column-domain py-2')}>
        {link}
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-term-status', fromMedium)}>
        <DomainStateMark state={row.state} />
      </div>
      <div role="cell" className={cn(gridCell, 'flex-1 py-2')}>
        <RateValue
          rate={row.retrieval?.rate}
          change={row.retrieval?.change ?? null}
          danger={retrievalDrop}
          empty="No pass yet"
        />
      </div>
      <div role="cell" className={cn(gridCell, 'flex-1 py-2')}>
        <RateValue
          rate={row.answers?.rate}
          change={row.answers?.change ?? null}
          danger={answersDrop}
          empty="No run yet"
        />
      </div>
      <div role="cell" className={cn(gridCell, 'flex-1 py-2', fromMedium)}>
        <FlipsMark flips={row.answers ? row.flips : null} />
      </div>
      <CountCell count={row.openGaps} attention className={fromWide} />
      <CountCell count={row.pastReview} attention className={fromWide} />
      <CountCell count={row.untested} attention className={fromWide} />
    </div>
  )
}

/** The health of each domain on the grid. A row opens the domain as a Workbench record. */
export function HealthGrid({
  health,
  workbench,
  canWrite,
  onWrite,
}: {
  health: HealthState
  /** The Workbench's address, which the grid is the overview of. */
  workbench: WorkbenchSearch
  canWrite: boolean
  onWrite: () => void
}) {
  if (health.state === 'pending') return <GridLoading slot={SLOT} label="Loading the domains" />
  if (health.state === 'failed')
    return <GridFailed slot={SLOT} what="the domains" retry={health.retry} />
  if (health.rows.length === 0)
    return (
      <GridMessage slot={SLOT} icon={HeedDomainIcon} title="No domain to show">
        You aren&apos;t an owner of any domain yet. An admin adds owners in Administration, under
        Domains.
      </GridMessage>
    )
  return (
    <div className="flex flex-col gap-2">
      <GridTable
        label="Domain health"
        slot={SLOT}
        header={<GridHeaderCells columns={healthColumns} />}
      >
        {health.rows.map((row) => (
          <HealthRow key={row.area.id} row={row} workbench={workbench} />
        ))}
      </GridTable>
      <p className="text-caption text-muted-foreground">
        Right facts: the share of test questions that get the facts they should, checked each time
        what AI apps get changes. Right answers: the share that pass the newest weekly answer test.
        Changes: questions that got better or worse since the run before.{' '}
        <HelpLink to="read-health#what-the-numbers-mean">About these numbers</HelpLink>
        {health.rows.every((row) => row.state.kind === 'not_started') && canWrite ? (
          <>
            {' '}
            <button
              type="button"
              onClick={onWrite}
              className="text-foreground underline underline-offset-3"
            >
              Write the first test question
            </button>
          </>
        ) : null}
      </p>
    </div>
  )
}

/** The verdict and the summary under it, once the rows are there. */
export function DomainsVerdict({
  health,
  questions,
  baseline,
}: {
  health: HealthState
  /** The test questions of the domains shown. */
  questions: readonly TestQuestion[]
  /** The run the newest one is compared with, in words, when it is not the run before. */
  baseline?: string
}) {
  if (health.state === 'pending') return <VerdictLoading />
  if (health.state === 'failed') return null
  const rows = health.rows
  const latest = rows
    .map((row) => row.answers?.finishedAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1)
  const domains = rows.length
  const active = questions.filter(
    (question) => question.status === 'active' && question.setAsideReason === null,
  ).length
  const summary = [
    `${domains.toLocaleString('en')} ${domains === 1 ? 'domain' : 'domains'}, ${active.toLocaleString('en')} active test ${active === 1 ? 'question' : 'questions'}.`,
    latest ? `Newest weekly run ${formatDay(latest)}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return <VerdictLine verdict={verdictOf(rows, baseline)} summary={summary} />
}

/** How many Fix next entries the page shows. */
const FIX_LIMIT = 12

/** The ranked list of what to fix next, across failing tests, gaps, stale and untested items. */
export function FixNextList({
  area,
  questions,
  linkTo,
  onWrite,
  canWrite,
  areaOf,
  title = 'Fix next',
  level = 2,
  limit = FIX_LIMIT,
}: {
  area: string | undefined
  questions: ReadonlyMap<string, TestQuestion>
  /** Where its question and gap links go. */
  linkTo: LinkTo
  onWrite: (action: Extract<FixAction, { kind: 'write' }>) => void
  canWrite: (area: string | null) => boolean
  areaOf: (area: string | null) => Area | undefined
  title?: string
  /** The heading's level: 2 on the page, 3 inside a panel under the record's own title. */
  level?: 2 | 3
  limit?: number
}) {
  const fix = useQuery(fixNextQuery({ ...(area ? { area } : {}), limit }))
  const headingId = `fix-next-${area ?? 'all'}-${level}`
  const Heading = level === 2 ? 'h2' : 'h3'
  let body
  if (fix.isPending) body = <GridLoading slot="fix-next" label="Loading what to fix next" />
  else if (fix.isError && !fix.data)
    body = <GridFailed slot="fix-next" what="what to fix next" retry={() => void fix.refetch()} />
  else if (fix.data.entries.length === 0)
    body = (
      <GridMessage slot="fix-next" icon={TargetIcon} title="Nothing to fix right now">
        Every test question passes, every gap is closed, and every fact has a test question and is
        within its check date.
      </GridMessage>
    )
  else
    body = (
      <ol
        aria-labelledby={headingId}
        data-slot="fix-next"
        className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
      >
        {fix.data.entries.map((entry, index) => {
          const view = fixEntryView(entry, questions)
          return (
            <li
              key={view.key}
              data-kind={entry.kind}
              className="flex flex-col gap-3 px-4 py-3 @2xl:flex-row @2xl:items-start"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <FixKindBadge kind={entry.kind} />
                  {entry.area ? <AreaBadge area={areaOf(entry.area)} /> : null}
                </div>
                <p className="text-body font-bold">{view.title}</p>
                <p className="text-dense text-muted-foreground">
                  {view.reasons}
                  {view.since ? ` Since ${view.since}.` : ''}
                </p>
              </div>
              <FixActionButton
                action={view.action}
                linkTo={linkTo}
                primary={index === 0}
                onWrite={onWrite}
                canWrite={canWrite(entry.area)}
              />
            </li>
          )
        })}
      </ol>
    )
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Heading id={headingId} className="text-large font-bold">
          {title}
        </Heading>
        <p className="text-body text-muted-foreground">
          Ranked by how much each would help: a question that got worse first, then failing tests,
          open gaps, facts past their check date and facts no test question covers.
        </p>
      </div>
      {body}
    </section>
  )
}

function FixActionButton({
  action,
  linkTo,
  primary,
  onWrite,
  canWrite,
}: {
  action: FixAction
  linkTo: LinkTo
  primary: boolean
  onWrite: (action: Extract<FixAction, { kind: 'write' }>) => void
  canWrite: boolean
}) {
  const variant = primary ? 'default' : 'outline'
  const className = 'shrink-0 self-start'
  switch (action.kind) {
    case 'question':
      return (
        <Button
          variant={variant}
          className={className}
          nativeButton={false}
          render={
            <Link
              {...linkTo({ record: `question:${action.id}`, tab: undefined })}
              resetScroll={false}
            />
          }
        >
          {action.label}
        </Button>
      )
    case 'gap':
      return (
        <Button
          variant={variant}
          className={className}
          nativeButton={false}
          render={<Link {...linkTo({ record: `gap:${action.id}` })} />}
        >
          {action.label}
        </Button>
      )
    case 'item':
      return (
        <Button
          variant={variant}
          className={className}
          nativeButton={false}
          render={<Link to="/library/$itemId" params={{ itemId: action.id }} />}
        >
          {action.label}
        </Button>
      )
    case 'write':
      return canWrite ? (
        <Button variant={variant} className={className} onClick={() => onWrite(action)}>
          {action.label}
        </Button>
      ) : null
  }
}
