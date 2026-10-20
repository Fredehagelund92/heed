import type { RefObject } from 'react'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { NotificationsPanel } from './notifications-panel'

/**
 * The bell's popover with the notifications list (slice W7), loaded the first time the bell is
 * pointed at, focused or pressed, so neither is part of the first load. It opens under the
 * header's bell button, which stays the same element throughout, so focus never jumps: the bell
 * is its anchor and takes focus back when it closes.
 */
export function NotificationsPopover({
  open,
  onOpenChange,
  bell,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bell: RefObject<HTMLButtonElement | null>
}) {
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // Pressing the bell itself toggles it (its own click); that press is not "outside".
        const target = details.event?.target
        if (
          !next &&
          details.reason === 'outside-press' &&
          target instanceof Node &&
          bell.current?.contains(target)
        )
          return
        onOpenChange(next)
      }}
    >
      <PopoverContent
        anchor={bell}
        finalFocus={bell}
        align="end"
        collisionPadding={16}
        aria-label="Notifications"
        className="w-inbox gap-0 p-0 max-md:[&_[data-slot=notifications-panel]_h2]:hidden max-md:[&_[data-slot=popover-sheet-header]]:px-4"
      >
        <NotificationsPanel onNavigate={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  )
}
