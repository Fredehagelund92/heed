import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

/**
 * A switch on Base UI (contract 7.1): a 32 by 20 track with a 16 pixel thumb, a `--input`
 * track when off (3:1) and ink when on, a 24 pixel hit area. Use it for a setting that takes
 * effect at once; a form choice that is submitted later is a checkbox or a radio group.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group/switch relative inline-flex h-5 w-8 shrink-0 items-center rounded-full border border-transparent transition-colors after:absolute after:-inset-x-1 after:-inset-y-1 aria-invalid:border-destructive max-md:after:-inset-x-2 max-md:after:-inset-y-3 pointer-coarse:after:-inset-y-3 data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-px rounded-full bg-background shadow-raised transition-transform duration-instant data-checked:translate-x-3.25"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
