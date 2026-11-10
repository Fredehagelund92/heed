import * as React from 'react'
import { useDomains, useDomainList } from '@/lib/workspace'
import { useObservability } from '@/lib/obs'
import { ArrowUpRightIcon, ChevronRightIcon, CircleHelpIcon, InfoIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GroupRow, SortTh, Th } from '@/components/heed/list'
import { DomainDot } from '@/components/heed/tag-chip'
import { MixBar, Sparkline, Swatch } from '@/components/obs/charts'
import {
  groupCount,
  monthName,
  monthsLabel,
  share,
  shownCount,
  shownSum,
  statusOf,
  type Count,
  type Grouping,
  type Topic,
  type TopicGroup,
  type View,
  sortGroups,
  TOPIC_SORTS,
  type Sort,
} from '@/model/observability'
import type { Sorting } from '@/lib/sort'
import type { DomainId } from '@/model/items'
import { openDock } from '@/lib/dock'

// The topics as rows, in one of three groupings. A topic is an exact scope (domain, metric, market
// and the month its dates start in), and that key never changes; grouping only joins rows for
// reading. A grouped row shows the combined count and the share that found nothing, and opens to
// its months. A total that would give a hidden count away by subtraction shows as "13+": the
// binding says which, the table only reads it.

export function TopicTable({
  rows,
  grouping,
  sorting,
  onSort,
  view,
  peeked,
  unread,
  onKeyDown,
  empty,
}: {
  rows: Topic[]
  grouping: Grouping
  sorting: Sorting<Sort>
  /** A sorting header's click. */
  onSort: (key: Sort) => void
  view: View
  peeked?: string
  /** Calls that could not be read in this range, to say under the topics. */
  unread: Count
  onKeyDown?: React.KeyboardEventHandler
  empty?: React.ReactNode
}) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  // A binding that keeps each topic's questions per day draws them; the service does not.
  const sparks = rows.some((r) => r.spark)
  const cols = sparks ? 6 : 5
  const obs = useObservability()
  const [open, setOpen] = React.useState<string[]>([])
  const [folded, setFolded] = React.useState<string[]>([])
  const toggle = (list: string[], k: string) =>
    list.includes(k) ? list.filter((x) => x !== k) : [...list, k]
  const groups = sortGroups(grouping === 'none' ? rows.map(obs.single) : obs.rollUp(rows), sorting)
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
          sparks={sparks}
          peeked={peeked === first.id || (!many && peeked === first.id)}
          expand={
            many ? { open: isOpen, onToggle: () => setOpen((x) => toggle(x, g.key)) } : undefined
          }
        />
        {many &&
          isOpen &&
          g.rows.map((r) => {
            const one = obs.single(r)
            return (
              <TopicLine
                key={r.id}
                id={r.id}
                name={monthName(r.month)}
                group={one}
                sparks={sparks}
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
          <SortTh
            keys={TOPIC_SORTS}
            sorting={sorting}
            by="name"
            onSort={onSort}
            className="w-full px-4 md:pl-5"
          />
          <Th className="hidden w-36 px-2 @5xl/main:table-cell">Domain</Th>
          <SortTh
            keys={TOPIC_SORTS}
            sorting={sorting}
            by="asked"
            onSort={onSort}
            className="w-24 px-2 text-right"
          />
          {sparks && <Th className="hidden w-24 px-2 @5xl/main:table-cell">{view.range} days</Th>}
          <Th className="hidden w-40 min-w-40 px-2 @2xl/main:table-cell @5xl/main:w-60 @5xl/main:min-w-60">
            How it was answered
          </Th>
          <Th className="hidden w-44 pr-4 pl-2 md:pr-5 @3xl/main:table-cell">Status</Th>
        </tr>
      </thead>
      <tbody onKeyDown={onKeyDown}>
        {groups.length === 0 && empty && (
          <tr>
            <td colSpan={cols} className="px-6 py-10 text-center text-sm">
              {empty}
            </td>
          </tr>
        )}
        {sections.map((s) => {
          const label =
            s.domain === null ? '' : s.domain ? (domains[s.domain]?.name ?? s.domain) : 'No domain'
          const all =
            s.domain === null
              ? null
              : obs.domainGroup(
                  s.domain,
                  s.groups.flatMap((g) => g.rows),
                )
          return (
            <React.Fragment key={label || 'all'}>
              {label && (
                <GroupRow
                  label={label}
                  detail={`${s.groups.length} ${s.groups.length === 1 ? 'topic' : 'topics'} - ${groupCount(all!)} asked`}
                  open={!folded.includes(label)}
                  colSpan={cols}
                  onToggle={() => setFolded((x) => toggle(x, label))}
                />
              )}
              {!folded.includes(label) && s.groups.map(row)}
            </React.Fragment>
          )
        })}
        {unread !== 0 && (
          <tr className="h-9 border-t bg-muted/30 text-sm">
            <td colSpan={cols} className="px-4 py-2 md:px-5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <CircleHelpIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">Could not be read</span>
                <span className="tabular-nums">{shownCount(unread)} calls</span>
                <span className="text-xs text-muted-foreground">
                  Named no metric and no value from the definitions, so they have no topic. Counted,
                  never the words.
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
  peeked,
  expand,
  month,
  sparks,
}: {
  id: string
  name: string
  months?: string[]
  group: TopicGroup
  peeked?: boolean
  /** Whether the table has a column for each topic's questions per day. */
  sparks: boolean
  expand?: { open: boolean; onToggle: () => void }
  /** A month inside a grouped topic, indented under it. */
  month?: boolean
}) {
  const domains = useDomains()
  const n = g.visible
  const hidden = n === null && g.shown === 0
  const st = statusOf(g)
  // A call whose agent and words disagreed: a hidden count still says there were some.
  const disagree = g.rows.some((r) => r.disagree !== undefined && r.disagree !== 0)
  const disagreeCount = g.rows.length === 1 ? (g.rows[0]!.disagree ?? null) : null
  const open = () => (expand ? expand.onToggle() : openDock('topic', id))
  const note = hidden ? undefined : answeredLine(n, g.counts.missing)
  return (
    <tr
      data-peeked={peeked || undefined}
      data-vt-move
      className={cn(
        'h-9 cursor-pointer border-t text-sm transition-colors hover:bg-muted/50 has-[[data-row-open]:focus-visible]:bg-muted data-peeked:bg-muted data-peeked:shadow-peeked',
        month && 'bg-muted/20',
      )}
      onClick={open}
    >
      {/* One line a row; on a phone the domain and the status fold under the name. */}
      <td className={cn('max-w-0 px-4 py-1.5 md:pl-5', month && 'pl-11 md:pl-12')}>
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
          {/* Where the Domain column has no room (the dock open beside it), its dot leads the name. */}
          {!month && g.domain && (
            <span className="hidden shrink-0 @3xl/main:inline-flex @5xl/main:hidden">
              <DomainDot id={g.domain} />
              <span className="sr-only">{domains[g.domain]?.name}: </span>
            </span>
          )}
          <button
            type="button"
            data-row-open={id}
            aria-expanded={expand ? expand.open : undefined}
            className={cn(
              'block min-w-0 truncate text-left outline-none hover:underline',
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
          {!month && (
            <>
              <Flags
                g={g}
                disagree={disagree}
                count={disagreeCount}
                className="hidden @5xl/main:flex"
              />
              <Flags
                g={g}
                disagree={disagree}
                count={disagreeCount}
                compact
                className="hidden @3xl/main:flex @5xl/main:hidden"
              />
            </>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground @3xl/main:hidden">
          {g.domain ? <DomainDot id={g.domain} /> : null}
          <span className="shrink-0">{g.domain ? domains[g.domain]?.name : 'No domain'}</span>
          {st && <span className="truncate">- {st.label}</span>}
          {!month && (
            <Flags g={g} disagree={disagree} count={disagreeCount} compact className="flex" />
          )}
        </span>
      </td>
      <td className="hidden px-2 text-dense whitespace-nowrap text-muted-foreground @5xl/main:table-cell">
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
              A count in it is hidden, so the total is not shown: it would give that count away.
            </TooltipContent>
          </Tooltip>
        ) : (
          n
        )}
      </td>
      {sparks && (
        <td className="hidden px-2 @5xl/main:table-cell">
          {!hidden && g.rows.length === 1 && g.rows[0]!.spark && (
            <Sparkline values={g.rows[0]!.spark} />
          )}
        </td>
      )}
      <td className="hidden px-2 @2xl/main:table-cell">
        {hidden ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : !shownSum(g.counts) && !(n && g.counts.missing !== null) ? (
          // Nothing of it may be drawn: the words say so where the bar would be.
          <span className="block truncate text-xs text-muted-foreground">{note}</span>
        ) : (
          // The bar is the row's answer at a glance; its words are a point away, and read out.
          <Tooltip>
            <TooltipTrigger render={<span className="block py-2" />}>
              <MixBar counts={g.counts} of={n} />
              <span className="sr-only">{note}</span>
            </TooltipTrigger>
            <TooltipContent>{note}</TooltipContent>
          </Tooltip>
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
                'gap-1 font-normal whitespace-nowrap',
              )}
            >
              <ArrowUpRightIcon />
              {st.label}
            </a>
          ) : (
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs whitespace-nowrap',
                st.tone === 'warn' && 'border-warn/45',
              )}
            >
              <Swatch
                state={
                  st.tone === 'warn'
                    ? (g.counts.conflict ?? 0) > 0
                      ? 'conflict'
                      : 'stale'
                    : 'missing'
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

/**
 * How a row was answered, in a line: what found context and what found nothing, each when it
 * shows. A hidden count is said as "fewer than 5", never worked out from the others.
 */
function answeredLine(asked: Count, nothing: Count) {
  if (nothing === null) return 'How many found nothing is hidden'
  if (asked === null) return `${shownCount(nothing)} found nothing`
  const pct = share(nothing, asked)
  if (asked === nothing) return `${nothing.toLocaleString('en-GB')} found nothing (100%)`
  return `${(asked - nothing).toLocaleString('en-GB')} found context${nothing ? `, ${nothing} nothing (${pct}%)` : ''}`
}

/** What a topic's scope says about how it was read: a metric group, no metric at all, or agent and words that disagreed. */
function Flags({
  g,
  disagree,
  count,
  compact,
  className,
}: {
  g: TopicGroup
  disagree: boolean
  count: Count
  /** One mark with all of them a point away, where the row has no room for their words. */
  compact?: boolean
  className?: string
}) {
  const flags = [
    g.named === 'group' && {
      label: 'Metric group',
      tip: `A metric group: its domain is taken from the group's metrics.`,
      warn: false,
    },
    g.named === 'none' && {
      label: 'No metric named',
      tip: 'Agents named a value but no metric from the definitions. An owner can add the word they use as another name.',
      warn: true,
    },
    g.rows.length > 1 &&
      g.rows.every((r) => r.in.notFound) &&
      g.rows.every((r) => r.counts.missing === null) && {
        label: 'Counted across a month edge',
        tip: 'Each month alone found nothing fewer than 5 times; counted together over 7 days, it is a gap and a Not found card.',
        warn: false,
      },
    disagree && {
      label: 'Agent and words disagree',
      tip: `${shownCount(count)} calls named one thing in the agent's own fields and another in the words. They were counted as the agent's fields say.`,
      warn: true,
    },
  ].filter(Boolean) as { label: string; tip: string; warn: boolean }[]
  if (!flags.length) return null
  if (compact)
    return (
      <span className={cn('shrink-0', className)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  'inline-flex cursor-help text-muted-foreground',
                  flags.some((f) => f.warn) && 'text-foreground',
                )}
              />
            }
          >
            <InfoIcon className="size-3.5" aria-hidden />
            <span className="sr-only">{flags.map((f) => f.label).join(', ')}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {flags.map((f) => (
              <p key={f.label}>
                <span className="font-medium">{f.label}.</span> {f.tip}
              </p>
            ))}
          </TooltipContent>
        </Tooltip>
      </span>
    )
  // Beside the name, on its line, and the name gives way first.
  return (
    <span className={cn('min-w-0 shrink-0 gap-1', className)}>
      {flags.map((f) => (
        <Tooltip key={f.label}>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  'inline-flex h-5 cursor-help items-center rounded-md border px-1.5 text-xs whitespace-nowrap text-muted-foreground',
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
