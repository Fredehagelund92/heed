import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { MentionRenderer } from '@/components/form/markdown'
import {
  ArrowRightIcon,
  CheckIcon,
  CircleSlashIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  GaugeIcon,
  GlobeIcon,
  InfoIcon,
  LinkIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ScaleIcon,
  SearchIcon,
  ShieldCheckIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { StepTrail, type TrailStep } from '@/components/change/step-trail'
import { MentionChip } from '@/components/item/mention-chip'
import { AbsenceLine } from '@/components/page/absence-line'
import { PreviewLink } from '@/components/preview/preview-link'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  checkedWords,
  factSentence,
  limitWords,
  REMOVED_TARGET,
  removedWords,
  stepsSummary,
  type AnswerView,
  type StepView,
} from '@/lib/assistant'
import { formatDay } from '@/lib/library'
import { draftSearch, type TryItScope } from '@/lib/try-it'
import { cn } from '@/lib/utils'
import { AnswerMarkdown, type FactItemRenderer } from './answer-markdown'
import { DraftConfirm } from './ask-draft-card'
import { FACTS_CAPTION, FactBlock, FactsRead, factMeta, type FactLookup } from './ask-facts'
import { AssistantLabel } from './ask-turn'
import './answer-motion.css'

/*
  One answer of the assistant (Assistant board, direction A): who answers and from which edition,
  the steps it took in plain words, the answer with a chip for every fact it names, the facts it
  read and how each one stands, and the checked row. All but the words come from the service's
  tool results and its citation check, never from the model's text, so they hold even when the
  model fails part way. Under a finished answer: copy, the thumbs (stored as a count, never with
  the person or the words), and, when get_facts read a scope, a link to it and What an agent
  would get for it. A greeting or thanks reads no scope, so it offers neither.

  An answer that is arriving settles in (contract 10): each step enters, runs and settles, the
  skeleton fades once the first sentence is in, and the rows that close the answer follow one
  after another. An answer that was already there when the conversation was opened does not move.
*/

export { FactsRead, type FactLookup }

const stepIcons: Record<StepView['icon'], Icon> = {
  search: SearchIcon,
  explain: ScaleIcon,
  read: FileTextIcon,
  check: ListChecksIcon,
  draft: FilePenIcon,
  web: GlobeIcon,
}

/** The facts a step returned, as links to them: what its row opens to. */
function StepFacts({ facts, titleOf }: { facts: string[]; titleOf: (id: string) => string }) {
  return (
    <ul aria-label="Facts this step returned" className="flex flex-col gap-1">
      {facts.map((id) => (
        <li key={id} className="break-words">
          <Link
            to="/library/$itemId"
            params={{ itemId: id }}
            className="underline-offset-4 hover:underline focus-visible:underline"
          >
            {titleOf(id)}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The folded trail's words: "3 steps · read 4 facts, 1 page". */
function StepsSummary({ steps }: { steps: readonly StepView[] }) {
  const { steps: count, read } = stepsSummary(steps)
  return (
    <>
      {count}
      {read ? (
        <>
          {' · read '}
          <span className="text-foreground tabular-nums">{read}</span>
        </>
      ) : null}
    </>
  )
}

/**
 * What the assistant did, as a step trail (contract 9.8): each step with its verb in the tense of
 * where it stands, folded into one row once the answer is done. Drawn again only when its answer
 * changes.
 */
const Steps = memo(function Steps({
  answer,
  working,
  live,
}: {
  answer: AnswerView
  working: boolean
  live: boolean
}) {
  const titleOf = (id: string) => answer.facts.find((fact) => fact.id === id)?.title ?? id
  const steps: TrailStep[] = answer.steps.map((step) => ({
    ...step,
    icon: stepIcons[step.icon],
    opens: step.facts.length ? <StepFacts facts={step.facts} titleOf={titleOf} /> : undefined,
  }))
  return (
    <StepTrail
      steps={steps}
      label="What the assistant did"
      summary={<StepsSummary steps={answer.steps} />}
      working={working}
      live={live}
    />
  )
})

/** "Checked before you saw it": the citation check's own report, never the model's words. */
export function CheckedRow({ answer, className }: { answer: AnswerView; className?: string }) {
  if (!answer.report) return null
  // An answer that names no fact, quotes none and had nothing removed has nothing to check.
  const { cited, quoted } = answer.report
  if (!cited.length && !answer.report.removed.length && !quoted) return null
  const { lead, removed } = checkedWords(answer.report)
  return (
    <div
      role="note"
      data-slot="ask-checked"
      className={cn('flex gap-3 rounded-md border bg-muted px-4 py-3 text-caption', className)}
    >
      <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <p>
          <b className="font-bold">Checked before you saw it.</b> {lead}
        </p>
        {removed.map((words) => (
          <p key={words} data-tone="warning" className="flex gap-2 text-status-warning-fg">
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 translate-y-px"
            />
            {words}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * A list item of the answer that starts with a fact it read, as that fact's block: the whole
 * title, the quiet line of kind, domain and date, and the words the answer says about it, or the
 * fact's own sentence when the answer says none.
 */
function factItemRenderer(answer: AnswerView, lookup: FactLookup): FactItemRenderer {
  return ({ target }, rest) => {
    const id = target.startsWith('item:') ? target.slice(5) : null
    const fact = id ? answer.facts.find((read) => read.id === id) : undefined
    if (!id || !fact) return null
    const row = lookup(id)
    return (
      <FactBlock
        id={id}
        title={fact.title}
        kind={row?.kind ?? fact.kind}
        meta={factMeta(row, fact.kind)}
      >
        {rest ?? (row ? factSentence(row.summary, fact.title) : null)}
      </FactBlock>
    )
  }
}

/** A cited fact in the answer: a chip that links to it, previews it, and shows it was checked. */
function citeRenderer(answer: AnswerView, lookup: FactLookup): MentionRenderer {
  const read = new Set(answer.facts.map((fact) => fact.id))
  return ({ label, target }) => {
    if (target.startsWith(REMOVED_TARGET)) {
      const reason = target
        .slice(REMOVED_TARGET.length)
        .replace('-', '_') as keyof typeof removedWords
      return (
        <span
          data-slot="ask-removed"
          className="inline rounded-badge border border-dashed border-status-warning-border px-1 text-status-warning-fg"
        >
          {removedWords[reason] ?? label}
        </span>
      )
    }
    const id = target.startsWith('item:') ? target.slice(5) : null
    // Only a fact a tool read this turn becomes a chip; anything else stays the words written.
    if (!id || !read.has(id)) return <>{label}</>
    const kind = lookup(id)?.kind ?? answer.facts.find((fact) => fact.id === id)?.kind ?? 'note'
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1">
        <PreviewLink
          preview={{ type: 'item', id }}
          className="min-w-0 rounded-badge outline-none focus-visible:outline-2 focus-visible:outline-ring hover:[&>[data-slot=mention-chip]]:bg-accent"
        >
          {/* The whole title, wrapped when it must: a screen reader and a copy get all of it. */}
          <MentionChip
            target={{ type: 'item', kind }}
            name={answer.facts.find((fact) => fact.id === id)?.title ?? label}
            hint={false}
            full
          />
        </PreviewLink>
        <CheckIcon
          aria-hidden="true"
          data-slot="ask-cite-check"
          className="size-icon-sm shrink-0 text-muted-foreground"
        />
      </span>
    )
  }
}

/**
 * A long answer folds at the height of a list (18rem, about twelve lines) until a person asks
 * for the rest (A.long); the fold fades out so it reads as more to come, not as a cut. It folds
 * only when that hides more than half the fold again (about six lines): for less, the fade and
 * Show the rest of the answer would take about as much room as they save, so a short answer that
 * runs a few lines past the fold shows whole. Drawn again only when its answer changes.
 */
const FOLD_RATIO = 1.5
const AnswerText = memo(function AnswerText({
  answer,
  lookup,
  working,
  onLeave,
}: {
  answer: AnswerView
  lookup: FactLookup
  working: boolean
  onLeave: (() => void) | undefined
}) {
  const [unfolded, setUnfolded] = useState(false)
  // past: the words are taller than the fold; tall: enough taller to fold (FOLD_RATIO).
  const [past, setPast] = useState(false)
  const [tall, setTall] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  // The fold's height in pixels, read off the frame the first time the words reach past it.
  const fold = useRef<number | null>(null)
  useLayoutEffect(() => {
    const node = frame.current
    if (!node || unfolded) return
    // The words' laid-out height, not the frame's scroll height: a sentence sliding in as it
    // arrives overflows the frame for a moment, and that would fold a short answer for good.
    const measure = () => {
      const words = (node.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0
      if (fold.current === null && words > node.clientHeight + 1) fold.current = node.clientHeight
      const at = fold.current
      setPast(at !== null && words > at + 1)
      setTall(at !== null && words > at * FOLD_RATIO)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => observer.disconnect()
  }, [unfolded, answer.markup])
  if (!answer.markup) return null
  const folds = tall && !unfolded
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        data-slot="ask-answer-text"
        data-folded={folds || undefined}
        // Held at the fold until the words are known to be past it, then whole unless it folds.
        className={cn('relative', !unfolded && (tall || !past) && 'max-h-list overflow-hidden')}
      >
        <AnswerMarkdown
          source={answer.markup}
          streaming={working}
          renderMention={citeRenderer(answer, lookup)}
          renderFactItem={factItemRenderer(answer, lookup)}
          factsCaption={FACTS_CAPTION}
          onLeave={onLeave}
        />
        {folds ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-background to-transparent"
          />
        ) : null}
      </div>
      {folds ? (
        <Button
          variant="link"
          className="h-auto w-fit p-0 font-normal text-foreground underline underline-offset-4"
          onClick={() => setUnfolded(true)}
        >
          Show the rest of the answer
        </Button>
      ) : null}
    </div>
  )
})

/** What the answer's actions need from the surface it is on. */
export type AnswerActions = {
  /** Shows What an agent would get for a scope: the panel's other tab, or the page. */
  onOpenAgent: (scope: TryItScope | null) => void
  /** The address of What an agent would get for a scope, to copy as a link. */
  agentHref: (scope: TryItScope | null) => string
  /** Copies the answer as Markdown. */
  onCopy: () => void
  /** Going to another page from the answer (Add context). */
  onLeave?: () => void
  /** Asks again: the answer failed or was cut. */
  onRetry: () => void
  onContinue: () => void
  onNewChat: () => void
  onApprove: (approvalId: string, approved: boolean) => void
  /** The answer's thumbs (FR-712): what was given, whether one is on its way, and giving one. */
  rating: AnswerRating
}

/** Thumbs up or down on an answer. */
export type RatingVerdict = 'helpful' | 'wrong'
export type AnswerRating = {
  /** The verdict the service counted for this answer, once it has. */
  given: RatingVerdict | null
  /** A rating of this answer is on its way. */
  sending: boolean
  onRate: (verdict: RatingVerdict) => void
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
            className="text-muted-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const ratingWords: Record<RatingVerdict, { label: string; given: string; Icon: Icon }> = {
  helpful: { label: 'Good answer', given: 'You rated this a good answer', Icon: ThumbsUpIcon },
  wrong: {
    label: 'Something was wrong',
    given: 'You rated this as something wrong',
    Icon: ThumbsDownIcon,
  },
}

/**
 * Thumbs up or down (FR-712). Once the service counted one, it shows pressed and neither takes
 * another: a rating keeps nothing that could find it again to change it.
 */
function RateButton({ verdict, rating }: { verdict: RatingVerdict; rating: AnswerRating }) {
  const words = ratingWords[verdict]
  const chosen = rating.given === verdict
  const done = rating.given !== null
  const label = chosen ? words.given : words.label
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={chosen}
            aria-disabled={done || rating.sending || undefined}
            onClick={() => {
              if (!done && !rating.sending) rating.onRate(verdict)
            }}
            className={cn(
              'text-muted-foreground',
              chosen && 'text-foreground',
              (done || rating.sending) && 'cursor-default',
            )}
          />
        }
      >
        <words.Icon className={cn(chosen && 'fill-current')} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The actions under a finished answer; `scope` is the scope get_facts read, if it read one. */
function Actions({
  scope,
  actions,
  className,
}: {
  scope: TryItScope | null
  actions: AnswerActions
  className?: string
}) {
  const [linked, setLinked] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(actions.agentHref(scope))
      setLinked('copied')
    } catch {
      setLinked('failed')
    }
  }
  return (
    <div data-slot="ask-actions" className={cn('flex flex-wrap items-center gap-1', className)}>
      <IconAction label="Copy answer" onClick={actions.onCopy}>
        <CopyIcon />
      </IconAction>
      <RateButton verdict="helpful" rating={actions.rating} />
      <RateButton verdict="wrong" rating={actions.rating} />
      {scope ? (
        <IconAction label="Copy a link to these metrics and dates" onClick={() => void copyLink()}>
          {linked === 'copied' ? <CheckIcon className="text-status-success-icon" /> : <LinkIcon />}
        </IconAction>
      ) : null}
      {actions.rating.given ? (
        <span aria-hidden="true" className="px-1 text-caption text-muted-foreground">
          Thanks. We keep only the count.
        </span>
      ) : null}
      <span role="status" className="sr-only">
        {actions.rating.given
          ? 'Rating saved. We keep only the count, not your name, the question or the answer.'
          : ''}
      </span>
      <span role="status" className="sr-only">
        {linked === 'copied'
          ? 'Link copied. It opens Try a question for the same metrics, markets and dates, never your question or the answer.'
          : linked === 'failed'
            ? 'Couldn’t copy the link'
            : ''}
      </span>
      {scope ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => actions.onOpenAgent(scope)}
          className="ml-auto text-muted-foreground"
        >
          <ExternalLinkIcon />
          Open in Try a question
        </Button>
      ) : null}
    </div>
  )
}

/** The spending limit stopped the answer: which one, when it resets, and what still works. */
function LimitReached({ answer, actions }: { answer: AnswerView; actions: AnswerActions }) {
  const words = limitWords(answer.limit!, (day) => formatDay(day, 'long'))
  return (
    <Alert variant="warning" data-slot="ask-limit">
      <GaugeIcon />
      <AlertContent>
        <AlertTitle>{words.title}</AlertTitle>
        <AlertDescription>
          {words.when} Try a question still works, because it doesn’t use AI.
        </AlertDescription>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => actions.onOpenAgent(answer.scopeUsed)}
        >
          <SearchIcon />
          Open Try a question
        </Button>
      </AlertContent>
    </Alert>
  )
}

/**
 * Nothing applies: the absence line says plainly that nothing is written down for what was
 * checked (contract 9.5), and offers a draft that starts with what the person asked about.
 */
function NothingFound({
  scope,
  scopeText,
  onLeave,
}: {
  scope: TryItScope | null
  scopeText: string | null
  onLeave?: () => void
}) {
  return (
    <AbsenceLine
      slot="ask-not-found"
      title="Nothing is written down for this"
      action={
        <Button
          variant="outline"
          className="w-fit"
          render={
            <Link to="/library/new" search={scope ? draftSearch(scope) : {}} onClick={onLeave} />
          }
        >
          <FilePlusIcon />
          Start a draft
        </Button>
      }
    >
      No checked fact applies
      {scopeText ? (
        <>
          {' '}
          to <b className="font-bold text-foreground">{scopeText}</b>
        </>
      ) : null}
      , which doesn’t mean nothing happened. If you know what did, write it down. The draft starts
      with what you asked about, and the owner of its domain checks it before agents get it.
    </AbsenceLine>
  )
}

/** The answer stopped at its length limit: what was shown was checked, and it can go on. */
function Cut({ actions }: { actions: AnswerActions }) {
  return (
    <Alert variant="info" data-slot="ask-cut">
      <InfoIcon />
      <AlertContent>
        <AlertTitle>The answer reached its length limit</AlertTitle>
        <AlertDescription>
          Everything above is checked. Ask me to go on, or ask a narrower question.
        </AlertDescription>
        <Button variant="outline" className="w-fit" onClick={actions.onContinue}>
          <ArrowRightIcon />
          Continue
        </Button>
      </AlertContent>
    </Alert>
  )
}

/**
 * The words while the assistant works: the steps so far, then sentences as they are checked. The
 * skeleton fades out as the first sentence comes in, and then leaves.
 */
function Working({ hasText, stepRunning }: { hasText: boolean; stepRunning: boolean }) {
  const [skeleton, setSkeleton] = useState(!hasText)
  useEffect(() => {
    if (!hasText || !skeleton) return
    const leave = window.setTimeout(() => setSkeleton(false), SKELETON_EXIT)
    return () => window.clearTimeout(leave)
  }, [hasText, skeleton])
  return (
    <div data-slot="ask-working" className="flex flex-col gap-3">
      {skeleton ? (
        <div
          aria-hidden="true"
          data-leaving={hasText || undefined}
          className="flex flex-col gap-2 transition-opacity duration-instant data-leaving:opacity-0"
        >
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : null}
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        {/* One spinner at a time: while a step runs, its row turns and this one rests. */}
        <LoaderCircleIcon
          aria-hidden="true"
          className={cn(
            'size-icon-sm shrink-0 motion-safe:animate-spin',
            stepRunning && 'invisible',
          )}
        />
        Working on it. Each sentence shows once it’s checked.
      </p>
    </div>
  )
}

/** How long the skeleton takes to fade out: an exit (contract 10, rule 3). */
const SKELETON_EXIT = 100

/**
 * One assistant answer. `working` while it streams, `failed` when it stopped with an error (the
 * words so far stay, marked as unfinished).
 */
export function AskAnswer({
  answer,
  scope,
  scopeText,
  lookup,
  working,
  failed,
  latest,
  factsClassName,
  actions,
}: {
  answer: AnswerView
  /** The scope the answer is about: what get_facts used, else what was sent. */
  scope: TryItScope | null
  scopeText: string | null
  lookup: FactLookup
  working: boolean
  failed: ReactNode
  /** The last answer of the conversation: only it offers Continue and Try again. */
  latest: boolean
  /** Classes for the facts read: the page hides them where its side column lists them. */
  factsClassName?: string
  actions: AnswerActions
}) {
  const done = !working && !failed
  // Arriving: it was working when it came on screen. Only then do its parts settle in.
  const [live] = useState(working)
  return (
    <article
      data-slot="ask-answer"
      data-state={working ? 'working' : failed ? 'failed' : 'done'}
      aria-label="Answer"
      className="flex min-w-0 flex-col gap-3"
    >
      {/* Editions show only on the Editions page (docs/design/voice.md). */}
      <AssistantLabel />
      <Steps answer={answer} working={working} live={live} />
      {answer.limit ? (
        <LimitReached answer={answer} actions={actions} />
      ) : answer.refused ? (
        <Alert data-slot="ask-refused">
          <CircleSlashIcon />
          <AlertContent>
            <AlertTitle>The assistant can’t answer this one</AlertTitle>
            <AlertDescription>
              Try asking it another way, or see what agents get in Try a question.
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : (
        <AnswerText answer={answer} lookup={lookup} working={working} onLeave={actions.onLeave} />
      )}
      {working ? (
        <Working
          hasText={answer.markup.length > 0}
          stepRunning={answer.steps.some((step) => step.running)}
        />
      ) : null}
      {failed}
      {done && answer.notFound ? (
        <NothingFound scope={scope} scopeText={scopeText} onLeave={actions.onLeave} />
      ) : null}
      {answer.draft ? (
        <DraftConfirm
          draft={answer.draft}
          onApprove={actions.onApprove}
          onLeave={actions.onLeave}
        />
      ) : null}
      {done && answer.cut && latest ? <Cut actions={actions} /> : null}
      {!answer.limit ? (
        <FactsRead
          answer={answer}
          lookup={lookup}
          className={cn(factsClassName, live && 'animate-settle')}
        />
      ) : null}
      {done && !answer.limit ? (
        <CheckedRow answer={answer} className={cn(live && 'animate-settle settle-after-1')} />
      ) : null}
      {done && !answer.limit && !answer.refused ? (
        <Actions
          scope={answer.scopeUsed}
          actions={actions}
          className={cn(live && 'animate-settle settle-after-2')}
        />
      ) : null}
    </article>
  )
}

/** The answer failed part way, or never started: say so, keep what came, offer Try again. */
export function AnswerFailed({
  title,
  description,
  canRetry,
  canCopy,
  tooLong,
  actions,
}: {
  title: string
  description: string
  canRetry: boolean
  canCopy: boolean
  tooLong: boolean
  actions: Pick<AnswerActions, 'onRetry' | 'onCopy' | 'onNewChat'>
}) {
  return (
    <Alert variant="danger" data-slot="ask-failed">
      <TriangleAlertIcon />
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
        <div className="flex flex-wrap gap-2">
          {tooLong ? (
            <Button variant="outline" onClick={actions.onNewChat}>
              Start a new chat
            </Button>
          ) : canRetry ? (
            <Button variant="outline" onClick={actions.onRetry}>
              <RefreshCwIcon />
              Try again
            </Button>
          ) : null}
          {canCopy ? (
            <Button variant="ghost" onClick={actions.onCopy}>
              <CopyIcon />
              Copy what I have
            </Button>
          ) : null}
        </div>
      </AlertContent>
    </Alert>
  )
}
