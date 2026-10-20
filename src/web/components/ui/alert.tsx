import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Alert: icon, title, text and an optional action (contract 7.1). The tone is a status family;
 * the icon carries the meaning, the tint only reinforces it.
 */
const alertVariants = cva(
  "group/alert flex w-full items-start gap-3 rounded-lg border p-4 text-left text-body *:[svg]:shrink-0 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground *:[svg]:text-muted-foreground',
        info: 'border-status-info-border bg-status-info-bg text-status-info-fg *:[svg]:text-status-info-icon',
        warning:
          'border-status-warning-border bg-status-warning-bg text-status-warning-fg *:[svg]:text-status-warning-icon',
        danger:
          'border-status-danger-border bg-status-danger-bg text-status-danger-fg *:[svg]:text-status-danger-icon',
        success:
          'border-status-success-border bg-status-success-bg text-status-success-fg *:[svg]:text-status-success-icon',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

/** The text column beside the icon: title, description and an optional action. */
function AlertContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-content"
      className={cn('flex min-w-0 flex-1 flex-col gap-1', className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-bold', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'flex max-w-prose flex-col gap-3 group-data-[variant=default]/alert:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertContent, AlertTitle, AlertDescription }
