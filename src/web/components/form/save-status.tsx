import { Button } from '@/components/ui/button'
import { CheckIcon, CloudOffIcon, LoaderCircleIcon } from '@/components/icons'
import type { AutosaveState } from '@/hooks/use-autosave'
import { cn } from '@/lib/utils'

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** "Saved 09:41": the time of day of the last save, on this device's clock. */
export function savedLabel(savedAt: Date): string {
  return `Saved ${timeFormat.format(savedAt)}`
}

/**
 * Where a draft stands, for the header of a write page (contract 9.3): "Saving...", "Saved 09:41"
 * or "Not saved. Trying again" with a button to try now, or why it is held ("Not saved. Fix the
 * text first"). Never a dialog. The words sit in a
 * polite status region so a screen reader hears them without losing its place.
 */
export function SaveStatus({
  status,
  savedAt,
  retrying,
  onRetry,
  held,
  className,
}: Pick<AutosaveState, 'status' | 'savedAt' | 'retrying'> & {
  onRetry?: () => void
  /** Why the draft is not saved on purpose, such as "Not saved. Fix the text first". */
  held?: string
  className?: string
}) {
  const failed = status === 'failed' || Boolean(held)
  return (
    <div
      data-slot="save-status"
      data-status={status}
      data-held={held ? '' : undefined}
      className={cn(
        'flex min-w-0 items-center gap-2 text-dense whitespace-nowrap text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        failed && 'text-status-danger-fg',
        className,
      )}
    >
      <span role="status" className="flex min-w-0 items-center gap-2">
        {held ? (
          <>
            <CloudOffIcon aria-hidden className="text-status-danger-icon" />
            {held}
          </>
        ) : status === 'saving' ? (
          <>
            <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
            Saving...
          </>
        ) : failed ? (
          <>
            <CloudOffIcon aria-hidden className="text-status-danger-icon" />
            {retrying ? 'Not saved. Trying again' : 'Not saved'}
          </>
        ) : savedAt ? (
          <>
            <CheckIcon aria-hidden />
            {savedLabel(savedAt)}
          </>
        ) : null}
      </span>
      {failed && !held && onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="text-foreground">
          Try now
        </Button>
      )}
    </div>
  )
}
