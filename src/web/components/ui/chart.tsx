import type { ComponentProps, ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

/*
  Chart (contract 7.1): Recharts through the shadcn Chart, normalised. Only a page that draws a
  chart imports this file, behind a lazy import, so Recharts never reaches the first load (the
  gaps and evals pages only). Series take the neutral ramp (`--chart-1`, `--chart-2`) or a status
  icon colour, never a kind or domain hue. Axis text, grid lines and labels take their tokens
  through `chartStyle`, as Recharts props, so a chart adds no rules to the app's first CSS.

  A chart is a picture of numbers that are also written down: every chart has a table
  alternative beside it, and its legend says in words what each mark is (contract 11, "Charts").
  The shadcn tooltip is left out on purpose: it opens on hover only, and the labels on the bars
  and the table already carry every number.
*/

/** The token colours of a chart's furniture, for the Recharts props that take them. */
export const chartStyle = {
  tick: { fill: 'var(--color-muted-foreground)' },
  grid: 'var(--color-border)',
  label: 'var(--color-foreground)',
} as const

export type ChartSeries = {
  key: string
  label: string
  /** A colour token: `var(--color-chart-1)`. */
  color: string
}

function ChartContainer({
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  children: ComponentProps<typeof ResponsiveContainer>['children']
}) {
  return (
    <div
      data-slot="chart"
      className={cn('flex h-chart w-full justify-center text-caption', className)}
      {...props}
    >
      <ResponsiveContainer initialDimension={{ width: 320, height: 192 }}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

/** The legend in words, under the chart: a swatch and the series' name each. */
function ChartLegend({
  series,
  className,
  children,
}: {
  series: readonly ChartSeries[]
  className?: string
  /** A note after the series, such as what a hidden count looks like. */
  children?: ReactNode
}) {
  return (
    <ul
      data-slot="chart-legend"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground',
        className,
      )}
    >
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 8 8" className="size-2 shrink-0">
            <rect width="8" height="8" rx="2" fill={item.color} />
          </svg>
          {item.label}
        </li>
      ))}
      {children ? <li className="flex items-center gap-2">{children}</li> : null}
    </ul>
  )
}

export { ChartContainer, ChartLegend }
