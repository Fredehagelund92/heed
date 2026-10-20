import * as React from 'react'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { ChevronsUpDownIcon } from '@/components/icons'

/**
 * The browser's own select (contract 7.1), for short lists on phones and with a coarse pointer,
 * where the system picker is easier than a popup. Same box as `SelectTrigger`, so the two can
 * swap at a breakpoint without the form moving. Inside a `Field` it is labelled and described
 * by the field, like the other controls.
 */
const nativeSelectVariants = cva(
  'w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-background py-1 pr-8 pl-3 text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed aria-invalid:border-destructive max-md:min-h-control-touch dark:bg-input/30 dark:hover:bg-input/50 pointer-coarse:h-control-touch pointer-coarse:text-large',
  {
    variants: {
      size: {
        default: 'h-control-md text-dense',
        lg: 'h-control-lg text-body',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> &
  VariantProps<typeof nativeSelectVariants>

function NativeSelect({ className, size = 'default', ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn(
        'group/native-select relative w-full has-[select:disabled]:opacity-50',
        className,
      )}
    >
      <FieldPrimitive.Control
        data-slot="native-select"
        data-size={size}
        className={nativeSelectVariants({ size })}
        render={<select {...props} />}
      />
      <ChevronsUpDownIcon
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
