import * as React from "react"
import { ViewTransition } from "react"
import { CloudAlertIcon, RefreshCwIcon, WifiOffIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { setQuery } from "@/lib/router"
import { ArrivedAfterWait, useDelayedBusy, useFirstLoad } from "@/lib/loading"
import { useOnline, useScenario } from "@/lib/scenario"

// Loading, a failed load and being offline, said calmly in the page's own shape: skeleton rows
// where the rows go, a sheet where the document goes, and one line with Retry when a load fails.

/** Rows of a list while it loads: hairline rows at the list's own height. */
export function ListSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={cn("flex flex-col", className)}>
      <div className="flex h-11 items-center gap-3 border-b px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto h-7 w-56 max-w-[40%]" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b px-4">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-3.5" style={{ width: `${38 + ((i * 17) % 34)}%` }} />
          <Skeleton className="ml-auto h-3.5 w-20 max-sm:hidden" />
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  )
}

/** A table while it loads: the header band and rows at the table's own height, the title column widest. */
export function TableSkeleton({ rows = 14, lead = [41], className }: { rows?: number; lead?: number[]; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={cn("flex flex-col", className)}>
      {/* The bars above the table (filters, views, a coverage line) at their own heights. */}
      {lead.map((h, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4" style={{ height: h }}>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
          {i === 0 && <Skeleton className="ml-auto h-7 w-56 max-w-[40%]" />}
        </div>
      ))}
      <div className="flex h-9 items-center gap-3 border-b bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] px-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-12 max-sm:hidden" />
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 border-b px-4">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-3.5" style={{ width: `${30 + ((i * 13) % 26)}%` }} />
          <Skeleton className="ml-auto h-5 w-32 rounded-md max-md:hidden" />
          <Skeleton className="size-4 shrink-0 rounded-full max-sm:hidden" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

/** A document while it loads: the title, a few lines of text, the owner line. */
export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-3/4" />
      <div className="mt-2 flex max-w-reading flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t pt-4">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
    </div>
  )
}

/** A side panel while its item loads: a few labelled sections of short lines. */
export function SideSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col">
      {[3, 4, 2].map((n, i) => (
        <div key={i} className="flex flex-col gap-2.5 border-b px-4 py-4">
          <Skeleton className="h-3.5 w-24" />
          {Array.from({ length: n }, (_, j) => (
            <Skeleton key={j} className="h-3" style={{ width: `${55 + (((i + j) * 11) % 35)}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Observability's numbers while they load: the four cells, each a label, a number and a line. */
export function KpiSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 bg-background px-4 py-3 md:px-5 md:py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  )
}

/** A chart while it loads: its title and line, then bars at rest along the baseline. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 md:px-5">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-64 max-w-full" />
      <div className="mt-2 flex items-end gap-[6%] border-b px-[4%]" style={{ height }}>
        {[48, 62, 30, 26, 70, 58, 50].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-none" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

/** Rows inside a frame: a dot or icon, a line and a short line, a number at the end. */
export function RowsSkeleton({ rows = 6, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-3 border-t px-4 md:px-5", tall ? "h-16" : "h-12")}>
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${35 + ((i * 17) % 30)}%` }} />
            {tall && <Skeleton className="h-3" style={{ width: `${25 + ((i * 11) % 25)}%` }} />}
          </div>
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  )
}

/** A load that failed: what didn't load, that nothing is lost, and Retry. */
export function LoadError({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex animate-in flex-col items-start gap-3 p-4 duration-(--dur-2) fade-in-0 sm:flex-row sm:items-center", className)}>
      <CloudAlertIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Couldn't load {what}.</p>
        <p className="text-muted-foreground">Nothing is lost. Check the connection and try again.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon data-icon="inline-start" />
        Retry
      </Button>
    </div>
  )
}

/**
 * Shows its content, or the loading or failed state. A load that ends within 150ms shows nothing
 * in between; a longer one shows the page-shaped skeleton for at least 300ms, and the content then
 * fades in through a <ViewTransition>. `quiet` is a second region of the same load (a side panel):
 * it shows its own skeleton, and leaves the failure to the main region.
 */
export function Loadable({
  what,
  skeleton,
  children,
  errorClassName,
  quiet,
}: {
  what: string
  skeleton: React.ReactNode
  children: React.ReactNode
  errorClassName?: string
  quiet?: boolean
}) {
  const scenario = useScenario()
  const waiting = useFirstLoad(what)
  const [retrying, setRetrying] = React.useState(false)
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const busy = retrying || scenario === "loading" || waiting
  const shown = useDelayedBusy(busy)
  // Whether the person saw the skeleton: what arrives after it may grow in, once.
  const [waited, setWaited] = React.useState(false)
  if (shown && !waited) setWaited(true)
  if (shown)
    return (
      <ViewTransition key="loading" exit="vt-leave">
        <div>{skeleton}</div>
      </ViewTransition>
    )
  // Under 150ms: nothing yet, so a fast load never flashes a skeleton.
  if (busy) return <div role="status" aria-busy="true" aria-label="Loading" className="min-h-24" />
  if (scenario === "failed")
    return quiet ? null : (
      <LoadError
        what={what}
        className={errorClassName}
        onRetry={() => {
          setRetrying(true)
          timer.current = window.setTimeout(() => {
            setRetrying(false)
            setQuery({ state: undefined })
          }, 700)
        }}
      />
    )
  return (
    <ViewTransition key="content" enter="vt-arrive">
      <ArrivedAfterWait.Provider value={waited}>{children}</ArrivedAfterWait.Provider>
    </ViewTransition>
  )
}

/** Offline: one quiet line across the top of the page; what people write stays on this device. */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" className="flex min-h-9 shrink-0 items-center gap-2 border-b bg-muted px-4 py-1.5 text-sm md:px-6">
      <WifiOffIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="font-medium">You're offline.</span>{" "}
        <span className="text-muted-foreground">What you write stays on this device; publishing waits until you're back.</span>
      </span>
    </div>
  )
}
