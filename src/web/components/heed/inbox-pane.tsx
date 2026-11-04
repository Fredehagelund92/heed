import * as React from 'react'
import {
  AtSignIcon,
  BellIcon,
  CalendarClockIcon,
  CircleDashedIcon,
  ClockIcon,
  FlagIcon,
  GitPullRequestArrowIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { and, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { FoldTrigger } from '@/components/heed/fold'
import { FreshDot, StatusIcon, TimeGlyph } from '@/components/heed/columns'
import { kindIcons } from '@/components/heed/kind-icons'
import { PeekFact } from '@/components/heed/peek'
import { ScopeChips } from '@/components/heed/scope-chips'
import { DomainDot, TagChip } from '@/components/heed/tag-chip'
import { DifferingWords } from '@/components/heed/differing-words'
import { StateLine } from '@/components/heed/state-line'
import { useDomains } from '@/lib/workspace'
import type { AnswerState } from '@/model/ask'
import { kindLabel, type DomainId, type Fact } from '@/model/items'
import { ownersOf } from '@/model/people'
import { plainText } from '@/lib/mentions'
import { parseWhen, timeLong } from '@/lib/timeframe'
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
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  /** What is inside in a few words, shown while it is closed. */
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} render={<section className="border-t" />}>
      {/* The row runs out to the pane's edges, its words in line with the text above. */}
      <h3 className="-mx-4 @md:-mx-7">
        <FoldTrigger label={title} summary={summary} className="px-4 @md:px-7" />
      </h3>
      <CollapsibleContent keepMounted>
        <div className="flex flex-col gap-3 pb-4 text-sm leading-relaxed">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The context item a card is about, folded to the row the Context list draws: its kind, its title
 * and what it is in words, and from 560 px of pane its status, when and freshness. Opened, what it
 * applies to, its text, what not to conclude, and the way to its page, unless the card's own
 * decision already leads there.
 */
export function ItemFold({ fact, link = true }: { fact: Fact; link?: boolean }) {
  const domains = useDomains()
  const id = React.useId()
  const Kind = kindIcons[fact.kind]
  const time = parseWhen(fact.when)
  return (
    <Collapsible render={<section className="border-t" />}>
      <h3 className="-mx-4 @md:-mx-7">
        {/* Its name is the type and the title, as a screen reader hears it; the line under the
            title and the marks are its description. */}
        <FoldTrigger
          aria-describedby={id}
          className="min-h-14 gap-3 px-4 @md:px-7"
          lead={
            <Kind
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
          }
          label={
            <span className="flex flex-col">
              <span className="truncate">
                <span className="sr-only">The context item: </span>
                {fact.title}
              </span>
              <span
                id={id}
                aria-hidden
                className="relative truncate text-xs font-normal text-muted-foreground"
              >
                Context item - {kindLabel[fact.kind]} - {domains[fact.domain]?.name} - owned by{' '}
                {and(ownersOf(fact, domains))}
                <span className="sr-only">
                  . {fact.status}, {timeLong(time)}
                </span>
              </span>
            </span>
          }
          trail={
            <span aria-hidden className="hidden items-center gap-3 @pane-split:flex">
              <StatusIcon status={fact.status} plain />
              <TimeGlyph time={time} plain />
              <FreshDot fact={fact} plain />
            </span>
          }
        />
      </h3>
      <CollapsibleContent keepMounted>
        <div className="flex flex-col gap-3 pb-4 pl-7 text-sm leading-relaxed">
          {fact.where.length > 0 && (
            <p className="flex flex-wrap gap-1.5">
              <ScopeChips fact={fact} />
            </p>
          )}
          <p className="text-reading">{plainText(fact.summary)}</p>
          {fact.dontConclude && (
            <PeekFact icon={ShieldAlertIcon}>
              <b>Don&apos;t conclude:</b> {fact.dontConclude}
            </PeekFact>
          )}
          {link && (
            <a
              href={`/context/${fact.id}`}
              className="w-fit text-primary underline-offset-4 hover:underline"
            >
              Open the context item
            </a>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
