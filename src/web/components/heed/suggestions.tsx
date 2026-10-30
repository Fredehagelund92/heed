import { cn } from '@/lib/utils'

/**
 * Questions to ask, as soft chips: conversational, like the box they fill. A grid of starters on a
 * new workspace's empty Ask, a row under an answer that looked nothing up.
 */
export function Suggestions({
  items,
  onPick,
  grid,
  label = 'Suggested questions',
}: {
  items: string[]
  onPick: (q: string) => void
  grid?: boolean
  label?: string
}) {
  if (!items.length) return null
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'gap-2',
        // A grid of two where there is room, stacked where there isn't: every starter whole, none cut off.
        grid ? 'grid grid-cols-1 @lg:grid-cols-2' : 'flex flex-wrap',
      )}
    >
      {items.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          className={cn(
            'rounded-surface border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors outline-none hover:border-foreground/25 hover:bg-muted/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40',
            grid ? '@lg:min-h-16' : '',
          )}
        >
          {q}
        </button>
      ))}
    </div>
  )
}
