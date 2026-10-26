import * as React from 'react'
import {
  ArrowLeftRightIcon,
  ArrowRightFromLineIcon,
  ArrowRightIcon,
  ArrowRightToLineIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  InfinityIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { kindIcons } from '@/components/heed/kind-icons'
import { kindLabel, type Fact, type Kind } from '@/data/world'
import {
  checkedTip,
  timeDate,
  timeLong,
  timeNow,
  trustOf,
  type TimeFrame,
  type Trust,
} from '@/lib/timeframe'

// The cells of the list columns' design B, as chosen: icons and short labels.
// The kind as an icon before the title, the status as a circle icon, the time frame as a glyph
// and a short date, and freshness as a dot (filled fresh, half ageing, hollow overdue). The only
// words beside the title are dates; the exact value is one hover away.

/** A small tooltip on any mark: the name first, then a quiet line of detail. */
function Tip({
  label,
  detail,
  children,
  className,
}: {
  label: string
  detail?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={detail ? `${label}. ${detail}` : label}
            className={cn('inline-flex align-middle', className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 flex-col items-start gap-0.5 text-left">
        <span className="font-medium">{label}</span>
        {detail && <span className="block opacity-80">{detail}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const kindHint: Record<Kind, string> = {
  event: 'A dated event, such as a stop, a switch or a new rule.',
  issue: 'Late, missing or doubled data, or a tracking outage.',
  note: 'A house rule or a definition worth knowing.',
  guide: 'What to check before you explain a movement.',
}

/** The kind as a 16px icon: lightning, triangle, bulb, route. */
export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon = kindIcons[kind]
  return (
    <Tip
      label={kindLabel[kind]}
      detail={kindHint[kind]}
      className={cn('text-muted-foreground', className)}
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
    </Tip>
  )
}

const statusLook = {
  Live: { icon: CircleCheckIcon, tone: 'text-[var(--ok)]', hint: 'Live: agents get it' },
  'Needs checking': {
    icon: CircleAlertIcon,
    tone: 'text-[var(--warn)]',
    hint: 'Needs checking: its check date passed or a definition changed',
  },
  Draft: {
    icon: CircleDashedIcon,
    tone: 'text-[var(--idle)]',
    hint: 'Draft: written, not shared with agents yet',
  },
  Archived: {
    icon: CircleMinusIcon,
    tone: 'text-[var(--idle)]',
    hint: 'Archived: agents no longer get it',
  },
} as const

/** The status as one of four circle icons: check, alert, dashed, minus. */
export function StatusIcon({ status, className }: { status: Fact['status']; className?: string }) {
  const s = statusLook[status]
  return (
    <Tip label={status} detail={s.hint} className={cn(s.tone, className)}>
      <s.icon aria-hidden className="size-4" strokeWidth={1.75} />
    </Tip>
  )
}

const timeGlyphs = {
  always: InfinityIcon,
  ongoing: ArrowRightIcon,
  since: ArrowRightFromLineIcon,
  until: ArrowRightToLineIcon,
  range: ArrowLeftRightIcon,
}

/** The time frame as a glyph (always, ongoing, since, until, a range) and only the date as text. */
export function TimeGlyph({ time }: { time: TimeFrame }) {
  const Icon = timeGlyphs[time.t]
  return (
    <Tip
      label={timeLong(time)}
      detail={timeNow(time)}
      className="items-center gap-1.5 text-[13px] whitespace-nowrap"
    >
      <Icon aria-hidden className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
      <span>{timeDate(time)}</span>
    </Tip>
  )
}

const freshLabel: Record<Trust, string> = {
  fresh: 'Fresh',
  ageing: 'Ageing',
  due: 'Overdue',
  draft: 'Not checked yet',
  retired: 'Archived',
}

/** Freshness as a dot: filled fresh (to 30 days), half ageing (to 90), hollow overdue, a dash when it doesn't apply. */
export function FreshDot({ fact }: { fact: Fact }) {
  const trust = trustOf(fact)
  const tone =
    trust === 'fresh'
      ? 'text-[var(--ok)]'
      : trust === 'ageing' || trust === 'due'
        ? 'text-[var(--warn)]'
        : 'text-[var(--idle)]'
  return (
    <Tip label={freshLabel[trust]} detail={checkedTip(fact)} className={tone}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        {trust === 'fresh' && <circle cx="6" cy="6" r="4.2" fill="currentColor" />}
        {trust === 'ageing' && (
          <>
            <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6 1.8a4.2 4.2 0 0 1 0 8.4Z" fill="currentColor" />
          </>
        )}
        {trust === 'due' && (
          <circle cx="6" cy="6" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
        {(trust === 'draft' || trust === 'retired') && (
          <path d="M3 6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        )}
      </svg>
    </Tip>
  )
}
