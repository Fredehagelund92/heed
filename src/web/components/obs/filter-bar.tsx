import * as React from 'react'
import { ListFilterIcon, PanelLeftIcon, TriangleAlertIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { barButton } from '@/components/heed/list'
import { Swatch } from '@/components/obs/charts'
import { FilterPicker, iconOf, type Field, type Step } from '@/components/obs/filter-picker'
import type { ObsFilterView } from '@/api/client'
import {
  anyValue,
  chipOf,
  chipValueWords,
  keyWords,
  moved,
  opWords,
  withValues,
  type Chip,
  type DimKey,
  type FacetValue,
  type FieldKey,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'
import type { Shown } from '@/model/observability'

export type { Field } from '@/components/obs/filter-picker'

// Overview's filter bar: the filters that are on as chips, each in parts (a field or a dimension,
// how it matches, its values, and a cross), and one Filter button that opens the picker
// (filter-picker.tsx): F opens it, and / too. A chip's name or values open the picker on that
// field; how it matches flips between is and is not. Backspace in the picker's empty first step
// takes the last chip off. Chips move by drag, by Alt and the arrows. Days chosen on the chart read
// as one more chip, first: "Time is 12 to 18 Oct", changed on the chart and taken off as any other.

export type FilterBarProps = {
  chips: Filters
  /**
   * A change, and what to say about it to a screen reader; `instant` for a chip moved, which is
   * where it was put already.
   */
  onChange: (chips: Filters, said: string, instant?: boolean) => void
  fields: Field[]
  /** Each value of a field with what it counts, without the field's own chip. */
  facet: (key: FieldKey) => FacetValue[]
  /** A value as people read it. */
  words: (key: FilterKey, v: string) => string
  /** The view the picker's counts follow, its range in days, and what they cannot follow. */
  view: ObsFilterView
  days: number
  left: string[]
  pinned: DimKey[]
  recent: DimKey[]
  /** Why an old Value chip was not read as a dimension's, when it was not. */
  legacy?: string
  /** The facets beside the topics, or in a sheet on a narrow page. */
  facets: { on: boolean; toggle: () => void; sheet: boolean }
  /** Days chosen on the chart, in words; `onEdit` goes to the chart, where they change. */
  time?: { words: string; onRemove: () => void; onEdit: () => void }
  /** Clear all: every chip, and the days chosen. */
  onClearAll?: () => void
}

/** A field's icon, for the picker, the facets and the chips. */
export const fieldIcon = iconOf

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
  view,
  days,
  left,
  pinned,
  recent,
  legacy,
  facets,
  time,
  onClearAll,
}: FilterBarProps) {
  const button = React.useRef<HTMLButtonElement>(null)
  const box = React.useRef<HTMLDivElement>(null)
  const [said, setSaid] = React.useState('')
  const [at, setAt] = React.useState<{
    step: Step
    anchor: Element | null
    fromChip: boolean
    /** Where the focus goes back to when the picker shuts. */
    back: FilterKey | null
  } | null>(null)

  const change = (next: Filters, words: string, instant?: boolean) => {
    onChange(next, words, instant)
    setSaid(words)
  }
  const sentenceOf = (c: Chip) => {
    const values = chipValueWords(c, words)
    const list =
      typeof values === 'string' ? values : values.join(c.key === 'topic' ? ' and ' : ', ')
    return `${keyWords(c.key)} ${opWords(c)} ${list}`
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
  const open = (step: Step, anchor: Element | null, fromChip = false) =>
    setAt({ step, anchor, fromChip, back: fromChip && step && step !== 'all' ? step : null })
  const close = () => {
    const back = at?.back
    setAt(null)
    // The focus goes back where the picker was opened from, once it has shut: the chip, else the
    // button.
    window.setTimeout(() => {
      const chip = back
        ? box.current?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(back)}"]`)
        : null
      ;(chip ?? button.current)?.focus({ preventScroll: true })
    }, 0)
  }

  // F opens the picker, / too: the same list, its box ready to type in.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'f' && e.key !== '/') || !forPage(e)) return
      e.preventDefault()
      setAt({ step: null, anchor: button.current, fromChip: false, back: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
            chips.length ? focusChip(box.current, chips[0]!.key) : button.current?.focus()
          }
        />
      )}
      <ChipRow
        chips={chips}
        words={words}
        legacy={legacy}
        sentenceOf={sentenceOf}
        onChange={change}
        onRemove={remove}
        onEdit={(key, anchor) => open(key, anchor, true)}
        button={button}
      />
      <Button
        ref={button}
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={!!at && !at.fromChip}
        aria-keyshortcuts="F"
        className="h-7 gap-1.5 px-2 text-dense font-normal @max-2xl/main:h-11 pointer-coarse:h-11"
        onClick={(e) => (at ? close() : open(null, e.currentTarget))}
      >
        <ListFilterIcon />
        Filter
        <Kbd aria-hidden className="pointer-events-none max-md:hidden">
          F
        </Kbd>
      </Button>
      <FilterPicker
        chips={chips}
        onChange={(next, words) => change(next, words)}
        fields={fields}
        facet={facet}
        words={words}
        view={view}
        days={days}
        left={left}
        pinned={pinned}
        recent={recent}
        at={at}
        onClose={close}
        onBackspace={() => {
          if (chips.length) remove(chips[chips.length - 1]!.key)
          else if (time) removeTime()
        }}
      />
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
  words: (key: FilterKey, v: string) => string
  legacy?: string
  sentenceOf: (c: Chip) => string
  onChange: (chips: Filters, said: string, instant?: boolean) => void
  onRemove: (key: FilterKey) => void
  /** Opens the picker on the chip's field or dimension, under the chip. */
  onEdit: (key: FilterKey, anchor: Element) => void
  button: React.RefObject<HTMLButtonElement | null>
}

/**
 * The chips, in their order. A chip's name opens the picker on it; Backspace or Delete takes it
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
  words,
  legacy,
  sentenceOf,
  onChange,
  onRemove,
  onEdit,
  button,
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
  const start = React.useRef<{ x: number; y: number; id: number } | null>(null)
  const dragged = React.useRef(false)
  const shell = React.useRef<HTMLSpanElement>(null)
  const listed = chipValueWords(c, words)
  // One or two values by name, more as how many.
  const values =
    typeof listed === 'string'
      ? listed
      : c.key === 'topic'
        ? listed.join(' and ')
        : listed.length > 2
          ? `${listed.length} values`
          : listed.join(', ')
  const said = sentenceOf(c)
  const last = index === chips.length - 1
  // How it matches flips between is and is not: a topic's words and a kind of agent have one way.
  const flips = c.key !== 'topic' && c.key !== 'agent'
  const old = c.key === 'market' && legacy
  const edit = () => shell.current && c.key !== 'topic' && onEdit(c.key, shell.current)

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const root = e.currentTarget.closest('ul')
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      const next = chips[index + 1] ?? chips[index - 1]
      onRemove(c.key)
      if (next) focusChip(root, next.key)
      else button.current?.focus()
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
      e.preventDefault()
      onMove(index + (e.key === 'ArrowLeft' ? -1 : 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (index > 0) focusChip(root, chips[index - 1]!.key)
      else focusChip(root?.parentElement ?? null, 'time')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (last) button.current?.focus()
      else focusChip(root, chips[index + 1]!.key)
    }
  }
  const part =
    'flex h-full min-w-0 shrink-0 items-center gap-1 px-1.5 outline-none select-none hover:bg-muted/60 focus-visible:bg-muted/60'

  return (
    <li data-vt-move className="relative flex max-w-full min-w-0">
      {dropBefore && <DropLine side="left" />}
      <span
        ref={shell}
        className={cn(
          'inline-flex h-6 max-w-full min-w-0 items-center divide-x divide-border overflow-hidden rounded-md bg-background text-xs inset-ring inset-ring-border transition-[opacity,box-shadow] has-[button:focus-visible]:ring-3 has-[button:focus-visible]:ring-ring/50 @max-2xl/main:h-8 pointer-coarse:h-8',
          dragging && 'relative z-raised opacity-80 shadow-md',
        )}
        style={dragging ? { translate: `${dragging.dx}px ${dragging.dy}px` } : undefined}
      >
        <button
          type="button"
          data-chip={c.key}
          aria-label={`${said}. Enter to change it, Backspace to remove it, Alt and the arrows to move it`}
          className={cn(part, 'cursor-default touch-manipulation pl-2')}
          onClick={() => {
            // A drag ends with a click on the chip; it moved the chip, it does not open it.
            if (dragged.current) {
              dragged.current = false
              return
            }
            edit()
          }}
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
        >
          <span
            aria-hidden
            className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3"
          >
            {c.key === 'answer' && c.values.length === 1 && !c.not ? (
              <Swatch state={c.values[0] as Shown} />
            ) : (
              fieldIcon(c.key)
            )}
          </span>
          <span className="max-w-40 truncate">{keyWords(c.key)}</span>
        </button>
        {flips ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            title={c.not ? 'Keep these instead' : 'Leave these out instead'}
            className={cn(part, 'text-muted-foreground')}
            onClick={() => {
              const next = withValues(chips, c.key, c.values, !c.not)
              onChange(next, sentenceOf(chipOf(next, c.key)!))
            }}
          >
            {opWords(c)}
          </button>
        ) : (
          <span className={cn(part, 'text-muted-foreground hover:bg-transparent')} aria-hidden>
            {opWords(c)}
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title={old ? legacy : undefined}
          className={cn(part, 'min-w-0 shrink font-medium')}
          onClick={edit}
        >
          {old && <TriangleAlertIcon className="size-3 shrink-0 text-warn" />}
          <span className={cn('truncate', anyValue(c) && 'font-normal')}>{values}</span>
        </button>
        <button
          type="button"
          aria-label={`Remove the filter: ${said}`}
          className="grid h-full w-6 shrink-0 place-items-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted @max-2xl/main:w-8 pointer-coarse:w-8"
          onClick={() => onRemove(c.key)}
        >
          <XIcon className="size-3" />
        </button>
      </span>
      {old && <span className="sr-only">{legacy}</span>}
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
