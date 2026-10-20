import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The pressable chip: the one shape for quick chips, facets and segmented choices (contract 8.3).
 * 32 high, radius 4, text-dense 500. Pressed takes the accent fill and a foreground border.
 */
const toggleVariants = cva(
  "group/toggle inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-dense font-bold whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-pressed:border-foreground data-pressed:bg-accent data-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: 'h-control-md max-md:min-h-control-touch pointer-coarse:h-control-touch',
        sm: 'h-control-sm px-2 max-md:min-h-control-touch pointer-coarse:h-control-touch',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

function Toggle({
  className,
  size = 'default',
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
