import * as React from 'react'
import { useDomains } from '@/lib/workspace'
import { useQuery } from '@tanstack/react-query'
import { observabilityPageQuery } from '@/api/queries'
import { useObservability } from '@/lib/obs'
import type { Observability } from '@/model/observability'
import type { Domains } from '@/model/people'
import {
  ArrowUpRightIcon,
  BotIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  EyeIcon,
  HistoryIcon,
  LayersIcon,
  ListChecksIcon,
  LockIcon,
  MessageSquareIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Frame, FrameSection } from '@/components/heed/frame'
import { Loadable } from '@/components/heed/load-state'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { DomainDot } from '@/components/heed/tag-chip'
import { BarRows, Legend, StackedBars } from '@/components/obs/charts'
import { Kpi, ObsControls } from '@/components/obs/controls'
import {
  dateLabel,
  GROUPINGS,
  groupCount,
  HIDE_UNDER,
  monthsLabel,
  shownCount,
  total,
  visibleTotal,
  type Grouping,
  type TopicRow,
  type View,
} from '@/model/observability'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { savedCounts } from '@/model/saved-questions'
import { useSavedQuestions } from '@/api/queries'
import { open } from '@/lib/events'
import { OBS_PURPOSE, useObsView } from '@/lib/obs'
import { href, setQuery, useRoute } from '@/lib/router'
import { ObsPage } from '@/pages/observability'

// Overview: one frame. Four numbers, each a way into its rows; questions per day, stacked by how
// they were answered, with a dashed line at each publish; the topics asked most with the share that
// found nothing; what found nothing (to the Inbox, where its draft or suggestion waits); what the
// last publish changed; and, for admins, the kinds of agent that asked.

const pct = (n: number) => `${n > 0 ? '+' : ''}${n}`

/** A question link into Questions, keeping the range and filters. */
const questionsHref = (v: View, extra: Record<string, string | undefined> = {}) =>
  href('/observability/questions', {
    range: v.range === 7 ? undefined : String(v.range),
    domain: v.domain,
    agent: v.agent,
    ...extra,
  })

export function OverviewPage() {
  const load = useQuery(observabilityPageQuery('overview'))
  const view = useObsView()
  return (
    <ObsPage section="overview">
      <Loadable
        query={load}
        what="the counts"
        skeleton={<ObsSkeleton section="overview" kpis={4} body="overview" />}
      >
        {view.state === 'empty' ? (
          <NothingConnected />
        ) : view.state === 'quiet' ? (
          <TooFew view={view} />
        ) : (
          <Overview view={view} />
        )}
      </Loadable>
    </ObsPage>
  )
}

function Head({
  view,
  children,
}: {
  view: ReturnType<typeof useObsView>
  children?: React.ReactNode
}) {
  const domains = useDomains()
  const domainLine =
    view.owned && view.domain
      ? `What agents asked about ${domains[view.domain]?.name} ${view.label}, and what they got.`
      : OBS_PURPOSE.overview
  // On a narrow page the filters take a row of their own under the title.
  return (
    <FrameSection
      title="Overview"
      description={domainLine}
      action={<div className="hidden @3xl/main:block">{<ObsControls view={view} />}</div>}
    >
      <div className="px-4 pb-4 md:px-5 @3xl/main:hidden">
        <ObsControls view={view} />
      </div>
      {children}
    </FrameSection>
  )
}

function Overview({ view }: { view: ReturnType<typeof useObsView> }) {
  const domains = useDomains()
  const obs = useObservability()
  const n = obs.numbersOf(view)
  const bars = obs.barsOf(view)
  const saved = savedCounts(useSavedQuestions(), view.domain)
  const topics = obs.topicsOf(view)
  // Top topics grouped as Questions groups them: metric and market by default, the month kept inside.
  const { query } = useRoute()
  const grouping: Grouping =
    query.get('group') === 'none' ? 'none' : query.get('group') === 'domain' ? 'domain' : 'metric'
  const top = topRows(obs, domains, topics, grouping)
  const unread = obs.couldNotRead(view)
  const pubs = obs.publishesIn(view)
  const marks = pubs
    .map((p) => ({
      index: bars.findIndex((b, i) => (b.at ?? 0) <= p.at && (bars[i + 1]?.at ?? Infinity) > p.at),
      title: p.title,
    }))
    .filter((m) => m.index >= 0)
  // Found nothing five or more times in 7 days, whatever the range, counted across a month edge.
  const nothing = obs.notFoundGroups(view)
  const before = view.range === 7 ? 'the 7 days before' : `the ${view.range} days before`
  return (
    <Frame>
      <Head view={view} />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        <Kpi
          icon={<MessageSquareIcon />}
          label="Asked"
          value={shownCount(n.asked)}
          change={n.asked >= HIDE_UNDER ? `${pct(n.askedChange)}%` : undefined}
          tone="up"
          sub={
            n.asked >= HIDE_UNDER
              ? `vs ${n.askedBefore.toLocaleString('en-GB')} ${before}`
              : undefined
          }
          href={questionsHref(view)}
        />
        <Kpi
          icon={<CircleCheckIcon />}
          label="Found checked context"
          value={`${n.foundShare}%`}
          change={n.foundChange ? `${pct(n.foundChange)} pts` : undefined}
          tone="up"
          sub={`${n.found.toLocaleString('en-GB')} of ${n.asked.toLocaleString('en-GB')}`}
          href={questionsHref(view, { answer: 'found' })}
        />
        <Kpi
          icon={<CircleDashedIcon />}
          label="Not found"
          value={shownCount(n.nothing)}
          // A count under 5 shows no change and no share either: they would give the number away.
          change={
            n.nothing < HIDE_UNDER
              ? undefined
              : n.nothingChange < 0
                ? `${-n.nothingChange} fewer`
                : n.nothingChange > 0
                  ? `${n.nothingChange} more`
                  : undefined
          }
          tone="warn"
          sub={n.nothing < HIDE_UNDER ? undefined : `${n.nothingShare}% of questions`}
          href={questionsHref(view, { answer: 'missing' })}
        />
        <Kpi
          icon={<ListChecksIcon />}
          label="Saved questions"
          value={saved.same}
          unit="same"
          sub={`of ${saved.total}`}
          href={href('/observability/quality', { domain: view.domain })}
        />
      </div>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-(--cols-split-19-10)">
        <FrameSection
          title={view.range === 90 ? 'Questions per week' : 'Questions per day'}
          description="What agents asked and how it was answered. A dashed line marks a publish."
        >
          <div className="flex flex-col gap-3 px-4 pb-4 md:px-5">
            <Legend />
            <StackedBars
              bars={bars}
              marks={marks}
              caption={`Questions per ${view.range === 90 ? 'week' : 'day'}, ${view.label}, by how they were answered`}
            />
          </div>
        </FrameSection>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
          <FrameSection
            title="Top topics"
            description="Asked most, with the share that was Not found."
            action={
              <span className="flex flex-wrap items-center gap-2">
                <GroupMenu value={grouping} />
                <a
                  href={questionsHref(view, {
                    group: grouping === 'metric' ? undefined : grouping,
                  })}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  <ArrowUpRightIcon data-icon="inline-start" />
                  All topics
                </a>
              </span>
            }
          >
            <div className="flex flex-col gap-3 px-4 pb-4 md:px-5">
              <BarRows
                caption="Top topics by questions asked"
                rows={top.slice(0, 8).map((g) => ({
                  key: g.key,
                  name: g.name,
                  label: g.name,
                  value: g.visible ?? g.shown,
                  display: groupCount(g),
                  hatch: g.total ? g.counts.missing / g.total : 0,
                  href: g.id
                    ? questionsHref(view, { dock: `topic.${g.id}` })
                    : questionsHref(view, { group: 'domain' }),
                }))}
              />
              <Legend states={['grounded', 'missing']} />
              {unread > 0 && (
                <p className="flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <CircleHelpIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium text-foreground">
                      Could not be read: {shownCount(unread)} calls.
                    </span>{' '}
                    No metric and no market from the definitions, so no topic. Counted, never the
                    words.
                  </span>
                </p>
              )}
            </div>
          </FrameSection>
        </div>
      </div>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-(--cols-split-19-10)">
        <FrameSection
          title="Asked, not found"
          description="Questions about the same thing, five or more times in 7 days."
          action={
            <a href="/inbox" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              <ArrowUpRightIcon data-icon="inline-start" />
              Open in Inbox
            </a>
          }
        >
          {nothing.length ? (
            <ul className="border-t">
              {nothing.map((t) => (
                <li
                  key={t.key}
                  className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 md:px-5"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                    <CircleDashedIcon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <a
                      href={questionsHref(view, { dock: `topic.${t.rows[0]!.id}` })}
                      className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {t.name}
                    </a>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      {t.domain && <DomainDot id={t.domain} />}
                      {t.domain ? domains[t.domain]?.name : 'No domain'} - asked {groupCount(t)}{' '}
                      times, not found {shownCount(t.counts.missing)}
                      {t.months.length > 1
                        ? `, across ${monthsLabel(t.months)}, counted together`
                        : ''}
                    </span>
                  </span>
                  {t.rows[0]!.gap && (
                    <a
                      href={t.rows[0]!.gap.href}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
                    >
                      <ArrowUpRightIcon data-icon="inline-start" />
                      {t.rows[0]!.gap.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t px-4 py-6 text-sm text-muted-foreground md:px-5">
              Nothing came up five times without an answer. Agents found something written down for
              every topic.
            </p>
          )}
        </FrameSection>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
          <FrameSection
            title="What changed"
            description="Each publish changes what agents get. Saved questions are checked against it."
          >
            <ul className="border-t">
              {(pubs.length ? pubs.slice(0, 2) : []).map((p) => (
                <li key={p.at} className="flex gap-3 border-b px-4 py-3 last:border-b-0 md:px-5">
                  <HistoryIcon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      Published {dateLabel(p.at)} by {p.by}. {p.checked}
                    </span>
                  </span>
                </li>
              ))}
              {!pubs.length && (
                <li className="px-4 py-4 text-sm text-muted-foreground md:px-5">
                  Nothing was published{view.domain ? ` in ${domains[view.domain]?.name}` : ''}{' '}
                  {view.label}.
                </li>
              )}
            </ul>
          </FrameSection>
          {!view.owned ? (
            <div className="border-t">
              <FrameSection title="By agent" description="Kind of agent, never a person.">
                <div className="px-4 pb-4 md:px-5">
                  <BarRows
                    quiet
                    caption="Questions by kind of agent"
                    rows={obs.agentsOf(view).map((a) => ({
                      key: a.name,
                      name: a.name,
                      label: a.name,
                      value: a.count,
                      display: shownCount(a.count),
                      onClick: () => setQuery({ agent: a.name }),
                    }))}
                  />
                </div>
              </FrameSection>
            </div>
          ) : (
            <p className="flex items-start gap-2 border-t px-4 py-4 text-sm text-muted-foreground md:px-5">
              <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              You see the domains you own. Usage and the agents list are for admins.
            </p>
          )}
        </div>
      </div>
    </Frame>
  )
}

/** Nothing connected: dashes, a ghost chart, and the three steps to the first question. */
function NothingConnected() {
  const obs = useObservability()
  const view = useObsView()
  const steps = [
    { done: true, title: 'Write what the business is about' },
    {
      done: false,
      title: 'Connect an agent',
      line: 'One prompt, and a live line that says when it is connected.',
      act: true,
    },
    { done: false, title: 'Ask it a question about your business' },
  ]
  return (
    <Frame>
      <Head view={view} />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        {[
          [<MessageSquareIcon key="i" />, 'Asked'],
          [<CircleCheckIcon key="i" />, 'Found checked context'],
          [<CircleDashedIcon key="i" />, 'Not found'],
          [<ListChecksIcon key="i" />, 'Saved questions'],
        ].map(([icon, label]) => (
          <Kpi
            key={label as string}
            icon={icon}
            label={label as string}
            value={<span className="text-muted-foreground">-</span>}
            sub="Nothing yet"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-(--cols-split-6-5)">
        <div aria-hidden className="px-4 py-6 opacity-50 md:px-5">
          <StackedBars
            bars={obs.barsOf({ range: 7 }).map((b) => ({
              ...b,
              counts: { grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 },
            }))}
            caption="No questions yet"
            height={160}
          />
        </div>
        <div className="border-t px-4 py-6 md:px-8 @4xl/main:border-t-0 @4xl/main:border-l">
          <div className="mb-1.5 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground">
              <BotIcon className="size-5" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">No agent has asked anything yet</h2>
          </div>
          <p className="mb-4 max-w-caption text-sm text-muted-foreground">
            Nothing is connected, so there is nothing to show. Once an agent asks, this page fills
            in with counts: what was asked about, and how it was answered.
          </p>
          <ol className="border">
            {steps.map((s) => (
              <li
                key={s.title}
                className="flex items-center gap-3 border-b px-3.5 py-2.5 last:border-b-0"
              >
                {s.done ? (
                  <CircleCheckIcon className="size-4 text-[var(--ok)]" aria-hidden />
                ) : (
                  <CircleDashedIcon className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 text-sm">
                  <span className={cn(s.done && 'text-muted-foreground')}>{s.title}</span>
                  {s.done && <span className="sr-only">, done</span>}
                  {s.line && <span className="block text-xs text-muted-foreground">{s.line}</span>}
                </span>
                {s.act && (
                  <Button size="sm" onClick={() => open('connect')}>
                    Connect an agent
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Frame>
  )
}

/** Fewer than 5 questions: no counts, because a small count could point to one person. */
function TooFew({ view }: { view: ReturnType<typeof useObsView> }) {
  return (
    <Frame>
      <Head view={view} />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        <Kpi
          icon={<MessageSquareIcon />}
          label="Asked"
          value={<span className="text-xl">Fewer than 5</span>}
          sub={view.label}
        />
        <Kpi
          icon={<CircleCheckIcon />}
          label="Found checked context"
          value="-"
          sub="counts under 5 are hidden"
        />
        <Kpi icon={<CircleDashedIcon />} label="Not found" value="-" />
        <Kpi icon={<ListChecksIcon />} label="Saved questions" value="0" sub="of 0" />
      </div>
      <Empty className="border-t py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EyeIcon />
          </EmptyMedia>
          <EmptyTitle>Too few questions to show</EmptyTitle>
          <EmptyDescription>
            Fewer than 5 questions {view.label}, so no counts are shown. A small count could point
            to one person.
          </EmptyDescription>
        </EmptyHeader>
        {view.range !== 30 && (
          <EmptyContent>
            <Button variant="outline" onClick={() => setQuery({ range: '30' })}>
              <CalendarIcon data-icon="inline-start" />
              Show 30 days
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </Frame>
  )
}

/** Top topics in a grouping: each exact scope with its month, metric and market (months joined), or a domain. */
function topRows(obs: Observability, domains: Domains, topics: TopicRow[], grouping: Grouping) {
  if (grouping === 'none')
    return topics.map((t) => ({ ...obs.rollUp([t])[0]!, name: obs.topicTitle(t), id: t.id }))
  const groups = obs.rollUp(topics).map((g) => ({ ...g, id: g.rows[0]!.id }))
  if (grouping === 'metric') return groups
  const by = new Map<string, typeof groups>()
  for (const g of groups) by.set(g.domain ?? '', [...(by.get(g.domain ?? '') ?? []), g])
  return [...by.entries()]
    .map(([d, gs]) => {
      const rows = gs.flatMap((g) => g.rows)
      const sum = rows.reduce((n, r) => n + total(r.counts), 0)
      const shown = rows.reduce(
        (n, r) => n + (total(r.counts) >= HIDE_UNDER ? total(r.counts) : 0),
        0,
      )
      const counts = gs.reduce(
        (c, g) => ({
          grounded: c.grounded + g.counts.grounded,
          partial: c.partial + g.counts.partial,
          conflict: c.conflict + g.counts.conflict,
          stale: c.stale + g.counts.stale,
          missing: c.missing + g.counts.missing,
        }),
        { grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 },
      )
      return {
        ...gs[0],
        key: d || 'none',
        name: d ? (domains[d]?.name ?? 'No domain') : 'No domain',
        rows,
        counts,
        total: sum,
        shown,
        visible: visibleTotal(sum, shown),
        id: undefined,
      }
    })
    .sort((a, b) => (b.visible ?? b.shown) - (a.visible ?? a.shown))
}

/** The Top topics grouping, kept in the address with Questions' own. */
function GroupMenu({ value }: { value: Grouping }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5 font-normal" />}
      >
        <LayersIcon data-icon="inline-start" />
        <span className="sr-only">Group: </span>
        {GROUPINGS[value]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group topics by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => setQuery({ group: v === 'metric' ? undefined : (v as string) })}
          >
            {(Object.keys(GROUPINGS) as Grouping[]).map((g) => (
              <DropdownMenuRadioItem key={g} value={g}>
                {GROUPINGS[g]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
