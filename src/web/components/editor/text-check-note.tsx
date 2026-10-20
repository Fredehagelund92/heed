import { TriangleAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { textCheckMessages } from '@/lib/text-check'

/**
 * The plain sentence under the text for the first thing the text check found (FR-117): what it
 * looks like, why it cannot go to agents, and a button that removes the marked words.
 */
export function TextCheckNote({
  id,
  code,
  more,
  onRemove,
}: {
  id: string
  code: string
  /** How many more matches the text holds after this one. */
  more: number
  onRemove: () => void
}) {
  const message = textCheckMessages[code] ?? "This text can't go in a fact. Remove it."
  const cut = message.indexOf('. ')
  return (
    <div
      id={id}
      data-slot="text-check"
      className="flex items-start gap-2 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-dense text-status-danger-fg"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="size-4 shrink-0 translate-y-px text-status-danger-icon"
      />
      <p className="min-w-0 flex-1">
        <b className="font-bold">{cut < 0 ? message : message.slice(0, cut + 1)}</b>
        {cut < 0 ? null : message.slice(cut + 1)}
        {more > 0 ? ` ${more} more ${more === 1 ? 'place' : 'places'} below.` : null}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
        className="text-status-danger-fg"
      >
        Remove it
      </Button>
    </div>
  )
}
