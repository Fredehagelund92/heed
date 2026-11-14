import type { CSSProperties } from 'react'
import { useDomains } from '@/lib/workspace'
import { diffWords } from 'diff'
import { BotIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { DomainId } from '@/model/items'

/* ---------- people ---------- */

// Soft tint, dark initials, picked from the name so one person keeps one colour everywhere.
// Each pair is 6.4:1 or better, and stays the same in dark mode.
const PASTELS: [string, string][] = [
  ['#ffd9c7', '#7a2e10'],
  ['#d4ecff', '#174a7a'],
  ['#dff3d0', '#2d5a14'],
  ['#f7d6ef', '#7a1f63'],
  ['#fff0bf', '#6a4a00'],
  ['#d9dcff', '#2e3591'],
  ['#cdf1ea', '#0f5a4e'],
  ['#ffd6dc', '#8a1f33'],
  ['#e9dcff', '#56309a'],
  ['#e2ecd4', '#3c5520'],
  ['#ffe2cc', '#80400e'],
  ['#d6e9f5', '#1d4d6b'],
]

function hash(s: string) {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** A person: 28 in lists, 32 in the user menu. Initials are 12 px; at 16 and 20 px there is no
 *  room for 12 px letters, so the avatar shows its colour (hidden from a screen reader, which hears
 *  the name beside it) and the name stays in its title. */
export function PersonAvatar({
  name,
  size = 28,
  className,
}: {
  name: string
  size?: 16 | 20 | 28 | 32
  className?: string
}) {
  const [tint, ink] = PASTELS[hash(name) % PASTELS.length]!
  const lettered = size >= 28
  return (
    <Avatar
      aria-hidden={lettered ? undefined : true}
      className={cn(
        size === 16 ? 'size-4' : size === 20 ? 'size-5' : size === 28 ? 'size-7' : 'size-8',
        className,
      )}
      title={name}
    >
      {/* The ink is inline so a row that forces its own text colour (a focused menu item) cannot
          take it: the initials keep their contrast on the tint in every row. */}
      <AvatarFallback
        className="bg-(--avatar-tint) text-xs font-semibold"
        style={
          {
            '--avatar-tint': tint,
            '--avatar-ink': ink,
            color: 'var(--avatar-ink)',
          } as CSSProperties
        }
      >
        {lettered && initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** An agent that sent something with a person's OK. */
export function AgentAvatar({ size = 28 }: { size?: 28 | 32 }) {
  return (
    <Avatar className={size === 28 ? 'size-7' : 'size-8'}>
      <AvatarFallback className="bg-muted text-foreground">
        <BotIcon className="size-4" aria-hidden />
      </AvatarFallback>
    </Avatar>
  )
}

/* ---------- context items ---------- */

export function DomainBadge({ id }: { id: DomainId }) {
  const domains = useDomains()
  return <Badge variant="outline">{domains[id]?.name}</Badge>
}

/* ---------- answer states ---------- */

// The answer line is its own module, so the docs site can show it without the app's data.
export { StateLine } from './state-line'

/* ---------- review ---------- */

/** Inside a button that is not built yet: it stays where it will be, disabled, and says so. */
export function ComingSoon() {
  return (
    <span className="inline-flex h-5 items-center rounded-md border px-1.5 text-xs font-normal">
      Coming soon
    </span>
  )
}

/** Before and now in one line: what went struck out, what came in marked. */
export function WordDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className="text-sm leading-relaxed">
      {diffWords(before, after).map((p, i) =>
        p.added ? (
          <ins
            key={i}
            className="rounded-sm bg-diff-add px-0.5 text-diff-add-ink underline decoration-diff-add-line/50"
          >
            {p.value}
          </ins>
        ) : p.removed ? (
          <del key={i} className="rounded-sm bg-diff-del px-0.5 text-diff-del-ink">
            {p.value}
          </del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  )
}

/** One field of a suggestion: unchanged fields stay quiet, changed ones show the words that moved. */
export function FieldDiff({
  label,
  before,
  after,
}: {
  label: string
  before: string
  after: string
}) {
  const changed = before !== after
  return (
    <div className="grid gap-1.5 border-t py-3 first:border-t-0 first:pt-0 @lg:grid-cols-(--cols-lead-40) @lg:gap-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground @lg:flex-col @lg:items-start @lg:gap-1">
        {label}
        {changed && before && <Badge variant="secondary">Changed</Badge>}
      </div>
      {changed && before ? (
        <WordDiff before={before} after={after} />
      ) : (
        <p
          className={cn('text-sm leading-relaxed break-words', !changed && 'text-muted-foreground')}
        >
          {after}
        </p>
      )}
    </div>
  )
}
