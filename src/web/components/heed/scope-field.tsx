import * as React from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import type { ScopeHit, ScopeSearchInput } from '@/api/client'
import { scopeSearchQuery } from '@/api/queries'
import {
  CheckIcon,
  ChevronRightIcon,
  GlobeIcon,
  PlusIcon,
  SearchIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
  XIcon,
} from '@/components/icons'
import { TagChip, WhereChip } from '@/components/heed/tag-chip'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDebounced } from '@/lib/mentions'
import {
  anyValue,
  dimensionIdOf,
  holds,
  termLabel,
  termOfHit,
  termWords,
  toggleTerm,
} from '@/lib/scope'
import type { Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'
import type { Fact, ScopeTerm } from '@/model/items'

// "Applies to" (FR-107, FR-126): the item's metrics, dimensions and values as chips, and one picker
// that searches the vocabulary on the server. A dimension can hold thousands of values, so nothing
// lists them all: before anything is typed the picker offers the person's recent terms; typing
// finds a few metrics and, per dimension, how many values match, the first few and the dimension
// itself as "any value". "All 2,400 values" searches inside one dimension, in a list that draws
// only the rows in view and reads them a page at a time. Arrows move, Enter adds or takes out,
// Right arrow opens a dimension, Backspace in the empty box leaves it, Esc closes.

/** Rows the service reads at a time inside one dimension. */
const PAGE = 50
/** Rows drawn beyond the visible ones, so scrolling never shows a gap. */
const OVERSCAN = 6

const isMarket = (t: ScopeTerm) =>
  t.kind === 'value' && (t.key ? dimensionIdOf(t.key) === 'market' : t.dimension === 'Market')

/** A term's look: the tag chip's tone and icon for what it is. A market is a country. */
function lookOf(t: ScopeTerm): { tone: Tone; Icon: typeof SigmaIcon } {
  if (t.kind === 'metric') return { tone: 'metric', Icon: SigmaIcon }
  if (t.kind === 'dimension') return { tone: 'dimension', Icon: SplitIcon }
  return isMarket(t) ? { tone: 'market', Icon: GlobeIcon } : { tone: 'dimension', Icon: TagIcon }
}

const count = (n: number, noun: string) =>
  `${n.toLocaleString('en')} ${n === 1 ? noun : noun === 'match' ? 'matches' : `${noun}s`}`

/** One chosen term as its chip. */
export function ScopeChip({ term, onRemove }: { term: ScopeTerm; onRemove?: () => void }) {
  const { tone, Icon } = lookOf(term)
  return (
    <TagChip
      tone={tone}
      icon={<Icon aria-hidden />}
      onRemove={onRemove}
      removeLabel={onRemove ? `Remove ${termWords(term)}` : undefined}
      title={termWords(term)}
    >
      {termLabel(term)}
    </TagChip>
  )
}

/**
 * What an item applies to, read-only: its terms by key when the binding read them, so a value
 * shows as a value of its dimension; otherwise its names.
 */
export function ScopeChips({ fact }: { fact: Pick<Fact, 'where' | 'scope'> }) {
  return fact.scope
    ? fact.scope.map((t) => <ScopeChip key={t.key || `${t.kind}:${t.name}`} term={t} />)
    : fact.where.map((w) => <WhereChip key={w} w={w} />)
}

type Row =
  | { id: string; type: 'term'; term: ScopeTerm; label: string; hint?: string }
  | { id: string; type: 'within'; dimension: ScopeHit; count: number; named: boolean }
type Section = { id: string; heading: string; count?: string; rows: Row[] }

const termRow = (hit: ScopeHit, label = hit.name): Row => ({
  id: hit.key,
  type: 'term',
  term: termOfHit(hit),
  label,
  ...(hit.alias ? { hint: `also ${hit.alias}` } : {}),
})

/** A row's element id inside the list. */
const optionId = (list: string, row: string) => `${list}-${row.replace(/[^a-zA-Z0-9_-]/g, '-')}`

/**
 * The picker itself: the search box and its list. `value` is what is chosen; `onToggle` adds or
 * takes out one term.
 */
function ScopePicker({
  label,
  value,
  onToggle,
  announcement,
  inputRef,
}: {
  label: string
  value: ScopeTerm[]
  onToggle: (t: ScopeTerm) => void
  announcement: string
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const ids = React.useId()
  const listId = `${ids}-list`
  const listRef = React.useRef<HTMLDivElement>(null)
  const mobile = useIsMobile()
  const rowHeight = mobile ? 44 : 40
  const [query, setQuery] = React.useState('')
  const [within, setWithin] = React.useState<ScopeHit | null>(null)
  const [active, setActive] = React.useState(0)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewport, setViewport] = React.useState(288)
  const [spoken, setSpoken] = React.useState('')
  const debounced = useDebounced(query.trim())
  // Clearing the words takes effect at once; only typing waits.
  const q = query.trim() ? debounced : ''

  // Outside a dimension: recent terms, or what the words find.
  const found = useQuery({
    ...scopeSearchQuery({ q }),
    enabled: !within,
    placeholderData: keepPreviousData,
  })
  const sections: Section[] = []
  const result = within ? undefined : found.data
  if (result && !q && result.recent.length)
    sections.push({ id: 'recent', heading: 'Recent', rows: result.recent.map((h) => termRow(h)) })
  if (result && q) {
    if (result.metrics.length)
      sections.push({
        id: 'metrics',
        heading: 'Metrics',
        rows: result.metrics.map((h) => termRow(h)),
      })
    for (const group of result.groups) {
      const any = termRow(group.dimension, anyValue(group.dimension.name))
      const values = group.values.map((h) => termRow(h))
      // Words that name the dimension offer "any value" first; words that found values offer them first.
      const rows = group.named ? [any, ...values] : [...values, any]
      if (group.count > group.values.length)
        rows.push({
          id: `within:${group.dimension.key}`,
          type: 'within',
          dimension: group.dimension,
          count: group.count,
          named: group.named,
        })
      sections.push({
        id: group.dimension.key,
        heading: group.dimension.name,
        count: count(group.count, group.named ? 'value' : 'match'),
        rows,
      })
    }
  }
  const flat = sections.flatMap((s) => s.rows)

  // Inside a dimension: the rows in view, a page at a time.
  const pageInput = (page: number): ScopeSearchInput => ({
    q,
    dimension: within?.key,
    limit: PAGE,
    ...(page ? { cursor: String(page * PAGE) } : {}),
  })
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const last = Math.floor((scrollTop + viewport) / rowHeight) + OVERSCAN
  const pageNumbers = [
    ...new Set([0, Math.floor(first / PAGE), Math.floor(last / PAGE), Math.floor(active / PAGE)]),
  ]
  const pages = useQueries({
    queries: pageNumbers.map((page) => ({
      ...scopeSearchQuery(pageInput(page)),
      enabled: !!within,
      placeholderData: page === 0 ? keepPreviousData : undefined,
    })),
  })
  const pageOf = (page: number) => pages[pageNumbers.indexOf(page)]?.data?.groups[0]
  const total = within ? (pageOf(0)?.count ?? 0) : flat.length
  const valueAt = (i: number) => pageOf(Math.floor(i / PAGE))?.values[i % PAGE]
  const current = Math.min(active, Math.max(0, total - 1))
  const loading = within ? pages[0]?.isPending : found.isPending && !!q

  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => setViewport(list.clientHeight || 288)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [within])

  /** Moves the active row, from the keys, and keeps it in view. */
  const moveTo = (i: number) => {
    setActive(i)
    const list = listRef.current
    if (!list) return
    if (within) {
      const top = i * rowHeight
      if (top < list.scrollTop) list.scrollTop = top
      else if (top + rowHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = top + rowHeight - list.clientHeight
    } else {
      const row = flat[i]
      if (row)
        document.getElementById(optionId(listId, row.id))?.scrollIntoView({ block: 'nearest' })
    }
  }

  const enter = (dimension: ScopeHit, named: boolean) => {
    setWithin(dimension)
    // Words that named the dimension are done; words that found its values keep searching them.
    if (named) setQuery('')
    setActive(0)
    setScrollTop(0)
    if (listRef.current) listRef.current.scrollTop = 0
    setSpoken(
      `Searching the values of ${dimension.name}. Press Backspace in the empty box to leave.`,
    )
    inputRef.current?.focus()
  }
  const leave = () => {
    if (!within) return
    setSpoken(`Left ${within.name}. Searching everything.`)
    setWithin(null)
    setActive(0)
    inputRef.current?.focus()
  }
  const pickAt = (i: number) => {
    if (within) {
      const hit = valueAt(i)
      if (hit) onToggle(termOfHit(hit))
      return
    }
    const row = flat[i]
    if (!row) return
    if (row.type === 'within') enter(row.dimension, row.named)
    else onToggle(row.term)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = (n: number) => {
      e.preventDefault()
      if (!total) return
      moveTo(
        within
          ? Math.min(total - 1, Math.max(0, current + n))
          : (current + Math.sign(n) + total) % total,
      )
    }
    if (e.key === 'ArrowDown') return step(1)
    if (e.key === 'ArrowUp') return step(-1)
    if (within && e.key === 'PageDown') return step(Math.max(1, Math.floor(viewport / rowHeight)))
    if (within && e.key === 'PageUp') return step(-Math.max(1, Math.floor(viewport / rowHeight)))
    if (e.key === 'Enter') {
      e.preventDefault()
      pickAt(current)
      return
    }
    if (e.key === 'ArrowRight' && !within && e.currentTarget.selectionStart === query.length) {
      const row = flat[current]
      const dimension =
        row?.type === 'within'
          ? { hit: row.dimension, named: row.named }
          : row?.type === 'term' && row.term.kind === 'dimension'
            ? {
                hit: result?.groups.find((g) => g.dimension.key === row.id)?.dimension,
                named: true,
              }
            : undefined
      if (dimension?.hit) {
        e.preventDefault()
        enter(dimension.hit, dimension.named)
      }
      return
    }
    if (within && (e.key === 'Escape' || (e.key === 'Backspace' && query === ''))) {
      e.preventDefault()
      e.stopPropagation()
      leave()
    }
  }

  const option = (row: { id: string; term?: ScopeTerm }, index: number) => ({
    id: optionId(listId, row.id),
    role: 'option' as const,
    'aria-selected': row.term ? holds(value, row.term) : false,
    'data-active': index === current || undefined,
    onMouseMove: () => index !== current && setActive(index),
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => pickAt(index),
  })
  const rowClass =
    'flex cursor-default items-center gap-2.5 rounded-sm px-2 text-sm outline-hidden select-none data-active:bg-muted [&_svg]:size-4 [&_svg]:shrink-0'

  const termContent = (term: ScopeTerm, text: string, hint?: string) => {
    const { Icon } = lookOf(term)
    return (
      <>
        <Icon aria-hidden className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={text}>
          {text}
        </span>
        {hint && (
          <span className="max-w-2/5 shrink-0 truncate text-xs text-muted-foreground">{hint}</span>
        )}
        <CheckIcon
          aria-hidden
          className={cn('text-foreground', !holds(value, term) && 'invisible')}
        />
      </>
    )
  }

  const empty = !loading && total === 0
  const typed = query.trim()
  const status = announcement || spoken

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {within && (
          <span
            data-slot="scope-within"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm bg-muted pr-0.5 pl-1.5 text-xs font-medium"
          >
            <span>
              <span className="sr-only">Searching in </span>
              {within.name}
            </span>
            <button
              type="button"
              aria-label={`Stop searching in ${within.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={leave}
              className="relative grid size-5 place-items-center rounded outline-none after:absolute after:-inset-2 hover:bg-chip-hover focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={within ? `Search the values of ${within.name}` : `Search ${label}`}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            total
              ? within
                ? valueAt(current) && optionId(listId, valueAt(current)!.key)
                : flat[current] && optionId(listId, flat[current].id)
              : undefined
          }
          value={query}
          placeholder={
            within
              ? total
                ? `Search ${count(total, 'value')} of ${within.name}`
                : `Search the values of ${within.name}`
              : 'Search metrics, dimensions and values'
          }
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setScrollTop(0)
            if (listRef.current) listRef.current.scrollTop = 0
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-reading outline-hidden placeholder:text-muted-foreground max-sm:text-base"
        />
      </div>
      {within && total > 0 && (
        <div
          aria-hidden
          className="mx-2 flex shrink-0 items-baseline justify-between gap-2 px-2 pt-3 pb-1.5 text-xs text-muted-foreground"
        >
          <span>{within.name}</span>
          <span className="tabular-nums">{count(total, q ? 'match' : 'value')}</span>
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={within ? `Values of ${within.name}` : label}
        aria-multiselectable
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="no-scrollbar max-h-72 min-h-0 scroll-py-1 overflow-x-hidden overflow-y-auto p-1 max-md:max-h-none max-md:flex-1"
      >
        {within && total > 0 && (
          <div className="relative mx-1" style={{ height: total * rowHeight }}>
            {Array.from({ length: Math.max(0, Math.min(total, last + 1) - first) }, (_, n) => {
              const i = first + n
              const hit = valueAt(i)
              const top = i * rowHeight
              if (!hit)
                return (
                  <div
                    key={`wait-${i}`}
                    aria-hidden
                    className="absolute inset-x-0 flex items-center px-2"
                    style={{ height: rowHeight, transform: `translateY(${top}px)` }}
                  >
                    <span className="h-3 w-2/3 rounded-sm bg-muted" />
                  </div>
                )
              const term = termOfHit(hit)
              return (
                <div
                  key={hit.key}
                  {...option({ id: hit.key, term }, i)}
                  aria-setsize={total}
                  aria-posinset={i + 1}
                  className={cn(rowClass, 'absolute inset-x-0')}
                  style={{ height: rowHeight, transform: `translateY(${top}px)` }}
                >
                  {termContent(term, hit.name, hit.alias ? `also ${hit.alias}` : undefined)}
                </div>
              )
            })}
          </div>
        )}
        {!within &&
          sections.map((s) => {
            const heading = `${listId}-${s.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-h`
            return (
              <div key={s.id} role="presentation" className="px-1 py-1">
                <div
                  aria-hidden
                  className="flex items-baseline justify-between gap-2 px-2 pt-2 pb-1.5 text-xs text-muted-foreground"
                >
                  <span id={heading}>{s.heading}</span>
                  {s.count && (
                    <span id={`${heading}-count`} className="tabular-nums">
                      {s.count}
                    </span>
                  )}
                </div>
                {/* Named with its count: "Campaign, 60 matches". */}
                <div
                  role="group"
                  aria-labelledby={s.count ? `${heading} ${heading}-count` : heading}
                >
                  {s.rows.map((row) => {
                    const i = flat.indexOf(row)
                    if (row.type === 'within')
                      return (
                        <div
                          key={row.id}
                          {...option(row, i)}
                          className={cn(rowClass, 'h-10 text-muted-foreground max-sm:h-11')}
                        >
                          <ChevronRightIcon aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            {row.named
                              ? `All ${count(row.count, 'value')} of ${row.dimension.name}`
                              : `All ${count(row.count, 'match')} in ${row.dimension.name}`}
                          </span>
                        </div>
                      )
                    return (
                      <div
                        key={row.id}
                        {...option(row, i)}
                        className={cn(rowClass, 'h-10 max-sm:h-11')}
                      >
                        {termContent(row.term, row.label, row.hint)}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        {(empty || (loading && !total)) && (
          <div role="presentation" className="px-3 py-6 text-center text-sm">
            {loading ? (
              <p className="text-muted-foreground">Searching…</p>
            ) : (within ? pages[0]?.isError : found.isError) ? (
              <p className="text-muted-foreground">
                The search didn't answer. Check your connection and type again.
              </p>
            ) : typed ? (
              <>
                <p className="font-medium">
                  Nothing called “<span className="break-all">{typed}</span>”
                  {within ? ` in ${within.name}` : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Applies to names only the metrics and dimensions your definitions source has, and
                  their values.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Type to find a metric, a dimension or one of its values.
              </p>
            )}
          </div>
        )}
      </div>
      <span role="status" className="sr-only">
        {status}
      </span>
    </div>
  )
}

/**
 * "Applies to" in the editor's property list: the chosen terms as chips, then a ghost "Add" that
 * opens the picker (a bottom sheet on a phone). Choosing a term keeps the picker open, so several
 * can be chosen in a row.
 */
export function ScopeField({
  labelId,
  label,
  value,
  onChange,
  placeholder,
}: {
  labelId: string
  label: string
  value: ScopeTerm[]
  onChange: (terms: ScopeTerm[]) => void
  placeholder: string
}) {
  const [open, setOpen] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  const mobile = useIsMobile()
  const input = React.useRef<HTMLInputElement>(null)
  const addId = React.useId()

  const toggle = (t: ScopeTerm) => {
    const next = toggleTerm(value, t)
    onChange(next.terms)
    const replaced = next.replaced.length
      ? t.kind === 'dimension'
        ? ` It replaces ${count(next.replaced.length, 'value')} of ${t.name}.`
        : ` It replaces ${anyValue(t.dimension ?? '')}.`
      : ''
    setAnnouncement(`${next.removed ? 'Took out' : 'Added'} ${termWords(t)}.${replaced}`)
  }
  const remove = (t: ScopeTerm) => {
    onChange(value.filter((x) => x !== t))
    setAnnouncement(`Took out ${termWords(t)}.`)
  }

  const picker = (
    <ScopePicker
      label={label}
      value={value}
      onToggle={toggle}
      announcement={announcement}
      inputRef={input}
    />
  )

  const trigger = (
    <button
      type="button"
      data-prop-value
      aria-labelledby={`${labelId} ${addId}-t`}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:bg-muted',
        !value.length && '-ml-1.5 h-8 text-sm',
      )}
    >
      <PlusIcon aria-hidden className="size-3" />
      <span id={`${addId}-t`}>{value.length ? 'Add' : placeholder}</span>
    </button>
  )

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 py-1">
      {value.map((t) => (
        <ScopeChip key={t.key || `${t.kind}:${t.name}`} term={t} onRemove={() => remove(t)} />
      ))}
      {mobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={trigger} />
          <SheetContent
            side="bottom"
            initialFocus={input}
            className="gap-0 pb-safe data-[side=bottom]:h-bottom-sheet"
          >
            <SheetHeader className="pb-2">
              <SheetTitle>{label}</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col px-4">{picker}</div>
            <div className="flex justify-end border-t px-4 pt-3">
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={trigger} />
          <PopoverContent
            align="start"
            initialFocus={input}
            aria-label={label}
            className="w-96 overflow-hidden p-0"
          >
            {picker}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
