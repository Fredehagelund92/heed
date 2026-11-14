import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

// A table while it loads, for the lists (Definitions, Context) and the app's skeleton of them: its
// own module, so only the code that draws a list fetches it.

/**
 * The bars above a list's table at their own heights, on a phone (the list under 28rem, where its
 * bar takes two rows and its lines wrap) and wide. A list's bar alone; Definitions' bar, the line
 * saying where they come from, and its coverage line.
 */
const LIST_LEAD = ['h-[45px] @max-md/main:h-[89px]']
export const DEFINITIONS_LEAD = [
  ...LIST_LEAD,
  'h-[57px] @max-md/main:h-[97px]',
  'h-[49px] @max-md/main:h-[81px]',
]

/**
 * A table while it loads: the header band and rows at the table's own height, the title column
 * widest. `announce={false}` inside a skeleton that already says Loading.
 */
export function TableSkeleton({
  rows = 14,
  lead = LIST_LEAD,
  announce = true,
  className,
}: {
  rows?: number
  lead?: string[]
  announce?: boolean
  className?: string
}) {
  return (
    <div
      {...(announce && { role: 'status', 'aria-busy': true, 'aria-label': 'Loading' })}
      className={cn('flex flex-col', className)}
    >
      {/* The bars above the table (filters, views, a coverage line) at their own heights. */}
      {lead.map((h, i) => (
        <div key={i} className={cn('flex items-center gap-3 border-b px-4 md:px-6', h)}>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
          {i === 0 && <Skeleton className="ml-auto h-7 w-56 max-w-2/5" />}
        </div>
      ))}
      <div data-skeleton-head className="flex h-9 items-center gap-3 border-b bg-band px-4 md:px-6">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-12 max-sm:hidden" />
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <TableSkeletonRow key={i} i={i} className="border-b" />
      ))}
    </div>
  )
}

/**
 * One row of a table while it loads, at the row's own height (36px, and two lines on a phone, where
 * a row puts its facts under its name): its glyph, its name, a chip, an owner, a count.
 */
function TableSkeletonRow({ i, className }: { i: number; className?: string }) {
  return (
    <div className={cn('flex h-9 items-center gap-3 px-4 md:px-6 @max-xl/main:h-14', className)}>
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3.5" style={{ width: `${30 + ((i * 13) % 26)}%` }} />
        <Skeleton className="hidden h-3 w-1/4 @max-xl/main:block" />
      </div>
      <Skeleton className="ml-auto h-5 w-32 rounded-md max-md:hidden" />
      <Skeleton className="size-4 shrink-0 rounded-full max-sm:hidden" />
      <Skeleton className="h-3.5 w-16" />
    </div>
  )
}

/**
 * The same rows inside a table's body, for the moment between its bar and its rows (a list of
 * hundreds draws them in a render of its own): the table never stands empty under its header.
 */
export function TableBodySkeleton({ rows = 14, colSpan }: { rows?: number; colSpan: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} aria-hidden data-skeleton-row className="h-9 border-b">
          <td colSpan={colSpan} className="p-0 align-middle">
            <TableSkeletonRow i={i} className="h-auto" />
          </td>
        </tr>
      ))}
    </>
  )
}
