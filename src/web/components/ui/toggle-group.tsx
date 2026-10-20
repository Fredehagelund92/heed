import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

import { toggleVariants } from '@/components/ui/toggle'

/** A row of toggles with roving focus: arrow keys move, Space or Enter presses. */
function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  size = 'default',
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(toggleVariants({ size }), className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
