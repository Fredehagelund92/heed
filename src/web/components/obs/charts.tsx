import * as React from 'react'
import { cn } from '@/lib/utils'
import { SHOWN, shownSum, STATE_WORDS, type Counts, type Shown } from '@/model/observability'
import { ArrivedAfterWait } from '@/lib/loading'

// Observability's charts, small SVG on the app's own tokens. One rule for colour: blue is the one
// colour for checked context, amber for what to look at, greys for the rest, and a hatch for
// "nothing written down", so every state also differs by shape and never by colour alone. Each
// chart carries a table of its numbers for screen readers; the drawing itself is decoration.

/** How each state fills a bar; "nothing written down" is the hatch, by its pattern's id. */
const fillOf = (state: Shown, hatch: string) =>
  ({
    grounded: 'var(--primary)',
    partial: 'var(--chart-1)',
    conflict: 'var(--caution)',
    stale: 'color-mix(in oklab, var(--caution) 45%, var(--background))',
    missing: `url(#${hatch})`,
  })[state]

/** A pattern id unique on the page: useId's colons aren't allowed in url(#...). */
const useHatchId = () => `obs-hatch-${React.useId().replace(/[^a-zA-Z0-9-]/g, '')}`

/** The diagonal hatch "nothing written down" is drawn with, defined once per chart. */
function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        width="5"
        height="5"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="5" height="5" fill="var(--muted)" />
        <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-2)" strokeWidth="1.6" />
      </pattern>
    </defs>
  )
}

/** A swatch for a legend: the same fill a bar has. */
export function Swatch({ state, className }: { state: Shown; className?: string }) {
  const id = useHatchId()
  return (
    <svg aria-hidden width="10" height="10" className={cn('shrink-0', className)}>
      {state === 'missing' && <Hatch id={id} />}
      <rect width="10" height="10" fill={fillOf(state, id)} />
    </svg>
  )
}

export function Legend({ states = SHOWN, className }: { states?: Shown[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)}>
      {states.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <Swatch state={s} />
          {STATE_WORDS[s]}
        </li>
      ))}
    </ul>
  )
}

/** A round upper bound for an axis, with four steps. */
export function niceMax(n: number) {
  if (n <= 8) return 8
  const step = Math.pow(10, Math.floor(Math.log10(n / 4)))
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * step).find((u) => u * 4 >= n)!
  return unit * 4
}

export type Bar = { label: string; at?: number; counts: Counts }

/**
 * A chart's drawn width: its box's real width, so its words stay their size on a phone. It is
 * measured before the first paint, so the chart never shows at the fallback's height and then
 * shrinks, moving everything under it (and a scroll to the topics that has already run).
 */
function useWidth(fallback: number) {
  const ref = React.useRef<HTMLElement>(null)
  const [w, setW] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (width: number) => setW(Math.max(260, Math.round(width)))
    fit(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => fit(e?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** About how wide a chart label of 12 px is, per character. */
const LABEL_CHAR = 6.7

/**
 * One dashed line per bar with a publish, and its label above the plot ("Published", "2
 * published") only where it has room: a label that would run into the one before it is left out,
 * and the line, the tooltip and the table for a screen reader still say it. A label that would run
 * past the right edge ends at its line instead.
 */
export function publishLines(
  marks: readonly { index: number }[],
  xOf: (index: number) => number,
  left: number,
  right: number,
): { index: number; x: number; label?: string; end?: boolean }[] {
  const counts = new Map<number, number>()
  for (const m of marks) counts.set(m.index, (counts.get(m.index) ?? 0) + 1)
  let free = left
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, n]) => {
      const x = xOf(index)
      const label = n > 1 ? `${n} published` : 'Published'
      const width = label.length * LABEL_CHAR
      const end = x + 4 + width > right
      const from = end ? x - 4 - width : x + 4
      if (from < free) return { index, x }
      free = from + width + 6
      return { index, x, label, end }
    })
}

/** The bars chosen on a chart, the first and the last, by their place. */
export type Span = { from: number; to: number }

/** How bars were chosen: by a drag on its way (nothing kept yet), by a drag or press, or by a key. */
export type SpanStep = 'live' | 'done' | 'key'

/** How near an edge of the bars chosen a press takes that edge, in px of the drawing: a finger, wider. */
const EDGE = { mouse: 7, touch: 16 }

/**
 * Questions per day (or per week), stacked by how they were answered, with a dashed line at each
 * publish so you can see whether the hatch of "nothing written down" shrank after it. Narrowed to
 * some answer states, it draws only those, on their own scale. Bars that are already on screen
 * move to their new heights when the view changes; another range draws new bars.
 *
 * With `onSpan` it chooses days: a drag across the bars chooses a run of them, a drag on the run
 * moves it and a drag on an edge moves that edge; a press beside the run clears it. With `onDrill`
 * a part of a bar looks at only that answer. All of it works from the keys too, once the chart has
 * focus: Left and Right move between bars, Up and Down between their parts, Enter looks at only
 * the part (or chooses the bar), Shift and Left or Right choose a run, Alt and Left or Right move
 * it, Escape clears it.
 */
export function StackedBars({
  bars,
  marks = [],
  states = SHOWN,
  height = 220,
  caption,
  span = null,
  onSpan,
  spanWords,
  onDrill,
}: {
  bars: Bar[]
  /** Publishes: the index of the bar they fall on, and what was published. */
  marks?: { index: number; title: string }[]
  /** The answer states drawn, in their order. */
  states?: Shown[]
  height?: number
  caption: string
  /** The bars chosen, when the chart chooses days. */
  span?: Span | null
  /** Bars chosen or cleared: `live` while a drag is on its way, `key` from the keys, else `done`. */
  onSpan?: (span: Span | null, step: SpanStep) => void
  /** The days of a run of bars, in words: "12 to 18 Oct". */
  spanWords?: (span: Span) => string
  /** A part of a bar pressed, or Enter on it: look at only that answer. */
  onDrill?: (state: Shown) => void
}) {
  const [hover, setHover] = React.useState<{ bar: number; part?: Shown } | null>(null)
  const [cursor, setCursor] = React.useState<{ bar: number; part?: Shown } | null>(null)
  const [keyed, setKeyed] = React.useState(false)
  const [zone, setZone] = React.useState<'edge' | 'body' | 'part' | 'plot'>('plot')
  const [said, setSaid] = React.useState('')
  const drag = React.useRef<{
    mode: 'new' | 'from' | 'to' | 'move'
    start: number
    orig: Span | null
    x: number
    moved: boolean
    part?: Shown
    to: Span | null
  } | null>(null)
  const [dragging, setDragging] = React.useState<'move' | 'other' | null>(null)
  const svg = React.useRef<SVGSVGElement>(null)
  const helpId = React.useId()
  const hatch = useHatchId()
  const [box, W] = useWidth(640)
  // The bars grow from the baseline once, only when they arrive after a wait the person saw; a
  // filter, a hover or a revisit shows them as they are.
  const arrived = React.useContext(ArrivedAfterWait)
  const [grow, setGrow] = React.useState(arrived)
  React.useEffect(() => {
    if (!grow) return
    const t = window.setTimeout(() => setGrow(false), 800)
    return () => window.clearTimeout(t)
  }, [grow])
  const H = height
  const pad = { l: 36, r: 8, t: 20, b: 24 }
  const drawn = (b: Bar) => states.reduce((n, s) => n + (b.counts[s] ?? 0), 0)
  const hidden = (b: Bar) => states.some((s) => b.counts[s] === null)
  const max = niceMax(Math.max(...bars.map(drawn), 1))
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const slot = plotW / bars.length
  const bw = Math.max(3, Math.min(38, slot * 0.66))
  const y = (v: number) => pad.t + plotH - (v / max) * plotH
  // Every label when there is room for it, else every second or fifth.
  const room = slot >= 44 ? 1 : slot >= 22 ? 2 : 5
  const every = Math.max(room, bars.length > 20 ? 5 : 1)
  const lines = publishLines(marks, (i) => pad.l + slot * i, pad.l, W - pad.r)
  const choosing = !!onSpan
  const last = bars.length - 1
  const clamp = (i: number) => Math.max(0, Math.min(last, i))
  const edges = (s: Span) => [pad.l + slot * s.from, pad.l + slot * (s.to + 1)] as const

  /** A pointer's place in the drawing's own units, and the bar under it. */
  const at = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect()
    const x = ((clientX - r.left) / Math.max(1, r.width)) * W
    return { x, bar: clamp(Math.floor((x - pad.l) / slot)) }
  }
  /** What a press there would take hold of: an edge of the run, the run, or a fresh choice. */
  const holdAt = (x: number, edge = EDGE.mouse): 'new' | 'from' | 'to' | 'move' => {
    if (!span) return 'new'
    const [x0, x1] = edges(span)
    if (Math.abs(x - x0) <= edge) return 'from'
    if (Math.abs(x - x1) <= edge) return 'to'
    return x > x0 && x < x1 ? 'move' : 'new'
  }
  const partOf = (target: EventTarget | null) =>
    ((target as Element | null)?.closest?.('[data-part]')?.getAttribute('data-part') ??
      undefined) as Shown | undefined

  /** A bar read out: its day, and each answer drawn with its count. */
  const barSaid = (i: number, part?: Shown) => {
    const b = bars[i]
    if (!b) return ''
    const cells = states.map((s) => `${STATE_WORDS[s]} ${b.counts[s] ?? 'hidden'}`)
    const pub = marks.some((m) => m.index === i) ? ', published' : ''
    const on = span && i >= span.from && i <= span.to ? ', selected' : ''
    if (part)
      return `${b.label}${on}: ${STATE_WORDS[part]} ${b.counts[part] ?? 'hidden'}. Enter to look at only ${STATE_WORDS[part]}`
    return `${b.label}${pub}${on}: ${cells.join(', ')}`
  }
  const drill = (part: Shown) => {
    onDrill?.(part)
    setSaid(`Added the filter Answer is ${STATE_WORDS[part]}`)
  }
  const choose = (next: Span | null, step: SpanStep) => {
    onSpan?.(next, step)
    if (step !== 'live') setSaid(next ? `Selected ${spanWords?.(next) ?? ''}` : 'Selection cleared')
  }
  const keyStep = (next: Span) => choose(next, 'key')

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!choosing || e.button !== 0) return
    setKeyed(false)
    const p = at(e.clientX)
    const mode = holdAt(p.x, e.pointerType === 'touch' ? EDGE.touch : EDGE.mouse)
    drag.current = {
      mode,
      start: p.bar,
      orig: span,
      x: e.clientX,
      moved: false,
      part: partOf(e.target),
      to: span,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = at(e.clientX)
    const d = drag.current
    if (!d) {
      const part = partOf(e.target)
      setHover((h) => (h?.bar === p.bar && h.part === part ? h : { bar: p.bar, part }))
      if (choosing) {
        const hold = holdAt(p.x)
        setZone(
          hold === 'from' || hold === 'to'
            ? 'edge'
            : hold === 'move'
              ? 'body'
              : part && onDrill
                ? 'part'
                : 'plot',
        )
      }
      return
    }
    if (!d.moved && Math.abs(e.clientX - d.x) < 4) return
    if (!d.moved) setDragging(d.mode === 'move' ? 'move' : 'other')
    d.moved = true
    const o = d.orig
    let next: Span
    if (d.mode === 'move' && o) {
      const w = o.to - o.from
      const from = Math.max(0, Math.min(last - w, o.from + p.bar - d.start))
      next = { from, to: from + w }
    } else if (d.mode === 'from' && o)
      next = { from: Math.min(p.bar, o.to), to: Math.max(p.bar, o.to) }
    else if (d.mode === 'to' && o)
      next = { from: Math.min(p.bar, o.from), to: Math.max(p.bar, o.from) }
    else next = { from: Math.min(d.start, p.bar), to: Math.max(d.start, p.bar) }
    if (d.to && d.to.from === next.from && d.to.to === next.to) return
    d.to = next
    choose(next, 'live')
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    if (!d) return
    if (d.moved) return choose(d.to, 'done')
    if (d.part && onDrill) return drill(d.part)
    // A press beside the run, that moved nothing, clears it.
    if (d.mode === 'new' && span) choose(null, 'done')
  }
  const onPointerCancel = () => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    if (d?.moved) onSpan?.(d.orig, 'live')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!choosing || e.metaKey || e.ctrlKey) return
    // A key shows where the keys are, as a focus ring would.
    setKeyed(true)
    const now = cursor?.bar ?? (span ? span.to : last)
    // The parts of a bar the keys step through, from the bottom up: those drawn, with a count.
    const parts = (i: number) => states.filter((s) => bars[i]?.counts[s] !== 0)
    const go = (bar: number, part?: Shown) => {
      const keep = part && parts(bar).includes(part) ? part : undefined
      setCursor({ bar, part: keep })
      setSaid(barSaid(bar, keep))
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const dir = e.key === 'ArrowLeft' ? -1 : 1
      if (e.altKey && span) {
        const w = span.to - span.from
        const from = Math.max(0, Math.min(last - w, span.from + dir))
        keyStep({ from, to: from + w })
        setCursor({ bar: dir < 0 ? from : from + w })
      } else if (e.shiftKey) {
        const anchor =
          span && now === span.from ? span.to : span && now === span.to ? span.from : now
        const to = clamp(now + dir)
        keyStep({ from: Math.min(anchor, to), to: Math.max(anchor, to) })
        setCursor({ bar: to })
      } else if (!e.altKey) go(clamp(now + dir), cursor?.part)
    } else if ((e.key === 'Home' || e.key === 'End') && !e.altKey) {
      e.preventDefault()
      go(e.key === 'Home' ? 0 : last, cursor?.part)
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
      e.preventDefault()
      const list = parts(now)
      if (!list.length) return
      const i = cursor?.part ? list.indexOf(cursor.part) : -1
      const j = e.key === 'ArrowUp' ? i + 1 : i < 0 ? list.length - 1 : i - 1
      go(now, j < 0 || j >= list.length ? undefined : list[j])
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (cursor?.part && onDrill) drill(cursor.part)
      else keyStep({ from: now, to: now })
    } else if (e.key === 'Escape' && span) {
      e.preventDefault()
      e.stopPropagation()
      choose(null, 'done')
    }
  }

  // The bar a tooltip is for: the one pointed at, or the one the keys are on; none while dragging.
  const tipAt = dragging ? null : (hover?.bar ?? (keyed ? (cursor?.bar ?? null) : null))
  const tip = tipAt !== null ? bars[tipAt] : null
  const tipPart = tipAt === hover?.bar ? hover?.part : cursor?.part
  const outside = (i: number) => !!span && (i < span.from || i > span.to)
  const sumOf = (s: Span) => {
    const picked = bars.slice(s.from, s.to + 1)
    return `${picked.reduce((n, b) => n + drawn(b), 0).toLocaleString('en-GB')}${picked.some(hidden) ? '+' : ''}`
  }
  const cursorAt = keyed && cursor ? cursor : null

  return (
    <figure
      ref={box}
      className={cn(
        'relative m-0',
        choosing &&
          'rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background',
      )}
      {...(choosing
        ? {
            tabIndex: 0,
            role: 'group',
            'aria-roledescription': 'chart',
            'aria-label': caption,
            'aria-describedby': helpId,
            'data-chart': 'questions',
            onKeyDown,
            onFocus: (e: React.FocusEvent<HTMLElement>) => {
              if (e.target !== e.currentTarget) return
              setKeyed(e.currentTarget.matches(':focus-visible'))
            },
            onBlur: () => {
              setKeyed(false)
              setCursor(null)
            },
          }
        : {})}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className={cn(
          'block h-auto w-full',
          choosing && 'touch-pan-y select-none',
          choosing &&
            (dragging === 'move'
              ? 'cursor-grabbing'
              : dragging
                ? 'cursor-ew-resize'
                : zone === 'edge'
                  ? 'cursor-ew-resize'
                  : zone === 'body'
                    ? 'cursor-grab'
                    : zone === 'part'
                      ? 'cursor-pointer'
                      : 'cursor-crosshair'),
        )}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => !drag.current && setHover(null)}
      >
        <Hatch id={hatch} />
        {span && (
          <rect
            data-span
            x={edges(span)[0]}
            y={pad.t - 1}
            width={edges(span)[1] - edges(span)[0]}
            height={plotH + 1}
            fill="color-mix(in oklab, var(--primary) 8%, transparent)"
            rx={3}
          />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--border)"
              strokeDasharray={f === 0 ? undefined : '2 3'}
            />
            <text
              x={pad.l - 6}
              y={y(max * f) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-xs tabular-nums"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2
          const pointed = hover && !dragging ? hover.bar : null
          let acc = 0
          return (
            // A bar is its day in this range: another range has other days, so other bars.
            <g
              key={`${bars.length}-${i}`}
              opacity={(outside(i) ? 0.35 : 1) * (pointed !== null && pointed !== i ? 0.55 : 1)}
            >
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" />
              <g
                className={cn(grow && 'bar-grow')}
                style={
                  grow ? { animationDelay: `calc(var(--stagger) * ${Math.min(i, 6)})` } : undefined
                }
              >
                {/* Every state has its part, empty when it is not drawn, so a part can move to and from nothing. */}
                {SHOWN.map((s) => {
                  const v = states.includes(s) ? (b.counts[s] ?? 0) : 0
                  const top = y(acc + v)
                  const h = y(acc) - top
                  acc += v
                  return (
                    <rect
                      key={s}
                      data-part={v ? s : undefined}
                      className="bar-move"
                      x={x}
                      y={top}
                      width={bw}
                      height={Math.max(0, h - (v ? 0.5 : 0))}
                      fill={fillOf(s, hatch)}
                    />
                  )
                })}
              </g>
              {i % every === 0 && (
                <text
                  x={x + bw / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-xs"
                >
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
        {lines.map((m) => (
          <g key={m.index} pointerEvents="none">
            <line
              x1={m.x}
              x2={m.x}
              y1={pad.t - 6}
              y2={pad.t + plotH}
              stroke="var(--foreground)"
              strokeDasharray="2 2"
              strokeWidth="1"
            />
            {m.label && (
              <text
                x={m.end ? m.x - 4 : m.x + 4}
                y={pad.t - 8}
                textAnchor={m.end ? 'end' : 'start'}
                className="fill-foreground text-xs"
              >
                {m.label}
              </text>
            )}
          </g>
        ))}
        {/* The run chosen, drawn over the bars: its outline, and a grip on each edge. */}
        {span && choosing && (
          <g pointerEvents="none">
            <rect
              x={edges(span)[0] + 0.5}
              y={pad.t - 0.5}
              width={Math.max(0, edges(span)[1] - edges(span)[0] - 1)}
              height={plotH}
              fill="none"
              stroke="var(--primary)"
              rx={3}
            />
            {edges(span).map((x, i) => (
              <rect
                key={i}
                x={x - 2}
                y={pad.t + plotH / 2 - 11}
                width={4}
                height={22}
                rx={2}
                fill="var(--primary)"
              />
            ))}
          </g>
        )}
        {/* Where the keys are: the bar, or the part of it. */}
        {cursorAt && bars[cursorAt.bar] && (
          <CursorMark
            at={cursorAt}
            bar={bars[cursorAt.bar]!}
            states={states}
            x={pad.l + slot * cursorAt.bar}
            slot={slot}
            bw={bw}
            top={pad.t}
            plotH={plotH}
            y={y}
          />
        )}
      </svg>
      {dragging && span && (
        // Over the middle of the run, above the plot, clear of the publish lines' labels.
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 z-raised -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background tabular-nums"
          style={{
            left: `clamp(5rem, ${((edges(span)[0] + edges(span)[1]) / 2 / W) * 100}%, calc(100% - 5rem))`,
          }}
        >
          {spanWords?.(span)}: {sumOf(span)} {states.length < SHOWN.length ? 'shown' : 'asked'}
        </div>
      )}
      {tip && (
        // On the side away from its bar, so it never covers what it describes.
        <div
          className={cn(
            'pointer-events-none absolute top-2 z-raised min-w-48 rounded-md border bg-popover px-3 py-2 text-xs shadow-md',
            tipAt !== null && tipAt >= bars.length / 2 ? 'left-10' : 'right-2',
          )}
        >
          <p className="mb-1 font-medium">
            {tip.label}: {drawn(tip)}
            {hidden(tip) ? '+' : ''} {states.length < SHOWN.length ? 'shown' : 'asked'}
          </p>
          <ul className="flex flex-col gap-0.5">
            {states
              .filter((s) => tip.counts[s] !== 0)
              .map((s) => (
                <li
                  key={s}
                  className={cn(
                    '-mx-1.5 flex items-center gap-1.5 rounded-sm px-1.5',
                    tipPart === s && 'bg-muted font-medium',
                  )}
                >
                  <Swatch state={s} />
                  <span
                    className={cn(
                      'flex-1',
                      tipPart === s ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {STATE_WORDS[s]}
                  </span>
                  <span className="tabular-nums">{tip.counts[s] ?? 'Hidden'}</span>
                </li>
              ))}
          </ul>
          {marks
            .filter((m) => m.index === tipAt)
            .map((m, i) => (
              <p key={i} className={cn(i === 0 ? 'mt-1.5 border-t pt-1.5' : 'mt-0.5')}>
                Published: {m.title}
              </p>
            ))}
          {onDrill && tipPart && (
            <p className="mt-1.5 border-t pt-1.5 text-muted-foreground">
              {keyed ? 'Enter' : 'Click'} to look at only {STATE_WORDS[tipPart]}
            </p>
          )}
        </div>
      )}
      {choosing && (
        <>
          <p id={helpId} className="sr-only">
            Left and Right move between bars, Up and Down between their answers. Enter on an answer
            looks at only it; Enter on a bar selects it. Shift and Left or Right select a run of
            bars, Alt and Left or Right move it, Escape clears it.
          </p>
          <p className="sr-only" aria-live="polite">
            {said}
          </p>
        </>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {states.map((s) => (
              <th key={s} scope="col">
                {STATE_WORDS[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bars.map((b, i) => (
            <tr key={i}>
              <th scope="row">
                {b.label}
                {marks.some((m) => m.index === i) ? ', published' : ''}
                {span && !outside(i) ? ', selected' : ''}
              </th>
              {states.map((s) => (
                <td key={s}>{b.counts[s] ?? 'Hidden'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Where a chart's keys are: a ring round the bar, or round the part of it. */
function CursorMark({
  at,
  bar,
  states,
  x,
  slot,
  bw,
  top,
  plotH,
  y,
}: {
  at: { bar: number; part?: Shown }
  bar: Bar
  states: Shown[]
  x: number
  slot: number
  bw: number
  top: number
  plotH: number
  y: (v: number) => number
}) {
  if (!at.part)
    return (
      <rect
        x={x + 1}
        y={top - 1}
        width={Math.max(0, slot - 2)}
        height={plotH + 1}
        fill="none"
        stroke="var(--ring)"
        strokeWidth={2}
        rx={3}
        pointerEvents="none"
      />
    )
  // The part's place in its stack: what the drawn states under it add up to.
  let below = 0
  for (const s of SHOWN) {
    if (s === at.part) break
    if (states.includes(s)) below += bar.counts[s] ?? 0
  }
  const v = bar.counts[at.part] ?? 0
  return (
    <rect
      x={x + (slot - bw) / 2 - 2}
      y={y(below + v) - 2}
      width={bw + 4}
      height={Math.max(4, y(below) - y(below + v) + 4)}
      fill="none"
      stroke="var(--ring)"
      strokeWidth={2}
      rx={3}
      pointerEvents="none"
    />
  )
}

/** A list of bars side by side: a name, a bar, a number. `hatch` is the share drawn as "nothing written down". */
export function BarRows({
  rows,
  caption,
  quiet,
}: {
  rows: {
    key: string
    name: React.ReactNode
    label: string
    value: number
    display?: string
    hatch?: number
    href?: string
    onClick?: () => void
  }[]
  caption: string
  /** Grey bars, all but the first: for counts that are no state (kinds of agent). */
  quiet?: boolean
}) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  const hatch = useHatchId()
  return (
    <div>
      <ul className="flex flex-col">
        {rows.map((r, i) => {
          const w = (r.value / max) * 100
          const inner = (
            <>
              <span
                className="w-36 min-w-0 shrink-0 truncate text-xs @max-md/main:w-28"
                title={r.label}
              >
                {r.name}
              </span>
              <span
                aria-hidden
                className="relative h-2.5 min-w-0 flex-1 overflow-hidden bg-muted/70"
              >
                <span
                  className={cn(
                    'absolute inset-y-0 left-0',
                    quiet && i > 0 ? 'bg-chart-2' : 'bg-primary',
                  )}
                  style={{ width: `${w}%` }}
                />
                {!!r.hatch && (
                  <svg
                    className="absolute inset-y-0 left-0 h-full"
                    style={{ width: `${w * r.hatch}%` }}
                    preserveAspectRatio="none"
                  >
                    <Hatch id={`${hatch}-${r.key}`} />
                    <rect width="100%" height="100%" fill={`url(#${hatch}-${r.key})`} />
                  </svg>
                )}
              </span>
              <span className="min-w-10 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {r.display ?? r.value}
              </span>
              {!!r.hatch && (
                <span className="sr-only">, {Math.round(r.hatch * 100)} in 100 not found</span>
              )}
            </>
          )
          return (
            <li key={r.key}>
              {r.href || r.onClick ? (
                <a
                  href={r.href}
                  onClick={(e) => {
                    if (r.onClick) {
                      e.preventDefault()
                      r.onClick()
                    }
                  }}
                  className="-mx-2 flex min-h-8 items-center gap-3 rounded-md px-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {inner}
                </a>
              ) : (
                <div className="flex min-h-8 items-center gap-3">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{r.display ?? r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A topic's questions per day, as one quiet line. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const W = 64
  const H = 18
  const max = Math.max(...values, 1)
  const pts = values
    .map(
      (v, i) =>
        `${(i / Math.max(1, values.length - 1)) * (W - 2) + 1},${H - 1 - (v / max) * (H - 2)}`,
    )
    .join(' ')
  return (
    <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={className}>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * How a topic was answered, as one bar split by state. A hidden count draws nothing of its own:
 * what is left of the bar is the hidden ones together, never one of them.
 */
export function MixBar({
  counts,
  of,
  className,
}: {
  counts: Counts
  /**
   * The total, when it shows. When what found nothing shows too, the answer states hidden under it
   * are the context found, drawn together in a lighter Checked; otherwise the bar's end stays empty.
   */
  of?: number | null
  className?: string
}) {
  const n = of || shownSum(counts) || 1
  const hatch = useHatchId()
  // What found context in states too small to show on their own: never one of them.
  const rest = of && counts.missing !== null ? of - shownSum(counts) : 0
  const parts = SHOWN.flatMap((st) => [
    ...(st === 'missing' && rest > 0
      ? [{ key: 'rest', w: rest, fill: 'var(--primary)', opacity: 0.45 }]
      : []),
    { key: st, w: counts[st] ?? 0, fill: fillOf(st, hatch), opacity: 1 },
  ])
  return (
    <svg
      aria-hidden
      className={cn('block h-2 w-full', className)}
      preserveAspectRatio="none"
      viewBox="0 0 100 8"
    >
      <Hatch id={hatch} />
      {parts.map((p, i) => {
        // Where this part starts: the share of the ones before it.
        const x = parts.slice(0, i).reduce((acc, q) => acc + (q.w / n) * 100, 0)
        const w = (p.w / n) * 100
        return (
          <rect
            key={p.key}
            x={x}
            y={0}
            width={Math.max(0, w - 0.4)}
            height={8}
            fill={p.fill}
            opacity={p.opacity}
          />
        )
      })}
    </svg>
  )
}

/**
 * A line over time, for a trend or a speed: one or two series, the last point marked. A value that
 * is null (a hidden count, or a week not counted) breaks the line rather than drawing a zero; its
 * table cell reads `missing`.
 */
export function LineChart({
  series,
  labels,
  max,
  height = 180,
  format = (v: number) => String(v),
  missing = 'Fewer than 5',
  caption,
}: {
  series: { name: string; values: (number | null)[]; color: string; fill?: boolean }[]
  labels: string[]
  max: number
  height?: number
  format?: (v: number) => string
  missing?: string
  caption: string
}) {
  const [box, W] = useWidth(520)
  const H = height
  const pad = { l: 44, r: 20, t: 12, b: 22 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const x = (i: number) => pad.l + (i / Math.max(1, labels.length - 1)) * plotW
  const y = (v: number) => pad.t + plotH - (v / max) * plotH
  // Every label while they fit, then every other one: the last always shows.
  const slot = plotW / Math.max(1, labels.length - 1)
  const every = slot >= 44 ? 1 : slot >= 22 ? 2 : 4
  return (
    <figure ref={box} className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
        {[0, 1 / 3, 2 / 3, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--border)"
              strokeDasharray={f === 0 ? undefined : '2 3'}
            />
            <text
              x={pad.l - 6}
              y={y(max * f) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-xs tabular-nums"
            >
              {format(Math.round(max * f))}
            </text>
          </g>
        ))}
        {series.map((s) => {
          // Runs of shown values, each its own line; a lone value is a dot.
          const runs: { i: number; v: number }[][] = []
          s.values.forEach((v, i) => {
            if (v === null) return
            const run = runs.at(-1)
            if (run && run.at(-1)!.i === i - 1) run.push({ i, v })
            else runs.push([{ i, v }])
          })
          const lastShown = runs.at(-1)?.at(-1)
          return (
            <g key={s.name}>
              {runs.map((run) => {
                const pts = run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')
                return (
                  <g key={run[0]!.i}>
                    {s.fill && run.length > 1 && (
                      <polygon
                        points={`${x(run[0]!.i)},${y(0)} ${pts} ${x(run.at(-1)!.i)},${y(0)}`}
                        fill={s.color}
                        opacity={0.12}
                      />
                    )}
                    {run.length > 1 ? (
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="1.75"
                        strokeLinejoin="round"
                      />
                    ) : (
                      <circle cx={x(run[0]!.i)} cy={y(run[0]!.v)} r="1.75" fill={s.color} />
                    )}
                  </g>
                )
              })}
              {lastShown && (
                <circle
                  cx={x(lastShown.i)}
                  cy={y(lastShown.v)}
                  r="3"
                  fill="var(--background)"
                  stroke={s.color}
                  strokeWidth="1.5"
                />
              )}
            </g>
          )
        })}
        {labels.map((l, i) =>
          i % every && i !== labels.length - 1 ? null : (
            <text
              key={l}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-xs"
            >
              {l}
            </text>
          ),
        )}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.name}>{s.values[i] === null ? missing : format(s.values[i]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** One series as bars: a count a week. A hidden count (null) draws no bar and reads "Fewer than 5". */
export function Bars({
  values: counts,
  labels,
  caption,
  height = 170,
}: {
  values: (number | null)[]
  labels: string[]
  caption: string
  height?: number
}) {
  const values = counts.map((v) => v ?? 0)
  const [box, W] = useWidth(520)
  const H = height
  const pad = { l: 28, r: 6, t: 10, b: 22 }
  const max = niceMax(Math.max(...values, 1))
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const slot = plotW / values.length
  const bw = Math.min(28, slot * 0.62)
  const y = (v: number) => pad.t + plotH - (v / max) * plotH
  const every = slot >= 40 ? 1 : slot >= 20 ? 2 : 4
  return (
    <figure ref={box} className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--border)"
              strokeDasharray={f === 0 ? undefined : '2 3'}
            />
            <text
              x={pad.l - 6}
              y={y(max * f) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-xs tabular-nums"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {values.map((v, i) => (
          <g key={i}>
            <rect
              x={pad.l + slot * i + (slot - bw) / 2}
              y={y(v)}
              width={bw}
              height={y(0) - y(v)}
              fill={i === values.length - 1 ? 'var(--primary)' : 'var(--chart-2)'}
            />
            {(i % every === 0 || i === values.length - 1) && (
              <text
                x={pad.l + slot * i + slot / 2}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-xs"
              >
                {labels[i]}
              </text>
            )}
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {counts.map((v, i) => (
            <tr key={i}>
              <th scope="row">{labels[i]}</th>
              <td>{v ?? 'Fewer than 5'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
