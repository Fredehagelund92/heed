import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { cn } from '@/lib/utils'

/**
 * A radio group on Base UI (contract 7.1). Arrow keys move between options and choose them;
 * the group is one tab stop. Each option is a 16 pixel circle with a 24 pixel hit area and a
 * `--input` boundary (3:1). Put each option in a `FieldItem` with a `FieldLabel`.
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('flex w-full flex-col gap-3', className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        'group/radio-group-item relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background transition-colors after:absolute after:-inset-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive max-md:size-5 max-md:after:-inset-3 pointer-coarse:size-5 pointer-coarse:after:-inset-3 data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="size-2 rounded-full bg-primary-foreground"
      />
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
