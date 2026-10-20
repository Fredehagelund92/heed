import * as React from 'react'
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import { cn } from '@/lib/utils'
import { OverlayLayer } from '@/components/ui/layer'

/**
 * Drawer on Base UI (contract 7.1, not Vaul): a panel from the bottom edge on phones, such as
 * the preview drawer of Add context. Swipe down, Escape or a tap on the scrim closes it; focus
 * is trapped while it is open and returns to the trigger. It slides in over 200 ms and out
 * over 100 (contract 10); with reduced motion it only fades.
 */
function Drawer({ swipeDirection = 'down', ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" swipeDirection={swipeDirection} {...props} />
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-overlay bg-scrim transition-opacity duration-base data-ending-style:opacity-0 data-ending-style:duration-instant data-starting-style:opacity-0 data-swiping:transition-none',
        className,
      )}
      {...props}
    />
  )
}

function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <OverlayLayer value>
      <DrawerPrimitive.Portal>
        <DrawerOverlay />
        <DrawerPrimitive.Viewport
          data-slot="drawer-viewport"
          className="pointer-events-none fixed inset-0 z-overlay"
        >
          <DrawerPrimitive.Popup
            data-slot="drawer-content"
            className={cn(
              'pointer-events-auto fixed inset-x-0 bottom-0 flex max-h-drawer drawer-swipe flex-col rounded-t-xl border-t bg-popover text-body text-popover-foreground shadow-overlay transition duration-base ease-out outline-none data-ending-style:duration-instant data-swiping:transition-none motion-safe:data-ending-style:translate-y-full motion-safe:data-starting-style:translate-y-full motion-reduce:data-ending-style:opacity-0 motion-reduce:data-starting-style:opacity-0',
              className,
            )}
            {...props}
          >
            <div aria-hidden className="flex shrink-0 justify-center pt-2">
              <div className="h-1 w-12 rounded-full bg-muted" />
            </div>
            <DrawerPrimitive.Content
              data-slot="drawer-body"
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            >
              {children}
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </OverlayLayer>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex shrink-0 flex-col gap-1 px-4 pt-2 pb-4', className)}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('flex shrink-0 flex-col gap-2 border-t p-4', className)}
      {...props}
    />
  )
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-large font-bold text-foreground', className)}
      {...props}
    />
  )
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-body text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle,
  DrawerTrigger,
}
