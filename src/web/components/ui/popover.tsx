import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { XIcon } from '@/components/icons'
import { useIsMobile } from '@/hooks/use-mobile'
import { usePopupLayer } from '@/components/ui/layer'

const PhoneSheet = React.createContext(true)

function Popover({
  phoneSheet = true,
  ...props
}: PopoverPrimitive.Root.Props & {
  /** Editable anchors, such as date fields, keep their calendar beside the input. */
  phoneSheet?: boolean
}) {
  const phone = useIsMobile()
  return (
    <PhoneSheet value={phoneSheet}>
      <PopoverPrimitive.Root data-slot="popover" modal={phone && phoneSheet} {...props} />
    </PhoneSheet>
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  children,
  sheetTitle,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  collisionAvoidance,
  collisionPadding,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props & { sheetTitle?: string } & Pick<
    PopoverPrimitive.Positioner.Props,
    | 'align'
    | 'alignOffset'
    | 'side'
    | 'sideOffset'
    | 'collisionAvoidance'
    | 'collisionPadding'
    | 'anchor'
  >) {
  const layer = usePopupLayer()
  const mobile = useIsMobile()
  const phone = React.use(PhoneSheet) && mobile
  const phoneTitle = sheetTitle ?? props['aria-label'] ?? 'Options'
  return (
    <PopoverPrimitive.Portal>
      {phone ? <PopoverPrimitive.Backdrop className={cn('fixed inset-0 bg-scrim', layer)} /> : null}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className={cn(
          'isolate',
          layer,
          phone && 'fixed! inset-x-0! top-auto! bottom-0! w-full! transform-none!',
        )}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          aria-label={phone ? phoneTitle : undefined}
          className={cn(
            'flex max-h-(--available-height) w-popover max-w-(--available-width) origin-(--transform-origin) flex-col gap-3 overflow-y-auto rounded-lg bg-popover p-3 text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10 outline-hidden duration-fast data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            layer,
            className,
            phone &&
              'max-h-drawer! w-full! max-w-full! transform-none! overscroll-contain rounded-t-xl rounded-b-none! pb-safe-bottom',
          )}
          {...props}
        >
          {phone ? (
            <div
              data-slot="popover-sheet-header"
              className="flex shrink-0 items-center justify-between gap-3 border-b"
            >
              <h2 className="text-body font-bold">{phoneTitle}</h2>
              <PopoverPrimitive.Close
                render={<Button variant="ghost" size="icon-touch" aria-label="Close options" />}
              >
                <XIcon />
              </PopoverPrimitive.Close>
            </div>
          ) : null}
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-dense', className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('font-bold', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
