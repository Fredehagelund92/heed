import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  XAxis,
  type BarShapeProps,
} from 'recharts'
import { ChartContainer, ChartLegend, chartStyle, type ChartSeries } from '@/components/ui/chart'
import { countLabel, countValue, type WeekPoint } from '@/lib/gaps'

/*
  A gap's weekly counts as bars (the Gaps page's docked panel), loaded on demand so Recharts
  stays out of the page's own chunk. Two series on the neutral ramp: reports and calls that found
  nothing. A hidden count draws no bar, only its label "<5", and a zero only its "0": the chart
  never draws a value the privacy rule hides. Recharts leaves out a bar of no height and its
  label with it, so every point takes a small minimum size and the shape draws the real bars only. The numbers are also the table beside it, so the picture is hidden from
  screen readers.
*/

const series: ChartSeries[] = [
  { key: 'reports', label: 'Reports', color: 'var(--color-chart-1)' },
  { key: 'noItemCalls', label: 'Calls that found nothing', color: 'var(--color-chart-2)' },
]

export default function WeeklyChart({ weeks }: { weeks: readonly WeekPoint[] }) {
  const data = weeks.map((point) => ({
    label: point.label,
    reports: countValue(point.reports) ?? 0,
    reportsLabel: countLabel(point.reports),
    reportsBar: Boolean(countValue(point.reports)),
    noItemCalls: countValue(point.noItemCalls) ?? 0,
    noItemCallsLabel: countLabel(point.noItemCalls),
    noItemCallsBar: Boolean(countValue(point.noItemCalls)),
  }))
  return (
    <div data-slot="weekly-chart" aria-hidden="true" className="flex flex-col gap-3">
      <ChartContainer>
        <BarChart
          data={data}
          margin={{ top: 24, right: 4, bottom: 0, left: 4 }}
          barGap={4}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={chartStyle.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={chartStyle.tick}
          />
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              fill={item.color}
              maxBarSize={24}
              minPointSize={2}
              isAnimationActive={false}
              shape={(props: BarShapeProps) =>
                (props.payload as Record<string, unknown>)[`${item.key}Bar`] ? (
                  <Rectangle {...props} radius={[4, 4, 0, 0]} />
                ) : (
                  <g />
                )
              }
            >
              <LabelList
                dataKey={`${item.key}Label`}
                position="top"
                offset={6}
                fill={chartStyle.label}
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
      <ChartLegend series={series} />
    </div>
  )
}
