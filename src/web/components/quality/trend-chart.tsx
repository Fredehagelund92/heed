import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, chartStyle, type ChartSeries } from '@/components/ui/chart'

/*
  A domain's weekly runs as two lines (the Workbench's domain record), loaded on demand so Recharts stays
  out of the page's own chunk: the answers pass of each weekly run, and the retrieval pass of its
  edition. The neutral ramp, a solid and a dashed line, so the two differ without colour. The same
  numbers are the table beside it, so the picture is hidden from screen readers.
*/

const series: ChartSeries[] = [
  { key: 'answers', label: 'Right answers', color: 'var(--color-chart-1)' },
  { key: 'retrieval', label: 'Right facts (dashed)', color: 'var(--color-chart-2)' },
]

export type TrendPoint = { label: string; answers: number | null; retrieval: number | null }

const percent = (value: number) => `${Math.round(value * 100)}%`

export default function TrendChart({ points }: { points: readonly TrendPoint[] }) {
  return (
    <div data-slot="trend-chart" aria-hidden="true" className="flex flex-col gap-3">
      <ChartContainer>
        <LineChart
          data={[...points]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={chartStyle.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={chartStyle.tick}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            tickFormatter={percent}
            tickLine={false}
            axisLine={false}
            width={40}
            tick={chartStyle.tick}
          />
          <Line
            dataKey="answers"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            dot={{ r: 2, fill: 'var(--color-chart-1)' }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="retrieval"
            stroke="var(--color-chart-2)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <ChartLegend series={series} />
    </div>
  )
}
