import type { ReactNode } from 'react'
import { DockFrame, DockMissing } from '@/components/dock'
import { LoadError, SideSkeleton } from '@/components/heed/load-state'
import { useDelayedBusy } from '@/lib/loading'
import type { Read } from '@/lib/read'

// A dock's read that is not ready, in the dock's frame. Its own module, so the skeleton and the
// failed line come with the docks that read, not with the first load.

/** A dock while its read loads: the frame at once, the skeleton after 150ms. */
function DockLoading({ title }: { title: string }) {
  const shown = useDelayedBusy(true)
  return (
    <DockFrame title={title}>
      {shown ? (
        <SideSkeleton />
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading" className="min-h-24" />
      )}
    </DockFrame>
  )
}

/**
 * A dock whose read is not ready: always in its frame, with its title and Close, so it is never an
 * empty strip. Loading shows the skeleton, a failed read one line with Retry, a missing one `missing`.
 */
export function DockRead({
  title,
  what,
  read,
  missing,
}: {
  title: string
  /** What did not load, as the failed line says it: "this answer". */
  what: string
  read: Exclude<Read<unknown>, { state: 'ready' }>
  missing: ReactNode
}) {
  if (read.state === 'loading') return <DockLoading title={title} />
  return (
    <DockFrame title={title}>
      {read.state === 'failed' ? (
        <LoadError what={what} onRetry={read.retry} />
      ) : (
        <DockMissing>{missing}</DockMissing>
      )}
    </DockFrame>
  )
}
