import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { OperationsOverviewView } from '@/api'
import { operationsQuery, useApiWrite } from '@/api/queries'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  TimerIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { gridCell, gridRowControl } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridTable,
  gridRowClass,
  gridRowLink,
  type GridColumn,
} from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import { formatMoment } from '@/lib/library'
import { ageWords, dollarWords, jobNames, jobStatusWords, spendFeatureNames } from '@/lib/settings'
import { sourceSearch } from '@/lib/sources'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { SettingsBlock } from './settings-parts'
import { SourceStatus } from './source-status'

type Job = OperationsOverviewView['jobs'][number]

const optional = '@max-3xl:hidden'
const jobColumns: GridColumn[] = [
  { icon: TimerIcon, title: 'Job', className: 'min-w-0 flex-1' },
  { icon: CircleCheckIcon, title: 'Status', className: 'w-column-status' },
  { icon: ClockIcon, title: 'Last success', className: cn('w-column-changed', optional) },
  { icon: HistoryIcon, title: 'Runs', className: cn('w-column-optional', optional) },
]
const sourceColumns: GridColumn[] = [
  { icon: DatabaseIcon, title: 'Source', className: 'min-w-0 flex-1' },
  { icon: CircleCheckIcon, title: 'Status', className: 'w-column-status' },
  { icon: ClockIcon, title: 'Data age', className: cn('w-column-optional', optional) },
  { icon: FileTextIcon, title: 'Definitions', className: cn('w-column-owner', optional) },
  { icon: FlagIcon, title: 'Needs checking', className: cn('w-column-owner', optional) },
]

function JobStatus({ status }: { status: Job['status'] }) {
  const words = jobStatusWords[status]
  if (status === 'failing')
    return (
      <Badge form="soft" tone="danger" icon={CircleAlertIcon} size="sm">
        {words}
      </Badge>
    )
  if (status === 'overdue')
    return (
      <Badge form="soft" tone="warning" icon={TriangleAlertIcon} size="sm">
        {words}
      </Badge>
    )
  return (
    <Badge form="bare" icon={status === 'ok' ? CircleCheckIcon : CircleDashedIcon} size="sm">
      {words}
    </Badge>
  )
}

/**
 * Operations (FR-810): each scheduled job with its last success, last error and runs, which an
 * administrator can run now; each definition source with the age of its data, its definitions
 * and what it flagged; and what models cost this month. It reads itself again every 30 seconds
 * while it is open. Nothing here names a person: spending is summed over people.
 */
export function OperationsSection() {
  const overview = useQuery(operationsQuery())
  if (overview.isPending)
    return (
      <PageContent width="overview">
        <GridLoading slot="settings-jobs" label="Loading the operations view" />
      </PageContent>
    )
  if (overview.isError)
    return (
      <PageContent width="overview">
        <GridFailed
          slot="settings-jobs"
          what="the operations view"
          retry={() => void overview.refetch()}
        />
      </PageContent>
    )
  const data = overview.data
  const running = data.runner === 'running'
  return (
    <PageContent width="overview" className="gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-dense text-muted-foreground" data-slot="operations-checked">
          Checked {formatMoment(data.checkedAt)}. We check again every 30 seconds.
        </p>
        <Button
          variant="outline"
          aria-disabled={overview.isFetching || undefined}
          onClick={() => {
            if (!overview.isFetching) void overview.refetch()
          }}
        >
          {overview.isFetching ? (
            <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
          ) : (
            <RefreshCwIcon aria-hidden />
          )}
          Check again
        </Button>
      </div>
      {running ? null : (
        <Alert variant="warning" data-slot="runner-stopped">
          <TriangleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>
              {data.runner === 'starting'
                ? 'The job runner is starting'
                : "The job runner isn't running"}
            </AlertTitle>
            <AlertDescription>
              Scheduled jobs wait until it starts, and you can't run one now. Tell the data team if
              it doesn't start.
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}

      <SettingsBlock
        title="Scheduled jobs"
        slot="jobs-block"
        description="Jobs that run on their own. They read the sources, test answers, find gaps and delete old records on time."
      >
        <GridTable
          slot="settings-jobs"
          label="Scheduled jobs"
          header={
            <>
              <GridHeaderCells columns={jobColumns} />
              <div role="columnheader" className={cn(gridCell, 'w-column-status')}>
                <span className="sr-only">Run now</span>
              </div>
            </>
          }
        >
          {data.jobs.map((job) => (
            <JobRow key={job.name} job={job} running={running} />
          ))}
        </GridTable>
      </SettingsBlock>

      <SettingsBlock
        title="Definition sources"
        slot="sources-block"
        description="Where the definitions of metrics and dimensions come from. Each opens its page in Sources. Out of date means the last good read is older than the source allows."
      >
        <GridTable
          slot="settings-sources"
          label="Definition sources"
          header={<GridHeaderCells columns={sourceColumns} />}
        >
          {data.connectors.map((connector) => (
            <div
              key={connector.id}
              role="row"
              data-connector={connector.id}
              className={gridRowClass}
            >
              <div
                role="cell"
                className={cn(
                  gridCell,
                  'min-w-0 flex-1 shrink flex-col items-start justify-center gap-1 py-2',
                )}
              >
                <Link
                  to="/admin"
                  search={sourceSearch(connector.id)}
                  className={cn(gridRowLink, 'max-w-full truncate')}
                >
                  {connector.name}
                </Link>
                {connector.lastError ? (
                  <span
                    className="max-w-full truncate text-dense text-muted-foreground"
                    title={connector.lastError}
                  >
                    {connector.lastError}
                  </span>
                ) : connector.lastRead?.warnings.length ? (
                  <span className="max-w-full truncate text-dense text-muted-foreground">
                    Last read{' '}
                    {connector.lastRead.status === 'partial'
                      ? 'in part'
                      : connector.lastRead.status}
                    :{' '}
                    {connector.lastRead.warnings.length === 1
                      ? `a warning about ${connector.lastRead.warnings[0]!.target}`
                      : `${connector.lastRead.warnings.length} warnings`}
                  </span>
                ) : null}
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-status')}>
                <SourceStatus status={connector.status} />
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-optional tabular-nums', optional)}>
                {connector.ageSeconds === null ? 'Never read' : ageWords(connector.ageSeconds)}
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-owner tabular-nums', optional)}>
                <span className="truncate">
                  {connector.definitions.current.toLocaleString('en')} current
                  {connector.definitions.missing
                    ? `, ${connector.definitions.missing.toLocaleString('en')} missing`
                    : ''}
                </span>
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-owner tabular-nums', optional)}>
                <span className="truncate">
                  {connector.flaggedItems || connector.staleLinks
                    ? `${connector.flaggedItems.toLocaleString('en')} ${connector.flaggedItems === 1 ? 'fact' : 'facts'}, ${connector.staleLinks.toLocaleString('en')} ${connector.staleLinks === 1 ? 'mention' : 'mentions'}`
                    : 'Nothing'}
                </span>
              </div>
            </div>
          ))}
        </GridTable>
      </SettingsBlock>

      <SettingsBlock
        title="AI spending"
        slot="spend-block"
        description="What AI calls cost, for everyone together. You set the cap in Limits."
      >
        <FieldTable label="AI spending" wideLabels>
          <FieldRow icon={ClockIcon} label="This month">
            <span className="tabular-nums">
              {dollarWords(data.spend.monthCostMicros)}
              {data.spend.monthCapMicros
                ? ` of ${dollarWords(data.spend.monthCapMicros)} (${Math.round((100 * data.spend.monthCostMicros) / data.spend.monthCapMicros)}%)`
                : ', no cap'}
            </span>
          </FieldRow>
          <FieldRow icon={ClockIcon} label="Today">
            <span className="tabular-nums">{dollarWords(data.spend.todayCostMicros)}</span>
          </FieldRow>
          {data.spend.byFeature.map((feature) => (
            <FieldRow
              key={feature.feature}
              icon={TimerIcon}
              label={spendFeatureNames[feature.feature] ?? feature.feature}
            >
              <span className="tabular-nums">
                {dollarWords(feature.costMicros)} in {feature.calls.toLocaleString('en')}{' '}
                {feature.calls === 1 ? 'call' : 'calls'} this month
              </span>
            </FieldRow>
          ))}
        </FieldTable>
      </SettingsBlock>
    </PageContent>
  )
}

function JobRow({ job, running }: { job: Job; running: boolean }) {
  const run = useApiWrite('runJob')
  const [busy, setBusy] = useState(false)
  const name = jobNames[job.name] ?? job.name
  const queued = (job.queue?.queued ?? 0) + (job.queue?.active ?? 0) > 0
  return (
    <div role="row" data-job={job.name} className={cn(gridRowClass, 'group/row')}>
      <div
        role="cell"
        className={cn(
          gridCell,
          'min-w-0 flex-1 shrink flex-col items-start justify-center gap-1 py-2',
        )}
      >
        <span className="max-w-full truncate text-body">{name}</span>
        {job.status === 'failing' && job.lastError ? (
          <span
            className="max-w-full truncate text-dense text-muted-foreground"
            title={job.lastError}
          >
            {job.lastErrorAt ? `${formatMoment(job.lastErrorAt)}: ` : ''}
            {job.lastError}
          </span>
        ) : (
          <span
            className="max-w-full truncate font-mono text-caption text-muted-foreground"
            translate="no"
          >
            {job.name}
          </span>
        )}
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-status')}>
        <JobStatus status={job.status} />
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums', optional)}>
        <span className="truncate text-muted-foreground">
          {job.lastSucceededAt ? formatMoment(job.lastSucceededAt) : 'Never'}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-optional tabular-nums', optional)}>
        <span className="truncate">
          {job.runsOk.toLocaleString('en')} ok
          {job.runsFailed ? `, ${job.runsFailed.toLocaleString('en')} failed` : ''}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-status justify-end')}>
        {!running ? (
          <BlockedButton
            variant="ghost"
            size="sm"
            title="You can't run it now"
            reason="The job runner isn't running, so no job can start."
          >
            Run now
          </BlockedButton>
        ) : queued ? (
          <span className="text-dense text-muted-foreground">Queued</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Run ${name} now`}
            aria-disabled={busy || undefined}
            className={gridRowControl}
            onClick={() => {
              if (busy) return
              setBusy(true)
              run
                .mutateAsync({ job: job.name })
                .then(
                  () => showToast(`${name} queued`, 'It starts within a minute.'),
                  (error: unknown) =>
                    showToast(
                      `${name} didn't start`,
                      error instanceof Error ? error.message : 'Try again.',
                    ),
                )
                .finally(() => setBusy(false))
            }}
          >
            {busy ? (
              <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
            ) : (
              <PlayIcon aria-hidden />
            )}
            Run now
          </Button>
        )}
      </div>
    </div>
  )
}
