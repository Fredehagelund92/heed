import { cn } from '@/lib/utils'

/**
 * A count next to a name (contract 6.13): quiet text in lists, a neutral chip inside a control,
 * ink only for what waits for this person, amber for a count of things that need a look. A count
 * read from one page of a longer list stops at `max` and shows as "99+".
 */
export function CountBadge({
  count,
  tone = 'chip',
  max,
  className,
}: {
  count: number
  tone?: 'quiet' | 'chip' | 'ink' | 'attention'
  max?: number
  className?: string
}) {
  const text =
    max !== undefined && count > max ? `${max.toLocaleString('en')}+` : count.toLocaleString('en')
  if (tone === 'quiet') {
    return (
      <span
        data-slot="count-badge"
        className={cn('text-dense text-muted-foreground tabular-nums', className)}
      >
        {text}
      </span>
    )
  }
  return (
    <span
      data-slot="count-badge"
      data-tone={tone === 'attention' ? 'warning' : 'neutral'}
      className={cn(
        'inline-flex badge-sm min-w-5 shrink-0 items-center justify-center rounded-badge border font-bold tabular-nums',
        tone === 'chip' && 'border-transparent bg-muted text-muted-foreground',
        tone === 'ink' && 'border-ink bg-ink text-ink-foreground',
        tone === 'attention' && 'border-tone-line bg-tone-tint text-tone-ink',
        className,
      )}
    >
      {text}
    </span>
  )
}
