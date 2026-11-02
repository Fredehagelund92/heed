import * as React from 'react'
import { ArrowRightIcon } from '@/components/icons'
import { StateLine } from '@/components/heed/bits'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DRAFT_LABEL, type AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import { useRoute } from '@/lib/router'

/** The card's width, and its distance from what it sits beside. */
const CARD_WIDTH = 280
const GAP = 8

/** How tall each state's card was when last open, so the next one knows whether it fits above. */
const heights = new Map<AnswerState, number>()

/**
 * Where the card goes, so it never covers the words it explains: beside the words when the thread
 * has room to their right for all of it, above the badge when it fits there, and otherwise in the
 * thread under the badge, where it moves the words down rather than sitting on them (a phone, or
 * an answer at the very top of the view).
 */
type Place = 'right' | 'top' | 'inline'

function placeFor(badge: Element, words: Element | null | undefined, height: number): Place {
  const frame = badge.closest('[data-thread]')?.getBoundingClientRect() ?? {
    top: 0,
    right: document.documentElement.clientWidth,
  }
  const top = badge.getBoundingClientRect().top
  const beside = words?.getBoundingClientRect()
  // Beside the words only where it ends before they do: below them the sources and the pair run
  // the whole width of the thread.
  if (
    beside?.width &&
    frame.right - beside.right - 2 * GAP >= CARD_WIDTH &&
    beside.bottom - top >= height
  )
    return 'right'
  if (top - frame.top - 2 * GAP >= height) return 'top'
  return 'inline'
}

/**
 * The state of an answer, at its head: the badge alone, its one or two words with its icon and
 * tint. What it means is a card on the badge: on hover, on keyboard focus and on a tap, the
 * meaning in plain words, what to do, anything the answer adds (`children`: which two items
 * disagree), and a way to all six. The card never covers the words it explains (`placeFor`), and
 * Escape closes it with focus back on the badge.
 */
export function StateHelp({
  state,
  draft,
  words,
  children,
}: {
  state: AnswerState
  draft?: boolean
  /** The answer's words, which the card goes beside when there is room. */
  words?: React.RefObject<HTMLElement | null>
  children?: React.ReactNode
}) {
  const { query } = useRoute()
  const line = ANSWER_LINES.find((l) => l.state === state)!
  const [open, setOpen] = React.useState(false)
  const [place, setPlace] = React.useState<Place>('top')
  const badge = React.useRef<HTMLButtonElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const slot = React.useRef<HTMLDivElement>(null)
  // Closed from inside the card, focus comes back to the badge: that doesn't open it again.
  const returning = React.useRef(false)
  const show = (next: boolean) => {
    // How tall it was, for the next time: read as it closes, once it has been laid out.
    if (!next && card.current?.offsetHeight) heights.set(state, card.current.offsetHeight)
    if (next && !open && badge.current)
      setPlace(
        placeFor(badge.current, words?.current, heights.get(state) ?? (children ? 300 : 240)),
      )
    setOpen(next)
  }
  // Asked for in the address (?statehelp=1), it opens once the badge is on screen.
  const asked = query.get('statehelp') === '1'
  React.useEffect(() => {
    if (asked) show(true)
    // Once, on the way in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Beside the words, the card's top is the badge's: it starts where the answer does.
  const [besideWords] = React.useState(() => ({
    getBoundingClientRect: () => {
      const w = words?.current?.getBoundingClientRect()
      const b = badge.current?.getBoundingClientRect()
      return w && b ? new DOMRect(w.left, b.top, w.width, b.height) : new DOMRect()
    },
  }))
  return (
    <Popover
      open={open}
      // A press opens it and leaves it open; Escape, a press outside or leaving it closes it.
      onOpenChange={(o, { reason }) => {
        const next = reason === 'trigger-press' || o
        if (!next && card.current?.contains(document.activeElement)) returning.current = true
        show(next)
      }}
    >
      <PopoverTrigger
        ref={badge}
        openOnHover
        delay={120}
        closeDelay={100}
        // Reached by the keyboard, it opens as it would under the pointer.
        onFocus={(e) => {
          if (returning.current) returning.current = false
          else if (e.currentTarget.matches(':focus-visible')) show(true)
        }}
        onBlur={() => (returning.current = false)}
        className="w-fit rounded-md text-left outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <StateLine state={state} draft={draft} tip={false} className="h-6 py-0">
          {draft && state === 'grounded' ? DRAFT_LABEL : undefined}
        </StateLine>
      </PopoverTrigger>
      {/* Where the card goes in the thread when it has nowhere else to go. */}
      <div ref={slot} className="empty:hidden" />
      <PopoverContent
        side={place === 'right' ? 'right' : place === 'top' ? 'top' : 'bottom'}
        align="start"
        sideOffset={GAP}
        anchor={place === 'right' ? besideWords : undefined}
        // Never turned onto the words: beside them or above the badge it stays on its side.
        collisionAvoidance={{ side: 'none', align: 'shift' }}
        container={place === 'inline' ? slot : undefined}
        positionerClassName={
          place === 'inline' ? 'static! transform-none! translate-none!' : undefined
        }
        // It opens beside the badge, not into it: Tab goes on into the card, Escape comes back.
        initialFocus={false}
        ref={card}
        aria-label={`What ${line.label} means`}
        className="w-70 max-w-full gap-2 rounded-lg p-3.5"
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
