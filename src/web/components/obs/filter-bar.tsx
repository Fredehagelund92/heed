import * as React from 'react'
import {
  BotIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  InboxIcon,
  LayersIcon,
  ListFilterIcon,
  PanelLeftIcon,
  SearchIcon,
  SigmaIcon,
  TagIcon,
  XIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Command, CommandFooter, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { barButton } from '@/components/heed/list'
import { TextSwitch } from '@/components/heed/switches'
import { Swatch } from '@/components/obs/charts'
import {
  chipOf,
  facetSaid,
  facetSize,
  facetWords,
  FILTER_WORDS,
  moved,
  opWords,
  toggled,
  withValues,
  type Chip,
  type FacetValue,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'
import type { Shown } from '@/model/observability'

// Overview's filter bar: the filters that are on as chips, each read as a sentence, and a
// type-ahead that adds one. F opens the list of fields and / starts typing; arrows and Enter
// choose, Esc closes, Backspace in the empty box takes the last chip off. A chip opens an editor:
// is or is not, a search over its values with what each counts, and its values to tick. Chips move
// by drag, by Alt and the arrows, or by the editor's buttons. The values' counts are the facets'
// (lib/obs-views.ts), so they follow the disclosure rules exactly. Days chosen on the chart read
// as one more chip, first: "Time is 12 to 18 Oct", changed on the chart and taken off as any other.

/** A field the bar offers, with the values it lists in order. */
export type Field = {
  key: FilterKey
  values: string[]
  /** One value at a time, and only "is": a kind of agent, which the service counts against all. */
  one?: boolean
}

export type FilterBarProps = {
  chips: Filters
  /**
   * A change, and what to say about it to a screen reader; `instant` for a chip moved, which is
   * where it was put already.
   */
  onChange: (chips: Filters, said: string, instant?: boolean) => void
  fields: Field[]
  /** Each value of a field with what it counts, without the field's own chip. */
  facet: (key: FilterKey) => FacetValue[]
  /** A value as people read it. */
  words: (key: FilterKey, v: string) => string
  /** The facets beside the topics, or in a sheet on a narrow page. */
  facets: { on: boolean; toggle: () => void; sheet: boolean }
  /** Days chosen on the chart, in words; `onEdit` goes to the chart, where they change. */
  time?: { words: string; onRemove: () => void; onEdit: () => void }
  /** Clear all: every chip, and the days chosen. */
  onClearAll?: () => void
}

const ICONS: Record<FilterKey, React.ReactNode> = {
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

/** A field's icon, for the type-ahead, the facets and the editor. */
export const fieldIcon = (key: FilterKey) => ICONS[key]

/** A count as a value's row says it, with a quiet bar of its share of the largest. */
export function ValueCount({
  f,
  max,
  state,
}: {
  f: FacetValue | undefined
  max: number
  state?: boolean
}) {
  if (!f) return null
  const words = facetWords(f.count, state)
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      {words}
      <span aria-hidden className="h-1 w-6 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-muted-foreground/40 transition-[width] duration-(--dur-3) ease-move"
          style={{ width: `${Math.round((facetSize(f.count) / Math.max(max, 1)) * 100)}%` }}
        />
      </span>
    </span>
  )
}

/** What a value's count means, read out with it. */
const countLabel = (f: FacetValue | undefined, state?: boolean) => (f ? facetSaid(f, state) : '')

/** The keys an input listens for while its list is open: arrows move, Enter picks. */
function useActive(ids: string[]) {
  const [active, setActive] = React.useState(0)
  const at = Math.min(active, Math.max(0, ids.length - 1))
  const move = (step: number) => setActive(ids.length ? (at + step + ids.length) % ids.length : 0)
  return { at, setActive, move, id: ids[at] }
}

/** The list under a box that keeps focus: it names the list and the active row for screen readers. */
function OptionList<T extends { id: string }>({
  box,
  label,
  items,
  active,
  onPick,
  onPoint,
  row,
  checked,
  head,
  empty,
  footer,
}: {
  /** The box that keeps the focus, which names the list and its active row. */
  box: React.RefObject<HTMLInputElement | null>
  label: string
  items: T[]
  active: string | undefined
  onPick: (item: T) => void
  onPoint: (index: number) => void
  row: (item: T) => React.ReactNode
  /** For a list of values to tick: whether each is ticked. */
  checked?: (item: T) => boolean
  head?: React.ReactNode
  empty: string
  footer?: React.ReactNode
}) {
  const list = React.useRef<HTMLDivElement>(null)
  // The box keeps the focus, so it says which list it controls and which row is active, by the
  // ids the list gives them.
  React.useEffect(() => {
    const el = box.current
    const option = list.current?.querySelector<HTMLElement>(
      `[data-option="${CSS.escape(active ?? '')}"]`,
    )
    option?.scrollIntoView({ block: 'nearest' })
    if (!el) return
    if (list.current?.id) el.setAttribute('aria-controls', list.current.id)
    if (option?.id) el.setAttribute('aria-activedescendant', option.id)
    else el.removeAttribute('aria-activedescendant')
  }, [active, box, items])
  React.useEffect(() => {
    const el = box.current
    return () => {
      el?.removeAttribute('aria-controls')
      el?.removeAttribute('aria-activedescendant')
    }
  }, [box])
  return (
    <Command
      shouldFilter={false}
      value={active ?? ''}
      label={label}
      // Keeps the caret in the box when a row is clicked.
      onMouseDown={(e) => e.preventDefault()}
      className="rounded-none! bg-transparent p-0"
    >
      {head}
      <CommandList ref={list} label={label} className="max-h-72 p-1">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.map((item, i) => (
            <CommandItem
              key={item.id}
              value={item.id}
              data-option={item.id}
              aria-checked={checked?.(item)}
              onSelect={() => onPick(item)}
              onPointerMove={() => onPoint(i)}
              className="min-h-8 gap-2 px-2 py-1 *:[svg:last-child]:hidden"
            >
              {row(item)}
            </CommandItem>
          ))
        )}
      </CommandList>
      {footer}
    </Command>
  )
}

/** The keys a list answers to, in its foot. */
function Keys({ back }: { back?: boolean }) {
  return (
    <CommandFooter className="h-8 gap-3 px-3">
      <span>
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> to choose
      </span>
      <span>
        <Kbd>Enter</Kbd> to add
      </span>
      {back && (
        <span>
          <Kbd>⌫</Kbd> back
        </span>
      )}
      <span>
        <Kbd>Esc</Kbd> to close
      </span>
    </CommandFooter>
  )
}

type Suggestion =
  | { id: string; kind: 'key'; key: FilterKey; on: boolean }
  | { id: string; kind: 'value'; key: FilterKey; value: string; label: string; prefix: boolean }
  | { id: string; kind: 'topic'; text: string }

/** Whether a single key goes to the page: nobody is typing, and nothing is open over it. */
const forPage = (e: KeyboardEvent) =>
  !e.metaKey &&
  !e.ctrlKey &&
  !e.altKey &&
  !(e.target as HTMLElement).closest(
    'input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]',
  )

export function FilterBar({
  chips,
  onChange,
  fields,
  facet,
  words,
  facets,
  time,
  onClearAll,
}: FilterBarProps) {
  const input = React.useRef<HTMLInputElement>(null)
  const box = React.useRef<HTMLDivElement>(null)
  const [text, setText] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<FilterKey | null>(null)
  const [said, setSaid] = React.useState('')
  const field = (k: FilterKey) => fields.find((f) => f.key === k)

  const change = (next: Filters, words: string, instant?: boolean) => {
    onChange(next, words, instant)
    setSaid(words)
  }
  const sentenceOf = (c: Chip) => {
    const values = c.values.map((v) => words(c.key, v))
    return `${FILTER_WORDS[c.key]} ${opWords(c)} ${values.join(c.key === 'topic' ? ' and ' : ', ')}`
  }
  const removeTime = () => {
    if (!time) return
    time.onRemove()
    setSaid(`Removed the filter Time is ${time.words}`)
  }
  const remove = (key: FilterKey) => {
    const c = chipOf(chips, key)
    if (!c) return
    change(
      chips.filter((x) => x.key !== key),
      `Removed the filter ${sentenceOf(c)}`,
    )
  }

  // F opens the fields, / starts typing: both in the one box.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'f' && e.key !== '/') || !forPage(e)) return
      e.preventDefault()
      setPending(null)
      input.current?.focus()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = text.trim().toLowerCase()
  const has = (label: string) => !q || label.toLowerCase().includes(q)
  const suggestions: Suggestion[] = []
  if (pending) {
    for (const v of field(pending)?.values ?? [])
      if (has(words(pending, v)))
        suggestions.push({
          id: `v:${pending}:${v}`,
          kind: 'value',
          key: pending,
          value: v,
          label: words(pending, v),
          prefix: false,
        })
  } else {
    for (const f of fields)
      if (has(FILTER_WORDS[f.key]))
        suggestions.push({ id: `k:${f.key}`, kind: 'key', key: f.key, on: !!chipOf(chips, f.key) })
    if (q.length >= 2)
      for (const f of fields)
        for (const v of f.values)
          if (has(words(f.key, v)))
            suggestions.push({
              id: `v:${f.key}:${v}`,
              kind: 'value',
              key: f.key,
              value: v,
              label: words(f.key, v),
              prefix: true,
            })
    if (q) suggestions.push({ id: 'topic', kind: 'topic', text: text.trim() })
  }
  const shown = suggestions.slice(0, 40)
  const active = useActive(shown.map((s) => s.id))
  const countOf = (key: FilterKey, v: string) => facet(key).find((f) => f.value === v)
  const maxOf = (key: FilterKey) => Math.max(1, ...facet(key).map((f) => facetSize(f.count)))

  const pick = (s: Suggestion) => {
    if (s.kind === 'key') {
      setPending(s.key)
      setText('')
      active.setActive(0)
      return
    }
    if (s.kind === 'topic') {
      const c = chipOf(chips, 'topic')
      const values = [...new Set([...(c?.values ?? []), s.text])]
      change(withValues(chips, 'topic', values), `Added the filter Topic has “${s.text}”`)
    } else {
      const c = chipOf(chips, s.key)
      const one = field(s.key)?.one
      const values = one ? [s.value] : [...new Set([...(c?.values ?? []), s.value])]
      const next = withValues(chips, s.key, values)
      change(next, `Added ${s.label}: ${sentenceOf(chipOf(next, s.key)!)}`)
    }
    setText('')
    setPending(null)
    active.setActive(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const empty = !e.currentTarget.value
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      else active.move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const s = shown[active.at]
      if (open && s) pick(s)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      if (pending) setPending(null)
      else if (open) setOpen(false)
      else e.currentTarget.blur()
    } else if (e.key === 'Backspace' && empty) {
      if (pending) setPending(null)
      else if (chips.length) remove(chips[chips.length - 1]!.key)
      else if (time) removeTime()
    } else if (e.key === 'ArrowLeft' && empty && (chips.length || time)) {
      e.preventDefault()
      setOpen(false)
      focusChip(box.current, chips.length ? chips[chips.length - 1]!.key : 'time')
    } else if (e.key === 'Tab') setOpen(false)
  }

  const row = (s: Suggestion) => {
    if (s.kind === 'key')
      return (
        <>
          <span className="flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
            {ICONS[s.key]}
          </span>
          <span className="min-w-0 flex-1 truncate">{FILTER_WORDS[s.key]}</span>
          <span className="text-xs text-muted-foreground">
            {s.on ? 'On' : s.key === 'agent' ? 'One kind at a time' : ''}
          </span>
        </>
      )
    if (s.kind === 'topic')
      return (
        <>
          <span className="flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
            <SearchIcon />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">Topic has </span>“{s.text}”
          </span>
        </>
      )
    const f = countOf(s.key, s.value)
    return (
      <>
        <span className="flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
          {s.key === 'answer' ? <Swatch state={s.value as Shown} /> : ICONS[s.key]}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {s.prefix && <span className="text-muted-foreground">{FILTER_WORDS[s.key]} is </span>}
          {s.label}
        </span>
        <ValueCount f={f} max={maxOf(s.key)} state={s.key === 'answer'} />
        <span className="sr-only">, {countLabel(f, s.key === 'answer')}</span>
      </>
    )
  }

  return (
    <div
      ref={box}
      className="flex min-h-10 flex-wrap items-center gap-1.5 border-t px-4 py-1.5 md:px-5"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={cn(barButton, facets.on && !facets.sheet && 'text-foreground')}
              aria-pressed={facets.sheet ? undefined : facets.on}
              onClick={facets.toggle}
            />
          }
        >
          <PanelLeftIcon />
          Facets
        </TooltipTrigger>
        <TooltipContent>
          {facets.sheet ? 'Every value with what it counts' : 'Show or hide the facets'}
        </TooltipContent>
      </Tooltip>
      {time && (
        <TimeChip
          time={time}
          onRemove={removeTime}
          onNext={() =>
            chips.length ? focusChip(box.current, chips[0]!.key) : input.current?.focus()
          }
        />
      )}
      <ChipRow
        chips={chips}
        fields={fields}
        facet={facet}
        words={words}
        sentenceOf={sentenceOf}
        onChange={change}
        onRemove={remove}
        input={input}
      />
      <Popover
        open={open && !!(shown.length || q)}
        onOpenChange={(o, d) => {
          // A press on the box itself keeps the list; anything else outside closes it.
          if (!o && box.current?.contains(d.event?.target as Node | null)) return
          if (!o) {
            setOpen(false)
            setPending(null)
          }
        }}
      >
        <div className="relative max-w-80 min-w-48 flex-1 @max-2xl/main:max-w-none">
          <ListFilterIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-label={
              pending ? `${FILTER_WORDS[pending]} is` : 'Filter by a field, a value or a topic'
            }
            value={text}
            placeholder={
              pending
                ? `${FILTER_WORDS[pending]} is…`
                : chips.length || time
                  ? 'Add a filter'
                  : 'Filter by answer, domain, value, metric or a topic'
            }
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
              active.setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="h-7 border-transparent bg-transparent pr-8 pl-8 text-dense shadow-none focus-visible:border-ring md:text-dense @max-2xl/main:h-11 @max-2xl/main:text-base dark:bg-transparent pointer-coarse:h-11"
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 max-md:hidden">
            F
          </Kbd>
        </div>
        <PopoverContent
          anchor={input}
          align="start"
          initialFocus={false}
          finalFocus={false}
          className="w-96 max-w-(--available-width) gap-0 p-0"
        >
          <OptionList
            box={input}
            label={pending ? FILTER_WORDS[pending] : 'Filters'}
            items={shown}
            active={active.id}
            onPick={pick}
            onPoint={active.setActive}
            row={row}
            head={
              pending && (
                <p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{FILTER_WORDS[pending]}</span> is…
                </p>
              )
            }
            empty="Nothing by that name."
            footer={<Keys back={!!pending} />}
          />
        </PopoverContent>
      </Popover>
      {chips.length + (time ? 1 : 0) > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs font-normal text-muted-foreground"
          onClick={() => {
            if (onClearAll) onClearAll()
            else onChange([], 'Cleared every filter')
            setSaid('Cleared every filter')
          }}
        >
          Clear all
        </Button>
      )}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  )
}

/** Puts focus on a chip's own button. */
function focusChip(root: HTMLElement | null, key: FilterKey | 'time') {
  root?.querySelector<HTMLElement>(`[data-chip="${key}"]`)?.focus()
}

/**
 * The days chosen on the chart, as a chip: its own button goes to the chart, where they change by
 * a drag or by Shift and the arrows; Backspace, Delete or its cross takes them off.
 */
function TimeChip({
  time,
  onRemove,
  onNext,
}: {
  time: NonNullable<FilterBarProps['time']>
  onRemove: () => void
  onNext: () => void
}) {
  const said = `Time is ${time.words}`
  return (
    <span
      data-vt-move
      className="inline-flex h-6 max-w-full min-w-0 items-center rounded-md bg-background text-xs inset-ring inset-ring-border has-[[data-chip]:focus-visible]:ring-3 has-[[data-chip]:focus-visible]:ring-ring/50"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-chip="time"
              aria-label={`${said}. Enter to change it on the chart, Backspace to remove it`}
              className="flex h-full min-w-0 items-center gap-1 truncate rounded-l-md pr-1 pl-2 outline-none select-none hover:bg-muted/60"
              onClick={time.onEdit}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault()
                  onNext()
                  onRemove()
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  onNext()
                }
              }}
            />
          }
        >
          <span className="shrink-0 text-muted-foreground">Time is</span>{' '}
          <span className="truncate font-medium tabular-nums">{time.words}</span>
        </TooltipTrigger>
        <TooltipContent>
          Change it on the chart <Kbd>B</Kbd>
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={`Remove the filter: ${said}`}
        className="grid size-6 shrink-0 place-items-center rounded-r-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}

type RowProps = {
  chips: Filters
  fields: Field[]
  facet: (key: FilterKey) => FacetValue[]
  words: (key: FilterKey, v: string) => string
  sentenceOf: (c: Chip) => string
  onChange: (chips: Filters, said: string, instant?: boolean) => void
  onRemove: (key: FilterKey) => void
  input: React.RefObject<HTMLInputElement | null>
}

/**
 * The chips, in their order. A chip's own button opens its editor; Backspace or Delete takes it
 * off, the arrows move between chips, Alt and the arrows move the chip. A pointer drags it to
 * another place, which a line shows while it moves.
 */
function ChipRow(props: RowProps) {
  const { chips, onChange, sentenceOf } = props
  const list = React.useRef<HTMLUListElement>(null)
  const [drag, setDrag] = React.useState<{
    key: FilterKey
    dx: number
    dy: number
    to: number
  } | null>(null)
  const moveTo = (key: FilterKey, to: number) => {
    const next = moved(chips, key, to)
    if (next === chips) return
    const c = chipOf(chips, key)!
    onChange(next, `Moved ${sentenceOf(c)} to place ${to + 1} of ${chips.length}`, true)
    refocus.current = key
  }
  // A chip moved by its keys keeps the focus in its new place.
  const refocus = React.useRef<FilterKey | null>(null)
  const order = chips.map((c) => c.key).join()
  React.useLayoutEffect(() => {
    if (refocus.current) focusChip(list.current, refocus.current)
    refocus.current = null
  }, [order])
  // Where a pointer would drop a chip: before the first chip whose middle it is left of, on its line.
  const dropAt = (x: number, y: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-chip]') ?? [])]
    const rects = items.map((el) => el.getBoundingClientRect())
    const line = rects.filter((r) => y >= r.top - 4 && y <= r.bottom + 4)
    const pool = line.length ? line : rects
    const before = pool.findIndex((r) => x < r.left + r.width / 2)
    const at = before < 0 ? rects.indexOf(pool[pool.length - 1]!) + 1 : rects.indexOf(pool[before]!)
    return at
  }
  if (!chips.length) return null
  return (
    <ul ref={list} aria-label="Filters" className="contents">
      {chips.map((c, i) => (
        <ChipItem
          key={c.key}
          chip={c}
          index={i}
          {...props}
          dragging={drag?.key === c.key ? drag : null}
          dropBefore={!!drag && drag.key !== c.key && drag.to === i}
          dropAfter={!!drag && i === chips.length - 1 && drag.to === chips.length}
          onMove={(to) => moveTo(c.key, to)}
          onDrag={(d) => {
            if (!d) return setDrag(null)
            setDrag({ key: c.key, dx: d.dx, dy: d.dy, to: dropAt(d.x, d.y) })
          }}
          onDrop={(d) => {
            setDrag(null)
            const to = dropAt(d.x, d.y)
            // Dropped after itself means where it already is.
            moveTo(c.key, to > i ? to - 1 : to)
          }}
        />
      ))}
    </ul>
  )
}

function ChipItem({
  chip: c,
  index,
  chips,
  fields,
  facet,
  words,
  sentenceOf,
  onChange,
  onRemove,
  input,
  dragging,
  dropBefore,
  dropAfter,
  onMove,
  onDrag,
  onDrop,
}: RowProps & {
  chip: Chip
  index: number
  dragging: { dx: number; dy: number } | null
  dropBefore: boolean
  dropAfter: boolean
  onMove: (to: number) => void
  onDrag: (d: { x: number; y: number; dx: number; dy: number } | null) => void
  onDrop: (d: { x: number; y: number }) => void
}) {
  const [open, setOpen] = React.useState(false)
  const start = React.useRef<{ x: number; y: number; id: number } | null>(null)
  const dragged = React.useRef(false)
  const shown = c.values.map((v) => words(c.key, v))
  const values =
    c.key === 'topic'
      ? shown.join(' and ')
      : shown.length > 2
        ? `${shown.slice(0, 2).join(', ')} +${shown.length - 2}`
        : shown.join(', ')
  const said = sentenceOf(c)
  const last = index === chips.length - 1

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const root = e.currentTarget.closest('ul')
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      const next = chips[index + 1] ?? chips[index - 1]
      onRemove(c.key)
      if (next) focusChip(root, next.key)
      else input.current?.focus()
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
      e.preventDefault()
      onMove(index + (e.key === 'ArrowLeft' ? -1 : 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (index > 0) focusChip(root, chips[index - 1]!.key)
      else focusChip(root?.parentElement ?? null, 'time')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (last) input.current?.focus()
      else focusChip(root, chips[index + 1]!.key)
    }
  }

  return (
    <li data-vt-move className="relative flex max-w-full min-w-0">
      {dropBefore && <DropLine side="left" />}
      <span
        className={cn(
          'inline-flex h-6 max-w-full min-w-0 items-center rounded-md bg-background text-xs inset-ring inset-ring-border transition-[opacity,box-shadow] has-[[data-chip]:focus-visible]:ring-3 has-[[data-chip]:focus-visible]:ring-ring/50',
          dragging && 'relative z-raised opacity-80 shadow-md',
          open && 'inset-ring-ring',
        )}
        style={dragging ? { translate: `${dragging.dx}px ${dragging.dy}px` } : undefined}
      >
        <Popover
          open={open}
          onOpenChange={(o) => {
            // A drag ends with a click on the chip; it moved the chip, it does not open it.
            if (o && dragged.current) {
              dragged.current = false
              return
            }
            setOpen(o)
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                data-chip={c.key}
                aria-label={`${said}. Enter to change it, Backspace to remove it, Alt and the arrows to move it`}
                className="flex h-full min-w-0 cursor-default touch-manipulation items-center gap-1 truncate rounded-l-md pr-1 pl-2 outline-none select-none hover:bg-muted/60"
                onKeyDown={onKeyDown}
                onPointerDown={(e) => {
                  if (e.button !== 0 || e.pointerType === 'touch') return
                  start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
                  dragged.current = false
                }}
                onPointerMove={(e) => {
                  const s = start.current
                  if (!s || s.id !== e.pointerId) return
                  const dx = e.clientX - s.x
                  const dy = e.clientY - s.y
                  if (!dragged.current && Math.hypot(dx, dy) < 4) return
                  if (!dragged.current)
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId)
                    } catch {
                      // A pointer that is already gone moves nothing.
                    }
                  dragged.current = true
                  onDrag({ x: e.clientX, y: e.clientY, dx, dy })
                }}
                onPointerUp={(e) => {
                  const s = start.current
                  start.current = null
                  if (!s || !dragged.current) return
                  onDrop({ x: e.clientX, y: e.clientY })
                }}
                onPointerCancel={() => {
                  start.current = null
                  dragged.current = false
                  onDrag(null)
                }}
              />
            }
          >
            <span className="shrink-0 text-muted-foreground">
              {FILTER_WORDS[c.key]} {opWords(c)}
            </span>{' '}
            <span className="truncate font-medium">{values}</span>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 gap-0 p-0"
            aria-label={`${FILTER_WORDS[c.key]} filter`}
          >
            <ChipEditor
              chip={c}
              index={index}
              chips={chips}
              field={fields.find((f) => f.key === c.key)}
              facet={facet}
              words={words}
              sentenceOf={sentenceOf}
              onChange={onChange}
              onMove={onMove}
              onRemove={() => {
                setOpen(false)
                onRemove(c.key)
                input.current?.focus()
              }}
            />
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label={`Remove the filter: ${said}`}
          className="grid size-6 shrink-0 place-items-center rounded-r-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => onRemove(c.key)}
        >
          <XIcon className="size-3" />
        </button>
      </span>
      {dropAfter && <DropLine side="right" />}
    </li>
  )
}

/** Where a dragged chip lands: a line in the gap. */
function DropLine({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-y-0.5 w-0.5 rounded-full bg-primary',
        side === 'left' ? '-left-1' : '-right-1',
      )}
    />
  )
}

/**
 * A chip's editor: whether it keeps or leaves out its values, a search over the field's values with
 * what each counts, and the values to tick. A topic's words are one box. It moves the chip too, for
 * anyone who does not drag.
 */
function ChipEditor({
  chip: c,
  index,
  chips,
  field,
  facet,
  words,
  sentenceOf,
  onChange,
  onMove,
  onRemove,
}: {
  chip: Chip
  index: number
  chips: Filters
  field: Field | undefined
  facet: (key: FilterKey) => FacetValue[]
  words: (key: FilterKey, v: string) => string
  sentenceOf: (c: Chip) => string
  onChange: (chips: Filters, said: string) => void
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const [q, setQ] = React.useState(c.key === 'topic' ? c.values.join(' ') : '')
  const search = React.useRef<HTMLInputElement>(null)
  const label = FILTER_WORDS[c.key]
  const counts = React.useMemo(() => (c.key === 'topic' ? [] : facet(c.key)), [c.key, facet])
  const byValue = new Map(counts.map((f) => [f.value, f]))
  const max = Math.max(1, ...counts.map((f) => facetSize(f.count)))
  // The field's values, and any chosen value it does not list (from a link), first.
  // The field's values, busiest first where the facets order them so, and any chosen value it
  // does not list (from a link) first.
  const listed = counts.length ? counts.map((f) => f.value) : (field?.values ?? [])
  const all = [...c.values.filter((v) => !listed.includes(v)), ...listed]
  const items = all
    .filter((v) => !q.trim() || words(c.key, v).toLowerCase().includes(q.trim().toLowerCase()))
    .map((v) => ({ id: v }))
  const active = useActive(items.map((i) => i.id))
  const set = (next: Filters) => {
    const now = chipOf(next, c.key)
    onChange(next, now ? sentenceOf(now) : `Removed the filter ${label}`)
  }
  const toggle = (v: string) =>
    set(field?.one ? withValues(chips, c.key, [v]) : toggled(chips, c.key, v))

  const moves = (
    <span className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Move left"
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
            />
          }
        >
          <ChevronLeftIcon />
        </TooltipTrigger>
        <TooltipContent>
          Move left <Kbd>⌥</Kbd> <Kbd>←</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Move right"
              disabled={index === chips.length - 1}
              onClick={() => onMove(index + 1)}
            />
          }
        >
          <ChevronRightIcon />
        </TooltipTrigger>
        <TooltipContent>
          Move right <Kbd>⌥</Kbd> <Kbd>→</Kbd>
        </TooltipContent>
      </Tooltip>
    </span>
  )
  const foot = (count: React.ReactNode) => (
    <div className="flex h-10 items-center gap-2 border-t px-2">
      <span className="pl-1 text-xs text-muted-foreground">{count}</span>
      <span className="ml-auto flex items-center gap-1">
        {chips.length > 1 && moves}
        <Button variant="ghost" size="sm" className="h-7 text-dense" onClick={onRemove}>
          Remove
        </Button>
      </span>
    </div>
  )

  if (c.key === 'topic')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const v = q.trim()
          set(v ? withValues(chips, 'topic', [v]) : chips.filter((x) => x.key !== 'topic'))
        }}
      >
        <label className="flex flex-col gap-1.5 p-3 text-xs font-medium text-muted-foreground">
          Topic has
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-8 text-sm" />
        </label>
        {foot('Enter to change it')}
      </form>
    )

  return (
    <div>
      <div className="flex items-center gap-3 px-3 pt-2.5 pb-1">
        <span className="text-sm font-medium">{label}</span>
        {field?.one ? (
          <span className="ml-auto text-xs text-muted-foreground">One kind at a time</span>
        ) : (
          <TextSwitch
            label={`${label}: keep or leave out`}
            className="ml-auto text-dense"
            value={c.not ? 'not' : 'is'}
            onChange={(v) => set(withValues(chips, c.key, c.values, v === 'not'))}
            options={[
              { value: 'is', label: c.values.length > 1 ? 'is any of' : 'is' },
              { value: 'not', label: c.values.length > 1 ? 'is none of' : 'is not' },
            ]}
          />
        )}
      </div>
      <div className="relative px-2 py-1.5">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-4.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={search}
          role="combobox"
          aria-expanded
          aria-autocomplete="list"
          aria-label={`Find a ${label.toLowerCase()}`}
          placeholder={`Find a ${label.toLowerCase()}`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            active.setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              active.move(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter' || (e.key === ' ' && !q)) {
              e.preventDefault()
              if (active.id) toggle(active.id)
            }
          }}
          className="h-8 pl-8 text-dense md:text-dense"
        />
      </div>
      <OptionList
        box={search}
        label="Values to choose from"
        items={items}
        active={active.id}
        onPick={(i) => toggle(i.id)}
        onPoint={active.setActive}
        checked={(i) => c.values.includes(i.id)}
        empty="No value by that name."
        row={(i) => {
          const on = c.values.includes(i.id)
          const f = byValue.get(i.id)
          return (
            <>
              {/* The row is the option and says it is ticked; its box is only drawn. */}
              <span inert className="flex">
                <Checkbox checked={on} className="pointer-events-none" />
              </span>
              {c.key === 'answer' && <Swatch state={i.id as Shown} />}
              <span className="min-w-0 flex-1 truncate">{words(c.key, i.id)}</span>
              <span className="sr-only">, {countLabel(f, c.key === 'answer')}</span>
              <ValueCount f={f} max={max} state={c.key === 'answer'} />
            </>
          )
        }}
      />
      {foot(`${c.values.length} chosen`)}
    </div>
  )
}
