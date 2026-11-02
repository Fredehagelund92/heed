import type * as React from 'react'
import {
  AtSignIcon,
  BellIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ClockIcon,
  FlagIcon,
  GitPullRequestArrowIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DomainDot, TagChip } from '@/components/heed/tag-chip'
import { DifferingWords } from '@/components/heed/differing-words'
import { StateLine } from '@/components/heed/state-line'
import { useDomains } from '@/lib/workspace'
import type { AnswerState } from '@/model/ask'
import type { DomainId } from '@/model/items'
import { ANSWER_SIDES, type Answers, type PaneState } from '@/model/inbox-pane'

// The Inbox pane's own parts, shared with the review's quick view in the dock: a head that says
// what the card is (its state as a chip, the domain, a 24 px title, the point in one sentence, then
// where it came from); what agents answer today and after the decision, in Heed's own answer
// states; folds for the evidence; and a foot with the one decision, named for what it does, and the
// words that say what follows. Secondary decisions sit beside the primary as labelled buttons.

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
        <p
          title={typeof follows === 'string' ? follows : undefined}
          className="min-w-0 flex-1 truncate text-sm text-muted-foreground @max-md:basis-full @max-md:whitespace-normal"
        >
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

/** The 3 px rule over the answer after the decision, in its state's colour. */
const afterRule: Record<AnswerState, string> = {
  grounded: 'border-t-[var(--ok)]',
  partial: 'border-t-[var(--warn)]',
  missing: 'border-t-[var(--idle)]',
  conflict: 'border-t-[var(--caution-icon)]',
  stale: 'border-t-[var(--warn)]',
  failed: 'border-t-destructive',
}

/** One side of the answers: its label, Heed's answer line, and the words agents give. */
function AnswerSide({
  label,
  answer,
  today,
}: {
  label: string
  answer: Answers['today']
  /** Set on the side after the decision: the answer of today, so the words that change are marked. */
  today?: Answers['today']
}) {
  const after = !!today
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 px-4 pt-4 pb-4.5',
        // Side by side, today's side keeps the same 3 px at its top, so both labels line up.
        !after && '@pane-split:border-t-3 @pane-split:border-t-transparent',
        after &&
          cn(
            'border-t-3 @pane-split:border-l',
            afterRule[answer.state],
            answer.state === 'conflict' && 'bg-caution-soft',
          ),
      )}
    >
      <span className="text-dense font-semibold text-muted-foreground">{label}</span>
      <StateLine state={answer.state} />
      <p
        className={cn(
          'text-reading leading-relaxed text-pretty',
          answer.state === 'missing' && !after && 'text-muted-foreground',
        )}
      >
        {!today ? (
          answer.text
        ) : today.text === answer.text ? (
          <span className="text-muted-foreground">The same as today.</span>
        ) : (
          <DifferingWords text={answer.text} other={today.text} />
        )}
      </p>
    </div>
  )
}

/**
 * What agents answer today and what they will answer after the decision, from the review's Try
 * it: a band with the question, then the two answers side by side from 560 px of pane, one above
 * the other below that. The band says what agents asked about instead, for a Not found card.
 */
export function AgentAnswers({ answers, asked }: { answers: Answers; asked?: React.ReactNode }) {
  return (
    <section aria-label="What agents will say" className="border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-band px-4 py-3.5">
        {asked ?? (
          <p className="rounded-surface border bg-background px-3.5 py-2 text-reading leading-snug">
            {answers.question}
          </p>
        )}
      </div>
      <div className="grid @pane-split:grid-cols-2">
        <AnswerSide label={ANSWER_SIDES.today} answer={answers.today} />
        <AnswerSide label={answers.afterLabel} answer={answers.after} today={answers.today} />
      </div>
    </section>
  )
}

/**
 * What agents asked about, for a Not found card: the scope and how often, never their words, which
 * are not kept. No count shows when there is none.
 */
export function AskedAbout({ scope, times }: { scope: string[]; times: number }) {
  return (
    <>
      <span className="text-dense font-semibold text-muted-foreground">Agents asked about</span>
      <span className="flex flex-wrap gap-1.5">
        {scope.map((s) => (
          <TagChip key={s}>{s}</TagChip>
        ))}
      </span>
      {times > 0 && (
        <span className="text-dense text-muted-foreground tabular-nums @pane-split:ml-auto">
          {times} {times === 1 ? 'time' : 'times'} this week
        </span>
      )}
    </>
  )
}

/** A fold for the evidence under the answers: closed until it is wanted, with a hairline above. */
export function Fold({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} render={<section className="border-t" />}>
      <h3>
        <CollapsibleTrigger className="group/fold flex min-h-11 w-full items-center gap-1.5 text-left text-sm font-semibold outline-none hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/fold:rotate-90"
          />
          {title}
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent keepMounted>
        <div className="flex flex-col gap-3 pb-4 text-sm leading-relaxed">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
