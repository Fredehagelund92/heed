import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  ClockIcon,
  ContrastIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'

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
