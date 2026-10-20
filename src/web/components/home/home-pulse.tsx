import type { ReactNode } from 'react'
import type { LibraryFreshness } from '@/api'
import { HeedRecheckDueIcon } from '@/components/icons'
import { ChangeMark } from '@/components/quality/quality-marks'
import { Skeleton } from '@/components/ui/skeleton'
import {
  callsText,
  countTrend,
  currentWeekBefore,
  needALook,
  percentText,
  shareTrend,
  weekRangeText,
  type AgentPulse,
  type FactPulse,
  type Trend,
} from '@/lib/home-pulse'
import { BarStrip, Meter, Sparkline } from './pulse-charts'
import type { Loadable } from './home-table'

/*
  The pulse strip (direction A of the Home lab, the captain's pick): "Last week in Heed" in four
  quiet tiles under the search, the same for every person. Each tile is a number, one line of
  words and one small chart (contract 7.1, "Chart"). From the container's xl width the tiles
  stand side by side (two, then four from 5xl, where a label and its change fit on one line);
  below it each is one row, the words on the left and the number and chart on the right. Every
  tile keeps its height through loading, so nothing moves when the numbers arrive, and says what
  an empty, hidden or failed number means. Each chart is an image whose label lists its values and
  says the change on the week before and its verdict in words (contract 11, "Charts").

  Beside each label, the change on the week before (the Home colour analysis, option A): an arrow
  and a signed size, green or red only where the number has a good direction and moved past the
  noise floor (lib/home-pulse.ts), muted otherwise. It colours the change, never the number or the
  tile, so a calm week looks as quiet as the rest of Home.
*/

const fmt = (count: number) => count.toLocaleString('en')

type TileState = { state: 'pending' } | { state: 'failed'; retry: () => void } | { state: 'ready' }

function Tile({
  label,
  status,
  value,
  chart,
  caption,
  trend,
}: {
  label: string
  status: TileState
  value?: ReactNode
  chart?: ReactNode
  caption?: ReactNode
  /** The change on the week before: beside the label, or under the number while a tile is a row. */
  trend?: ReactNode
}) {
  // One grid, read in the order label, words, number, change, chart. While a tile is a row, the
  // label and words stand left of the number and chart, and the change sits under the number.
  // From the container's xl width the label and its change make the first line, the number and
  // chart the second and the words the third; the change's column is only as wide as the change,
  // so the label keeps the rest. Every slot keeps its height, so nothing moves when the numbers
  // arrive.
  return (
    <li
      data-slot="pulse-tile"
      data-state={status.state}
      className="grid min-w-0 auto-cols-max grid-cols-1 items-center gap-x-3 rounded-lg border bg-card px-4 py-3 @xl:gap-y-2 @xl:p-4"
    >
      <span className="col-start-1 row-span-2 row-start-1 flex min-w-0 flex-col self-center @xl:contents">
        <span className="text-dense text-muted-foreground @xl:col-span-2 @xl:col-start-1 @xl:row-start-1 @xl:self-center">
          {label}
        </span>
        <span className="min-h-4 text-caption text-muted-foreground @xl:col-span-3 @xl:row-start-3">
          {status.state === 'pending' ? (
            <Skeleton className="h-4 w-16" />
          ) : status.state === 'failed' ? (
            <>
              We couldn't load this.{' '}
              <button
                type="button"
                onClick={status.retry}
                className="rounded-sm text-brand-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Try again
              </button>
            </>
          ) : (
            caption
          )}
        </span>
      </span>
      <span className="col-start-2 row-start-1 flex min-h-8 items-end justify-self-end @xl:col-start-1 @xl:row-start-2 @xl:justify-self-start">
        {status.state === 'pending' ? (
          <Skeleton className="h-8 w-12" />
        ) : status.state === 'failed' ? (
          <span className="text-body text-muted-foreground">Not loaded</span>
        ) : (
          <span data-slot="pulse-value" className="text-title font-bold tabular-nums">
            {value}
          </span>
        )}
      </span>
      <span className="col-span-2 col-start-2 row-start-2 flex min-h-5 items-center self-start justify-self-start @xl:col-span-1 @xl:col-start-3 @xl:row-start-1 @xl:min-h-0 @xl:self-center @xl:justify-self-end">
        {status.state === 'ready' ? trend : null}
      </span>
      <span className="col-start-3 row-start-1 flex self-end justify-self-end @xl:col-span-2 @xl:col-start-2 @xl:row-start-2">
        {status.state === 'pending' ? (
          <Skeleton className="h-8 w-spark" />
        ) : status.state === 'ready' ? (
          chart
        ) : null}
      </span>
    </li>
  )
}

/** A chart's label with the tile's change and its verdict in words, once there is a change. */
const withChange = (label: string, trend: Trend | null) =>
  trend === null ? label : `${label}. ${trend.spoken[0]!.toUpperCase()}${trend.spoken.slice(1)}`

/** A tile's change mark: judged numbers rise for the better, volumes are only a size. */
function TrendMark({ trend }: { trend: Trend | null }) {
  if (trend === null) return null
  return <ChangeMark change={trend} better={trend.verdict === 'none' ? 'none' : 'up'} />
}

/** Muted words in a number's place: what the number would be, or why there is none. */
function NoNumber({ children }: { children: ReactNode }) {
  return <span className="text-body font-normal text-muted-foreground">{children}</span>
}

const tileState = (value: Loadable<unknown>): TileState =>
  value.state === 'ready' ? { state: 'ready' } : value

function QuestionsTile({ agent }: { agent: Loadable<AgentPulse> }) {
  const label = 'Questions from AI apps'
  if (agent.state !== 'ready') return <Tile label={label} status={tileState(agent)} />
  const { weeks, minimum, none } = agent.data
  const week = weeks.at(-1)!
  const last = week.calls
  const before = weeks.at(-2)?.calls ?? null
  const values = weeks.map((entry) => entry.calls)
  // A hidden total with shown topic weeks is at least their sum: "105+".
  const floor = last === null && week.shownCalls > 0 ? week.shownCalls : null
  const trend = none ? null : countTrend(last, before)
  return (
    <Tile
      label={label}
      status={{ state: 'ready' }}
      value={last !== null ? fmt(last) : floor !== null ? `${fmt(floor)}+` : `<${minimum}`}
      chart={
        <Sparkline
          values={values}
          label={withChange(
            `${label} per week, the last ${weeks.length} weeks: ${weeks.map((entry) => callsText(entry, minimum).toLowerCase()).join(', ')}`,
            trend,
          )}
        />
      }
      caption={
        none
          ? 'No AI app has asked yet'
          : floor !== null
            ? `At least ${fmt(floor)}. A few more stay hidden.`
            : last === null
              ? `We hide counts under ${minimum}`
              : `${weeks.length} weeks shown`
      }
      trend={<TrendMark trend={trend} />}
    />
  )
}

function AnsweredTile({ agent }: { agent: Loadable<AgentPulse> }) {
  // The share of AI app calls that got at least one fact: reach, not whether an answer was right.
  const label = 'Questions that found a fact'
  if (agent.state !== 'ready') return <Tile label={label} status={tileState(agent)} />
  const { weeks, minimum } = agent.data
  const last = weeks.at(-1)!
  const before = weeks.at(-2)
  const shares = weeks.map((week) => (week.answered === null ? null : week.answered * 100))
  const trend = shareTrend(last.answered, before?.answered ?? null, {
    questions: { now: last.calls, before: before?.calls ?? null },
  })
  const chart = (
    <Sparkline
      values={shares}
      min={0}
      max={100}
      label={withChange(
        `Share of AI app questions that found at least one fact per week, the last ${weeks.length} weeks: ${shares.map((share) => (share === null ? 'none' : `${Math.round(share)} percent`)).join(', ')}`,
        trend,
      )}
    />
  )
  let value: ReactNode
  let caption: string
  if (last.calls === 0) {
    value = <NoNumber>No questions</NoNumber>
    caption = agent.data.none ? 'Shows once an AI app asks' : 'No AI app asked last week'
  } else if (last.answered === null || last.calls === null || last.noItemCalls === null) {
    value = <NoNumber>Hidden</NoNumber>
    caption = `We hide counts under ${minimum}`
  } else {
    value = percentText(last.answered)
    caption =
      last.noItemCalls === 0
        ? `All ${fmt(last.calls)} found facts`
        : `${fmt(last.calls - last.noItemCalls)} of ${fmt(last.calls)} · ${fmt(last.noItemCalls)} found nothing`
  }
  return (
    <Tile
      label={label}
      status={{ state: 'ready' }}
      value={value}
      chart={chart}
      caption={caption}
      trend={<TrendMark trend={trend} />}
    />
  )
}

function ChangedTile({ facts }: { facts: Loadable<FactPulse> }) {
  const label = 'Facts added or changed'
  if (facts.state !== 'ready') return <Tile label={label} status={tileState(facts)} />
  const { weeks, changedDomains, applyToday } = facts.data
  const values = weeks.map((week) => week.changed)
  const last = values.at(-1)!
  const trend = applyToday === 0 && last === 0 ? null : countTrend(last, values.at(-2) ?? null)
  return (
    <Tile
      label={label}
      status={{ state: 'ready' }}
      value={fmt(last)}
      chart={
        <BarStrip
          values={values}
          label={withChange(
            `${label} per week, the last ${weeks.length} weeks: ${values.join(', ')}`,
            trend,
          )}
        />
      }
      caption={
        applyToday === 0 && last === 0
          ? 'Nothing written down yet'
          : last === 0
            ? `None last week · ${weeks.length} weeks shown`
            : `In ${changedDomains} ${changedDomains === 1 ? 'domain' : 'domains'} · ${weeks.length} weeks shown`
      }
      trend={<TrendMark trend={trend} />}
    />
  )
}

function CurrentTile({
  facts,
  freshness,
}: {
  facts: Loadable<FactPulse>
  freshness: LibraryFreshness | null
}) {
  const label = 'Facts that are current'
  if (facts.state !== 'ready') return <Tile label={label} status={tileState(facts)} />
  const pulse = facts.data
  const look = needALook(pulse)
  // Today's share against the one seven days before; without the counts, no mark.
  const trend =
    pulse.applyToday === 0 || freshness === null
      ? null
      : shareTrend(pulse.current / pulse.applyToday, currentWeekBefore(freshness), {
          base: 'week ago',
        })
  const parts = [
    `${fmt(pulse.current)} current`,
    `${fmt(pulse.recheckDue)} check due`,
    `${fmt(pulse.sourceChanged)} source changed`,
    `${fmt(pulse.sourceMissing)} source missing`,
  ]
  return (
    <Tile
      label={label}
      status={{ state: 'ready' }}
      value={
        pulse.applyToday === 0 ? (
          <NoNumber>None yet</NoNumber>
        ) : (
          percentText(pulse.current / pulse.applyToday)
        )
      }
      chart={
        <Meter
          parts={[
            { value: pulse.current, tone: 'ink' },
            { value: pulse.recheckDue, tone: 'warning' },
            { value: pulse.sourceChanged + pulse.sourceMissing, tone: 'warning-soft' },
          ]}
          label={withChange(
            `${fmt(pulse.applyToday)} facts that apply today: ${parts.join(', ')}`,
            trend,
          )}
        />
      }
      caption={
        pulse.applyToday === 0 ? (
          'No facts apply yet'
        ) : look === 0 ? (
          `All ${fmt(pulse.applyToday)} current`
        ) : (
          <span className="flex items-center gap-1">
            <HeedRecheckDueIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 text-status-warning-icon"
            />
            {`${fmt(look)} of ${fmt(pulse.applyToday)} need checking`}
          </span>
        )
      }
      trend={<TrendMark trend={trend} />}
    />
  )
}

/** "Last week": the four tiles. */
export function HomePulse({
  agent,
  facts,
  freshness,
  lastWeek,
}: {
  agent: Loadable<AgentPulse>
  facts: Loadable<FactPulse>
  /** How much of the library was current a week at a time; null until known, or if it failed. */
  freshness: LibraryFreshness | null
  /** The Monday of last week, once the service's today is known. */
  lastWeek: string | null
}) {
  return (
    <section aria-labelledby="home-pulse" className="flex flex-col gap-3" data-slot="home-pulse">
      <div className="flex min-w-0 flex-col @xl:flex-row @xl:items-baseline @xl:gap-3">
        <h2 id="home-pulse" className="text-body font-bold">
          Last week
        </h2>
        {/* Its line is kept while the day is not known yet, so nothing moves when it is
            (a blank line has no text baseline to align to). */}
        <span className="min-h-4 text-caption text-muted-foreground tabular-nums">
          {lastWeek === null ? '\u00a0' : weekRangeText(lastWeek)}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
        <QuestionsTile agent={agent} />
        <AnsweredTile agent={agent} />
        <ChangedTile facts={facts} />
        <CurrentTile facts={facts} freshness={freshness} />
      </ul>
    </section>
  )
}
