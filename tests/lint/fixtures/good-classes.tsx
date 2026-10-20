// The same shape, built only from tokens. Must produce no messages.
import { CheckIcon } from '@/components/icons'

export function GoodComponent() {
  return (
    <div className="flex flex-col gap-4 bg-background p-6 text-dense text-foreground @md:flex-row">
      <CheckIcon className="size-4 text-muted-foreground" />
      <span className="h-control-md w-sidebar rounded-md border bg-type-event-tint p-2 text-type-event-ink">
        Tokens only
      </span>
    </div>
  )
}
