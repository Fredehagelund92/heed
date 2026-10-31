import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toApiError } from '@/api/errors'
import {
  observabilitySnapshotQuery,
  observabilitySnapshotsQuery,
  observabilitySummaryQuery,
  useApiWrite,
} from '@/api/queries'
import {
  ArrowUpRightIcon,
  BellIcon,
  BookmarkIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FilePenLineIcon,
  FileTextIcon,
  LockIcon,
  MessageSquareIcon,
  PrinterIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Frame, FrameSection } from '@/components/heed/frame'
import { Loadable } from '@/components/heed/load-state'
import { DomainDot } from '@/components/heed/tag-chip'
import { LineChart, niceMax } from '@/components/obs/charts'
import { Definition, DomainFilter, Kpi, type KpiChange } from '@/components/obs/controls'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { dateLabel } from '@/model/observability'
import {
  caughtLines,
  changesWords,
  countWords,
  DEFINITIONS,
  dayName,
  notComparedWords,
  periodName,
  SUMMARY_PERIODS,
  summaryNumbers,
  summarySentences,
  type Move,
  type Snapshot,
  type SnapshotItem,
  type SummaryData,
  type SummaryPeriod,
  type SummaryWords,
} from '@/model/obs-summary'
import { OBS_PURPOSE, useObsAddress, type ObsAddress } from '@/lib/obs'
import { setQuery, useRoute } from '@/lib/router'
import { useDomains, useMe } from '@/lib/workspace'
import { ObsCrumbs, ObsPage } from '@/pages/observability'

// Summary: one page to pass on, over the last whole calendar month or quarter. Four numbers, each
// with what it counts a click away; a few plain sentences from fixed templates; what Heed caught,
// as separate lines; the weekly trend of checked answers; what is still open; and what changed,
// with who approved it. It prints on one A4 sheet: the controls and the menus stay on screen.
//
// Under it, the monthly snapshots: each whole month's Summary as it was on the day it was taken,
// kept for good as counts and the sentences said over them. A snapshot opens as a digest, a page
// made to print on one A4 sheet or to save as a PDF and pass on.

const DAY = 86_400_000

/** Each line of what was caught: its icon, and what it counts, a click away. */
const CAUGHT_ICONS: Record<string, typeof TriangleAlertIcon> = {
  warned: TriangleAlertIcon,
  saved: BookmarkIcon,
  alerts: BellIcon,
}
const CAUGHT_DEFINITIONS: Record<string, string> = {
  warned: DEFINITIONS.warned,
  saved: DEFINITIONS.saved,
  alerts: DEFINITIONS.alerts,
}

/** What a hidden headline count says: true whether it is small itself or keeps a small one safe. */
const HIDDEN = 'hidden: under 5, or it would give one under 5 away'

/** The address: the period, and a domain or an owner's own. */
function useSummaryAddress(): ObsAddress & { period: SummaryPeriod } {
  const { query } = useRoute()
  return { ...useObsAddress(), period: query.get('period') === 'quarter' ? 'quarter' : 'month' }
}

export function SummaryPage() {
  const view = useSummaryAddress()
  const load = useQuery(
    observabilitySummaryQuery({
      period: view.period,
      ...(view.domain ? { domain: view.domain } : {}),
    }),
  )
  return (
    <ObsPage section="summary">
      <Loadable
        query={load}
        what="the summary"
        skeleton={<ObsSkeleton section="summary" kpis={4} body="overview" />}
      >
        {load.data && (
          <>
            <Summary data={load.data} view={view} />
            <Snapshots view={view} live={load.data} />
          </>
        )}
      </Loadable>
    </ObsPage>
  )
}

/** How long a topic has been open, to the last day counted: "open since 24 Sep 2026 (29 days)". */
function openFor(since: number, last: number) {
  const days = Math.round((last - since) / DAY) + 1
  return days > 0
    ? `open since ${dayName(since)} (${days.toLocaleString('en-GB')} ${days === 1 ? 'day' : 'days'})`
    : `open since ${dayName(since)}`
}

/** Last month or last quarter: one row of two, a radio group to a screen reader. */
function PeriodSwitch({ value }: { value: SummaryPeriod }) {
  return (
    <div
      role="radiogroup"
      aria-label="Period"
      className="flex h-8 shrink-0 items-stretch rounded-md border bg-background p-0.5 max-sm:h-10"
    >
      {(Object.keys(SUMMARY_PERIODS) as SummaryPeriod[]).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => setQuery({ period: p === 'month' ? undefined : p })}
          className={cn(
            'rounded-tile px-2.5 text-dense whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            value === p && 'bg-muted font-medium text-foreground',
          )}
        >
          {SUMMARY_PERIODS[p]}
        </button>
      ))}
    </div>
  )
}

function Controls({ view }: { view: ReturnType<typeof useSummaryAddress> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DomainFilter view={view} />
      <PeriodSwitch value={view.period} />
    </div>
  )
}

/** A move as a cell says it: no arrow and no colour inside the margin. */
function kpiOf(move: Move | null, better?: 'up' | 'down'): KpiChange | undefined {
  if (!move) return undefined
  if (move.direction === 'same') return { words: move.words }
  return {
    words: move.words,
    direction: move.direction,
    ...(better ? { tone: move.direction === better ? 'good' : 'bad' } : {}),
  }
}

function Summary({
  data,
  view,
}: {
  data: SummaryData
  view: ReturnType<typeof useSummaryAddress>
}) {
  const domains = useDomains()
  const name = periodName(data.now)
  const before = periodName(data.before)
  const where = view.domain ? (domains[view.domain]?.name ?? 'One domain') : 'All domains'
  const notes = [
    notComparedWords(data),
    data.complete ? null : `Some of ${name} is no longer kept, so its counts may be low.`,
  ].filter((n): n is string => !!n)
  return (
    <div data-print="sheet">
      <Frame>
        <FrameSection
          title={`Summary, ${name}`}
          description={
            <>
              {where} · {dayName(data.now.start)} to {dayName(data.now.end - DAY)}.{' '}
              {OBS_PURPOSE.summary}
            </>
          }
          action={
            <div className="hidden @3xl/main:block print:hidden">
              <Controls view={view} />
            </div>
          }
        >
          <div className="px-4 pb-4 md:px-5 @3xl/main:hidden print:hidden">
            <Controls view={view} />
          </div>
          {notes.length > 0 && data.state === 'normal' && (
            <ul className="flex flex-col gap-1 px-4 pb-4 text-sm text-muted-foreground md:px-5">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </FrameSection>
        {data.state === 'normal' ? (
          <Counted data={data} name={name} before={before} />
        ) : (
          <NotCounted state={data.state} name={name} />
        )}
      </Frame>
    </div>
  )
}

/** Nothing asked yet, or too few questions to show any count. */
function NotCounted({ state, name }: { state: 'empty' | 'quiet'; name: string }) {
  return (
    <Empty className="border-t py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleSlashIcon />
        </EmptyMedia>
        <EmptyTitle>
          {state === 'empty' ? 'No agent has asked anything yet' : 'Too few questions to show'}
        </EmptyTitle>
        <EmptyDescription>
          {state === 'empty'
            ? 'Once an agent asks, this page sums up each month and quarter: what was asked, how it was answered, and what changed.'
            : `Fewer than 5 questions in ${name}, so no counts are shown. A small count could point to one person.`}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * The numbers, sentences, trend and lists of a counted Summary. A snapshot's (`frozen`) says the
 * sentences kept with it, and what is open and what changed as the counts it kept.
 */
function Counted({
  data,
  name,
  before,
  frozen,
}: {
  data: SummaryData
  name: string
  before: string
  frozen?: { words: SummaryWords; takenOn: number }
}) {
  const domains = useDomains()
  const s = summaryNumbers(data)
  const sentences = frozen?.words.sentences ?? summarySentences(data)
  const caught = frozen?.words.caught ?? caughtLines(data)
  const weekValues = data.weeks.map((w) => (w.counted ? w.checked : null))
  const extra = (shown: number, total: number | null) =>
    total !== null && total > shown ? `And ${(total - shown).toLocaleString('en-GB')} more.` : null
  return (
    <>
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4 print:grid-cols-4">
        <Kpi
          icon={<MessageSquareIcon />}
          label="Questions asked"
          value={s.asked === null ? '-' : countWords(s.asked)}
          // More questions is neither good nor bad: an arrow, never a colour.
          change={kpiOf(s.askedMove)}
          sub={
            s.askedBefore !== null
              ? `${countWords(s.askedBefore)} in ${before}`
              : data.previous
                ? HIDDEN
                : undefined
          }
          definition={DEFINITIONS.asked}
        />
        <Kpi
          icon={<CircleCheckIcon />}
          label="Checked answers"
          value={s.checked === null ? '-' : (s.checkedShare ?? countWords(s.checked))}
          change={kpiOf(s.checkedMove, 'up')}
          sub={
            s.checked === null
              ? HIDDEN
              : s.checkedShare
                ? `${countWords(s.checked)} of ${countWords(s.asked!)} questions`
                : 'Too few questions this period for a share'
          }
          definition={DEFINITIONS.checked}
        />
        <Kpi
          icon={<CircleDashedIcon />}
          label="Not found"
          value={s.missing === null ? '-' : countWords(s.missing)}
          change={kpiOf(s.missingMove, 'down')}
          sub={
            s.missing === null
              ? HIDDEN
              : s.missingShare && s.missing >= 5
                ? `${s.missingShare} of questions`
                : undefined
          }
          definition={DEFINITIONS.missing}
        />
        <Kpi
          icon={<FilePenLineIcon />}
          label="Changes approved"
          value={changesWords(data.changes.total)}
          sub={`${changesWords(data.changes.before)} in ${before}`}
          definition={DEFINITIONS.changes}
        />
      </div>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-2 print:grid-cols-2">
        <FrameSection
          title="In short"
          description={
            frozen
              ? `Fixed sentences over the numbers on this page, as they were said on ${dayName(frozen.takenOn)}. None is written by a model.`
              : 'Fixed sentences over the numbers on this page. None is written by a model.'
          }
        >
          <ul className="flex flex-col gap-2 px-4 pb-4 text-sm md:px-5">
            {sentences.map((line) => (
              <li key={line} className="text-pretty">
                {line}
              </li>
            ))}
          </ul>
        </FrameSection>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l print:border-t-0 print:border-l">
          <FrameSection
            title="Checked answers each week"
            description="From the weekly counts. A gap is a week whose count is hidden, or before agents first asked."
          >
            <div className="px-4 pb-4 md:px-5">
              <LineChart
                series={[
                  {
                    name: 'Checked answers',
                    values: weekValues,
                    color: 'var(--primary)',
                    fill: true,
                  },
                ]}
                labels={data.weeks.map((w) => dateLabel(w.at))}
                max={niceMax(Math.max(...weekValues.map((v) => v ?? 0), 1))}
                height={150}
                format={(v) => v.toLocaleString('en-GB')}
                missing="Not shown"
                caption={`Checked answers each week, the 13 weeks up to the end of ${name}`}
              />
            </div>
          </FrameSection>
        </div>
      </div>
      <FrameSection
        title="What we caught"
        description="Three separate lines, never added up. Each counts something that was noticed and shown to an agent or an owner."
      >
        <ul className="grid grid-cols-1 gap-px border-t bg-border @3xl/main:grid-cols-3 print:grid-cols-3">
          {caught.map((c) => {
            const Icon = c.measured ? (CAUGHT_ICONS[c.key] ?? TriangleAlertIcon) : CircleSlashIcon
            const definition = c.measured ? CAUGHT_DEFINITIONS[c.key] : undefined
            return (
              <li key={c.key} className="flex flex-col gap-1 bg-background px-4 py-3 md:px-5">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  {c.title}
                  {definition && <Definition label={c.title} definition={definition} />}
                </span>
                <span className={cn('text-sm text-pretty', !c.measured && 'text-muted-foreground')}>
                  {c.text}
                </span>
              </li>
            )
          })}
        </ul>
      </FrameSection>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-2 print:grid-cols-2">
        <FrameSection
          title="Still open"
          description={
            frozen
              ? `Topics agents found nothing written down for, on ${dayName(frozen.takenOn)}.`
              : `Topics agents found nothing written down for, the most asked about in ${name} first.`
          }
        >
          <div className="px-4 pb-4 md:px-5">
            {frozen ? (
              <p className="text-sm text-pretty">
                {data.open.total === 0
                  ? 'Nothing was open: every topic agents found nothing for had been written down.'
                  : `${data.open.total === 1 ? 'One topic was' : `${data.open.total.toLocaleString('en-GB')} topics were`} still open, waiting for an owner to write ${data.open.total === 1 ? 'it' : 'them'} down. A snapshot keeps the count, not the topics: Summary lists them as they are today.`}
              </p>
            ) : data.open.spots.length ? (
              <ul className="flex flex-col divide-y border-y">
                {data.open.spots.map((o) => (
                  <li key={o.id} className="flex flex-col gap-0.5 py-2.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {o.domain && <DomainDot id={o.domain} />}
                      {o.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {o.domain && `${domains[o.domain]?.name ?? o.domain} · `}
                      {o.missing === null
                        ? `found nothing in ${name}: the count is hidden`
                        : `found nothing ${countWords(o.missing)} times in ${name}`}{' '}
                      · {openFor(o.since, data.last)} ·{' '}
                      <a
                        href={o.href}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {o.label}
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing is open: every topic agents found nothing for has been written down.
              </p>
            )}
            {!frozen && extra(data.open.spots.length, data.open.total) && (
              <p className="mt-2 text-xs text-muted-foreground">
                {extra(data.open.spots.length, data.open.total)}
              </p>
            )}
          </div>
        </FrameSection>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l print:border-t-0 print:border-l">
          <FrameSection
            title={frozen ? 'What changed' : 'What changed and who approved it'}
            description={
              frozen
                ? `Changes an owner approved in review and published in ${name}.`
                : `Changes an owner approved in review and published in ${name}, the latest first.`
            }
          >
            <div className="px-4 pb-4 md:px-5">
              {frozen ? (
                <p className="text-sm text-pretty">
                  {data.changes.total === 0
                    ? `No change was approved and published in ${name}.`
                    : `${changesWords(data.changes.total)} ${data.changes.total === 1 ? 'change was' : 'changes were'} approved by an owner and published, against ${changesWords(data.changes.before).toLowerCase()} in ${before}. A snapshot keeps the counts, not the items or who approved them.`}
                </p>
              ) : data.changes.latest.length ? (
                <ul className="flex flex-col divide-y border-y">
                  {data.changes.latest.map((c) => (
                    <li key={`${c.at}-${c.title}`} className="flex flex-col gap-0.5 py-2.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {c.domain && <DomainDot id={c.domain} />}
                        {c.href ? (
                          <a href={c.href} className="underline-offset-2 hover:underline">
                            {c.title}
                          </a>
                        ) : (
                          c.title
                        )}
                        {c.href && (
                          <ArrowUpRightIcon
                            className="size-3.5 text-muted-foreground print:hidden"
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.domain && `${domains[c.domain]?.name ?? c.domain} · `}
                        {dayName(c.at)} · approved by {c.by}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : data.changes.total === null ? (
                <p className="text-sm text-muted-foreground">
                  The changes are not listed: their count is hidden.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No change was approved and published in {name}.
                </p>
              )}
              {!frozen && extra(data.changes.latest.length, data.changes.total) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {extra(data.changes.latest.length, data.changes.total)}
                </p>
              )}
            </div>
          </FrameSection>
        </div>
      </div>
      <FrameSection title="What each number counts" level={3}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 pb-3 text-xs md:px-5 @3xl/main:grid-cols-2 print:grid-cols-2">
          {(
            [
              ['Questions asked', DEFINITIONS.asked],
              ['Checked answers', DEFINITIONS.checked],
              ['Answered with a warning', DEFINITIONS.warned],
              ['Not found', DEFINITIONS.missing],
              ['Changes approved', DEFINITIONS.changes],
              ...(caught.some((c) => c.key === 'saved' && c.measured)
                ? ([['Saved questions that changed', DEFINITIONS.saved]] as const)
                : []),
              ...(caught.some((c) => c.key === 'alerts' && c.measured)
                ? ([['Alerts that owners acted on', DEFINITIONS.alerts]] as const)
                : []),
            ] as const
          ).map(([term, text]) => (
            <div key={term}>
              <dt className="inline font-medium">{term}: </dt>
              <dd className="inline text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
        <p className="flex items-start gap-2 border-t px-4 py-3 text-xs text-muted-foreground md:px-5">
          <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Counts only: never the words of a question or who asked. A count under 5 is never shown,
            nor one that would give one away.{' '}
            {data.hidden === 0
              ? 'No number is hidden on this page.'
              : `${data.hidden.toLocaleString('en-GB')} ${data.hidden === 1 ? 'number is' : 'numbers are'} hidden: under 5, or it would give one under 5 away.`}{' '}
            Counted to the end of {dayName(data.last)}.
            {frozen &&
              ` A snapshot taken on ${dayName(frozen.takenOn)}, kept for good as counts and these sentences.`}
          </span>
        </p>
      </FrameSection>
    </>
  )
}

/* ---------- snapshots ---------- */

/** The month before the one `today` is in: the last whole month, which the job keeps next. */
function lastMonthOf(last: number) {
  const today = new Date(last + DAY)
  return {
    start: Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
    end: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  }
}

/**
 * The monthly snapshots of the scope on screen (every domain, or one), the latest month first,
 * each a link to its digest. An admin can take the last whole month's at once when the nightly
 * job has not yet. On screen only: the sheet above is what prints.
 */
function Snapshots({
  view,
  live,
}: {
  view: ReturnType<typeof useSummaryAddress>
  live: SummaryData
}) {
  const me = useMe()
  const load = useQuery(observabilitySnapshotsQuery(view.domain))
  const take = useApiWrite('takeObservabilitySnapshot')
  const month = lastMonthOf(live.last)
  const list = load.data ?? []
  const due =
    me.admin &&
    live.state !== 'empty' &&
    !!load.data &&
    !list.some((s) => s.now.start === month.start)
  const action = due ? (
    <Button
      variant="outline"
      size="sm"
      disabled={take.isPending}
      onClick={() =>
        void take
          .mutateAsync(undefined)
          .then((r) =>
            toast(
              r.taken
                ? `Snapshot of ${periodName(r.now)} taken`
                : `${periodName(r.now)} has no new snapshot`,
              {
                description: r.taken
                  ? 'Its numbers stay as they are today, kept for good. Open it to print or save it as a PDF.'
                  : 'It was already kept, or agents asked nothing in it.',
              },
            ),
          )
          .catch((error: unknown) =>
            toast.error("Couldn't take the snapshot", { description: toApiError(error).message }),
          )
      }
    >
      <FileTextIcon />
      Take {periodName(month)} now
    </Button>
  ) : null
  return (
    <div className="print:hidden">
      <Frame>
        <FrameSection
          title="Monthly snapshots"
          description="Each whole month's Summary as it was on the day it was taken, kept for good: counts and sentences only. Open one to print it or save it as a PDF."
          action={action}
        >
          <div className="px-4 pb-4 md:px-5">
            {load.isError ? (
              <p className="text-sm text-muted-foreground">
                The snapshots could not be loaded. Reload the page to try again.
              </p>
            ) : list.length ? (
              <ul className="flex flex-col divide-y border-y">
                {list.map((item) => (
                  <SnapshotRow key={item.id} item={item} />
                ))}
              </ul>
            ) : load.data ? (
              <p className="text-sm text-muted-foreground">
                No snapshot yet. One is taken of each month on the night after it ends.
              </p>
            ) : null}
          </div>
        </FrameSection>
      </Frame>
    </div>
  )
}

function SnapshotRow({ item }: { item: SnapshotItem }) {
  const domains = useDomains()
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <a
        href={`/observability/summary/${item.id}`}
        className="text-sm font-medium underline-offset-2 hover:underline"
      >
        {periodName(item.now)}
        {item.domain && `, ${domains[item.domain]?.name ?? item.domain}`}
      </a>
      <span className="text-xs text-muted-foreground">
        {item.state === 'quiet' ? 'Fewer than 5 questions · ' : ''}
        Taken on {dayName(item.takenOn)}
      </span>
    </li>
  )
}

/**
 * A snapshot's digest: the Summary of a whole month as it was on the day it was taken, its counts
 * and sentences kept for good. It is made to pass on: Print or save as PDF opens the browser's own
 * dialog, and the sheet fits one A4 page without menus or controls, readable in black and white.
 */
export function DigestPage({ id }: { id: string }) {
  const load = useQuery(observabilitySnapshotQuery(id))
  const snapshot = load.data
  return (
    <ObsPage
      section="summary"
      crumbs={
        <ObsCrumbs
          section="summary"
          rest={[{ label: snapshot ? `${periodName(snapshot.now)} snapshot` : 'Snapshot' }]}
        />
      }
    >
      <Loadable
        query={load}
        what="the snapshot"
        skeleton={<ObsSkeleton section="summary" kpis={4} body="overview" />}
      >
        {snapshot === null ? (
          <Frame>
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleSlashIcon />
                </EmptyMedia>
                <EmptyTitle>No snapshot here</EmptyTitle>
                <EmptyDescription>
                  It may count a domain you don't own. Summary lists the snapshots you can open.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Frame>
        ) : (
          snapshot && <Digest snapshot={snapshot} />
        )}
      </Loadable>
    </ObsPage>
  )
}

function Digest({ snapshot }: { snapshot: Snapshot }) {
  const domains = useDomains()
  const { data, words } = snapshot
  const name = periodName(data.now)
  const before = periodName(data.before)
  const where = snapshot.domain ? (domains[snapshot.domain]?.name ?? 'One domain') : 'All domains'
  return (
    <div data-print="sheet">
      <Frame>
        <FrameSection
          title={`Summary, ${name}`}
          description={
            <>
              {where} · {dayName(data.now.start)} to {dayName(data.now.end - DAY)}. A snapshot taken
              on {dayName(snapshot.takenOn)}: the numbers as they were that day. Counts only: never
              the words of a question or who asked.
            </>
          }
          action={
            <Button
              variant="outline"
              size="sm"
              className="print:hidden"
              onClick={() => window.print()}
            >
              <PrinterIcon />
              Print or save as PDF
            </Button>
          }
        >
          {words.notes.length > 0 && data.state === 'normal' && (
            <ul className="flex flex-col gap-1 px-4 pb-4 text-sm text-muted-foreground md:px-5">
              {words.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </FrameSection>
        {data.state === 'normal' ? (
          <Counted
            data={data}
            name={name}
            before={before}
            frozen={{ words, takenOn: snapshot.takenOn }}
          />
        ) : (
          <NotCounted state={data.state} name={name} />
        )}
      </Frame>
    </div>
  )
}
