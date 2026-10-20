import type { ReactNode } from 'react'

/*
  The pulse strip's small charts (contract 7.1, "Chart"): inline SVG beside a number, 96 by
  32, with no chart library, no axis and no motion. The neutral ramp only: the line and older
  bars in muted tones, the latest point or bar in ink; the meter adds the warning status for
  facts that need a look, which the tile also says in words beside an icon. Each chart is an
  image whose label lists its values.
*/

/*
  The marks take their colours as SVG attributes that name the tokens, as the Recharts charts do
  (`chartStyle` in components/ui/chart.tsx), so the strip adds no rules to the app's first CSS.
*/
const tone = {
  ink: 'var(--color-foreground)',
  line: 'var(--color-muted-foreground)',
  area: 'var(--color-muted)',
  baseline: 'var(--color-border)',
  warning: 'var(--color-status-warning-icon)',
} as const

const WIDTH = 96
const HEIGHT = 32
const PAD = 3

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      data-slot="pulse-chart"
      className="block shrink-0 overflow-visible"
    >
      {children}
    </svg>
  )
}

/**
 * A line over a soft area, the last point in ink. A hidden or missing value (null) has no point:
 * a dashed stroke bridges the weeks between two known ones, so the line never pretends to know
 * them, and a lone known week is a small dot. `min` and `max` fix the scale (a share runs 0 to
 * 100); otherwise it spans the values from zero.
 */
export function Sparkline({
  values,
  label,
  min,
  max,
}: {
  values: readonly (number | null)[]
  label: string
  min?: number
  max?: number
}) {
  const known = values.filter((value): value is number => value !== null)
  const low = min ?? Math.min(0, ...known)
  const high = max ?? Math.max(...known, low + 1)
  const x = (index: number) => PAD + (index * (WIDTH - 2 * PAD)) / Math.max(1, values.length - 1)
  const y = (value: number) => HEIGHT - PAD - ((value - low) / (high - low)) * (HEIGHT - 2 * PAD)
  type Point = [number, number]
  const runs: Point[][] = []
  let open = false
  values.forEach((value, index) => {
    if (value === null) open = false
    else {
      if (!open) runs.push([])
      runs.at(-1)!.push([x(index), y(value)])
      open = true
    }
  })
  const at = ([px, py]: Point) => `${px.toFixed(1)},${py.toFixed(1)}`
  const points = (run: Point[]) => run.map(at).join('L')
  const bridges = runs.slice(1).map((run, index) => [runs[index]!.at(-1)!, run[0]!] as const)
  const last = values.at(-1)
  const lastIndex = values.length - 1
  return (
    <Frame label={label}>
      {runs
        .filter((run) => run.length > 1)
        .map((run) => (
          <path
            key={`area-${run[0]![0]}`}
            fill={tone.area}
            d={`M${run[0]![0].toFixed(1)},${HEIGHT - PAD}L${points(run)}L${run.at(-1)![0].toFixed(1)},${HEIGHT - PAD}Z`}
          />
        ))}
      <line
        x1={PAD}
        x2={WIDTH - PAD}
        y1={HEIGHT - PAD + 0.5}
        y2={HEIGHT - PAD + 0.5}
        stroke={tone.baseline}
      />
      {bridges.map(([from, to]) => (
        <path
          key={`bridge-${from[0]}`}
          fill="none"
          stroke={tone.line}
          strokeWidth={1}
          strokeDasharray="2 2"
          d={`M${at(from)}L${at(to)}`}
        />
      ))}
      {runs.map((run) =>
        run.length > 1 ? (
          <path
            key={`line-${run[0]![0]}`}
            fill="none"
            stroke={tone.line}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            d={`M${points(run)}`}
          />
        ) : run[0]![0] === x(lastIndex) ? null : (
          <circle
            key={`dot-${run[0]![0]}`}
            fill={tone.line}
            cx={run[0]![0]}
            cy={run[0]![1]}
            r={1.5}
          />
        ),
      )}
      {last === null || last === undefined ? null : (
        <circle fill={tone.ink} cx={x(lastIndex)} cy={y(last)} r={2.5} />
      )}
    </Frame>
  )
}

/** Weekly bars from the baseline, older weeks muted and the last in ink. A zero is a stub. */
export function BarStrip({ values, label }: { values: readonly number[]; label: string }) {
  const gap = 2
  const width = (WIDTH - gap * (values.length - 1)) / values.length
  const high = Math.max(1, ...values)
  return (
    <Frame label={label}>
      {values.map((value, index) => {
        const height = Math.max(2, (value / high) * (HEIGHT - 1))
        return (
          <rect
            // Bars are positional: the nth week is always the nth bar.
            key={index}
            x={index * (width + gap)}
            y={HEIGHT - height}
            width={width}
            height={height}
            rx={1}
            fill={index === values.length - 1 ? tone.ink : tone.line}
            fillOpacity={index === values.length - 1 ? 1 : 0.4}
          />
        )
      })}
    </Frame>
  )
}

export type MeterPart = {
  value: number
  tone: 'ink' | 'warning' | 'warning-soft'
}

const meterTone: Record<MeterPart['tone'], { fill: string; fillOpacity?: number }> = {
  ink: { fill: tone.ink },
  warning: { fill: tone.warning },
  'warning-soft': { fill: tone.warning, fillOpacity: 0.4 },
}

/** One bar split in parts, in order, on a muted track; a part of zero takes no room. */
export function Meter({ parts, label }: { parts: readonly MeterPart[]; label: string }) {
  const height = 8
  const top = HEIGHT - height - 6
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  const shown = parts.filter((part) => part.value > 0)
  const gap = 2
  const room = WIDTH - gap * Math.max(0, shown.length - 1)
  let left = 0
  return (
    <Frame label={label}>
      <rect x={0} y={top} width={WIDTH} height={height} rx={2} fill={tone.area} />
      {total === 0
        ? null
        : shown.map((part) => {
            const width = (part.value / total) * room
            const x = left
            left += width + gap
            return (
              <rect
                // One part per tone: the caller sums the parts that share one.
                key={part.tone}
                x={x}
                y={top}
                width={width}
                height={height}
                rx={2}
                {...meterTone[part.tone]}
              />
            )
          })}
    </Frame>
  )
}
