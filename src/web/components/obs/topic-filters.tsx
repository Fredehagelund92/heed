import * as React from 'react'
import { toast } from 'sonner'
import { useWrite } from '@/api/queries'
import {
  BookmarkIcon,
  BotIcon,
  CalendarIcon,
  ChevronDownIcon,
  FlagIcon,
  LayersIcon,
  ListFilterIcon,
  ListTreeIcon,
  XIcon,
} from '@/components/icons'
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { barButton, FilterChip, FilterRow, FilterValue } from '@/components/heed/list'
import { TextSwitch } from '@/components/heed/switches'
import { Swatch } from '@/components/obs/charts'
import {
  GROUPINGS,
  monthName,
  monthShort,
  SHOWN,
  shownCount,
  STATE_WORDS,
  type Grouping,
  type Shown,
  type Topic,
} from '@/model/observability'
import type { DomainId } from '@/model/items'
import { useObservability, type ObsView } from '@/lib/obs'
import { GAP_WORDS, gapOf, passes, sentence, type Filters, type Gap } from '@/lib/obs-views'
import { setQuery } from '@/lib/router'
import { useDomainList, useDomains } from '@/lib/workspace'

// Overview's controls for its topics, on the list pattern Context and Definitions share: the views
// as words with counts, a Filter menu whose values say how many topics they keep, the month, the
// grouping, the filters that are on as chips, and a view saved for the whole workspace. Domain and
// kind of agent narrow the read itself, so the numbers and the chart follow them too.

const toggle = <T,>(list: T[] | undefined, v: T) => {
  const l = list ?? []
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v]
}

export type ViewOption = { id: string; name: string; count: number }

/**
 * The views, built in and saved: words with how many topics each holds, the chosen one underlined.
 * On a narrow page they fold into one menu. A saved view can be taken off by anyone, as it belongs
 * to the workspace.
 */
export function ViewSwitch({
  views,
  value,
  onChange,
  onRemove,
}: {
  views: ViewOption[]
  value: string
  onChange: (id: string) => void
  /** Taking the chosen view off, when it is a saved one. */
  onRemove?: () => void
}) {
  const on = views.find((v) => v.id === value) ?? views[0]!
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={cn(barButton, 'text-foreground @4xl/main:hidden')}
            />
          }
        >
          <span className="sr-only">View: </span>
          {on.name}
          <span className="text-xs text-muted-foreground tabular-nums">{on.count}</span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Views</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={on.id} onValueChange={(v) => onChange(v as string)}>
              {views.map((v) => (
                <DropdownMenuRadioItem key={v.id} value={v.id}>
                  <FilterValue count={v.count}>{v.name}</FilterValue>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TextSwitch
        label="Views"
        className="min-w-0 pl-1 text-dense @max-4xl/main:hidden"
        value={on.id}
        onChange={onChange}
        options={views.map((v) => ({ value: v.id, label: v.name, count: v.count }))}
      />
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove the view ${on.name}`}
          className="text-muted-foreground"
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

/**
 * The Filter menu: one list of fields, each opening its values with how many topics they keep, or
 * for a kind of agent how often it asked. Domain and agent are for admins; an owner sees their own.
 */
export function FilterMenu({
  filters,
  set,
  view,
}: {
  filters: Filters
  set: (f: Filters) => void
  view: ObsView
}) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const obs = useObservability()
  const all = obs.data.topics
  const n = (f: Filters) => all.filter((t) => passes(t, f)).length
  const owned = view.owned
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
          {/* An owner of more than one domain picks among their own; an admin, among all. */}
          {(!owned || owned.length > 1) && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LayersIcon />
                Domain
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuRadioGroup
                  value={filters.domain ?? 'all'}
                  onValueChange={(v) =>
                    set({ ...filters, domain: v === 'all' ? undefined : (v as DomainId) })
                  }
                >
                  {!owned && <DropdownMenuRadioItem value="all">All domains</DropdownMenuRadioItem>}
                  {(owned ?? domainIds.filter((d) => !domains[d]?.sandbox)).map((d) => (
                    <DropdownMenuRadioItem key={d} value={d}>
                      <FilterValue count={n({ ...filters, domain: d })}>
                        {domains[d]?.name}
                      </FilterValue>
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
              <DropdownMenuSubContent className="w-60">
                <DropdownMenuGroup>
                  {/* How often each kind asked: a kind of agent, never a person. */}
                  <DropdownMenuLabel>Kind of agent, never a person</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={filters.agent ?? 'all'}
                    onValueChange={(v) =>
                      set({ ...filters, agent: v === 'all' ? undefined : (v as string) })
                    }
                  >
                    <DropdownMenuRadioItem value="all">All agents</DropdownMenuRadioItem>
                    {obs.data.agents.map((a) => (
                      <DropdownMenuRadioItem key={a.name} value={a.name}>
                        <span className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{a.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {shownCount(a.count)}
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FlagIcon />
              In the Inbox
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {(Object.keys(GAP_WORDS) as Gap[]).map((g) => (
                <DropdownMenuCheckboxItem
                  key={g}
                  checked={!!filters.gap?.includes(g)}
                  onCheckedChange={() => set({ ...filters, gap: toggle(filters.gap, g) })}
                >
                  <FilterValue count={all.filter((t) => gapOf(t) === g).length}>
                    {GAP_WORDS[g]}
                  </FilterValue>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        {on > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => set(cleared(view))}>
              <XIcon />
              Clear all
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The filters with nothing on: an owner keeps their own domain. */
export const cleared = (view: Pick<ObsView, 'owned' | 'domain'>): Filters => ({
  domain: view.owned ? view.domain : undefined,
})

/** The month asked about: every month the topics are about, newest first. */
export function MonthMenu({ filters, set }: { filters: Filters; set: (f: Filters) => void }) {
  const obs = useObservability()
  return (
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
        <span className="text-foreground">{filters.month ? monthShort(filters.month) : 'All'}</span>
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
  )
}

/** How the topics are grouped for reading; each stays one exact scope with its month. */
export function GroupMenu({ value }: { value: Grouping }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(barButton, value !== 'none' && 'bg-muted text-foreground')}
          />
        }
      >
        <ListTreeIcon />
        Group <span className="text-foreground">{GROUPINGS[value]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          Each topic stays one exact scope with its month; grouping joins them for reading.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The filters that are on, as chips that each come off, with Clear all from two. */
export function FilterChips({
  filters,
  set,
  view,
}: {
  filters: Filters
  set: (f: Filters) => void
  view: ObsView
}) {
  const domains = useDomains()
  const domain = !view.owned && filters.domain
  const count =
    (domain ? 1 : 0) +
    (filters.answer?.length ? 1 : 0) +
    (filters.agent ? 1 : 0) +
    (filters.gap?.length ? 1 : 0) +
    (filters.month ? 1 : 0)
  return (
    <FilterRow count={count} onClear={() => set(cleared(view))}>
      {domain && (
        <FilterChip
          field="Domain"
          values={[domains[domain]?.name ?? domain]}
          onRemove={() => set({ ...filters, domain: undefined })}
        />
      )}
      {!!filters.answer?.length && (
        <FilterChip
          field="Answer"
          values={filters.answer.map((s) => STATE_WORDS[s])}
          onRemove={() => set({ ...filters, answer: undefined })}
        />
      )}
      {filters.agent && (
        <FilterChip
          field="Agent"
          values={[filters.agent]}
          onRemove={() => set({ ...filters, agent: undefined })}
        />
      )}
      {!!filters.gap?.length && (
        <FilterChip
          field="In the Inbox"
          values={filters.gap.map((g) => GAP_WORDS[g])}
          onRemove={() => set({ ...filters, gap: undefined })}
        />
      )}
      {filters.month && (
        <FilterChip
          field="Month"
          values={[monthName(filters.month)]}
          onRemove={() => set({ ...filters, month: undefined })}
        />
      )}
    </FilterRow>
  )
}

/** Save this view: a name, and everyone in the workspace has it beside the others. */
export function SaveView({ filters, disabled }: { filters: Filters; disabled: boolean }) {
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
              disabled ? 'Filter the topics first: a view keeps its filters.' : undefined
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
                description: 'Everyone in the workspace has it beside the others.',
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

/** How many topics a view holds, with the domain in the address. */
export const viewCount = (all: Topic[], has: (t: Topic) => boolean, filters: Filters) =>
  all.filter((t) => has(t) && passes(t, { domain: filters.domain })).length
