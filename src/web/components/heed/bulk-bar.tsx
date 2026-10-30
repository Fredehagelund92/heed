import * as React from 'react'
import { InfoIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Skip } from '@/lib/bulk'
import { countLine } from '@/lib/selection'

// The one bar for rows picked in a list (Context, Definitions, the Inbox): the count, Clear, and the
// list's actions, on the ink surface the Heed app uses. It takes a band of its own under the list,
// never over it, so no row is ever half hidden behind it; on a phone it is the bar along the bottom. A line above it says what a change left alone
// ("2 skipped: owned by Marketing", with the reasons a hover away), what failed with Retry, or that
// changes are off while offline. Destructive actions are never the primary button here: they only
// open a confirmation, which is the one place that says them in red.

/** What the line above the bar says. */
export type BulkNote = {
  text: string
  skipped?: Skip[]
  action?: { label: string; onClick: () => void }
}

export function BulkBar({
  label,
  count,
  onClear,
  matching,
  note,
  children,
}: {
  label: string
  count: number
  onClear: () => void
  /** After every row shown is ticked: the rows the filters match beyond them (folded groups). */
  matching?: { count: number; onSelect: () => void }
  note?: BulkNote
  children?: React.ReactNode
}) {
  // A status line that stays mounted: a screen reader hears each count and each note. One that
  // appears with its text is often not read.
  const [said, setSaid] = React.useState('')
  const before = React.useRef({ count, note: note?.text })
  React.useEffect(() => {
    if (note?.text && note.text !== before.current.note) setSaid(note.text)
    else if (count !== before.current.count) setSaid(countLine(count))
    before.current = { count, note: note?.text }
  }, [count, note?.text])
  return (
    <>
      <span role="status" className="sr-only">
        {said}
      </span>
      {count > 0 && (
        <div className="flex shrink-0 animate-in flex-col items-center gap-1.5 border-t bg-background px-4 py-2.5 duration-(--dur-3) fade-in-0 slide-in-from-bottom-2 max-md:gap-0 max-md:border-t-0 max-md:bg-foreground max-md:p-0 max-md:pb-safe-area">
          {note && <NoteLine note={note} />}
          <div
            role="region"
            aria-label={label}
            className="flex h-11 max-w-full items-center gap-1 rounded-lg bg-foreground pr-2 pl-4 text-sm text-background shadow-md max-md:h-auto max-md:min-h-14 max-md:w-full max-md:rounded-none max-md:px-2 max-md:shadow-none"
          >
            <span className="px-1 font-semibold whitespace-nowrap tabular-nums">
              {count} selected
            </span>
            {matching && matching.count > count && (
              <BulkButton
                onClick={matching.onSelect}
                className="underline-offset-4 hover:underline max-md:hidden"
              >
                Select all {matching.count} matching
              </BulkButton>
            )}
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-background/30" />
            <div className="flex min-w-0 flex-1 items-center gap-1 md:flex-none">{children}</div>
            <BulkButton onClick={onClear}>
              <XIcon />
              <span className="max-sm:sr-only">Clear</span>
              <Kbd className="bg-background/15 text-background max-md:hidden">Esc</Kbd>
            </BulkButton>
          </div>
        </div>
      )}
    </>
  )
}

function NoteLine({ note }: { note: BulkNote }) {
  return (
    <div className="flex max-w-full items-center gap-2 rounded-md bg-foreground py-1 pr-1 pl-3 text-xs text-background max-md:w-full max-md:rounded-none max-md:border-b max-md:border-background/15 max-md:py-2">
      <span className="min-w-0">{note.text}</span>
      {note.skipped && note.skipped.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Why they were skipped"
                className="text-background hover:bg-background/15 hover:text-background focus-visible:ring-background/60"
              />
            }
          >
            <InfoIcon />
          </TooltipTrigger>
          <TooltipContent className="max-w-80">
            <ul className="flex flex-col gap-1">
              {note.skipped.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <span className="font-medium">{s.title}</span> - {s.reason}
                </li>
              ))}
              {note.skipped.length > 8 && <li>And {note.skipped.length - 8} more.</li>}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
      {note.action && (
        <BulkButton
          onClick={note.action.onClick}
          className="h-7 px-2 text-xs font-semibold underline underline-offset-4"
        >
          {note.action.label}
        </BulkButton>
      )}
    </div>
  )
}

/**
 * A button on the bar. With a `reason` it stays in reach but does nothing, and says why on a hover
 * and to a screen reader.
 */
export function BulkButton({
  reason,
  className,
  onClick,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { reason?: string }) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      aria-disabled={reason ? true : undefined}
      aria-description={reason}
      onClick={reason ? (e) => e.preventDefault() : onClick}
      className={cn(
        'shrink-0 text-background hover:bg-background/15 hover:text-background focus-visible:ring-background/60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 max-md:h-11 max-md:min-w-11',
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )
  if (!reason) return button
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  )
}
