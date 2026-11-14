import * as React from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { meets, searchable, VALUE_PAGE, type TopicSum, type ValueGroup } from '@domain/obs-filters'
import { api } from '@/api'
import type { ObsDimension, ObsFilterView } from '@/api/client'
import { dimensionValuesQuery, obsDimensionsQuery, obsValuesQuery } from '@/api/queries'
import {
  BotIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FlagIcon,
  InboxIcon,
  LayersIcon,
  LoaderCircleIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { TextSwitch } from '@/components/heed/switches'
import { Swatch } from '@/components/obs/charts'
import { useIsMobile } from '@/hooks/use-mobile'
import { useAfter, useDelayedBusy } from '@/lib/loading'
import { useDebounced } from '@/lib/mentions'
import { nameOf, rememberNames } from '@/lib/obs-names'
import {
  ANY,
  chipOf,
  facetSaid,
  facetSize,
  facetWords,
  FILTER_WORDS,
  isDim,
  keyWords,
  MAX_CHIPS,
  toggled,
  withValues,
  type DimKey,
  type FacetValue,
  type FieldKey,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'
import type { Shown } from '@/model/observability'

// Overview's filter picker: a dimension first, then its values, as Linear's filter works. The
// first step lists the fixed fields, the dimensions an admin pinned, the person's recent ones, the
// most asked about in the range and every dimension; typing finds a field or a dimension by name,
// and from two letters a value in any dimension, grouped by dimension. A dimension's step lists
// "Any value", then its values the most asked first (or A to Z), with what each counts, a search,
// and is or is not; a tick applies at once. The counts are the service's (/observability/dimensions
// and /observability/values), shown counts added up, never every value at once: 50 a page.
// The box keeps the focus: the arrows move, Enter opens or adds, Space ticks, Escape goes back a
// step and then closes, and Backspace in the empty box goes back, then takes the last chip off.

/** A field the picker offers, with the values it lists in order. */
export type Field = {
  key: FieldKey
  values: string[]
  /** One value at a time, and only "is": a kind of agent, which the service counts against all. */
  one?: boolean
}

/** Where the picker is: its first step, every dimension, or one field's or dimension's values. */
export type Step = null | 'all' | FilterKey

/** How many dimensions the first step lists as the most asked, and its recent ones. */
const TOP = 7
export const RECENT = 3
/** Groups of values the words find before "in N more dimensions", and the names that match. */
const GROUPS = 4
const NAMES = 5
/** How long a later read waits before its spinner shows, in ms. */
const SPIN_AFTER = 1000
/** The most rows a step keeps a place for while its values load: more than the list shows. */
const KEEP_AT_MOST = 12

export type PickerProps = {
  chips: Filters
  onChange: (chips: Filters, said: string) => void
  fields: Field[]
  /** Each value of a field with what it counts, without the field's own chip. */
  facet: (key: FieldKey) => FacetValue[]
  /** A value as people read it. */
  words: (key: FilterKey, v: string) => string
  /** The view the counts follow: its range, a domain or a kind of agent, and the filters. */
  view: ObsFilterView
  /** The range, in days, as the counts are over it. */
  days: number
  /** In words, what the counts cannot follow: a topic's words, a view of several fields. */
  left: string[]
  pinned: DimKey[]
  recent: DimKey[]
  /** An admin pins a dimension for everyone, or unpins it, from its step. */
  onPin?: (key: DimKey, on: boolean) => void
  /** Where it opens and on what, or shut. */
  at: { step: Step; anchor: Element | null; fromChip: boolean } | null
  onClose: () => void
  /** Backspace in the empty first step: the last chip comes off. */
  onBackspace: () => void
}

/** A count from the service as a facet's count, for the same words and bar. */
export const countOf = (s: TopicSum | null | undefined): FacetValue['count'] =>
  s ? { visible: s.total, shown: s.total ?? s.atLeast } : null
const valueOf = (value: string, s: TopicSum | null | undefined): FacetValue => ({
  value,
  topics: s?.topics ?? 0,
  count: countOf(s),
})

type Row = { id: string; label: string; disabled?: boolean } & (
  | { kind: 'field'; key: FieldKey; on: boolean }
  | { kind: 'dim'; d: ObsDimension; on: boolean; hit?: string }
  | { kind: 'all'; n: number; asked: number }
  | { kind: 'add'; key: FilterKey; value: string; f: FacetValue; prefix?: string; max: number }
  | { kind: 'tick'; key: FilterKey; value: string; f: FacetValue | undefined; max: number }
  | { kind: 'within'; key: DimKey; q: string; n: number }
  | { kind: 'groups'; n: number }
  | { kind: 'more'; n: number }
  | { kind: 'topic'; text: string }
)
type Section = {
  id: string
  heading?: React.ReactNode
  rows: Row[]
  /** Said under the rows: what matched but was not asked about, or why nothing shows. */
  note?: React.ReactNode
  /** Rows of places under the rows: skeletons while busy, else room the list keeps. */
  keep?: number
  busy?: boolean
}

/** The words a list of dimensions or values is ordered by. */
type Sort = 'asked' | 'name'
const SORTS = [
  { value: 'asked' as const, label: 'Most asked' },
  { value: 'name' as const, label: 'A to Z' },
]

const ICONS: Record<FieldKey, React.ReactNode> = {
  answer: <Swatch state="missing" className="mx-0.5" />,
  domain: <LayersIcon />,
  agent: <BotIcon />,
  market: <TagIcon />,
  metric: <SigmaIcon />,
  month: <CalendarIcon />,
  gap: <InboxIcon />,
  reported: <FlagIcon />,
  topic: <SearchIcon />,
}

/** A field's icon, or a dimension's, for the picker, the chips and the facets. */
export const iconOf = (key: FilterKey) => (isDim(key) ? <SplitIcon /> : ICONS[key])

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

export function FilterPicker(props: PickerProps) {
  const mobile = useIsMobile()
  const { at, onClose } = props
  const box = React.useRef<HTMLInputElement>(null)
  const title = at?.step ? (at.step === 'all' ? 'All dimensions' : keyWords(at.step)) : 'Filter'
  if (mobile)
    return (
      <Sheet open={!!at} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          initialFocus={box}
          showCloseButton={false}
          className="gap-0 pb-safe data-[side=bottom]:h-bottom-sheet"
        >
          <span aria-hidden className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border" />
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a field or a dimension, then its values.
          </SheetDescription>
          {at && <PickerBody {...props} at={at} box={box} phone />}
        </SheetContent>
      </Sheet>
    )
  return (
    <Popover open={!!at} onOpenChange={(o) => !o && onClose()}>
      <PopoverContent
        anchor={at?.anchor ?? undefined}
        align="start"
        initialFocus={box}
        aria-label={title}
        className="w-110 max-w-(--available-width) gap-0 overflow-hidden p-0"
      >
        {at && <PickerBody {...props} at={at} box={box} />}
      </PopoverContent>
    </Popover>
  )
}

function PickerBody({
  chips,
  onChange,
  fields,
  facet,
  words,
  view,
  days,
  left,
  pinned,
  recent,
  onPin,
  at,
  onClose,
  onBackspace,
  box,
  phone,
}: PickerProps & {
  at: NonNullable<PickerProps['at']>
  box: React.RefObject<HTMLInputElement | null>
  phone?: boolean
}) {
  const [step, setStep] = React.useState<Step>(at.step)
  const [prev, setPrev] = React.useState<Step>(null)
  const [text, setText] = React.useState('')
  const [active, setActive] = React.useState(0)
  const [said, setSaid] = React.useState('')
  const [sortDims, setSortDims] = React.useState<Sort>('asked')
  const [sortValues, setSortValues] = React.useState<Sort>('asked')
  const [allGroups, setAllGroups] = React.useState(false)
  // The rows a dimension's step holds a place for while its first read is on its way: its values
  // take those places, and the list keeps its height when they are fewer, so nothing moves.
  const [kept, setKept] = React.useState<{ key: FilterKey; rows: number } | null>(null)
  const ids = React.useId()
  const listId = `${ids}-list`
  const list = React.useRef<HTMLDivElement>(null)
  const typed = text.trim()
  const debounced = useDebounced(typed)
  // Clearing the words takes effect at once; only typing waits.
  const q = typed ? debounced : ''

  // The values chosen when a step opens come first, and ticking never moves a row.
  const [first] = React.useState(
    () =>
      new Map<FilterKey, string[]>(
        at.step && at.step !== 'all' ? [[at.step, chipOf(chips, at.step)?.values ?? []]] : [],
      ),
  )
  const go = (next: Step, words = '') => {
    if (next && next !== 'all') first.set(next, chipOf(chips, next)?.values ?? [])
    setPrev(step)
    setStep(next)
    setText(words)
    setActive(0)
    setAllGroups(false)
    setKept(null)
    if (list.current) list.current.scrollTop = 0
    if (next && next !== 'all')
      setSaid(`${keyWords(next)}: choose its values. Backspace goes back.`)
    box.current?.focus()
  }
  const back = () => {
    if (at.fromChip && step === at.step) return onClose()
    go(step && step !== 'all' && prev === 'all' ? 'all' : null)
  }
  const change = (next: Filters, words: string) => {
    onChange(next, words)
    setSaid(words)
  }

  const dims = useQuery({ ...obsDimensionsQuery(view), placeholderData: keepPreviousData })
  const all = dims.data?.dimensions ?? []
  rememberNames(all)
  const dimOf = (key: string) => all.find((d) => d.key === key)

  const valueStep = step && step !== 'all' ? step : null

  // One dimension's values: the service's, a page at a time. The first page is the read its facet
  // makes, so a dimension the facets (or an earlier step) read opens with its values in the same
  // frame, never an empty step first.
  const stepDimension = valueStep && isDim(valueStep) ? valueStep : undefined
  const client = useQueryClient()
  const firstPage = dimensionValuesQuery(view, stepDimension ?? '', q, sortValues)
  const valueInput = firstPage.queryKey[1]
  const pages = useInfiniteQuery({
    queryKey: [...firstPage.queryKey, 'pages'],
    queryFn: ({ pageParam }) =>
      pageParam
        ? api.obsValues({ ...valueInput, cursor: pageParam })
        : client.fetchQuery(firstPage),
    initialData: () => {
      const read = client.getQueryData(firstPage.queryKey)
      return read && { pages: [read], pageParams: [''] }
    },
    initialDataUpdatedAt: () => client.getQueryState(firstPage.queryKey)?.dataUpdatedAt,
    initialPageParam: '',
    getNextPageParam: (last) => last.groups[0]?.nextCursor ?? undefined,
    enabled: !!stepDimension,
    // Another search or order of the same dimension keeps its rows until the next has loaded.
    placeholderData: (last, was) =>
      (was?.queryKey[1] as { dimension?: string } | undefined)?.dimension === stepDimension
        ? last
        : undefined,
  })
  // The words in every dimension, from two letters, in the first step.
  const search = useQuery({
    ...obsValuesQuery({ ...view, q, sort: 'asked' }),
    enabled: step === null && searchable(q),
    placeholderData: keepPreviousData,
  })
  if (stepDimension && !pages.data) {
    const rows = placesFor(dimOf(stepDimension))
    if (kept?.key !== stepDimension || kept.rows !== rows) setKept({ key: stepDimension, rows })
  }
  const firstLook = useDelayedBusy(
    (!!stepDimension && pages.isPending) || (step === null && searchable(q) && search.isPending),
  )
  const slow = useAfter(
    (!!stepDimension && pages.isFetching && !pages.isFetchingNextPage) ||
      (step === null && search.isFetching) ||
      typed !== debounced,
    SPIN_AFTER,
  )

  let sections: Section[] = []
  let head: React.ReactNode = null
  /** Above the list, outside it: how many values it holds, and their order. */
  let tools: React.ReactNode = null
  const sorting = (count: string) => (
    <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground">
      <span className="truncate">{count}</span>
      <TextSwitch
        label={`Order the values of ${valueStepName()}`}
        className="ml-auto text-xs"
        value={sortValues}
        onChange={setSortValues}
        options={SORTS}
      />
    </div>
  )
  const valueStepName = () => (step && step !== 'all' ? keyWords(step) : '')
  let foot: React.ReactNode = phone ? (
    <div className="flex h-14 shrink-0 items-center justify-end border-t px-3">
      <Button variant="secondary" className="h-11 px-4" onClick={onClose}>
        Done
      </Button>
    </div>
  ) : (
    <Keys back={!!step} />
  )
  let placeholder = chips.length ? 'Add a filter…' : 'Filter by a field, a dimension or a value…'
  let label = 'Filter by a field, a dimension or a value'

  if (step === null) sections = firstStep()
  else if (step === 'all') {
    head = (
      <StepHead
        phone={phone}
        onBack={back}
        title="All dimensions"
        hint={all.length.toLocaleString('en-GB')}
      >
        <TextSwitch
          label="Order the dimensions"
          className="ml-auto text-xs"
          value={sortDims}
          onChange={setSortDims}
          options={SORTS}
        />
      </StepHead>
    )
    placeholder = 'Find a dimension'
    label = 'Find a dimension'
    const found = all.filter((d) => !typed || meets(typed)(termOf(d)))
    sections = [
      {
        id: 'all',
        rows: order(found, sortDims).map((d) => dimRow(d)),
        busy: dims.isPending,
        note: !found.length && !dims.isPending ? `No dimension is called “${typed}”.` : undefined,
      },
    ]
  }
  if (valueStep) {
    const chip = chipOf(chips, valueStep)
    const field = isDim(valueStep) ? undefined : fields.find((f) => f.key === valueStep)
    const name = keyWords(valueStep)
    const d = isDim(valueStep) ? dimOf(valueStep) : undefined
    const one = !!field?.one
    head = (
      <StepHead
        phone={phone}
        onBack={at.fromChip && step === at.step ? undefined : back}
        icon={iconOf(valueStep)}
        title={name}
      >
        {onPin && isDim(valueStep) && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('text-muted-foreground', phone && 'size-11')}
            aria-label={`${pinned.includes(valueStep) ? 'Unpin' : 'Pin'} ${name} for everyone`}
            title={
              pinned.includes(valueStep)
                ? 'Unpin for everyone'
                : 'Pin for everyone: first in this list, and a facet of its own'
            }
            onClick={() => onPin(valueStep, !pinned.includes(valueStep))}
          >
            {pinned.includes(valueStep) ? <PinOffIcon /> : <PinIcon />}
          </Button>
        )}
        {!one && (
          <TextSwitch
            label={`${name}: keep or leave out`}
            className="ml-auto text-xs"
            value={chip?.not ? 'not' : 'is'}
            onChange={(v) => {
              const values = chip?.values ?? []
              if (!values.length) return
              change(
                withValues(chips, valueStep, values, v === 'not'),
                `${name} ${v === 'not' ? 'is not' : 'is'}`,
              )
            }}
            options={[
              { value: 'is', label: 'is' },
              { value: 'not', label: 'is not' },
            ]}
          />
        )}
      </StepHead>
    )
    placeholder = d ? `Search ${plural(d.values, 'value')}` : `Search ${name.toLowerCase()}`
    label = `Search the values of ${name}`
    sections = isDim(valueStep) ? dimensionValues(valueStep) : fieldValues(field)
    const n = chip?.values.length ?? 0
    foot = (
      <div
        className={cn(
          'flex h-10 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground pointer-coarse:h-12',
          phone && 'h-14',
        )}
      >
        {!phone && (
          <>
            <span>
              <Kbd>Space</Kbd> tick
            </span>
            {!(at.fromChip && step === at.step) && (
              <span>
                <Kbd>⌫</Kbd> back
              </span>
            )}
          </>
        )}
        <span className="ml-auto tabular-nums" aria-live="polite">
          {n ? `${n} chosen` : ''}
        </span>
        <Button className={cn('pointer-coarse:h-11', phone && 'h-11 px-4')} onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  const flat = sections.flatMap((s) => s.rows)
  const current = Math.min(active, Math.max(0, flat.length - 1))
  const activeRow = flat[current]
  React.useEffect(() => {
    if (!activeRow) return
    document.getElementById(optionId(listId, activeRow.id))?.scrollIntoView({ block: 'nearest' })
  }, [activeRow, listId])

  /* ---------- the first step ---------- */

  function firstStep(): Section[] {
    const out: Section[] = []
    if (chips.length >= MAX_CHIPS)
      out.push({
        id: 'full',
        rows: [],
        note: `${MAX_CHIPS} filters is the most a view keeps: take one off to add another.`,
      })
    const offered = fields.filter((f) => f.key !== 'topic' && f.key !== 'market')
    if (!typed) {
      out.push({
        id: 'fields',
        heading: 'Fields',
        rows: offered.map((f) => fieldRow(f.key)),
      })
      const listed = (keys: DimKey[]) =>
        keys.flatMap((k) => {
          const d = dimOf(k)
          return d ? [dimRow(d)] : []
        })
      if (pinned.length)
        out.push({
          id: 'pinned',
          heading: (
            <span className="flex items-center gap-1">
              <PinIcon aria-hidden className="size-3" /> Pinned
            </span>
          ),
          rows: listed(pinned),
        })
      const mine = recent.filter((k) => !pinned.includes(k)).slice(0, RECENT)
      if (mine.length)
        out.push({
          id: 'recent',
          heading: (
            <span className="flex items-center gap-1">
              <ClockIcon aria-hidden className="size-3" /> Recent
            </span>
          ),
          rows: listed(mine),
        })
      const asked = all.filter((d) => (d.asked?.topics ?? 0) > 0)
      const top = order(
        asked.filter((d) => !pinned.includes(d.key as DimKey) && !mine.includes(d.key as DimKey)),
        'asked',
      ).slice(0, TOP)
      out.push({
        id: 'dimensions',
        heading: 'Dimensions',
        rows: [
          ...order(top, sortDims).map((d) => dimRow(d)),
          ...(all.length
            ? [
                {
                  id: 'all',
                  kind: 'all' as const,
                  label: `All ${all.length} dimensions`,
                  n: all.length,
                  asked: asked.length,
                },
              ]
            : []),
        ],
        busy: dims.isPending,
        note: dims.isError ? (
          <Retry what="the dimensions" onRetry={() => void dims.refetch()} />
        ) : dims.data && !all.length ? (
          'The definitions have no dimensions yet.'
        ) : dims.data && !asked.length ? (
          `Agents named no dimension in ${days} days.${days < 90 ? ' Try 90 days.' : ''}`
        ) : undefined,
      })
      return out
    }

    // Typed: fields and dimensions by name, a field's values, then values in every dimension.
    const fit = meets(typed)
    const names = [
      ...offered
        .filter((f) => fit({ key: f.key, name: FILTER_WORDS[f.key], aliases: [] }))
        .map((f) => fieldRow(f.key)),
      ...all.filter((d) => fit(termOf(d))).map((d) => dimRow(d, typed)),
    ].slice(0, NAMES)
    if (names.length) out.push({ id: 'names', heading: 'Fields and dimensions', rows: names })
    const own: Row[] = []
    for (const f of offered) {
      if (f.key === 'agent') continue
      const counts = facet(f.key)
      const max = Math.max(1, ...counts.map((v) => facetSize(v.count)))
      for (const v of counts)
        if (v.topics > 0 && words(f.key, v.value).toLowerCase().includes(typed.toLowerCase()))
          own.push({
            id: `add:${f.key}:${v.value}`,
            kind: 'add',
            key: f.key,
            value: v.value,
            label: words(f.key, v.value),
            prefix: FILTER_WORDS[f.key],
            f: v,
            max,
          })
    }
    if (own.length) out.push({ id: 'own', rows: own.slice(0, 3) })
    if (searchable(typed)) {
      const found = search.data
      const groups = found?.groups ?? []
      const shown = allGroups ? groups : groups.slice(0, GROUPS)
      for (const g of shown) out.push(groupOf(g))
      const rest: Row[] = []
      if (!allGroups && groups.length > GROUPS)
        rest.push({
          id: 'groups',
          kind: 'groups',
          label: `“${typed}” in ${groups.length - GROUPS} more dimensions`,
          n: groups.length - GROUPS,
        })
      out.push({
        id: 'values',
        rows: rest,
        note: search.isError ? (
          <Retry what="the values" onRetry={() => void search.refetch()} />
        ) : found?.notAsked ? (
          `${plural(found.notAsked, groups.length ? 'more value' : 'value')} ${found.notAsked === 1 ? 'matches' : 'match'}, but no agent asked about ${found.notAsked === 1 ? 'it' : 'them'} in ${days} days.`
        ) : undefined,
      })
    }
    out.push({
      id: 'topic',
      rows: [{ id: 'topic', kind: 'topic', label: `Topic has “${typed}”`, text: typed }],
    })
    const any = out.some((s) => s.id !== 'topic' && s.rows.length)
    if (!any && !search.isFetching && typed === debounced)
      out.unshift({
        id: 'none',
        rows: [],
        note: `Nothing matches “${typed}” in the last ${days} days.${searchable(typed) ? '' : ' Type two letters to search the values.'}`,
      })
    return out
  }

  /** A dimension's values the words found, its first three, and the way to the rest. */
  function groupOf(g: ValueGroup): Section {
    rememberNames([g.dimension, ...g.values])
    const max = Math.max(1, ...g.values.map((v) => facetSize(countOf(v.asked))))
    const key = g.dimension.key as DimKey
    return {
      id: `g:${key}`,
      heading: (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">{g.dimension.name}</span>
          <span className="ml-auto font-normal tabular-nums">{plural(g.matched, 'value')}</span>
        </span>
      ),
      rows: [
        ...g.values.map((v): Row => ({
          id: `add:${key}:${v.key}`,
          kind: 'add',
          key,
          value: v.key,
          label: v.name,
          f: valueOf(v.key, v.asked),
          max,
        })),
        ...(g.matched > g.values.length
          ? [
              {
                id: `within:${key}`,
                kind: 'within' as const,
                key,
                q: typed,
                n: g.matched,
                label: `All ${g.matched} in ${g.dimension.name}`,
              },
            ]
          : []),
      ],
    }
  }

  /* ---------- a step's values ---------- */

  function dimensionValues(key: DimKey): Section[] {
    const loaded = pages.data?.pages.flatMap((p) => p.groups[0]?.values ?? []) ?? []
    rememberNames(loaded)
    const group = pages.data?.pages[0]?.groups[0]
    const d = dimOf(key)
    const byKey = new Map(loaded.map((v) => [v.key, v]))
    const max = Math.max(1, ...loaded.map((v) => facetSize(countOf(v.asked))))
    const chosen = (first.get(key) ?? []).filter(
      (v) => v !== ANY && (!q || nameOf(v).toLowerCase().includes(q.toLowerCase())),
    )
    const rows: Row[] = [
      ...chosen.map((v) => tickRow(key, v, byKey.get(v)?.asked ?? null, max)),
      ...loaded
        .filter((v) => !chosen.includes(v.key))
        .map((v) => tickRow(key, v.key, v.asked, max)),
    ]
    const out: Section[] = []
    if (!q)
      out.push({
        id: 'any',
        rows: [
          {
            id: `tick:${key}:${ANY}`,
            kind: 'tick',
            key,
            value: ANY,
            label: 'Any value',
            f: group ? valueOf(ANY, group.asked) : undefined,
            max: 0,
          },
        ],
      })
    // The bar is there from the first frame, its count once read, so the rows never move down.
    tools = sorting(
      !group
        ? ''
        : q
          ? plural(group.matched, 'match', 'matches')
          : `${group.matched.toLocaleString('en-GB')} asked about in ${days} days${d?.values ? ` of ${d.values.toLocaleString('en-GB')}` : ''}`,
    )
    const more = group ? group.matched - loaded.length : 0
    if (pages.hasNextPage && more > 0)
      rows.push({
        id: 'more',
        kind: 'more',
        n: more,
        label: `Show ${plural(more, 'more value')}, fewer asks each`,
      })
    const note = pages.isError ? (
      <Retry what={`the values of ${keyWords(key)}`} onRetry={() => void pages.refetch()} />
    ) : group && !rows.length ? (
      <>
        {q
          ? `No value of ${keyWords(key)} matches “${q}” and was asked about in ${days} days.`
          : d && !d.values
            ? `${keyWords(key)} has no values from the definitions, so only Any value can be chosen.`
            : `No agent asked about a value of ${keyWords(key)} in ${days} days.`}
        {group.notAsked > 0 &&
          ` ${plural(group.notAsked, 'value')} ${group.notAsked === 1 ? 'matches' : 'match'}, but no agent asked about ${group.notAsked === 1 ? 'it' : 'them'}.`}
      </>
    ) : group?.notAsked && q ? (
      `${plural(group.notAsked, 'more value')} ${group.notAsked === 1 ? 'matches' : 'match'}, but no agent asked about ${group.notAsked === 1 ? 'it' : 'them'} in ${days} days.`
    ) : undefined
    // The places kept for the values while they load, and those they leave when fewer came.
    const places = kept?.key === key && !q ? Math.min(KEEP_AT_MOST, kept.rows) : 0
    out.push({
      id: 'values',
      heading: undefined,
      rows,
      keep: places - rows.length - (note ? 1 : 0),
      busy: firstLook && !pages.data,
      note,
    })
    return out
  }

  function fieldValues(field: Field | undefined): Section[] {
    if (!field) return []
    const key = field.key
    const counts = facet(key)
    const byValue = new Map(counts.map((f) => [f.value, f]))
    const max = Math.max(1, ...counts.map((f) => facetSize(f.count)))
    const find = typed.toLowerCase()
    // The field's values, with any chosen value it does not list (from a link), first.
    const listed = counts.length ? counts.map((f) => f.value) : field.values
    const chosen = (first.get(key) ?? []).filter((v) => !listed.includes(v))
    let values = [...chosen, ...listed].filter(
      (v) => !find || words(key, v).toLowerCase().includes(find),
    )
    if (key !== 'answer' && key !== 'month' && sortValues === 'name')
      values = [...values].sort((a, b) => words(key, a).localeCompare(words(key, b)))
    const was = first.get(key) ?? []
    values = [...values.filter((v) => was.includes(v)), ...values.filter((v) => !was.includes(v))]
    if (key !== 'answer' && key !== 'month') tools = sorting(plural(values.length, 'value'))
    return [
      {
        id: 'values',
        heading: undefined,
        rows: values.map((v) => tickRow(key, v, byValue.get(v), max)),
        note: values.length ? undefined : `No ${keyWords(key).toLowerCase()} by that name.`,
      },
    ]
  }

  /* ---------- rows ---------- */

  function fieldRow(key: FieldKey): Row {
    return {
      id: `field:${key}`,
      kind: 'field',
      key,
      label: FILTER_WORDS[key],
      on: !!chipOf(chips, key),
    }
  }
  function dimRow(d: ObsDimension, hit?: string): Row {
    return {
      id: `dim:${d.key}`,
      kind: 'dim',
      d,
      label: d.name,
      on: !!chipOf(chips, d.key as DimKey),
      ...(hit ? { hit } : {}),
    }
  }
  function tickRow(
    key: FilterKey,
    value: string,
    count: TopicSum | FacetValue | null | undefined,
    max: number,
  ): Row {
    const f = !count ? undefined : 'value' in count ? count : valueOf(value, count)
    return {
      id: `tick:${key}:${value}`,
      kind: 'tick',
      key,
      value,
      label: words(key, value),
      f,
      max,
    }
  }

  /* ---------- what a row does ---------- */

  const pick = (row: Row | undefined) => {
    if (!row || row.disabled) return
    switch (row.kind) {
      case 'field':
        return go(row.key)
      case 'dim':
        return go(row.d.key as DimKey)
      case 'all':
        return go('all')
      case 'within':
        return go(row.key, row.q)
      case 'groups':
        return setAllGroups(true)
      case 'more':
        return void pages.fetchNextPage()
      case 'topic': {
        const c = chipOf(chips, 'topic')
        const values = [...new Set([...(c?.values ?? []), row.text])]
        change(withValues(chips, 'topic', values), `Added the filter Topic has “${row.text}”`)
        return onClose()
      }
      case 'add': {
        const c = chipOf(chips, row.key)
        const one = !isDim(row.key) && fields.find((f) => f.key === row.key)?.one
        const values = one
          ? [row.value]
          : [...new Set([...(c?.values ?? []).filter((v) => v !== ANY), row.value])]
        change(withValues(chips, row.key, values), `Added ${row.label}, ${keyWords(row.key)}`)
        return onClose()
      }
      case 'tick': {
        const one = !isDim(row.key) && fields.find((f) => f.key === row.key)?.one
        const on = !!chipOf(chips, row.key)?.values.includes(row.value)
        const next = one
          ? withValues(chips, row.key, on ? [] : [row.value])
          : toggled(chips, row.key, row.value)
        return change(next, `${on ? 'Took out' : 'Added'} ${row.label}, ${keyWords(row.key)}`)
      }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const empty = !e.currentTarget.value
    const moveBy = (n: number) => {
      e.preventDefault()
      if (flat.length) setActive((current + n + flat.length) % flat.length)
    }
    if (e.key === 'ArrowDown') return moveBy(1)
    if (e.key === 'ArrowUp') return moveBy(-1)
    if (e.key === 'Home' && empty) return moveBy(-current)
    if (e.key === 'End' && empty) return moveBy(flat.length - 1 - current)
    if (e.key === 'Enter' || (e.key === ' ' && empty && valueStep)) {
      e.preventDefault()
      return pick(activeRow)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return step ? back() : onClose()
    }
    if (e.key === 'Backspace' && empty) {
      e.preventDefault()
      if (step) back()
      else onBackspace()
    }
  }

  const checked = (row: Row) =>
    row.kind === 'tick' ? !!chipOf(chips, row.key)?.values.includes(row.value) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      {head}
      <div
        className={cn(
          'relative flex h-10 shrink-0 items-center gap-2 border-b px-3 pointer-coarse:h-12',
          phone && 'h-12',
        )}
      >
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={box}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? optionId(listId, activeRow.id) : undefined}
          aria-label={label}
          placeholder={placeholder}
          value={text}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setAllGroups(false)
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground pointer-coarse:text-base',
            phone && 'text-base',
          )}
        />
        {(slow || (step === null && firstLook)) && (
          <LoaderCircleIcon
            role="img"
            aria-label="Loading"
            className="size-4 shrink-0 animate-spin text-muted-foreground"
          />
        )}
      </div>
      {tools}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={valueStep ? true : undefined}
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain p-1',
          !phone && 'max-h-96',
        )}
      >
        {sections.map((s) => (
          <div
            key={s.id}
            // A section with no rows is only its note: no group, as a group holds options.
            role={s.rows.length ? 'group' : undefined}
            aria-labelledby={s.heading && s.rows.length ? `${listId}-${s.id}` : undefined}
            className="not-first:mt-1"
          >
            {s.heading && (
              <div
                id={`${listId}-${s.id}`}
                role="presentation"
                className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-muted-foreground"
              >
                {s.heading}
              </div>
            )}
            {s.rows.map((row) => {
              const index = flat.indexOf(row)
              return (
                <Option
                  key={row.id}
                  id={optionId(listId, row.id)}
                  row={row}
                  active={index === current}
                  checked={checked(row)}
                  days={days}
                  phone={!!phone}
                  onPoint={() => index !== current && setActive(index)}
                  onPick={() => pick(row)}
                />
              )
            })}
            {s.keep !== undefined
              ? s.keep > 0 && <SkeletonRows rows={s.keep} shown={!!s.busy} phone={!!phone} />
              : s.busy && <SkeletonRows phone={!!phone} />}
            {s.note && (
              <p role="presentation" className="px-2 py-2 text-xs text-muted-foreground">
                {s.note}
              </p>
            )}
          </div>
        ))}
      </div>
      {left.length > 0 && (
        <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground">
          Counts leave out {left.join(', ')}.
        </p>
      )}
      {foot}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  )
}

const optionId = (list: string, row: string) => `${list}-${row.replace(/[^\w-]/g, '_')}`
const termOf = (d: ObsDimension) => ({ key: d.key, name: d.name, aliases: [] })

/**
 * The rows a dimension's step lists before it is read: a row for each value asked about, a page at
 * most and "Show more" under it, or one line that says there are none.
 */
const placesFor = (d: ObsDimension | undefined) =>
  d
    ? Math.max(1, Math.min(d.valuesAsked, VALUE_PAGE) + (d.valuesAsked > VALUE_PAGE ? 1 : 0))
    : WIDTHS.length

/** Dimensions in order: the most asked first, or A to Z. */
const order = <T extends ObsDimension>(list: T[], sort: Sort) =>
  [...list].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : facetSize(countOf(b.asked)) - facetSize(countOf(a.asked)) || a.name.localeCompare(b.name),
  )

function StepHead({
  onBack,
  icon,
  title,
  hint,
  phone,
  children,
}: {
  phone?: boolean
  onBack?: () => void
  icon?: React.ReactNode
  title: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center gap-1.5 border-b px-2 text-xs text-muted-foreground pointer-coarse:h-12',
        phone && 'h-12',
      )}
    >
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          className={cn('pointer-coarse:size-11', phone && 'size-11')}
          onClick={onBack}
        >
          <ChevronLeftIcon />
        </Button>
      )}
      {icon && (
        <span className="flex size-4 items-center justify-center [&_svg]:size-3.5" aria-hidden>
          {icon}
        </span>
      )}
      <span className="truncate text-sm font-medium text-foreground">{title}</span>
      {hint && <span className="tabular-nums">{hint}</span>}
      {children}
    </div>
  )
}

function Keys({ back }: { back: boolean }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground pointer-coarse:hidden">
      <span>
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> to choose
      </span>
      <span>
        <Kbd>Enter</Kbd> to open or add
      </span>
      {back && (
        <span>
          <Kbd>⌫</Kbd> back
        </span>
      )}
      <span>
        <Kbd>Esc</Kbd> to close
      </span>
    </div>
  )
}

function Retry({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <span className="flex items-center gap-2">
      Couldn’t load {what}.
      <Button variant="link" className="h-auto p-0 text-xs" onClick={onRetry}>
        Try again
      </Button>
    </span>
  )
}

const WIDTHS = [70, 55, 80, 45, 62]

/**
 * Rows of the list's own shape, each an option's height, while its first read is on its way; not
 * shown yet, they only keep the places, as nothing shows before 150 ms.
 */
function SkeletonRows({
  rows = WIDTHS.length,
  shown = true,
  phone,
}: {
  rows?: number
  shown?: boolean
  phone: boolean
}) {
  return (
    <div aria-hidden className={cn('flex flex-col', !shown && 'invisible')}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex min-h-8 items-center gap-2 px-2 pointer-coarse:min-h-11',
            phone && 'min-h-11',
          )}
        >
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
        </div>
      ))}
    </div>
  )
}

/** One row of the list: what it is, and what it counts. */
function Option({
  id,
  row,
  active,
  checked,
  days,
  phone,
  onPoint,
  onPick,
}: {
  id: string
  row: Row
  active: boolean
  checked: boolean | undefined
  days: number
  phone: boolean
  onPoint: () => void
  onPick: () => void
}) {
  const icon = (node: React.ReactNode) => (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5"
    >
      {node}
    </span>
  )
  const go = icon(<ChevronRightIcon />)
  let body: React.ReactNode
  let said = ''
  switch (row.kind) {
    case 'field':
      body = (
        <>
          {icon(iconOf(row.key))}
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.on && <span className="text-xs font-medium text-primary">On</span>}
          {go}
        </>
      )
      said = row.on ? ', on' : ''
      break
    case 'dim': {
      const n = row.d.asked?.topics ? facetWords(countOf(row.d.asked)) : null
      const hint = n ? `${n} · ${plural(row.d.values, 'value')}` : `not asked in ${days} days`
      body = (
        <>
          {icon(<SplitIcon />)}
          <span className="min-w-0 flex-1 truncate font-medium">
            <Marked text={row.label} hit={row.hit} />
          </span>
          {row.on && <span className="text-xs font-medium text-primary">On</span>}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{hint}</span>
          {go}
        </>
      )
      said = `${row.on ? ', on' : ''}, ${n ? `asked ${n} times, ${plural(row.d.values, 'value')}` : `not asked in ${days} days`}`
      break
    }
    case 'all':
      body = (
        <>
          {icon(<ChevronRightIcon />)}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {row.asked} asked about in {days} days
          </span>
        </>
      )
      break
    case 'add':
    case 'tick': {
      const any = row.value === ANY
      body = (
        <>
          {row.kind === 'tick' ? (
            // The row is the option and says it is ticked; its box is only drawn.
            <span inert className="flex">
              <Checkbox checked={!!checked} className="pointer-events-none" />
            </span>
          ) : (
            icon(row.key === 'answer' ? <Swatch state={row.value as Shown} /> : <TagIcon />)
          )}
          {row.kind === 'tick' && row.key === 'answer' && <Swatch state={row.value as Shown} />}
          <span className="min-w-0 flex-1 truncate">
            {row.kind === 'add' && row.prefix && (
              <span className="text-muted-foreground">{row.prefix} · </span>
            )}
            {row.label}
            {any && (
              <span className="text-muted-foreground"> · asked about {nameOfRow(row)} at all</span>
            )}
          </span>
          {row.f && <CountCell f={row.f} max={any ? 0 : row.max} state={row.key === 'answer'} />}
        </>
      )
      said = row.f ? `, ${facetSaid(row.f, row.key === 'answer')}` : ''
      break
    }
    case 'within':
    case 'groups':
    case 'more':
      body = (
        <>
          {icon(row.kind === 'within' ? <ChevronRightIcon /> : <ChevronDownIcon />)}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
        </>
      )
      break
    case 'topic':
      body = (
        <>
          {icon(<SearchIcon />)}
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">Topic has </span>“{row.text}”
          </span>
        </>
      )
      break
  }
  return (
    <div
      id={id}
      role="option"
      aria-selected={row.kind === 'tick' ? !!checked : active}
      aria-disabled={row.disabled || undefined}
      data-active={active || undefined}
      data-row={row.kind}
      onMouseMove={onPoint}
      onClick={onPick}
      className={cn(
        'flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 py-1 outline-hidden select-none pointer-coarse:min-h-11 data-active:bg-accent',
        phone && 'min-h-11',
      )}
    >
      {body}
      {said && <span className="sr-only">{said}</span>}
    </div>
  )
}

const nameOfRow = (row: { key: FilterKey }) => keyWords(row.key).toLowerCase()

/** A dimension's name with the words that found it in bold. */
function Marked({ text, hit }: { text: string; hit?: string }) {
  const at = hit ? text.toLowerCase().indexOf(hit.toLowerCase()) : -1
  if (!hit || at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold">{text.slice(at, at + hit.length)}</span>
      {text.slice(at + hit.length)}
    </>
  )
}

/** A count as a row says it, with a quiet bar of its share of the largest. */
function CountCell({ f, max, state }: { f: FacetValue; max: number; state?: boolean }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      {facetWords(f.count, state)}
      {max > 0 && (
        <span aria-hidden className="h-1 w-6 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-muted-foreground/40"
            style={{ width: `${Math.round((facetSize(f.count) / max) * 100)}%` }}
          />
        </span>
      )}
    </span>
  )
}
