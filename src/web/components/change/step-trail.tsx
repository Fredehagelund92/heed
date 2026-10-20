import { useState, type ReactNode } from 'react'
import {
  ChevronRightIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import '@/components/assistant/answer-motion.css'

/*
  What an AI app or the assistant did, step by step (contract 7.2, 9.8): one muted row per real
  step, its verb in the present while it runs ("Reading") and in the past once it is done
  ("Read"), what it acted on in the foreground colour, and what it found after a middle dot. The
  running step turns a spinner, and a done step shows its icon. Once the work is done a trail of
  two or more steps folds into one row that says how many there were and what they read, and
  opens again on a click; a step that did not work keeps the trail open, so nothing that went
  wrong is folded away. A step that returned something (the facts it read) opens to it.

  Arriving (`live`): each row rises in, its spinner gives way to its icon, its counts fade in, and
  the trail folds as the work ends (contract 10, rule 10). With less motion the spinner is a still
  ring and each of these is a fade of 100 ms.
*/

export type TrailStep = {
  id: string
  icon: Icon
  /** The verb and its words, muted: "Reading", "Read the overview of". */
  words: string
  /** What the step acted on, in the foreground colour: a site, a domain, an edition. */
  object?: string | null
  /** Muted words after the object: "for people". */
  after?: string | null
  /** Muted words after the counts and a middle dot: the fields it named. */
  note?: string | null
  /** What it found, after a middle dot: "4 checked, 2 apply". */
  counts?: string | null
  running: boolean
  failed: boolean
  /** What it returned, shown when its row is opened: the facts it read. */
  opens?: ReactNode
}

/** The row's glyph: the spinner while it runs (a still ring with less motion), else its icon. */
function StepGlyph({ step, live }: { step: TrailStep; live: boolean }) {
  const Glyph = step.failed ? TriangleAlertIcon : step.icon
  const glyph = (
    <Glyph
      aria-hidden="true"
      data-tone={step.failed ? 'warning' : undefined}
      className={cn(
        'size-icon-sm shrink-0',
        step.failed ? 'text-tone-dot' : 'text-muted-foreground',
        live && (step.running ? 'opacity-0' : 'animate-settle-instant'),
      )}
    />
  )
  const spinner = (
    <>
      <LoaderCircleIcon
        aria-hidden="true"
        className={cn(
          'size-icon-sm text-muted-foreground motion-safe:animate-spin motion-reduce:hidden',
          !step.running && 'spinner-done',
        )}
      />
      {step.running ? (
        <CircleDashedIcon
          aria-hidden="true"
          className="size-icon-sm text-muted-foreground motion-safe:hidden"
        />
      ) : null}
    </>
  )
  // While arriving the spinner and the icon share one place: one fades out as the other fades in.
  if (live)
    return (
      <span className="grid shrink-0 *:col-start-1 *:row-start-1">
        {spinner}
        {glyph}
      </span>
    )
  return step.running ? <span className="grid shrink-0">{spinner}</span> : glyph
}

/** The words of a step: the verb muted, the object and the counts in the foreground colour. */
function StepWords({ step, live }: { step: TrailStep; live: boolean }) {
  return (
    <span className="min-w-0 flex-1 text-muted-foreground">
      {step.words}
      {step.object ? (
        <>
          {' '}
          <span className="text-foreground">{step.object}</span>
        </>
      ) : null}
      {step.after ? ` ${step.after}` : null}
      {step.failed ? ": it didn't work" : null}
      {step.counts ? (
        <>
          {' · '}
          <span className={cn('text-foreground tabular-nums', live && 'animate-settle')}>
            {step.counts}
          </span>
        </>
      ) : null}
      {step.note ? ` · ${step.note}` : null}
    </span>
  )
}

// A row is 24 high on one line; a glyph stays beside the first line when the words wrap.
const rowClass = 'flex items-start gap-2 py-1 text-caption'

function StepRow({ step, live }: { step: TrailStep; live: boolean }) {
  const enter = live && 'animate-arrive-fast'
  const head = (
    <>
      <span className="flex h-4 shrink-0 items-center">
        <StepGlyph step={step} live={live} />
      </span>
      <StepWords step={step} live={live} />
    </>
  )
  if (!step.opens || step.running)
    return (
      <li
        data-slot="trail-step"
        data-running={step.running || undefined}
        data-failed={step.failed || undefined}
        className={cn(rowClass, enter)}
      >
        {head}
      </li>
    )
  return (
    <li data-slot="trail-step" className={cn(enter)}>
      <details className="group/step">
        <summary
          className={cn(
            rowClass,
            'w-fit max-w-full cursor-pointer list-none rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
          )}
        >
          {head}
          <span className="flex h-4 shrink-0 items-center">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-icon-sm text-muted-foreground transition-transform group-open/step:rotate-90 motion-reduce:transition-none"
            />
          </span>
        </summary>
        <div className="flex flex-col gap-1 pt-1 pb-2 pl-6 text-caption">{step.opens}</div>
      </details>
    </li>
  )
}

/**
 * The trail. `working` while the work goes on: it stays open. Once done, two or more steps that
 * all worked fold into one row (`summary`), unless the person opened it.
 */
export function StepTrail({
  steps,
  label,
  summary,
  working = false,
  live = false,
  className,
}: {
  steps: readonly TrailStep[]
  /** The list's accessible name: "What the assistant did". */
  label: string
  /** The folded row's words: how many steps, and what they read. */
  summary: ReactNode
  working?: boolean
  /** It is arriving now: its rows move in (contract 10, rule 10). */
  live?: boolean
  className?: string
}) {
  // Null until the person opens or folds it; until then it is open while the work goes on.
  const [chosen, setChosen] = useState<boolean | null>(null)
  if (!steps.length) return null
  // One tree from the first step to the last, so a row that is on screen never enters again.
  const folds = steps.length > 1 && !steps.some((step) => step.failed)
  const open = !folds || working || (chosen ?? false)
  return (
    <Collapsible
      data-slot="step-trail"
      data-open={open || undefined}
      open={open}
      onOpenChange={setChosen}
      className={cn('flex min-w-0 flex-col', className)}
    >
      {folds && !working ? (
        <CollapsibleTrigger
          className={cn(
            rowClass,
            'group/trail w-fit max-w-full rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            live && 'animate-settle',
          )}
        >
          <span className="flex h-4 shrink-0 items-center">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-icon-sm transition-transform group-data-panel-open/trail:rotate-90 motion-reduce:transition-none"
            />
          </span>
          <span className="min-w-0">
            <span className="sr-only">{label}:</span> {summary}
          </span>
        </CollapsibleTrigger>
      ) : null}
      <CollapsibleContent keepMounted className="collapsible-height">
        <ul aria-label={label} className={cn('flex flex-col gap-1', folds && !working && 'pt-1')}>
          {steps.map((step) => (
            <StepRow key={step.id} step={step} live={live} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
