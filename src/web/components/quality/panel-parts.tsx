import type { ReactNode } from 'react'
import { Link, type LinkOptions } from '@tanstack/react-router'
import type { QualityPanelTab } from '@/lib/search-params'
import { cn } from '@/lib/utils'

/*
  The parts the record bodies share: a row of figures, and the link that opens another record in
  the same frame (a question from a run, a run from a domain), so moving between them keeps the
  page and its list. A body never names a page: the page that shows it says where its links go
  (`LinkTo`), which is the Workbench's record pane (`workbenchLinks`).
*/

/** A record a body links to: a domain, a test question, a run or a gap. */
export type RecordRef = `${'domain' | 'question' | 'run' | 'gap'}:${string}`

/**
 * A link inside a record body, as a change to what is open: another record, its tab, the try
 * whose transcript shows, or the run it is compared with. A key left out keeps what is open; a
 * key given as undefined clears it.
 */
export type RecordTarget = {
  record?: RecordRef
  tab?: QualityPanelTab
  cell?: string
  against?: string
}

/** Where a link inside a record body goes, from the page that shows the record. */
export type LinkTo = (target: RecordTarget) => LinkOptions

/** Figures side by side, two a row in a panel: a label, the value and a line under it. */
export function Figures({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl
      aria-label={label}
      data-slot="quality-figures"
      className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card text-dense [&>div]:border-b [&>div:nth-child(odd)]:border-r [&>div:nth-last-child(-n+2)]:border-b-0"
    >
      {children}
    </dl>
  )
}

export function Figure({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-large">{children}</span>
        {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  )
}

/** Opens another record in the same frame: same list, same view, a new record. */
export function RecordLink({
  linkTo,
  record,
  tab,
  cell,
  className,
  children,
}: {
  linkTo: LinkTo
  record: RecordRef
  tab?: QualityPanelTab
  cell?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      {...linkTo({ record, tab, cell, against: undefined })}
      replace
      resetScroll={false}
      className={cn(
        'rounded-sm underline-offset-3 hover:underline focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      {children}
    </Link>
  )
}
