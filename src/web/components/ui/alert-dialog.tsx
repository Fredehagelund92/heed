import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { cn } from '@/lib/utils'
import { OverlayLayer } from '@/components/ui/layer'
import { Button, QuietButtons } from '@/components/ui/button'

/**
 * AlertDialog on Base UI (contract 7.1): a dialog that interrupts and must be answered. It has
 * no close button and does not close on a click outside; Escape and Cancel close it, and focus
 * returns to the trigger. `max-w-confirm` wide. It enters with an 8 pixel rise and a fade
 * (contract 10). Governed actions use `ConfirmDialog`, which is built on this.
 */
function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-overlay bg-scrim transition-opacity duration-base data-ending-style:opacity-0 data-ending-style:duration-instant data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <OverlayLayer value>
      <AlertDialogPrimitive.Portal>
        <AlertDialogOverlay />
        <AlertDialogPrimitive.Viewport
          data-slot="alert-dialog-viewport"
          className="@container/viewport fixed inset-0 z-overlay flex items-center justify-center overflow-y-auto p-4"
        >
          <AlertDialogPrimitive.Popup
            data-slot="alert-dialog-content"
            className={cn(
              'relative flex max-h-full w-full max-w-confirm flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-6 text-body text-popover-foreground shadow-overlay ring-1 ring-foreground/10 transition duration-base ease-out outline-none data-ending-style:opacity-0 data-ending-style:duration-instant data-starting-style:opacity-0 motion-safe:data-starting-style:translate-y-2 pointer-coarse:p-4',
              className,
            )}
            {...props}
          />
        </AlertDialogPrimitive.Viewport>
      </AlertDialogPrimitive.Portal>
    </OverlayLayer>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

/**
 * Cancel first, the action last; stacked full width on a phone with the action on top. The
 * footer is quiet: Cancel and any other outline action are ghost beside the one action.
 */
function AlertDialogFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 *:w-full @md/viewport:flex-row @md/viewport:justify-end @md/viewport:*:w-auto',
        className,
      )}
      {...props}
    >
      <QuietButtons value>{children}</QuietButtons>
    </div>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-large font-bold text-foreground', className)}
      {...props}
    />
  )
}

/** The effect, in one sentence. It is what the person needs to read, so it is not muted. */
function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        'max-w-prose text-body text-foreground *:[a]:text-brand-ink *:[a]:underline *:[a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = 'outline',
  size = 'lg',
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogTitle,
  AlertDialogTrigger,
}
