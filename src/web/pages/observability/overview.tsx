import * as React from 'react'
import { flushSync } from 'react-dom'
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
import { SortMenu } from '@/components/heed/list'
import { CountUp } from '@/components/heed/count-up'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { Legend, StackedBars } from '@/components/obs/charts'
import { Kpi, kpiChange, moreOrFewer, RangeSwitch } from '@/components/obs/controls'
import { TopicTable } from '@/components/obs/topic-table'
import { FilterBar, type Field } from '@/components/obs/filter-bar'
import { FacetRail, FacetSheet } from '@/components/obs/facet-rail'
import { GroupMenu, SaveView, ViewSwitch, cleared, viewCount } from '@/components/obs/topic-filters'
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
  type Observability,
  type Shown,
  type Sort,
  type Topic,
  type TopicGroup,
} from '@/model/observability'
import { savedCounts } from '@/model/saved-questions'
import { openDock, useDock } from '@/lib/dock'
import { open } from '@/lib/events'
import { usePublishOrder, useRowKeys } from '@/lib/list'
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
import type { DomainId } from '@/model/items'
import {
  BUILT_IN,
  chipOf,
  chipsFrom,
  chipsTo,
  facet,
  facetSize,
  narrowed,
  passes,
  readDomain,
  sentence,
  valueOf,
  valueWords,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'
import { changeQuery, href, setQuery, useRoute } from '@/lib/router'
import { clicked, sortingFrom, sortingTo, type Sorting } from '@/lib/sort'
import { useDomainList, useDomains, useMe } from '@/lib/workspace'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useWide } from '@/hooks/use-wide'
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
  const domainList = useDomainList()
  const write = useWrite()
  const obs = useObservability()
  const me = useMe()
  const { query } = useRoute()
  const dock = useDock()
  const saved = useSavedViews()
  const reduced = useReducedMotion()
  const chips = chipsFrom(query)
  // An owner reads their own domains, one at a time: their domain is no chip, as they can't take
  // it off. A kind of agent is for admins.
  const own = view.owned && view.domain ? view.domain : undefined
  const shown = chips.filter(
    (c) => !(own && c.key === 'domain') && !(view.owned && c.key === 'agent'),
  )
  const on: Filters = own ? [{ key: 'domain', values: [own] }, ...shown] : shown
  const viewId = query.get('view') ?? 'all'
  const sorting = sortingFrom(TOPIC_SORTS, query, 'asked')
  const sortBy = (s: Sorting<Sort>) => setQuery(sortingTo(TOPIC_SORTS, s, 'asked'))
  // Grouping only joins rows for reading; the key under it stays the exact scope with its month.
  const group: Grouping =
    query.get('group') === 'none' ? 'none' : query.get('group') === 'domain' ? 'domain' : 'metric'
  const custom = saved.find((v) => v.id === viewId)
  const builtIn = BUILT_IN.find((v) => v.id === viewId) ?? (custom ? undefined : BUILT_IN[0])
  const chosen = custom ? custom.id : (builtIn?.id ?? 'all')
  const inView = (t: Topic) => (builtIn ? builtIn.has(t) : true)

  // A change of the filters is a step in the address, so Back undoes it. The topics and the chips
  // move to their new places while the numbers count (one view transition, none with reduced
  // motion); a chip moved by its keys moves at once, as the keyboard's tier is instant.
  const set = (next: Filters, opts?: { instant?: boolean }) => {
    const keep = own ? next.filter((c) => c.key !== 'domain') : next
    const domain = own
      ? (chipOf(next, 'domain') ?? { key: 'domain' as const, values: [own] })
      : null
    moveTo(chipsTo(domain ? [domain, ...keep] : keep), reduced || !!opts?.instant)
  }

  const all = obs.data.topics
  const rows = all.filter((t) => inView(t) && passes(t, on, obs.topicName))
  usePublishOrder(
    'obs-topics',
    obs.rowOrder(rows, group, sorting).map((t) => t.id),
  )
  const peeked = dock?.kind === 'topic' ? dock.id : undefined
  const onKeyDown = useRowKeys({
    onMove: (id) => peeked && openDock('topic', id),
    onEscape: () => !!peeked,
  })
  const said = sentence(shown, domains)
  const narrow = narrowed(on, chosen)
  // The chart counts questions, so it follows the answer filter and the domain and kind of agent
  // the service reads; what narrows topics alone (a view, a market, a month, a topic's words) it
  // cannot follow, and says so.
  const behind =
    chosen !== 'all' ||
    on.some(
      (c) => c.key !== 'answer' && c.key !== 'agent' && !(c.key === 'domain' && readDomain(on)),
    )
  const answer = chipOf(on, 'answer')
  const states = answer
    ? SHOWN.filter((s) => answer.values.includes(s) !== !!answer.not)
    : undefined
  const totals = obs.selection(rows)
  const topics = group === 'none' ? rows.length : obs.rollUp(rows).length
  // Calls that could not be read have no topic, so they show only when nothing narrows the list.
  const unread = !narrow ? obs.data.couldNotRead : 0

  const { fields, facets } = useFacets(obs, domainList, me.admin, on, chosen, view.owned)
  const words = (key: FilterKey, v: string) => valueWords(key, v, domains)
  const facetOf = (key: FilterKey) => facets.get(key) ?? []

  // The facets sit beside the topics where there is room for them, and the device remembers
  // whether they are shown; on a narrow page they open in a sheet.
  const [setBody, wide] = useWide<HTMLDivElement>(FACETS_FROM)
  const [facetsOn, setFacetsOn] = React.useState(() => readFacets())
  const [sheet, setSheet] = React.useState(false)
  const rail = wide && facetsOn
  const toggleFacets = () => {
    if (!wide) return setSheet(true)
    setFacetsOn(!facetsOn)
    writeFacets(!facetsOn)
  }
  const facetProps = {
    chips: on,
    onChange: (next: Filters) => set(next),
    fields,
    facet: facetOf,
    words,
  }

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
        ? viewCount(all, v.has as (t: Topic) => boolean, on, obs.topicName)
        : all.filter((t) => passes(t, v.filters, obs.topicName)).length,
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
            setQuery({ view: id === 'all' ? undefined : id, ...(v ? chipsTo(v.filters) : {}) })
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
          <SaveView filters={on} said={said} disabled={!said.length} />
        </span>
      </div>
      <FilterBar
        chips={shown}
        onChange={(next, _said, instant) => set(next, { instant })}
        fields={fields}
        facet={facetOf}
        words={words}
        facets={{ on: rail, toggle: toggleFacets, sheet: !wide }}
      />
      <div
        ref={setBody}
        className={cn(
          'grid border-t transition-[grid-template-columns] duration-(--dur-3) ease-panel',
          !wide
            ? 'grid-cols-1'
            : rail
              ? 'grid-cols-(--cols-facets)'
              : 'grid-cols-(--cols-facets-shut)',
        )}
      >
        {wide && <FacetRail {...facetProps} folded={!rail} />}
        {/* The topics measure the room beside the facets, not the page's. */}
        <div className="@container/main min-w-0">
          <Numbers view={view} narrow={narrow} totals={totals} topics={topics} />
          <Chart view={view} answer={states} behind={behind} />
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
                  {said.join(', ') || 'Nothing in this view.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => set(cleared(view))}
                >
                  Clear the filters
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
        </div>
      </div>
      {!wide && <FacetSheet open={sheet} onOpenChange={setSheet} {...facetProps} />}
    </Frame>
  )
}

/** The view transition of a change of the filters, while it runs. */
let moving: ViewTransition | null = null

/**
 * A change of the filters, as a step in the address. Unless it is instant, the topic rows and the
 * chips move to their new places in one view transition while the numbers count under them. The
 * page stops drawing while a transition takes its pictures, so it waits for the new address a
 * short while at most, and a change made while one runs is made at once.
 */
function moveTo(changes: Record<string, string | undefined>, instant: boolean) {
  if (instant || moving || !document.startViewTransition) return void changeQuery(changes)
  const root = document.documentElement
  root.dataset.vt = 'filters'
  const t = document.startViewTransition(async () => {
    await Promise.race([changeQuery(changes), new Promise((done) => setTimeout(done, DRAWN_IN))])
    flushSync(() => {})
  })
  moving = t
  void t.finished.finally(() => {
    if (moving !== t) return
    moving = null
    delete root.dataset.vt
  })
}
/** How long a transition waits for the new address to be drawn, in ms. */
const DRAWN_IN = 200

/** The fields the bar and the facets offer, each with its values in the order they list. */
function fieldsOf(
  obs: Observability,
  domains: { id: DomainId; sandbox?: boolean }[],
  admin: boolean,
  owned: DomainId[] | null,
): Field[] {
  const topics = obs.data.topics
  const of = (key: FilterKey) =>
    [...new Set(topics.map((t) => valueOf(t, key)).filter((v): v is string => !!v))].sort((a, b) =>
      a.localeCompare(b),
    )
  return [
    { key: 'answer', values: [...SHOWN] },
    // An admin filters on every domain; an owner of more than one picks one of their own.
    ...(!owned
      ? [{ key: 'domain' as const, values: domains.filter((d) => !d.sandbox).map((d) => d.id) }]
      : owned.length > 1
        ? [{ key: 'domain' as const, values: owned, one: true }]
        : []),
    ...(admin
      ? [{ key: 'agent' as const, values: obs.data.agents.map((a) => a.name), one: true }]
      : []),
    { key: 'market', values: of('market') },
    { key: 'metric', values: of('metric') },
    { key: 'month', values: obs.topicMonths() },
    { key: 'gap', values: ['draft', 'suggestion', 'none'] },
    { key: 'reported', values: ['yes', 'no'] },
  ]
}

/**
 * The fields the bar and the facets offer, each with its values in order and what they count:
 * worked out once per change of the data, the filters, the view or an owner's domains.
 */
function useFacets(
  obs: Observability,
  domains: { id: DomainId; sandbox?: boolean }[],
  admin: boolean,
  chips: Filters,
  chosen: string,
  owned: DomainId[] | null,
) {
  const signature = JSON.stringify([chips, chosen, owned])
  return React.useMemo(
    () => facetsOf(obs, domains, admin, signature),
    [obs, domains, admin, signature],
  )
}

/** The fields and their values' counts, for the chips, the view and the domains in `signature`. */
function facetsOf(
  obs: Observability,
  domains: { id: DomainId; sandbox?: boolean }[],
  admin: boolean,
  signature: string,
) {
  const [chips, chosen, owned] = JSON.parse(signature) as [Filters, string, DomainId[] | null]
  const fields = fieldsOf(obs, domains, admin, owned)
  const view = BUILT_IN.find((v) => v.id === chosen)
  const inView = (t: Topic) => (view ? view.has(t) : true)
  const values = (k: FilterKey) => fields.find((f) => f.key === k)?.values ?? []
  const facets = new Map(
    fields.map((f) => {
      const list = facet(f.key, { obs, chips, inView, all: chosen === 'all', values })
      // The busiest first, where the values have no order of their own.
      if (f.key === 'domain' || f.key === 'market' || f.key === 'metric')
        list.sort((a, b) => facetSize(b.count) - facetSize(a.count) || b.topics - a.topics)
      return [f.key, list] as const
    }),
  )
  return { fields, facets }
}

/** The facets beside the topics from this width of the frame; under it they open in a sheet. */
const FACETS_FROM = 896
const FACETS_KEY = 'heed.obs.facets'
const readFacets = () => {
  try {
    return localStorage.getItem(FACETS_KEY) !== 'off'
  } catch {
    return true
  }
}
const writeFacets = (on: boolean) => {
  try {
    localStorage.setItem(FACETS_KEY, on ? 'on' : 'off')
  } catch {
    // A browser that keeps nothing shows the facets each time.
  }
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
    <div className="grid grid-cols-2 gap-px bg-border @3xl/main:grid-cols-4">
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
          ? 'Every question asked, as the chart counts questions, not topics. The numbers and the topics follow the view and the filters.'
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
