import type { CSSProperties, ReactNode } from 'react'
import { EqualIcon, FolderIcon, GlobeIcon, SigmaIcon, SplitIcon, XIcon } from 'lucide-react'
import { cn } from 'cn'
import { chipTone, domainHue, domainIdByName, kindOfWhere, type Tone } from '@/lib/tones'
import type { DomainId } from '@/data/world'

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
        'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[6px] pl-1.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:opacity-80',
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
          className="relative grid size-5 shrink-0 place-items-center rounded-[4px] outline-none after:absolute after:-inset-2 hover:bg-black/8 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
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
  const kind = kindOfWhere(w)
  const Icon = whereIcon[kind]
  const hue = kind === 'domain' ? domainHue[domainIdByName(w)!] : undefined
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
  const h = domainHue[id]
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        h === null ? 'border border-muted-foreground' : 'bg-[oklch(0.62_0.14_var(--chip-h))]',
        className,
      )}
      style={h === null ? undefined : ({ '--chip-h': h } as CSSProperties)}
    />
  )
}
