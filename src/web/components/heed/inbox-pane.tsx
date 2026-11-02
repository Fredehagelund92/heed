import type * as React from 'react'
import {
  AtSignIcon,
  BellIcon,
  CalendarClockIcon,
  CircleDashedIcon,
  ClockIcon,
  FlagIcon,
  GitPullRequestArrowIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { DomainDot, TagChip } from '@/components/heed/tag-chip'
import { useDomains } from '@/lib/workspace'
import type { DomainId } from '@/model/items'
import type { PaneState } from '@/model/inbox-pane'

// The Inbox pane's own parts, shared with the review's quick view in the dock: a head that says
// what the card is (its state as a chip, the domain, a 24 px title, the point in one sentence, then
// where it came from), and a foot with the one decision, named for what it does, and the words
// that say what follows. Secondary decisions sit beside the primary as labelled buttons.

/** The icon each kind of card, and each state a chip names, carries. */
export const cardIcon = {
  suggestion: GitPullRequestArrowIcon,
  gap: CircleDashedIcon,
  flag: FlagIcon,
  check: CalendarClockIcon,
  look: TriangleAlertIcon,
  alert: BellIcon,
  conflict: TriangleAlertIcon,
  mention: AtSignIcon,
  waiting: ClockIcon,
} satisfies Record<PaneState['icon'], unknown>

/** The card's state as Heed's one chip: its icon and its word, tinted only when it needs care. */
export function StateChip({ state }: { state: PaneState }) {
  const Icon = cardIcon[state.icon]
  return (
    <TagChip tone={state.tone} icon={<Icon aria-hidden />}>
      {state.label}
    </TagChip>
  )
}

/** A domain as the contract draws it outside a chip: its dot and its name. */
function Domain({ id }: { id: DomainId }) {
  const domains = useDomains()
  const name = domains[id]?.name
  if (!name) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <DomainDot id={id} className="size-2" />
      {name}
    </span>
  )
}

/**
 * The head of a card: what it is, then the point, then where it came from. The title is the
 * review heading's size (24 px, 600), so the pane starts here and not in the list beside it.
 */
export function PaneHead({
  state,
  domain,
  title,
  summary,
  from,
  className,
}: {
  state: PaneState
  domain?: DomainId
  title: string
  summary?: React.ReactNode
  from?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-2.5 px-4 pt-5 pb-5 @md:px-7', className)}>
      <div className="flex flex-wrap items-center gap-2.5">
        <StateChip state={state} />
        {domain && <Domain id={domain} />}
      </div>
      <h2 className="text-xl leading-tight font-semibold tracking-tight text-balance @md:text-2xl">
        {title}
      </h2>
      {summary && <p className="text-reading leading-relaxed text-pretty">{summary}</p>}
      {from && <div className="text-sm text-muted-foreground">{from}</div>}
    </header>
  )
}

/**
 * The foot of a card: the words that say what follows, then the secondary decisions, then the
 * primary. It stays a 48 px bar while it fits; in a narrow pane the words take their own line and
 * the buttons share the next.
 */
export function PaneFoot({
  follows,
  children,
}: {
  follows?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-bar flex-wrap items-center gap-x-3 gap-y-2 px-4 py-1.5 @max-md:py-3 @md:pl-7 @max-md:[&>button]:min-w-fit @max-md:[&>button]:flex-1">
      {follows ? (
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground @max-md:basis-full @max-md:whitespace-normal">
          {follows}
        </p>
      ) : (
        <span className="flex-1 @max-md:hidden" />
      )}
      {children}
    </div>
  )
}

/**
 * The one primary decision, at the default control height, with its key beside the words for
 * people who use the keyboard (never under a finger). The key is said to a screen reader as the
 * button's shortcut, not as part of its name.
 */
export function PrimaryAction({
  children,
  onClick,
  disabled,
  keyHint = true,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  keyHint?: boolean
}) {
  return (
    <Button
      size="lg"
      data-primary
      aria-keyshortcuts={keyHint ? 'Enter' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {keyHint && (
        <Kbd
          aria-hidden
          className="border border-primary-foreground/40 bg-transparent text-primary-foreground pointer-coarse:hidden"
        >
          Enter
        </Kbd>
      )}
    </Button>
  )
}
