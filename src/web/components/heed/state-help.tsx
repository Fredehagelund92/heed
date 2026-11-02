import * as React from 'react'
import { ArrowRightIcon } from '@/components/icons'
import { StateLine } from '@/components/heed/bits'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DRAFT_LABEL, type AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import { useRoute } from '@/lib/router'

/**
 * The state of an answer, at its head: the badge alone, its one or two words with its icon and
 * tint. What it means is a card on the badge: on hover, on keyboard focus and on a tap, the
 * meaning in plain words, what to do, anything the answer adds (`children`: which two items
 * disagree), and a way to all six. The card sits above the badge, never over the words it
 * explains, and Escape closes it with focus back on the badge.
 */
export function StateHelp({
  state,
  draft,
  children,
}: {
  state: AnswerState
  draft?: boolean
  children?: React.ReactNode
}) {
  const { query } = useRoute()
  const line = ANSWER_LINES.find((l) => l.state === state)!
  const [open, setOpen] = React.useState(query.get('statehelp') === '1')
  const card = React.useRef<HTMLDivElement>(null)
  // Closed from inside the card, focus comes back to the badge: that doesn't open it again.
  const returning = React.useRef(false)
  return (
    <Popover
      open={open}
      // A press opens it and leaves it open; Escape, a press outside or leaving it closes it.
      onOpenChange={(o, { reason }) => {
        const next = reason === 'trigger-press' || o
        if (!next && card.current?.contains(document.activeElement)) returning.current = true
        setOpen(next)
      }}
    >
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={100}
        // Reached by the keyboard, it opens as it would under the pointer.
        onFocus={(e) => {
          if (returning.current) returning.current = false
          else if (e.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        onBlur={() => (returning.current = false)}
        className="w-fit rounded-md text-left outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <StateLine state={state} draft={draft} tip={false} className="h-6 py-0">
          {draft && state === 'grounded' ? DRAFT_LABEL : undefined}
        </StateLine>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        // It opens beside the badge, not into it: Tab goes on into the card, Escape comes back.
        initialFocus={false}
        ref={card}
        aria-label={`What ${line.label} means`}
        className="w-80 max-w-viewport-inset gap-2 rounded-lg p-3.5"
      >
        <p className="text-sm font-semibold">
          {line.label}: {line.sentence.charAt(0).toLowerCase() + line.sentence.slice(1)}
        </p>
        <p className="text-sm text-pretty">{line.means}</p>
        {children}
        <p className="text-sm text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">What you do. </span>
          {line.todo}
        </p>
        <a
          href="/help"
          className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          All answer lines
          <ArrowRightIcon className="size-3.5" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  )
}
