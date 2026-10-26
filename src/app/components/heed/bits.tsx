import type { CSSProperties, ReactNode } from 'react'
import { useDomains } from '@/lib/workspace'
import { diffWords } from 'diff'
import {
  BotIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  ClockIcon,
  ContrastIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import type { DomainId, Status } from '@/model/items'

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

/** A person: 32 in chat, 28 in lists. */
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
  return (
    <Avatar
      className={cn(
        size === 16 ? 'size-4' : size === 20 ? 'size-5' : size === 28 ? 'size-7' : 'size-8',
        className,
      )}
      title={name}
    >
      <AvatarFallback
        className={cn(
          'bg-(--avatar-tint) font-semibold text-(--avatar-ink)',
          size === 16
            ? 'text-5xs'
            : size === 20
              ? 'text-4xs'
              : size === 28
                ? 'text-2xs'
                : 'text-xs',
        )}
        style={{ '--avatar-tint': tint, '--avatar-ink': ink } as CSSProperties}
      >
        {initials(name)}
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

export function StatusBadge({ status }: { status: Status }) {
  if (status === 'Live') return <Badge variant="outline">Live</Badge>
  if (status === 'Needs checking')
    return (
      <Badge variant="secondary">
        <ClockIcon data-icon="inline-start" aria-hidden />
        Needs checking
      </Badge>
    )
  return (
    <Badge variant="ghost" className="text-muted-foreground">
      {status}
    </Badge>
  )
}

/* ---------- answer states ---------- */

const stateIcon: Record<AnswerState, typeof CircleCheckIcon> = {
  grounded: CircleCheckIcon,
  partial: ContrastIcon,
  missing: CircleDashedIcon,
  conflict: TriangleAlertIcon,
  stale: ClockIcon,
  failed: CircleAlertIcon,
}

/**
 * The one line that says what kind of answer this is, in one or two plain words from the one list
 * (`ANSWER_LINES`), always with its icon and tint, never colour alone and never the word alone.
 * `sentence` adds the short sentence under it for every state but Checked; the tooltip gives the
 * longer meaning. `draft` is an answer from text nobody has checked yet: a dashed ring, never the
 * checked mark. Built of spans, so it can sit inside a button.
 */
export function StateLine({
  state,
  draft,
  children,
  className,
  sentence,
  tip = true,
}: {
  state: AnswerState
  draft?: boolean
  /** Other words in place of the state's own, such as an answer from a draft. */
  children?: ReactNode
  className?: string
  sentence?: boolean
  /** The tooltip with the longer meaning; off where something else explains it. */
  tip?: boolean
}) {
  const line = ANSWER_LINES.find((l) => l.state === state)!
  const Icon = draft && state === 'grounded' ? CircleDotDashedIcon : stateIcon[state]
  const chip = (
    <span
      className={cn(
        'flex w-fit items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold',
        draft ? 'border border-dashed border-input' : stateTone[state],
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{children ?? line.label}</span>
    </span>
  )
  const shown =
    tip && !draft ? (
      <Tooltip>
        <TooltipTrigger render={<span className="flex w-fit" />}>{chip}</TooltipTrigger>
        <TooltipContent className="block max-w-64 text-pretty">
          <span className="font-semibold">{line.long}.</span> {line.means}
        </TooltipContent>
      </Tooltip>
    ) : (
      chip
    )
  if (!sentence || draft || state === 'grounded') return shown
  return (
    <span className="flex flex-col gap-1">
      {shown}
      <span className="text-sm font-normal text-muted-foreground">{line.sentence}</span>
    </span>
  )
}

/**
 * Each state told apart at a glance, never by colour alone (the icon and the words differ too): a
 * quiet tint per state, the words in the text colour so they keep 4.5:1 in both themes.
 */
const stateTone: Record<AnswerState, string> = {
  grounded: 'bg-primary/8 [&>svg]:text-primary',
  partial: 'bg-muted [&>svg]:text-muted-foreground',
  missing: 'border border-dashed border-input [&>svg]:text-muted-foreground',
  conflict: 'bg-warn/14 ring-1 ring-warn/45 ring-inset [&>svg]:text-[var(--warn)]',
  stale: 'bg-warn/8 [&>svg]:text-[var(--warn)]',
  failed: 'bg-destructive/10 [&>svg]:text-destructive',
}

/* ---------- review ---------- */

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
