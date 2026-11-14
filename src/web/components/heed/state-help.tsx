import * as React from 'react'
import { ArrowRightIcon, BookAIcon } from '@/components/icons'
import { StateLine } from '@/components/heed/bits'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DRAFT_LABEL, type AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import { useRoute } from '@/lib/router'

/** The card's width, and its distance from what it sits beside. */
const CARD_WIDTH = 280
const GAP = 8

/** How tall each state's card was when last open, so the next one knows whether it fits above. */
const heights = new Map<string, number>()

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
  const line = ANSWER_LINES.find((l) => l.state === state)!
  return (
    <BadgeCard
      id={state}
      label={line.label}
      words={words}
      tall={!!children}
      badge={
        <StateLine state={state} draft={draft} tip={false} className="h-6 py-0">
          {draft && state === 'grounded' ? DRAFT_LABEL : undefined}
        </StateLine>
      }
      title={`${line.label}: ${line.sentence.charAt(0).toLowerCase() + line.sentence.slice(1)}`}
      means={line.means}
      todo={line.todo}
      more={{ href: '/help', label: 'All answer lines' }}
    >
      {children}
    </BadgeCard>
  )
}

/**
 * The head of an answer that is a definition and nothing more: a question about what a metric is,
 * which the definitions source answers and no context item does. A neutral mark, never a state's
 * tint: the context's state is still Not found, as agents get it, and its card says so.
 */
export function DefinitionHelp({
  names,
  tool,
  words,
}: {
  /** The metrics defined, as Definitions names them. */
  names: string[]
  /** The tool the source reads, as people say it. */
  tool: string
  words?: React.RefObject<HTMLElement | null>
}) {
  const them = names.length === 1 ? 'it' : 'them'
  return (
    <BadgeCard
      id="definition"
      label="Definition"
      words={words}
      badge={
        <span className="flex h-6 w-fit items-center gap-2 rounded-md bg-muted px-2 text-sm font-semibold">
          <BookAIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Definition
        </span>
      }
      title={`Definition: ${tool}'s own words.`}
      means={`${tool} defines ${them} this way, and agents get the same words. Nothing else is written about ${them} here yet, so for context the answer is Not found.`}
      todo="If people need more than the definition, such as what to rule out or when it changed, write context."
      more={
        names.length === 1
          ? { href: `/definitions/${encodeURIComponent(names[0]!)}`, label: 'Open in Definitions' }
          : { href: '/definitions', label: 'Open Definitions' }
      }
    />
  )
}

/** A badge whose meaning is a card on it, placed so it never covers the words it explains. */
function BadgeCard({
  id,
  label,
  words,
  tall,
  badge,
  title,
  means,
  todo,
  more,
  children,
}: {
  /** What the card's last height is kept under. */
  id: string
  label: string
  words?: React.RefObject<HTMLElement | null>
  /** The card holds more than its words, so it is likely taller. */
  tall?: boolean
  badge: React.ReactNode
  title: string
  means: string
  todo: string
  more: { href: string; label: string }
  children?: React.ReactNode
}) {
  const { query } = useRoute()
  const [open, setOpen] = React.useState(false)
  const [place, setPlace] = React.useState<Place>('top')
  const trigger = React.useRef<HTMLButtonElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const slot = React.useRef<HTMLDivElement>(null)
  // Closed from inside the card, focus comes back to the badge: that doesn't open it again.
  const returning = React.useRef(false)
  const show = (next: boolean) => {
    // How tall it was, for the next time: read as it closes, once it has been laid out.
    if (!next && card.current?.offsetHeight) heights.set(id, card.current.offsetHeight)
    if (next && !open && trigger.current)
      setPlace(placeFor(trigger.current, words?.current, heights.get(id) ?? (tall ? 300 : 240)))
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
      const b = trigger.current?.getBoundingClientRect()
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
        ref={trigger}
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
        {badge}
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
        aria-label={`What ${label} means`}
        className="w-70 max-w-full gap-2 rounded-md p-3.5"
      >
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-pretty">{means}</p>
        {children}
        <p className="text-sm text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">What you do. </span>
          {todo}
        </p>
        <a
          href={more.href}
          className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {more.label}
          <ArrowRightIcon className="size-3.5" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  )
}
