import * as React from 'react'
import { useDomains, useDomainList } from '@/lib/workspace'
import { useObservability } from '@/lib/obs'
import { ArrowUpRightIcon, ChevronRightIcon, CircleHelpIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GroupRow, Th, thClass } from '@/components/heed/list'
import { DomainDot } from '@/components/heed/tag-chip'
import { MixBar, Sparkline, Swatch } from '@/components/obs/charts'
import {
  found,
  groupCount,
  HIDE_UNDER,
  monthName,
  monthsLabel,
  shownCount,
  statusOf,
  total,
  visibleTotal,
  type Grouping,
  type TopicGroup,
  type TopicRow,
  type View,
  sortGroups,
  type Sort,
} from '@/model/observability'
import type { DomainId } from '@/model/items'
import { openDock } from '@/lib/dock'

// The topics as rows, in one of three groupings. A topic is an exact scope (domain, metric, market
// and the month its dates start in), and that key never changes; grouping only joins rows for
// reading. A grouped row shows the combined count and the share that found nothing, and opens to
// its months. A total that would give a month under 5 away by subtraction shows as "13+".

const COLS = 6

export function TopicTable({
  rows,
  grouping,
  sort,
  view,
  peeked,
  unread,
  onKeyDown,
  empty,
}: {
  rows: TopicRow[]
  grouping: Grouping
  sort: Sort
  view: View
  peeked?: string
  /** Calls that could not be read in this range, to say under the topics. */
  unread: number
  onKeyDown?: React.KeyboardEventHandler
  empty?: React.ReactNode
}) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const obs = useObservability()
  const [open, setOpen] = React.useState<string[]>([])
  const [folded, setFolded] = React.useState<string[]>([])
  const toggle = (list: string[], k: string) =>
    list.includes(k) ? list.filter((x) => x !== k) : [...list, k]
  const groups = sortGroups(
    grouping === 'none' ? rows.map((r) => obs.rollUp([r])[0]!) : obs.rollUp(rows),
    sort,
  )
  // Domain only: a section per domain, with the topics that have none last.
  const sections =
    grouping === 'domain'
      ? [...domainIds, undefined]
          .map((d) => ({ domain: d, groups: groups.filter((g) => g.domain === d) }))
          .filter((s) => s.groups.length)
      : [{ domain: null as DomainId | undefined | null, groups }]

  const row = (g: TopicGroup) => {
    const many = grouping !== 'none' && g.rows.length > 1
    const isOpen = open.includes(g.key)
    // A group has its rows: one, or a topic's months.
    const first = g.rows[0]!
    return (
      <React.Fragment key={g.key + (grouping === 'none' ? first.id : '')}>
        <TopicLine
          id={first.id}
          name={grouping === 'none' ? obs.topicTitle(first) : g.name}
          months={grouping === 'none' ? undefined : g.months}
          group={g}
          view={view}
          peeked={peeked === first.id || (!many && peeked === first.id)}
          expand={
            many ? { open: isOpen, onToggle: () => setOpen((x) => toggle(x, g.key)) } : undefined
          }
        />
        {many &&
          isOpen &&
          g.rows.map((r) => {
            const one = obs.rollUp([r])[0]!
            return (
              <TopicLine
                key={r.id}
                id={r.id}
                name={monthName(r.month)}
                group={one}
                view={view}
                peeked={peeked === r.id}
                month
              />
            )
          })}
      </React.Fragment>
    )
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <Th className="w-full px-4 md:pl-5">Topic</Th>
          <Th className="hidden w-36 px-2 @3xl/main:table-cell">Domain</Th>
          <th className={cn(thClass, 'w-24 px-2 text-right')}>Asked</th>
          <Th className="hidden w-24 px-2 @4xl/main:table-cell">{view.range} days</Th>
          <Th className="hidden w-60 min-w-60 px-2 @2xl/main:table-cell">How it was answered</Th>
          <Th className="hidden w-44 pr-4 pl-2 md:pr-5 @3xl/main:table-cell">Status</Th>
        </tr>
      </thead>
      <tbody onKeyDown={onKeyDown}>
        {groups.length === 0 && empty && (
          <tr>
            <td colSpan={COLS} className="px-6 py-10 text-center text-sm">
              {empty}
            </td>
          </tr>
        )}
        {sections.map((s) => {
          const label =
            s.domain === null ? '' : s.domain ? (domains[s.domain]?.name ?? s.domain) : 'No domain'
          const exact = s.groups.flatMap((g) => g.rows)
          const sum = exact.reduce((n, r) => n + total(r.counts), 0)
          const shown = exact.reduce(
            (n, r) => n + (total(r.counts) >= HIDE_UNDER ? total(r.counts) : 0),
            0,
          )
          return (
            <React.Fragment key={label || 'all'}>
              {label && (
                <GroupRow
                  label={label}
                  detail={`${s.groups.length} ${s.groups.length === 1 ? 'topic' : 'topics'} - ${groupCount({ visible: visibleTotal(sum, shown), shown })} asked`}
                  open={!folded.includes(label)}
                  colSpan={COLS}
                  onToggle={() => setFolded((x) => toggle(x, label))}
                />
              )}
              {!folded.includes(label) && s.groups.map(row)}
            </React.Fragment>
          )
        })}
        {unread > 0 && (
          <tr className="border-t bg-muted/30 text-sm">
            <td colSpan={COLS} className="px-4 py-2.5 md:px-5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <CircleHelpIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">Could not be read</span>
                <span className="tabular-nums">{shownCount(unread)} calls</span>
                <span className="text-xs text-muted-foreground">
                  Named no metric and no market from the definitions, so they have no topic.
                  Counted, never the words.
                </span>
              </span>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/** One row: a topic, a grouped topic, or one month of a grouped topic. */
function TopicLine({
  id,
  name,
  months,
  group: g,
  view,
  peeked,
  expand,
  month,
}: {
  id: string
  name: string
  months?: string[]
  group: TopicGroup
  view: View
  peeked?: boolean
  expand?: { open: boolean; onToggle: () => void }
  /** A month inside a grouped topic, indented under it. */
  month?: boolean
}) {
  const domains = useDomains()
  const obs = useObservability()
  const n = g.visible
  const hidden = n === null && g.shown === 0
  const st = statusOf({ ...g.rows[0]!, counts: g.counts })
  const disagree = g.rows.reduce((k, r) => k + (r.disagree ?? 0), 0)
  const share = g.total ? Math.round((g.counts.missing / g.total) * 100) : 0
  const open = () => (expand ? expand.onToggle() : openDock('topic', id))
  return (
    <tr
      data-peeked={peeked || undefined}
      className={cn(
        'h-12 cursor-pointer border-t text-sm transition-colors hover:bg-muted/50 has-[[data-row-open]:focus-visible]:bg-muted data-peeked:bg-muted data-peeked:shadow-peeked',
        month && 'bg-muted/20',
      )}
      onClick={open}
    >
      <td className={cn('max-w-0 px-4 py-2 md:pl-5', month && 'pl-11 md:pl-12')}>
        <span className="flex min-w-0 items-center gap-1.5">
          {expand && (
            <ChevronRightIcon
              aria-hidden
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--dur-2)',
                expand.open && 'rotate-90',
              )}
            />
          )}
          <button
            type="button"
            data-row-open={id}
            aria-expanded={expand ? expand.open : undefined}
            className={cn(
              'block max-w-full truncate text-left outline-none hover:underline',
              month ? 'text-dense' : 'font-medium',
            )}
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
          >
            {name}
            {expand && <span className="sr-only">, {g.rows.length} months</span>}
          </button>
          {months && (
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {monthsLabel(months)}
            </span>
          )}
        </span>
        {!month && <Flags g={g} disagree={disagree} />}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground @3xl/main:hidden">
          {g.domain ? <DomainDot id={g.domain} /> : null}
          {g.domain ? domains[g.domain]?.name : 'No domain'}
          {st && <span className="truncate">- {st.label}</span>}
        </span>
      </td>
      <td className="hidden px-2 text-dense whitespace-nowrap text-muted-foreground @3xl/main:table-cell">
        {!month && (
          <span className="flex items-center gap-1.5">
            {g.domain && <DomainDot id={g.domain} />}
            {g.domain ? domains[g.domain]?.name : 'No domain'}
          </span>
        )}
      </td>
      <td className="px-2 text-right font-semibold whitespace-nowrap tabular-nums">
        {hidden ? (
          <span className="text-xs font-normal text-muted-foreground">Fewer than 5</span>
        ) : n === null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-help underline decoration-dotted underline-offset-4" />
              }
            >
              {groupCount(g)}
            </TooltipTrigger>
            <TooltipContent className="max-w-56">
              One month has fewer than 5, so the total is not shown: it would give that month away.
            </TooltipContent>
          </Tooltip>
        ) : (
          n
        )}
      </td>
      <td className="hidden px-2 @4xl/main:table-cell">
        {!hidden && g.rows.length === 1 && <Sparkline values={obs.sparkOf(g.rows[0]!, view)} />}
      </td>
      <td className="hidden px-2 py-2 @2xl/main:table-cell">
        {hidden ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : (
          <>
            <MixBar counts={g.counts} />
            <span className="mt-1 block text-xs whitespace-nowrap text-muted-foreground">
              {n === null
                ? `${share}% not found`
                : `${found(g.counts)} found context${g.counts.missing ? `, ${g.counts.missing} nothing (${share}%)` : ''}`}
            </span>
          </>
        )}
      </td>
      <td
        className="hidden pr-4 pl-2 md:pr-5 @3xl/main:table-cell"
        onClick={(e) => st?.href && e.stopPropagation()}
      >
        {!month && st ? (
          st.href ? (
            <a
              href={st.href}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'xs' }),
                'gap-1 font-normal',
              )}
            >
              <ArrowUpRightIcon />
              {st.label}
            </a>
          ) : (
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs',
                st.tone === 'warn' && 'border-warn/45',
              )}
            >
              <Swatch
                state={
                  st.tone === 'warn' ? (g.counts.conflict >= 3 ? 'conflict' : 'stale') : 'missing'
                }
              />
              {st.label}
            </span>
          )
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </tr>
  )
}

/** What a topic's scope says about how it was read: a metric group, no metric at all, or agent and words that disagreed. */
function Flags({ g, disagree }: { g: TopicGroup; disagree: number }) {
  const flags = [
    g.named === 'group' && {
      label: 'Metric group',
      tip: `A metric group: its domain is taken from the group's metrics.`,
      warn: false,
    },
    g.named === 'none' && {
      label: 'No metric named',
      tip: 'Agents named a market but no metric from the definitions. An owner can add the word they use as another name.',
      warn: true,
    },
    g.rows.length > 1 &&
      g.counts.missing >= HIDE_UNDER &&
      g.rows.every((r) => r.counts.missing < HIDE_UNDER) && {
        label: 'Counted across a month edge',
        tip: 'Each month alone found nothing fewer than 5 times; counted together over 7 days, it is a gap and a Not found card.',
        warn: false,
      },
    disagree > 0 && {
      label: 'Agent and words disagree',
      tip: `${shownCount(disagree)} calls named one thing in the agent's own fields and another in the words. They were counted as the agent's fields say.`,
      warn: true,
    },
  ].filter(Boolean) as { label: string; tip: string; warn: boolean }[]
  if (!flags.length) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {flags.map((f) => (
        <Tooltip key={f.label}>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  'inline-flex h-5 cursor-help items-center rounded-md border px-1.5 text-2xs text-muted-foreground',
                  f.warn && 'border-warn/45 text-foreground',
                )}
              />
            }
          >
            {f.label}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{f.tip}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  )
}
