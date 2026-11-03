import * as React from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { CollapsibleTrigger } from '@/components/ui/collapsible'

// Every fold in the app opens from one trigger (docs/design/components.md, "Folds"). A section's
// fold is a full-width row at least 44 px tall: what it holds in 14 px at weight 500, a muted
// summary only while it is closed, and the chevron at the end, pointing down and turning half a
// turn with the panel. An inline toggle (Ask's look-up, a figure's query, the Text diff's
// unchanged lines) keeps its own size and gets a 44 px area under a finger. A section header's
// fold (Settings) is its chevron, stretched over the whole header row. Hover changes a colour,
// and focus is the contract's ring, drawn inside the row.

/** The chevron of every fold: at the end, pointing down, turning in step with the panel. */
export function FoldChevron({ className }: { className?: string }) {
  return (
    <ChevronDownIcon
      aria-hidden
      className={cn(
        'size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-3) ease-move group-aria-expanded/fold:rotate-180',
        className,
      )}
    />
  )
}

const looks = {
  row: 'flex min-h-11 w-full min-w-0 items-center gap-2 py-2 text-left text-sm hover:bg-band-soft focus-visible:ring-inset',
  inline:
    'relative inline-flex min-h-6 items-center gap-1 rounded-sm text-left hover:text-foreground pointer-coarse:after:absolute pointer-coarse:after:inset-(--touch-inset)',
  header:
    'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground after:absolute after:inset-0 hover:text-foreground focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset',
}

type FoldTriggerProps = Omit<React.ComponentProps<'button'>, 'children'> & {
  /**
   * `row` for a section's fold, `inline` for a toggle in a line of text, `header` for a section
   * header's chevron, which takes the whole header row as its target.
   */
  variant?: keyof typeof looks
  /** What the fold holds; a `header` fold names it to a screen reader only. */
  label: React.ReactNode
  /**
   * What is inside, in a few muted words, shown only while the fold is closed. A screen reader
   * hears it as the fold's description, so the fold's name stays what it holds.
   */
  summary?: React.ReactNode
  /** An icon or a logo before the label. */
  lead?: React.ReactNode
  /** Marks before the chevron, at the end of the row. */
  trail?: React.ReactNode
  /**
   * A reveal that is not a collapsible (a table's own rows) passes its state here and its own
   * onClick; without it the trigger opens the Collapsible around it.
   */
  expanded?: boolean
}

/** The one trigger of every fold. */
export function FoldTrigger({
  variant = 'row',
  label,
  summary,
  lead,
  trail,
  expanded,
  className,
  ...props
}: FoldTriggerProps) {
  const summaryId = React.useId()
  const look = cn(
    'group/fold transition-colors duration-(--dur-1) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    looks[variant],
    className,
  )
  const content =
    variant === 'header' ? (
      <>
        <FoldChevron className="text-current" />
        <span className="sr-only">{label}</span>
      </>
    ) : variant === 'inline' ? (
      <>
        {label}
        <FoldChevron className="size-3.5 text-current" />
      </>
    ) : (
      <>
        {lead}
        <span className={cn('min-w-0 font-medium', summary != null && 'shrink-0')}>{label}</span>
        {summary != null && (
          <span
            id={summaryId}
            aria-hidden
            className="min-w-0 flex-1 truncate text-muted-foreground transition-[opacity,visibility] duration-(--dur-1) group-aria-expanded/fold:invisible group-aria-expanded/fold:opacity-0"
          >
            {summary}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {trail}
          <FoldChevron />
        </span>
      </>
    )
  const describedBy =
    props['aria-describedby'] ?? (summary != null && variant === 'row' ? summaryId : undefined)
  if (expanded !== undefined)
    return (
      <button
        type="button"
        aria-expanded={expanded}
        className={look}
        {...props}
        aria-describedby={describedBy}
      >
        {content}
      </button>
    )
  return (
    <CollapsibleTrigger className={look} {...props} aria-describedby={describedBy}>
      {content}
    </CollapsibleTrigger>
  )
}
