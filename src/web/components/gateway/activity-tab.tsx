import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { TrafficSummary } from '@/api'
import { trafficQuery } from '@/api/queries'
import {
  ActivityIcon,
  BotIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  ClockIcon,
  FileTextIcon,
  HashIcon,
  ListChecksIcon,
  TimerIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { AppFamiliesThisWeek } from '@/components/quality/app-families'
import { gridCell } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridMessage,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { toolbarViewClass } from '@/components/page/toolbar'
import { toolName } from '@/lib/gateway'
import { formatMoment } from '@/lib/library'
import { trafficDays } from '@/lib/search-params'
import { byteWords, durationWords } from '@/lib/settings'
import { cn } from '@/lib/utils'

const SLOT = 'traffic'
const optional = '@max-3xl:hidden'
const wide = '@max-5xl:hidden'

const columns: GridColumn[] = [
  { icon: BotIcon, title: 'Agent', className: 'min-w-0 flex-1' },
  { icon: ListChecksIcon, title: 'Tool', className: 'w-column-owner' },
  { icon: HashIcon, title: 'Calls', className: 'w-column-version justify-end' },
  {
    icon: CircleSlashIcon,
    title: 'Refused',
    className: cn('w-column-version justify-end', optional),
  },
  {
    icon: CircleAlertIcon,
    title: 'Errors',
    className: cn('w-column-version justify-end', optional),
  },
  { icon: TimerIcon, title: 'Median', className: cn('w-column-version justify-end', wide) },
  { icon: FileTextIcon, title: 'Sent', className: cn('w-column-version justify-end', wide) },
  { icon: ClockIcon, title: 'Last call', className: cn('w-column-changed', optional) },
]

const daysWords = (days: number) => (days === 1 ? 'Last day' : `Last ${days} days`)
const count = (n: number) => n.toLocaleString('en')
const toolWords = (tool: string) => (tool === 'protocol' ? 'Connecting' : toolName(tool))
/** Calls the gateway turned away: a limit, a missing token or a client or tool not allowed. */
const refusedOf = (
  row: Pick<TrafficSummary['total'], 'rateLimited' | 'forbidden' | 'unauthorized'>,
) => row.rateLimited + row.forbidden + row.unauthorized

/**
 * The traffic by client and tool (FR-410): what each AI client called over the last days, how
 * often the gateway answered or refused and how fast, read from the request log. The log names
 * a client by its label, which every person's app of that kind shares, and never a person or a
 * question. The days are in the address (`days=`); a week by default. Under it, this week's calls
 * per kind of agent, whose small counts are hidden, so they are counted by the week alone.
 */
export function ActivityTab({ days = 7 }: { days?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <TrafficSection days={days} />
      <section aria-labelledby="apps-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="apps-title" className="text-large font-bold">
            Agents this week
          </h2>
          <p className="max-w-reading text-dense text-muted-foreground">
            The tool calls of each kind of agent since Monday, and how many needed more detail,
            found nothing, were malformed or failed.
          </p>
        </div>
        <AppFamiliesThisWeek />
      </section>
    </div>
  )
}

function TrafficSection({ days }: { days: number }) {
  const traffic = useQuery(trafficQuery(days))
  return (
    <section aria-labelledby="activity-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="activity-title" className="text-large font-bold">
            Calls by agent and tool
          </h2>
          <p className="max-w-reading text-dense text-muted-foreground">
            What agents asked for, and how it went. We record the agent and the tool, never a person
            or a question
            {traffic.data ? `, and keep ${count(traffic.data.retentionDays)} days` : ''}.
          </p>
        </div>
        <nav aria-label="Days counted" className="flex items-center gap-1">
          {trafficDays.map((option) => (
            <Link
              key={option}
              to="/admin"
              search={{
                section: 'gateway',
                tab: 'activity',
                ...(option === 7 ? {} : { days: option }),
              }}
              replace
              aria-current={option === days ? 'page' : undefined}
              className={toolbarViewClass}
            >
              {option === 1 ? '1 day' : `${option} days`}
            </Link>
          ))}
        </nav>
      </div>
      {traffic.isPending ? (
        <GridLoading slot={SLOT} label="Loading the calls" />
      ) : traffic.isError ? (
        <GridFailed slot={SLOT} what="the calls" retry={() => void traffic.refetch()} />
      ) : traffic.data.rows.length === 0 ? (
        <GridMessage
          slot={SLOT}
          icon={ActivityIcon}
          title={`No calls in the ${daysWords(days).toLowerCase()}`}
        >
          Once an agent connects and calls a tool, its calls are counted here by agent and tool.
        </GridMessage>
      ) : (
        <TrafficView summary={traffic.data} days={days} />
      )}
    </section>
  )
}

function TrafficView({ summary, days }: { summary: TrafficSummary; days: number }) {
  const { total } = summary
  const answered = total.calls ? Math.round((1000 * total.ok) / total.calls) / 10 : 0
  return (
    <div className="flex flex-col gap-6">
      <FieldTable label={`${daysWords(days)} in total`} wideLabels>
        <FieldRow icon={HashIcon} label="Calls">
          <span className="tabular-nums" data-slot="traffic-calls">
            {count(total.calls)} · {answered}% answered
          </span>
        </FieldRow>
        <FieldRow
          icon={CircleSlashIcon}
          label="Refused"
          hint="Over a limit, without a valid sign-in or access key, or an agent or tool that isn't allowed."
        >
          <span className="tabular-nums">
            {count(refusedOf(total))} ({count(total.rateLimited)} over a limit,{' '}
            {count(total.unauthorized)} without a valid sign-in or access key,{' '}
            {count(total.forbidden)} not allowed)
          </span>
        </FieldRow>
        <FieldRow icon={CircleAlertIcon} label="Errors">
          <span className="tabular-nums">{count(total.errors)}</span>
        </FieldRow>
        <FieldRow
          icon={TriangleAlertIcon}
          label="Malformed"
          hint="Calls the tool couldn't read, because the agent sent them wrong. Nothing here needs fixing."
        >
          <span className="tabular-nums">{count(total.invalidInput)}</span>
        </FieldRow>
        <FieldRow icon={TimerIcon} label="Time to answer">
          <span className="tabular-nums">
            {durationWords(total.medianMs)} median, {durationWords(total.p95Ms)} for the slowest 5%
          </span>
        </FieldRow>
        <FieldRow icon={FileTextIcon} label="Sent">
          <span className="tabular-nums">{byteWords(total.bytes)}</span>
        </FieldRow>
      </FieldTable>
      <GridTable
        slot={SLOT}
        label="Calls by agent and tool"
        header={<GridHeaderCells columns={columns} />}
      >
        {summary.rows.map((row) => (
          <div
            key={`${row.client}.${row.tool}`}
            role="row"
            data-traffic={`${row.client}.${row.tool}`}
            className={gridRowClass}
          >
            <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 gap-2')}>
              <span className="truncate text-body">
                {row.client === 'unknown' ? 'No agent named' : (row.clientName ?? row.client)}
              </span>
              {row.client === 'unknown' ? null : (
                <span
                  className="truncate font-mono text-dense text-muted-foreground"
                  translate="no"
                >
                  {row.client}
                </span>
              )}
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-owner')}>
              <span className="truncate">{toolWords(row.tool)}</span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-version justify-end tabular-nums')}>
              {count(row.calls)}
            </div>
            <div
              role="cell"
              className={cn(gridCell, 'w-column-version justify-end tabular-nums', optional)}
            >
              {count(refusedOf(row))}
            </div>
            <div
              role="cell"
              className={cn(gridCell, 'w-column-version justify-end tabular-nums', optional)}
            >
              {count(row.errors)}
            </div>
            <div
              role="cell"
              className={cn(gridCell, 'w-column-version justify-end tabular-nums', wide)}
            >
              {row.medianMs === null ? '-' : durationWords(row.medianMs)}
            </div>
            <div
              role="cell"
              className={cn(gridCell, 'w-column-version justify-end tabular-nums', wide)}
            >
              {byteWords(row.bytes)}
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums', optional)}>
              <span className="truncate text-muted-foreground">{formatMoment(row.lastHour)}</span>
            </div>
          </div>
        ))}
      </GridTable>
    </div>
  )
}
