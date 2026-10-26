import * as React from 'react'
import { cn } from '@/lib/utils'
import { SHOWN, STATE_WORDS, total, type Counts, type Shown } from '@/data/observability'
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
    conflict: 'var(--warn)',
    stale: 'color-mix(in oklab, var(--warn) 45%, var(--background))',
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
function niceMax(n: number) {
  if (n <= 8) return 8
  const step = Math.pow(10, Math.floor(Math.log10(n / 4)))
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * step).find((u) => u * 4 >= n)!
  return unit * 4
}

export type Bar = { label: string; at?: number; counts: Counts }

/** A chart's drawn width: its box's real width, so its words stay their size on a phone. */
function useWidth(fallback: number) {
  const ref = React.useRef<HTMLElement>(null)
  const [w, setW] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/**
 * Questions per day (or per week), stacked by how they were answered, with a dashed line at each
 * publish so you can see whether the hatch of "nothing written down" shrank after it.
 */
export function StackedBars({
  bars,
  marks = [],
  height = 220,
  caption,
}: {
  bars: Bar[]
  /** Publishes: the index of the bar they fall on, and what was published. */
  marks?: { index: number; title: string }[]
  height?: number
  caption: string
}) {
  const [hover, setHover] = React.useState<number | null>(null)
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
  const pad = { l: 28, r: 8, t: 18, b: 22 }
  const max = niceMax(Math.max(...bars.map((b) => total(b.counts)), 1))
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const slot = plotW / bars.length
  const bw = Math.max(3, Math.min(38, slot * 0.66))
  const y = (v: number) => pad.t + plotH - (v / max) * plotH
  // Every label when there is room for it, else every second or fifth.
  const room = slot >= 44 ? 1 : slot >= 22 ? 2 : 5
  const every = Math.max(room, bars.length > 20 ? 5 : 1)
  const tip = hover !== null ? bars[hover] : null
  return (
    <figure ref={box} className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        aria-hidden
        onMouseLeave={() => setHover(null)}
      >
        <Hatch id={hatch} />
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
              className="fill-muted-foreground text-3xs tabular-nums"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2
          let acc = 0
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" />
              <g
                className={cn(grow && 'bar-grow')}
                style={
                  grow ? { animationDelay: `calc(var(--stagger) * ${Math.min(i, 6)})` } : undefined
                }
              >
                {SHOWN.map((s) => {
                  const v = b.counts[s]
                  if (!v) return null
                  const top = y(acc + v)
                  const h = y(acc) - top
                  acc += v
                  return (
                    <rect
                      key={s}
                      x={x}
                      y={top}
                      width={bw}
                      height={Math.max(0, h - 0.5)}
                      fill={fillOf(s, hatch)}
                      opacity={hover !== null && hover !== i ? 0.55 : 1}
                    />
                  )
                })}
              </g>
              {i % every === 0 && (
                <text
                  x={x + bw / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-3xs"
                >
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
        {marks.map((m) => {
          const x = pad.l + slot * m.index
          return (
            <g key={m.index}>
              <line
                x1={x}
                x2={x}
                y1={pad.t - 6}
                y2={pad.t + plotH}
                stroke="var(--foreground)"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              <text x={x + 4} y={pad.t - 8} className="fill-foreground text-3xs">
                Published
              </text>
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute top-2 right-2 z-raised min-w-48 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
          <p className="mb-1 font-medium">
            {tip.label}: {total(tip.counts)} asked
          </p>
          <ul className="flex flex-col gap-0.5">
            {SHOWN.filter((s) => tip.counts[s]).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <Swatch state={s} />
                <span className="flex-1 text-muted-foreground">{STATE_WORDS[s]}</span>
                <span className="tabular-nums">{tip.counts[s]}</span>
              </li>
            ))}
          </ul>
          {marks.find((m) => m.index === hover) && (
            <p className="mt-1.5 border-t pt-1.5">
              Published: {marks.find((m) => m.index === hover)!.title}
            </p>
          )}
        </div>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {SHOWN.map((s) => (
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
              </th>
              {SHOWN.map((s) => (
                <td key={s}>{b.counts[s]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
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
                className="w-36 min-w-0 shrink-0 truncate text-dense @max-md/main:w-28"
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
              <span className="min-w-10 shrink-0 text-right text-dense whitespace-nowrap text-muted-foreground tabular-nums">
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

/** How a topic was answered, as one bar split by state. */
export function MixBar({ counts, className }: { counts: Counts; className?: string }) {
  const n = total(counts) || 1
  const hatch = useHatchId()
  return (
    <svg
      aria-hidden
      className={cn('block h-2 w-full', className)}
      preserveAspectRatio="none"
      viewBox="0 0 100 8"
    >
      <Hatch id={hatch} />
      {SHOWN.map((st, i) => {
        // Where this state starts: the share of the ones before it.
        const x = SHOWN.slice(0, i).reduce((acc, k) => acc + (counts[k] / n) * 100, 0)
        const w = (counts[st] / n) * 100
        return (
          <rect
            key={st}
            x={x}
            y={0}
            width={Math.max(0, w - 0.4)}
            height={8}
            fill={fillOf(st, hatch)}
          />
        )
      })}
    </svg>
  )
}

/** A line over time, for a trend or a speed: one or two series, the last point marked. */
export function LineChart({
  series,
  labels,
  max,
  height = 180,
  format = (v: number) => String(v),
  caption,
}: {
  series: { name: string; values: number[]; color: string; fill?: boolean }[]
  labels: string[]
  max: number
  height?: number
  format?: (v: number) => string
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
              className="fill-muted-foreground text-3xs tabular-nums"
            >
              {format(Math.round(max * f))}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
          return (
            <g key={s.name}>
              {s.fill && (
                <polygon
                  points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`}
                  fill={s.color}
                  opacity={0.12}
                />
              )}
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <circle
                cx={x(s.values.length - 1)}
                cy={y(s.values.at(-1)!)}
                r="3"
                fill="var(--background)"
                stroke={s.color}
                strokeWidth="1.5"
              />
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
              className="fill-muted-foreground text-3xs"
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
                <td key={s.name}>{format(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** One series as bars: a count a week. */
export function Bars({
  values,
  labels,
  caption,
  height = 170,
}: {
  values: number[]
  labels: string[]
  caption: string
  height?: number
}) {
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
              className="fill-muted-foreground text-3xs tabular-nums"
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
                className="fill-muted-foreground text-3xs"
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
          {values.map((v, i) => (
            <tr key={i}>
              <th scope="row">{labels[i]}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
