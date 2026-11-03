import * as React from 'react'
import { useSavedViews, useSavedQuestions, useWrite } from '@/api/queries'
import { toast } from 'sonner'
import {
  BotIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  ListChecksIcon,
  MessageSquareIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { BarSpacer, ListBar, SearchField, SortMenu } from '@/components/heed/list'
import { CountUp } from '@/components/heed/count-up'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { Legend, StackedBars } from '@/components/obs/charts'
import { Kpi, kpiChange, moreOrFewer, RangeSwitch } from '@/components/obs/controls'
import { TopicTable } from '@/components/obs/topic-table'
import {
  FilterChips,
  FilterMenu,
  GroupMenu,
  MonthMenu,
  SaveView,
  ViewSwitch,
  cleared,
  viewCount,
} from '@/components/obs/topic-filters'
import {
  dayLabel,
  groupCount,
  HIDE_UNDER,
  share,
  SHOWN,
  shownCount,
  TOPIC_SORTS,
  type Count,
  type Grouping,
  type Shown,
  type Sort,
  type Topic,
  type TopicGroup,
} from '@/model/observability'
import { savedCounts } from '@/model/saved-questions'
import { openDock, useDock } from '@/lib/dock'
import { open } from '@/lib/events'
import { matches, usePublishOrder, useRowKeys } from '@/lib/list'
import {
  OBS_PURPOSE,
  ObsDrawn,
  obsPageInput,
  useObsAddress,
  useObservability,
  useObsPageQuery,
  useObsView,
  type ObsView,
} from '@/lib/obs'
import {
  BUILT_IN,
  filtersFrom,
  filtersTo,
  narrowed,
  passes,
  sentence,
  type Filters,
} from '@/lib/obs-views'
import { href, setQuery, useRoute } from '@/lib/router'
import { clicked, sortingFrom, sortingTo, type Sorting } from '@/lib/sort'
import { useDomains } from '@/lib/workspace'
import { ObsPage } from '@/pages/observability'

// Overview: what agents asked and what they got, in one view over one state in the address. The
// numbers, the questions per day and the topics all follow the same range, domain, kind of agent,
// view and filters: the domain and the agent narrow the read itself, every other filter narrows
// the topics, and the numbers then add up what those topics may show ("83+"). A row opens the
// answer panel, a replay of what an agent gets for it. Questions' old address opens it at the
// topics. Never the words of a question, never who asked.

const pct = (n: number) => `${n > 0 ? '+' : ''}${n}`

/** The share of answers that were Checked: never one with a warning, never one that found nothing. */
const CHECKED = 'Checked answers'
/** What a hidden headline count says: true whether it is small itself or keeps a small one safe. */
const HIDDEN = 'hidden: under 5, or it would give one under 5 away'

export function OverviewPage({ topicsFirst }: { topicsFirst?: boolean }) {
  // Another range, domain or agent keeps this view until the next has loaded: the numbers count
  // to the new ones and the bars move, instead of a skeleton.
  const load = useObsPageQuery('overview', true)
  const input = obsPageInput('overview', useObsAddress())
  const [drawn, setDrawn] = React.useState(input)
  if (load.data && !load.isPlaceholderData && JSON.stringify(drawn) !== JSON.stringify(input))
    setDrawn(input)
  return (
    <ObsPage section="overview">
      <Loadable
        query={load}
        what="the counts"
        skeleton={<ObsSkeleton section="overview" kpis={4} body="overview" />}
      >
        <ObsDrawn.Provider value={drawn}>
          <OverviewOf topicsFirst={!!topicsFirst} busy={load.isPlaceholderData} />
        </ObsDrawn.Provider>
      </Loadable>
    </ObsPage>
  )
}

/** The page for what its data says: nothing asked yet, too few to count, or the counts. */
function OverviewOf({ topicsFirst, busy }: { topicsFirst: boolean; busy: boolean }) {
  const view = useObsView()
  if (view.state === 'empty') return <NothingConnected />
  if (view.state === 'quiet') return <TooFew view={view} />
  return <Explorer view={view} topicsFirst={topicsFirst} busy={busy} />
}

function Head({ view }: { view: ObsView }) {
  const domains = useDomains()
  // An owner reads their own domains: the line says so, as the Filter menu has no domain for them.
  const domainLine =
    view.owned && view.domain
      ? `What agents asked about ${domains[view.domain]?.name} ${view.label}, and what they got, by topic. You see the domains you own.`
      : OBS_PURPOSE.overview
  return (
    <FrameSection
      title="Overview"
      description={domainLine}
      action={<RangeSwitch value={view.range} />}
    />
  )
}

function Explorer({
  view,
  topicsFirst,
  busy,
}: {
  view: ObsView
  topicsFirst: boolean
  busy: boolean
}) {
  const domains = useDomains()
  const write = useWrite()
  const obs = useObservability()
  const { query } = useRoute()
  const dock = useDock()
  const saved = useSavedViews()
  const [text, setText] = React.useState('')
  const filters = filtersFrom(query)
  // An owner sees their own domains only.
  if (view.owned && (!filters.domain || !view.owned.includes(filters.domain)))
    filters.domain = view.domain
  if (view.owned) delete filters.agent
  const viewId = query.get('view') ?? 'all'
  const sorting = sortingFrom(TOPIC_SORTS, query, 'asked')
  const sortBy = (s: Sorting<Sort>) => setQuery(sortingTo(TOPIC_SORTS, s, 'asked'))
  // Grouping only joins rows for reading; the key under it stays the exact scope with its month.
  const group: Grouping =
    query.get('group') === 'none' ? 'none' : query.get('group') === 'domain' ? 'domain' : 'metric'
  const custom = saved.find((v) => v.id === viewId)
  const builtIn = BUILT_IN.find((v) => v.id === viewId) ?? (custom ? undefined : BUILT_IN[0])
  const set = (f: Filters) => setQuery(filtersTo(f))
  // What narrows the topics: a saved view's own filters, with those in the address over them.
  const on = custom ? { ...custom.filters, ...filters } : filters

  const all = obs.data.topics
  const rows = all.filter(
    (t) => (builtIn ? builtIn.has(t) : true) && passes(t, on) && matches(text, obs.topicName(t)),
  )
  usePublishOrder(
    'obs-topics',
    obs.rowOrder(rows, group, sorting).map((t) => t.id),
  )
  const peeked = dock?.kind === 'topic' ? dock.id : undefined
  const onKeyDown = useRowKeys({
    onMove: (id) => peeked && openDock('topic', id),
    onEscape: () => !!peeked,
  })
  const said = sentence(filters, domains)
  const chosen = custom ? custom.id : (builtIn?.id ?? 'all')
  const narrow = narrowed(on, chosen, text)
  // The chart counts questions, so it follows the answer filter; it cannot follow what narrows
  // topics alone (a built-in view, the Inbox, the month, a search), and says so.
  const behind =
    (!!builtIn && builtIn.id !== 'all') || !!on.gap?.length || !!on.month || !!text.trim()
  const totals = obs.selection(rows)
  const topics = group === 'none' ? rows.length : obs.rollUp(rows).length
  // Calls that could not be read have no topic, so they show only when nothing narrows the list.
  const unread = !narrow ? obs.data.couldNotRead : 0

  // Opened from Questions' old address or on a topic: the topics are what it was opened for.
  const topicsAt = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!topicsFirst && !peeked) return
    let gone = false
    // Once the font is in, so the lines above have their final height; the page's own scroller
    // moves, never the shell around it.
    void document.fonts.ready.then(() => {
      const at = topicsAt.current
      const scroller = at?.closest<HTMLElement>('[data-slot=page-scroll]')
      if (gone || !at || !scroller) return
      scroller.scrollTop += at.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })
    return () => {
      gone = true
    }
    // Only on arriving: a topic opened later leaves the page where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const views = [...BUILT_IN, ...saved].map((v) => ({
    id: v.id,
    name: v.name,
    count:
      'has' in v
        ? viewCount(all, v.has as (t: Topic) => boolean, filters)
        : all.filter((t) => passes(t, v.filters)).length,
  }))

  return (
    <Frame aria-busy={busy || undefined}>
      <Head view={view} />
      <div className="flex min-h-10 flex-wrap items-center gap-x-2 border-t px-4 py-1 md:px-5">
        <ViewSwitch
          views={views}
          value={chosen}
          onChange={(id) => {
            const v = saved.find((x) => x.id === id)
            setQuery({ view: id === 'all' ? undefined : id, ...(v ? filtersTo(v.filters) : {}) })
          }}
          onRemove={
            custom
              ? () => {
                  void write('removeView', { id: custom.id })
                  setQuery({ view: undefined })
                  toast(`Removed the view ${custom.name}`)
                }
              : undefined
          }
        />
        <span className="ml-auto">
          <SaveView filters={filters} disabled={!said.length} />
        </span>
      </div>
      <div className="border-t">
        <ListBar>
          <FilterMenu filters={filters} set={set} view={view} />
          <MonthMenu filters={filters} set={set} />
          <BarSpacer>
            <SearchField value={text} onChange={setText} placeholder="Search topics" />
          </BarSpacer>
        </ListBar>
      </div>
      <FilterChips filters={filters} set={set} view={view} />
      <Numbers view={view} narrow={narrow} totals={totals} topics={topics} />
      <Chart view={view} answer={on.answer} behind={behind} />
      <div ref={topicsAt}>
        <FrameSection
          title="Topics"
          description="Each is a metric, a market and the month asked about, grouped here for reading."
          action={
            <span className="flex flex-wrap items-center gap-1">
              <SortMenu keys={TOPIC_SORTS} sorting={sorting} onSort={sortBy} className="w-52" />
              <GroupMenu value={group} />
            </span>
          }
        />
      </div>
      <TopicTable
        rows={rows}
        grouping={group}
        sorting={sorting}
        onSort={(k) => sortBy(clicked(TOPIC_SORTS, sorting, k))}
        view={view}
        peeked={peeked}
        unread={unread}
        onKeyDown={onKeyDown}
        empty={
          <>
            <p className="font-medium">No topics match</p>
            <p className="mt-1 text-muted-foreground">
              {[text && `Searching for “${text}”`, ...said].filter(Boolean).join(', ') ||
                'Nothing in this view.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => (
                setText(''),
                setQuery({ ...filtersTo(cleared(view)), view: undefined })
              )}
            >
              Clear search and filters
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5 text-xs text-muted-foreground md:px-5">
        <span>
          {topics} {topics === 1 ? 'topic' : 'topics'} -{' '}
          {rows.length ? groupCount(totals.asked) : 0} calls{' '}
          {view.label === 'this week' ? 'in 7 days' : `in ${view.range} days`}. A count under 5
          shows as “fewer than 5”.
        </span>
        <Legend />
      </div>
    </Frame>
  )
}

/** A count as a number cell says it: counting to its new value, "13+", "Fewer than 5" or "-". */
function Figure({ count, plus, suffix }: { count: Count; plus?: boolean; suffix?: string }) {
  if (count === null) return '-'
  if (count > 0 && count < HIDE_UNDER && !suffix)
    return <span className="text-base">{shownCount(count)}</span>
  return <CountUp value={count} suffix={plus ? '+' : suffix} />
}

/**
 * A sum as a number cell says it: the total, or what its shown parts add up to, "13+". Nothing
 * shown is "Fewer than 5" for what was asked, as the table says it, and "-" for an answer state,
 * which may be hidden to keep another count safe.
 */
const sumFigure = (g: Pick<TopicGroup, 'visible' | 'shown'>, state?: boolean) =>
  g.visible !== null ? (
    <Figure count={g.visible} />
  ) : g.shown > 0 ? (
    <Figure count={g.shown} plus />
  ) : state ? (
    '-'
  ) : (
    <span className="text-base">Fewer than 5</span>
  )

/**
 * Four numbers, each a way into its topics: the view's own, with how they moved, when nothing
 * narrows the topics; else what the topics in view add up to, from what they may show.
 */
function Numbers({
  view,
  narrow,
  totals,
  topics,
}: {
  view: ObsView
  narrow: boolean
  totals: ReturnType<ReturnType<typeof useObservability>['selection']>
  topics: number
}) {
  const obs = useObservability()
  const { query, path } = useRoute()
  const n = obs.numbers()
  const saved = savedCounts(useSavedQuestions(), view.domain)
  const before = obs.data.range === 7 ? 'the 7 days before' : `the ${obs.data.range} days before`
  // A number narrows the topics to its answers, here.
  const drill = (answer: string) => {
    const q = Object.fromEntries(query)
    return href(path, { ...q, answer, dock: undefined })
  }
  const inTopics = `in ${topics} ${topics === 1 ? 'topic' : 'topics'}`
  const checkedShare = narrow ? share(totals.checked.visible, totals.asked.visible) : null
  const nothingShare = narrow ? share(totals.nothing.visible, totals.asked.visible) : null
  return (
    <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
      {narrow ? (
        <>
          <Kpi
            icon={<MessageSquareIcon />}
            label="Asked"
            value={sumFigure(totals.asked)}
            sub={inTopics}
          />
          <Kpi
            icon={<CircleCheckIcon />}
            label={CHECKED}
            value={
              checkedShare !== null ? (
                <CountUp value={checkedShare} suffix="%" />
              ) : (
                sumFigure(totals.checked, true)
              )
            }
            sub={
              totals.checked.visible === null && !totals.checked.shown
                ? HIDDEN
                : `${groupCount(totals.checked)} of ${groupCount(totals.asked).toLowerCase()} asked`
            }
            href={drill('grounded')}
          />
          <Kpi
            icon={<CircleDashedIcon />}
            label="Not found"
            value={sumFigure(totals.nothing, true)}
            sub={
              totals.nothing.visible === null && !totals.nothing.shown
                ? HIDDEN
                : nothingShare !== null
                  ? `${nothingShare}% of questions`
                  : inTopics
            }
            href={drill('missing')}
          />
        </>
      ) : (
        <>
          <Kpi
            icon={<MessageSquareIcon />}
            label="Asked"
            value={<Figure count={n.asked} />}
            // More questions is neither good nor bad: an arrow, never a colour.
            change={kpiChange(n.askedChange, (c) =>
              n.askedChange?.percent != null ? `${pct(n.askedChange.percent)}%` : moreOrFewer(c),
            )}
            sub={
              n.asked === null
                ? 'hidden: it would give a count under 5 away'
                : n.askedBefore !== null
                  ? `vs ${n.askedBefore.toLocaleString('en-GB')} ${before}`
                  : undefined
            }
          />
          <Kpi
            icon={<CircleCheckIcon />}
            label={CHECKED}
            value={<Figure count={n.checkedShare} suffix="%" />}
            change={kpiChange(n.checkedChange, (c) => `${pct(c.by)} pts`, 'up')}
            sub={
              n.checked !== null && n.asked !== null
                ? `${n.checked.toLocaleString('en-GB')} of ${n.asked.toLocaleString('en-GB')} asked`
                : HIDDEN
            }
            href={drill('grounded')}
          />
          <Kpi
            icon={<CircleDashedIcon />}
            label="Not found"
            // A hidden count may be under 5 or keep one under 5 safe, so it never says which.
            value={<Figure count={n.nothing} />}
            // A count under 5 shows no change and no share either: they would give the number away.
            change={kpiChange(n.nothingChange, (c) => `${pct(c.by)} pts`, 'down')}
            sub={
              n.nothing === null
                ? HIDDEN
                : n.nothing < HIDE_UNDER || n.nothingShare === null
                  ? undefined
                  : `${n.nothingShare}% of questions`
            }
            href={drill('missing')}
          />
        </>
      )}
      <Kpi
        icon={<ListChecksIcon />}
        label="Saved questions"
        value={<CountUp value={saved.same} />}
        unit="same"
        sub={`of ${saved.total}`}
        href={href('/observability/quality', { domain: view.domain })}
      />
    </div>
  )
}

/**
 * Questions per day (per week over 90 days), stacked by how they were answered, with a dashed line
 * at each publish. The answer filter keeps its states; what narrows topics alone it cannot follow,
 * as it counts questions, not topics, and then it says so.
 */
function Chart({ view, answer, behind }: { view: ObsView; answer?: Shown[]; behind: boolean }) {
  const obs = useObservability()
  const { bars, publishes, range } = obs.data
  const marks = publishes
    .map((p) => ({
      index: bars.findIndex((b, i) => (b.at ?? 0) <= p.at && (bars[i + 1]?.at ?? Infinity) > p.at),
      title: p.title,
    }))
    .filter((m) => m.index >= 0)
  const states = answer?.length ? SHOWN.filter((s) => answer.includes(s)) : SHOWN
  const per = range === 90 ? 'week' : 'day'
  return (
    <FrameSection
      title={`Questions per ${per}`}
      description={
        behind
          ? 'Every question asked, as the chart counts questions, not topics. The numbers and the topics follow the view, the filters and the search.'
          : 'What agents asked and how it was answered. A dashed line marks a publish.'
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4 md:px-5">
        <Legend states={states} />
        <StackedBars
          bars={bars}
          marks={marks}
          states={states}
          caption={`Questions per ${per}, ${view.label}, by how they were answered`}
        />
      </div>
    </FrameSection>
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
          [<CircleCheckIcon key="i" />, CHECKED],
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
            bars={Array.from({ length: 7 }, (_, i) => {
              const at = obs.data.last - (6 - i) * 86_400_000
              return {
                label: dayLabel(at),
                at,
                counts: { grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 },
              }
            })}
            caption="No questions yet"
            height={160}
          />
        </div>
        <div className="border-t px-4 py-6 md:px-8 @4xl/main:border-t-0 @4xl/main:border-l">
          <div className="mb-1.5 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground">
              <BotIcon className="size-5" aria-hidden />
            </span>
            <h2 className="text-base font-semibold">No agent has asked anything yet</h2>
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
function TooFew({ view }: { view: ObsView }) {
  return (
    <Frame>
      <Head view={view} />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        <Kpi
          icon={<MessageSquareIcon />}
          label="Asked"
          value={<span className="text-base">Fewer than 5</span>}
          sub={view.label}
        />
        <Kpi icon={<CircleCheckIcon />} label={CHECKED} value="-" sub="counts under 5 are hidden" />
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
