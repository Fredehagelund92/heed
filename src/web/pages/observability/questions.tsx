import * as React from 'react'
import { useSavedViews, useWrite } from '@/api/queries'
import { useObservability, useObsPageQuery } from '@/lib/obs'
import {
  BookmarkIcon,
  BotIcon,
  CalendarIcon,
  FlagIcon,
  LayersIcon,
  ListFilterIcon,
  XIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Frame, FrameSection } from '@/components/heed/frame'
import { Loadable } from '@/components/heed/load-state'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { barButton, SearchField, SortMenu } from '@/components/heed/list'
import { Legend, Swatch } from '@/components/obs/charts'
import { RangeSwitch } from '@/components/obs/controls'
import {
  GROUPINGS,
  monthName,
  monthShort,
  groupCount,
  RANGES,
  SHOWN,
  STATE_WORDS,
  TOPIC_SORTS,
  type Grouping,
  type Shown,
  type Sort,
} from '@/model/observability'
import { TopicTable } from '@/components/obs/topic-table'
import type { DomainId } from '@/model/items'
import { openDock, useDock } from '@/lib/dock'
import { matches, usePublishOrder, useRowKeys } from '@/lib/list'
import { useObsView } from '@/lib/obs'
import {
  BUILT_IN,
  GAP_WORDS,
  filtersFrom,
  filtersTo,
  gapOf,
  passes,
  sentence,
  type Filters,
  type Gap,
} from '@/lib/obs-views'
import { setQuery, useRoute } from '@/lib/router'
import { clicked, sortingFrom, sortingTo, type Sorting } from '@/lib/sort'
import { useDomainList, useDomains } from '@/lib/workspace'
import { ObsPage } from '@/pages/observability'

// Questions: what agents asked about, grouped by the same thing (a metric, a market, dates), never
// the words, never who asked. Saved views along the top belong to the workspace; the filters read
// back as a sentence; a row opens the answer panel, a replay of what an agent gets for it.

const toggle = <T,>(list: T[] | undefined, v: T) => {
  const l = list ?? []
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v]
}

export function QuestionsPage() {
  const load = useObsPageQuery('questions')
  return (
    <ObsPage section="questions">
      <Loadable
        query={load}
        what="the questions"
        skeleton={<ObsSkeleton section="questions" body="table" />}
      >
        <Questions />
      </Loadable>
    </ObsPage>
  )
}

function Questions() {
  const domains = useDomains()
  const write = useWrite()
  const obs = useObservability()
  const view = useObsView()
  const { query } = useRoute()
  const dock = useDock()
  const saved = useSavedViews()
  const [text, setText] = React.useState('')
  const filters = filtersFrom(query)
  // An owner sees their own domains only.
  if (view.owned && (!filters.domain || !view.owned.includes(filters.domain)))
    filters.domain = view.domain
  const viewId = query.get('view') ?? 'all'
  const sorting = sortingFrom(TOPIC_SORTS, query, 'asked')
  const sortBy = (s: Sorting<Sort>) => setQuery(sortingTo(TOPIC_SORTS, s, 'asked'))
  // Grouping only joins rows for reading; the key under it stays the exact scope with its month.
  const group: Grouping =
    query.get('group') === 'none' ? 'none' : query.get('group') === 'domain' ? 'domain' : 'metric'
  const custom = saved.find((v) => v.id === viewId)
  const builtIn = BUILT_IN.find((v) => v.id === viewId) ?? (custom ? undefined : BUILT_IN[0])
  const set = (f: Filters) => setQuery(filtersTo(f))

  const all = view.state === 'empty' || view.state === 'quiet' ? [] : obs.data.topics
  const inView = all.filter(
    (t) =>
      (builtIn ? builtIn.has(t) : true) &&
      passes(t, custom ? { ...custom.filters, ...filters } : filters) &&
      matches(text, obs.topicName(t)),
  )
  const rows = inView
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
  // What the rows add up to: the domains' own counts when every topic of a domain is here.
  const byDomain = [...new Set(rows.map((t) => t.domain))].map((d) =>
    obs.domainGroup(
      d,
      rows.filter((t) => t.domain === d),
    ),
  )
  const asked = groupCount({
    visible: byDomain.every((g) => g.visible !== null)
      ? byDomain.reduce((n, g) => n + g.visible!, 0)
      : null,
    shown: byDomain.reduce((n, g) => n + (g.visible ?? g.shown), 0),
  })
  const topics = group === 'none' ? rows.length : obs.rollUp(rows).length
  // Calls that could not be read have no topic, so they show only when nothing narrows the list.
  const unread =
    !said.length && !text && (builtIn?.id ?? 'all') === 'all' && !custom ? obs.data.couldNotRead : 0
  const viewCount = (has: (t: (typeof all)[number]) => boolean) =>
    all.filter((t) => has(t) && passes(t, { domain: filters.domain })).length

  return (
    <Frame>
      <FrameSection
        title="Questions"
        description="What agents asked about: each topic is a metric, a market and the month asked about, grouped here for reading. Never the words, never who asked."
        action={<RangeSwitch value={view.range} />}
      />
      {/* Saved views: the workspace's, as tabs. */}
      <div className="flex flex-wrap items-center gap-x-1 border-t px-3 md:px-4">
        <div
          role="tablist"
          aria-label="Saved views"
          className="flex flex-wrap items-center gap-x-1"
        >
          {[...BUILT_IN, ...saved].map((v) => {
            const on = v.id === (custom ? custom.id : (builtIn?.id ?? 'all'))
            const n =
              'has' in v
                ? viewCount(v.has as never)
                : all.filter((t) => passes(t, v.filters)).length
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() =>
                  setQuery({
                    view: v.id === 'all' ? undefined : v.id,
                    ...(v.custom ? filtersTo(v.filters) : {}),
                  })
                }
                className={cn(
                  '-mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent px-2 text-dense whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                  on && 'border-foreground font-medium text-foreground',
                )}
              >
                {v.name}
                <span className="text-xs tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>
        {/* A saved view can be taken off the tabs by anyone, as it belongs to the workspace. */}
        {custom && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove the view ${custom.name}`}
            className="text-muted-foreground"
            onClick={() => {
              void write('removeView', { id: custom.id })
              setQuery({ view: undefined })
              toast(`Removed the view ${custom.name}`)
            }}
          >
            <XIcon />
          </Button>
        )}
        <span className="ml-auto">
          <SaveView filters={filters} disabled={!said.length} />
        </span>
      </div>
      {/* The bar: Filter, Sort, Group, search. */}
      <div className="flex flex-wrap items-center gap-1 border-t px-4 py-1.5 md:px-5">
        <FilterMenu filters={filters} set={set} owned={view.owned} />
        <SortMenu keys={TOPIC_SORTS} sorting={sorting} onSort={sortBy} className="w-52" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={cn(barButton, group !== 'none' && 'bg-muted text-foreground')}
              />
            }
          >
            <LayersIcon />
            Group <span className="text-foreground">{GROUPINGS[group]}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group topics by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={group}
                onValueChange={(v) =>
                  setQuery({ group: v === 'metric' ? undefined : (v as string) })
                }
              >
                {(Object.keys(GROUPINGS) as Grouping[]).map((g) => (
                  <DropdownMenuRadioItem key={g} value={g}>
                    {GROUPINGS[g]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
              Each topic stays one exact scope with its month; grouping joins them for reading.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={cn(barButton, filters.month && 'bg-muted text-foreground')}
              />
            }
          >
            <CalendarIcon />
            Month{' '}
            <span className="text-foreground">
              {filters.month ? monthShort(filters.month) : 'All'}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>The month asked about</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filters.month ?? 'all'}
                onValueChange={(v) =>
                  set({ ...filters, month: v === 'all' ? undefined : (v as string) })
                }
              >
                <DropdownMenuRadioItem value="all">All months</DropdownMenuRadioItem>
                {obs.topicMonths().map((m) => (
                  <DropdownMenuRadioItem key={m} value={m}>
                    {monthName(m)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto w-full max-w-64 @max-2xl/main:max-w-none @max-2xl/main:basis-full">
          <SearchField value={text} onChange={setText} placeholder="Search topics" />
        </div>
      </div>
      {said.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground md:px-5">
          <span>
            Time is{' '}
            <span className="font-medium text-foreground">
              {view.label === 'this week' ? 'last 7 days' : view.label.replace('the ', '')}
            </span>
          </span>
          {said.map((s) => (
            <React.Fragment key={s}>
              <span aria-hidden>-</span>
              <span className="text-foreground">{s}</span>
            </React.Fragment>
          ))}
          <button
            type="button"
            className="ml-auto underline underline-offset-4 hover:text-foreground"
            onClick={() => set({ domain: view.owned ? view.domain : undefined })}
          >
            Clear all
          </button>
        </div>
      )}
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
          view.state === 'empty' ? (
            <>
              <p className="font-medium">No questions yet</p>
              <p className="mt-1 text-muted-foreground">
                When an agent asks, its topic shows here: what it was about and how it was answered.
              </p>
            </>
          ) : (
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
                  set({ domain: view.owned ? view.domain : undefined }),
                  setQuery({ view: undefined })
                )}
              >
                Clear search and filters
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5 text-xs text-muted-foreground md:px-5">
        <span>
          {topics} {topics === 1 ? 'topic' : 'topics'} - {rows.length ? asked : 0} calls{' '}
          {view.label === 'this week' ? 'in 7 days' : `in ${view.range} days`}. A count under 5
          shows as “fewer than 5”.
        </span>
        <Legend />
      </div>
    </Frame>
  )
}

/** The filter menu: one list of fields, each opening its values with how many topics they'd show. */
function FilterMenu({
  filters,
  set,
  owned,
}: {
  filters: Filters
  set: (f: Filters) => void
  owned: DomainId[] | null
}) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const obs = useObservability()
  const view = useObsView()
  const all = obs.data.topics
  const n = (f: Filters) => all.filter((t) => passes(t, f)).length
  const on =
    (filters.answer?.length ?? 0) +
    (filters.gap?.length ?? 0) +
    (filters.domain && !owned ? 1 : 0) +
    (filters.agent ? 1 : 0)
  const sum = obs.data.numbers.counts
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(barButton, on > 0 && 'bg-muted text-foreground')}
          />
        }
      >
        <ListFilterIcon />
        Filter
        {on > 0 && <span className="tabular-nums">{on}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Filter by</DropdownMenuLabel>
          {!owned && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LayersIcon />
                Domain
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuRadioGroup
                  value={filters.domain ?? 'all'}
                  onValueChange={(v) =>
                    set({ ...filters, domain: v === 'all' ? undefined : (v as DomainId) })
                  }
                >
                  <DropdownMenuRadioItem value="all">All domains</DropdownMenuRadioItem>
                  {domainIds
                    .filter((d) => !domains[d]?.sandbox)
                    .map((d) => (
                      <DropdownMenuRadioItem key={d} value={d}>
                        <span className="flex w-full items-center justify-between gap-2">
                          {domains[d]?.name}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {n({ ...filters, domain: d })}
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Swatch state="missing" className="mx-0.5" />
              Answer
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Answer is any of</DropdownMenuLabel>
                {SHOWN.map((s: Shown) => (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={!!filters.answer?.includes(s)}
                    onCheckedChange={() => set({ ...filters, answer: toggle(filters.answer, s) })}
                  >
                    <span className="flex w-full items-center gap-2">
                      <Swatch state={s} />
                      <span className="flex-1">{STATE_WORDS[s]}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {sum[s] === null ? '' : sum[s].toLocaleString('en-GB')}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!owned && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BotIcon />
                Agent
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup
                  value={filters.agent ?? 'all'}
                  onValueChange={(v) =>
                    set({ ...filters, agent: v === 'all' ? undefined : (v as string) })
                  }
                >
                  <DropdownMenuRadioItem value="all">All agents</DropdownMenuRadioItem>
                  {obs.data.agents.map((a) => (
                    <DropdownMenuRadioItem key={a.name} value={a.name}>
                      {a.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FlagIcon />
              In the Inbox
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {(Object.keys(GAP_WORDS) as Gap[]).map((g) => (
                <DropdownMenuCheckboxItem
                  key={g}
                  checked={!!filters.gap?.includes(g)}
                  onCheckedChange={() => set({ ...filters, gap: toggle(filters.gap, g) })}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    {GAP_WORDS[g]}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {all.filter((t) => gapOf(t) === g).length}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarIcon />
              Time
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuRadioGroup
                value={String(view.range)}
                onValueChange={(v) => setQuery({ range: v === '7' ? undefined : (v as string) })}
              >
                {RANGES.map((r) => (
                  <DropdownMenuRadioItem key={r} value={String(r)}>
                    {r} days
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        {on > 0 && (
          <DropdownMenuItem onClick={() => set({ domain: owned ? view.domain : undefined })}>
            <XIcon />
            Clear all
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Save this view: a name, and everyone in the workspace has it as a tab. */
function SaveView({ filters, disabled }: { filters: Filters; disabled: boolean }) {
  const domains = useDomains()
  const write = useWrite()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const suggested = sentence(filters, domains).join(', ')
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setName(suggested)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={barButton}
            aria-disabled={disabled || undefined}
            aria-description={
              disabled ? 'Filter the list first: a view keeps its filters.' : undefined
            }
            onClick={(e) => disabled && e.preventDefault()}
          />
        }
      >
        <BookmarkIcon />
        Save this view
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            void write('saveView', { name: name.trim(), filters }).then(({ id }) => {
              setOpen(false)
              setQuery({ view: id })
              toast(`Saved the view ${name.trim()}`, {
                description: 'Everyone in the workspace has it as a tab.',
              })
            })
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="view-name">
            Name the view
            <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            It keeps these filters: {suggested}. It belongs to the workspace, so everyone sees it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save for everyone
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
