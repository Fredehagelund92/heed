import { cn } from '@/lib/utils'
import type { Connector } from '@/model/integrations'

/** A tool's real logo in a white tile, so it reads the same in light and dark. */
export function ToolLogo({
  c,
  size = 'md',
  className,
}: {
  c: Pick<Connector, 'logo'>
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border bg-logo-plate',
        size === 'sm' && 'size-5 rounded-tile p-0.75',
        size === 'md' && 'size-8 rounded-md p-1.5',
        size === 'lg' && 'size-11 rounded-lg p-2',
        className,
      )}
    >
      <img src={c.logo} alt="" className="size-full object-contain" />
    </span>
  )
}
