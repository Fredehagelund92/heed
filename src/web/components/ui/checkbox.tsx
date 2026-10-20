import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { cn } from '@/lib/utils'
import { CheckIcon, MinusIcon } from '@/components/icons'

/**
 * A 16px box with a 24px hit area (contract 4.5). The boundary is `--input`, 3:1 on every surface.
 * `indeterminate` (some of a list selected) fills the box and draws a dash instead of the tick.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer group/checkbox relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background transition-colors after:absolute after:-inset-1 data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground max-md:size-5 max-md:after:-inset-3 pointer-coarse:size-5 pointer-coarse:after:-inset-3 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current [&>svg]:size-3 [&>svg]:stroke-icon-sm"
      >
        <CheckIcon className="group-data-indeterminate/checkbox:hidden" />
        <MinusIcon className="hidden group-data-indeterminate/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
