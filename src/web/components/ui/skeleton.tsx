import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      // With reduced motion the skeleton is static at 70 percent opacity (design contract 10, rule 9).
      className={cn(
        'rounded-md bg-muted motion-safe:animate-pulse motion-reduce:opacity-70',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
