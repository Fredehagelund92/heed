import { Skeleton } from '@/components/ui/skeleton'
import { Frame, FrameSection } from '@/components/heed/frame'
import { ChartSkeleton, KpiSkeleton, RowsSkeleton } from '@/components/heed/load-state'
import { OBS_PURPOSE, OBS_TITLES, type ObsSection } from '@/lib/obs'

// Each Observability page while its counts load, in its own shape: the frame, its title and line
// at once (they are not data), the numbers as four cells, and the page's own body below.

type Body = 'overview' | 'table' | 'rules' | 'split'

export function ObsSkeleton({
  section,
  kpis = 0,
  body,
}: {
  section: ObsSection
  kpis?: number
  body: Body
}) {
  return (
    <Frame role="status" aria-busy="true" aria-label="Loading">
      <FrameSection
        title={OBS_TITLES[section]}
        description={OBS_PURPOSE[section]}
        action={<Skeleton className="h-8 w-56 max-sm:hidden" />}
      />
      {kpis > 0 && <KpiSkeleton n={kpis} />}
      {body === 'overview' && (
        <div className="grid grid-cols-[minmax(0,1fr)] border-t @4xl/main:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <ChartSkeleton />
          <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
            <div className="flex flex-col gap-3 px-4 py-4 md:px-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-52 max-w-full" />
            </div>
            <RowsSkeleton rows={8} />
          </div>
        </div>
      )}
      {body === 'table' && (
        <div className="border-t">
          <div className="flex h-10 items-center gap-4 px-4 md:px-5">
            {[20, 16, 14, 24].map((w, i) => (
              <Skeleton key={i} className="h-3.5" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
          <RowsSkeleton rows={9} tall />
        </div>
      )}
      {body === 'rules' && <RowsSkeleton rows={8} tall />}
      {body === 'split' && (
        <div className="grid grid-cols-[minmax(0,1fr)] border-t @4xl/main:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <RowsSkeleton rows={6} tall />
          <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
            <ChartSkeleton height={170} />
          </div>
        </div>
      )}
    </Frame>
  )
}
