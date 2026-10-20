import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  type Icon,
} from '@/components/icons'
import type { TimelineTone } from '@/components/proposal/timeline'
import { formatDay, formatMoment } from '@/lib/library'
import type { ProposalStep, StepState } from '@/lib/proposal-activity'
import { cn } from '@/lib/utils'

/*
  Where a proposal stands (frame B, 1): four steps from its events, submitted, checks, claimed
  and the decision, each a 24 pixel round mark on one hairline with the step's words and when it
  happened under it. The mark's glyph carries the state (a check, a dot, a warning, a cross, a
  dashed circle) and the words say it again, so colour is never the only sign. The step the
  proposal is at is the list's current step.
*/

const stepLook: Record<StepState, { glyph: Icon; tone: TimelineTone; words: string }> = {
  done: { glyph: CircleCheckIcon, tone: 'success', words: 'Done' },
  current: { glyph: CircleDotIcon, tone: 'info', words: 'Now' },
  attention: { glyph: CircleAlertIcon, tone: 'warning', words: 'Needs attention' },
  failed: { glyph: CircleXIcon, tone: 'danger', words: "Didn't pass" },
  waiting: { glyph: CircleDashedIcon, tone: 'neutral', words: 'Not yet' },
}

function StepMark({ state }: { state: StepState }) {
  const { glyph: Glyph, tone } = stepLook[state]
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full border',
        tone === 'neutral'
          ? 'border-border bg-background text-muted-foreground'
          : 'border-tone-line bg-tone-tint text-tone-ink',
      )}
    >
      <Glyph className="size-icon-sm" />
    </span>
  )
}

/** The four steps as one row from a 672 pixel column, two by two below it. */
export function ProposalStepper({
  steps,
  className,
}: {
  steps: readonly ProposalStep[]
  className?: string
}) {
  const current = steps.findLast((step) => step.state !== 'waiting')
  return (
    <ol
      aria-label="Where it stands"
      data-slot="proposal-stepper"
      className={cn('grid grid-cols-2 gap-y-4 @2xl:grid-cols-4', className)}
    >
      {steps.map((step) => (
        <li
          key={step.key}
          data-step={step.key}
          data-state={step.state}
          aria-current={step === current ? 'step' : undefined}
          className="group/step relative flex min-w-0 flex-col gap-2 pr-4"
        >
          {/* The hairline to the next mark; only while the steps sit in one row. */}
          <span
            aria-hidden="true"
            className="absolute top-3 right-0 left-8 hidden h-px bg-border group-last/step:hidden @2xl:block"
          />
          <StepMark state={step.state} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-dense font-bold break-words">
              {step.label}
              <span className="sr-only">, {stepLook[step.state].words}</span>
            </span>
            {step.at ? (
              <time
                dateTime={step.at}
                title={formatMoment(step.at, 'long')}
                className="text-caption text-muted-foreground tabular-nums"
              >
                {formatMoment(step.at)}
              </time>
            ) : step.due ? (
              <span className="text-caption text-muted-foreground tabular-nums">
                Due {formatDay(step.due)}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
