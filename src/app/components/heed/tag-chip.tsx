import type { CSSProperties, ReactNode } from 'react'
import { EqualIcon, FolderIcon, GlobeIcon, SigmaIcon, SplitIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useVocabulary } from '@/api/queries'
import { chipTone, domainHue, domainIdByName, kindOfWhere, type Tone } from '@/lib/tones'
import { useDomains } from '@/lib/workspace'
import type { DomainId } from '@/model/items'

// The one chip: 24px, a 6px radius, tinted by what it names, with its type's icon. Tags in the
// editor, Details, the list's Scope column and filters all use it.

export function TagChip({
  tone = 'neutral',
  hue,
  icon,
  children,
  onRemove,
  removeLabel,
  title,
  className,
}: {
  tone?: Tone
  /** A domain's own hue. */
  hue?: number | null
  icon?: ReactNode
  children: ReactNode
  onRemove?: () => void
  removeLabel?: string
  title?: string
  className?: string
}) {
  const t = chipTone(tone, hue)
  return (
    <span
      title={title}
      style={t.style}
      className={cn(
        'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-sm pl-1.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:opacity-80',
        onRemove ? 'pr-0.5' : 'pr-1.5',
        t.className,
        className,
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="relative grid size-5 shrink-0 place-items-center rounded outline-none after:absolute after:-inset-2 hover:bg-chip-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      )}
    </span>
  )
}

const whereIcon = {
  metric: SigmaIcon,
  dimension: SplitIcon,
  market: GlobeIcon,
  domain: FolderIcon,
  term: EqualIcon,
}

/** A plain "applies to" word as its chip: a metric, a market, a domain or the author's own word. */
export function WhereChip({
  w,
  label,
  onRemove,
}: {
  w: string
  label?: ReactNode
  onRemove?: () => void
}) {
  const vocabulary = useVocabulary()
  const domains = useDomains()
  const kind = kindOfWhere(w, vocabulary, domains)
  const Icon = whereIcon[kind]
  const domain = kind === 'domain' ? domainIdByName(w, domains) : undefined
  const hue = domain ? domainHue(domain) : undefined
  return (
    <TagChip
      tone={kind}
      hue={hue}
      icon={<Icon aria-hidden />}
      onRemove={onRemove}
      removeLabel={onRemove ? `Remove ${w}` : undefined}
      title={w}
    >
      {label ?? w}
    </TagChip>
  )
}

/** A domain's dot: its hue, or a neutral ring for the sandbox. */
export function DomainDot({ id, className }: { id: DomainId; className?: string }) {
  const h = domainHue(id)
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        h === null ? 'border border-muted-foreground' : 'bg-chip-dot',
        className,
      )}
      style={h === null ? undefined : ({ '--chip-h': h } as CSSProperties)}
    />
  )
}
