import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from '@/lib/utils'
import { OverlayLayer } from '@/components/ui/layer'

import { Button, QuietButtons } from '@/components/ui/button'
import { XIcon } from '@/components/icons'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-overlay bg-scrim duration-instant supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <OverlayLayer value>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            'fixed top-1/2 left-1/2 z-overlay grid w-inset max-w-dialog -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-6 text-body text-popover-foreground shadow-overlay ring-1 ring-foreground/10 duration-base outline-none data-open:animate-in data-open:fade-in-0 motion-safe:data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:duration-instant data-closed:fade-out-0',
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              render={
                <Button
                  variant="ghost"
                  className="absolute top-4 right-4 text-muted-foreground"
                  size="icon-sm"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </OverlayLayer>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-row justify-end gap-2', className)}
      {...props}
    >
      <QuietButtons value>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
        )}
      </QuietButtons>
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-large font-bold', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-dense text-muted-foreground *:[a]:text-brand-ink *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:decoration-2',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
}
