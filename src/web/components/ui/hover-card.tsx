import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card'
import { cn } from '@/lib/utils'
import { usePopupLayer } from '@/components/ui/layer'

/**
 * HoverCard on Base UI's preview card: a small card that opens after 300 ms of hover or on
 * keyboard focus of its trigger, for a mention or a person (contract 6.13). It never holds the
 * only copy of an instruction; the trigger stays a link that works without it.
 */
function HoverCard<Payload>({ ...props }: PreviewCardPrimitive.Root.Props<Payload>) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ delay = 300, ...props }: PreviewCardPrimitive.Trigger.Props) {
  return <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" delay={delay} {...props} />
}

function HoverCardContent({
  className,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  alignOffset = 0,
  collisionPadding,
  anchor,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionPadding' | 'anchor'
  >) {
  const layer = usePopupLayer()
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className={cn('isolate', layer)}
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            'flex w-popover max-w-(--available-width) origin-(--transform-origin) flex-col gap-2 rounded-lg bg-popover p-3 text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10 outline-hidden duration-fast data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            layer,
            className,
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
