import type { ReactNode } from 'react'
import { CircleDashedIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/*
  The absence line (contract 7.2 `AbsenceLine`, 9.5): an honest statement that nothing is written
  down for a scope that was checked, such as a `no_match`, a scope with no items, or a gap. It is
  left aligned with the dashed ring mark inside a 1 px dashed `--input` border, never an
  illustration, so it reads as a result that was looked for, not as an empty list. The centred
  `Empty` keeps its one meaning: this list has no rows.
*/

export function AbsenceLine({
  title,
  children,
  action,
  slot = 'absence-line',
  className,
}: {
  /** The statement, such as "Nothing is written down for this". */
  title: string
  /** What was checked and what the absence does not prove. */
  children?: ReactNode
  /** One next step, or two at most. */
  action?: ReactNode
  /** The element's `data-slot`, for a page that has its own name for it. */
  slot?: string
  className?: string
}) {
  return (
    <div
      data-slot={slot}
      className={cn(
        'flex min-w-0 gap-3 rounded-lg border border-dashed border-input p-4',
        className,
      )}
    >
      <span className="flex h-5 shrink-0 items-center">
        <CircleDashedIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-dense font-bold">{title}</p>
          {children ? <div className="text-dense text-muted-foreground">{children}</div> : null}
        </div>
        {action}
      </div>
    </div>
  )
}
