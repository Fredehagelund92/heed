import type { LevelResult } from '@/api'
import { CheckGlyph } from '@/components/proposal/gate-result'
import { parseEditionLabel } from '@/lib/editions'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'

/*
  The details of one check level on the review screen (frame C2, 5; FR-505 to FR-516): the
  matching probes and what each did, the delivery probe and the test questions it asked, and the
  answer run's state, with the day of what agents got rather than an edition's number. A level recorded without details says so in one sentence (gate.ts).
*/

type Details<Level extends LevelResult['level']> = Extract<LevelResult, { level: Level }>['details']

export type CheckDetailLookups = {
  /** A term's name by its key (`val:market/norway` → Norway, `dim:market` → Market). */
  termName: (key: string) => string
  /** A test question's wording by its id, when the person may read it. */
  questionText: (id: string) => string | null
}

/** "Another market", "The day after its last day": what a level 2 probe tries, in words. */
export function probeName(name: string, termName: (key: string) => string): string {
  if (name === 'inside') return 'Where it applies, on its first day'
  if (name === 'before_start') return 'The day before it starts'
  if (name === 'on_end_day') return 'The day after its last day'
  if (name === 'all_values') return 'Without a filter'
  if (name === 'other_metric') return 'Another metric'
  if (name.startsWith('without_dimension:'))
    return `With no ${termName(name.slice('without_dimension:'.length)).toLowerCase()} named`
  if (name.startsWith('other_value:'))
    return `Another ${termName(name.slice('other_value:'.length)).toLowerCase()}`
  return name.replace(/_/g, ' ')
}

function Facts({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <dl aria-label={label} className="flex flex-col gap-1 text-caption">
      {children}
    </dl>
  )
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function MatchingDetails({
  details,
  lookups,
}: {
  details: Details<'matching'>
  lookups: CheckDetailLookups
}) {
  const probes = details.probes ?? []
  if (!probes.length)
    return <p className="text-caption text-muted-foreground">No test questions recorded.</p>
  return (
    <ul aria-label="Test questions" className="flex flex-col gap-2">
      {probes.map((probe) => {
        const scope = [
          ...probe.scope.metrics.map(lookups.termName),
          ...Object.entries(probe.scope.filters).flatMap(([dimension, values]) =>
            // A dimension named without a value: any of its values.
            values.length
              ? values.map(lookups.termName)
              : [`Any ${lookups.termName(dimension).toLowerCase()}`],
          ),
        ]
        return (
          <li key={probe.name} data-slot="probe" className="flex gap-2 text-caption">
            <CheckGlyph
              state={probe.passed ? 'passed' : 'failed'}
              className="[&>svg]:size-icon-sm"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-bold">{probeName(probe.name, lookups.termName)}</span>
              <span className="text-muted-foreground">
                {scope.join(', ') || 'Any metric'} · {formatDay(probe.scope.window.start)}
              </span>
              <span>
                {probe.expect === 'delivered' ? 'Should find it' : 'Should leave it out'}
                {': '}
                {probe.actual === 'delivered'
                  ? `found it${probe.match === 'partial' ? ', for part of the question' : ''}`
                  : 'left it out'}
                {probe.withheld ? ` (${probe.withheld})` : ''}.
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DeliveryDetails({
  details,
  lookups,
}: {
  details: Details<'delivery'>
  lookups: CheckDetailLookups
}) {
  const questions = details.questions ?? []
  const worse = questions.filter((question) => question.regression)
  const unread = questions.filter((question) => question.error)
  const probe = details.probe
  return (
    <div className="flex flex-col gap-2">
      <Facts label="Reaches agents">
        {probe ? (
          <Fact term="Asked for">
            {[
              ...probe.metrics.map(lookups.termName),
              ...probe.dimension_filters.flatMap((filter) =>
                filter.values.length
                  ? filter.values.map(lookups.termName)
                  : [`Any ${lookups.termName(filter.dimension).toLowerCase()}`],
              ),
            ].join(', ')}{' '}
            on {formatDay(probe.window.from)}
          </Fact>
        ) : null}
        <Fact term="The reply">
          {details.delivered
            ? 'Agents get it.'
            : details.cut
              ? "It's cut to fit the size limit."
              : "Agents don't get it."}
        </Fact>
        {details.replacedShown?.length ? (
          <Fact term="Facts it replaces">
            {details.replacedShown.length === 1
              ? 'Agents still get it'
              : `Agents still get all ${details.replacedShown.length}`}
          </Fact>
        ) : null}
        <Fact term="Test questions">
          {questions.length
            ? `${questions.length} asked, ${worse.length ? `${worse.length} got worse` : 'none got worse'}`
            : 'The domain has none yet.'}
        </Fact>
      </Facts>
      {worse.length || unread.length ? (
        <ul aria-label="Test answers that got worse" className="flex flex-col gap-1 text-caption">
          {worse.map((question) => (
            <li key={question.id} className="flex gap-2">
              <CheckGlyph state="failed" className="[&>svg]:size-icon-sm" />
              {lookups.questionText(question.id) ?? 'A hidden test question'}
            </li>
          ))}
          {unread.map((question) => (
            <li key={question.id} className="flex gap-2 text-muted-foreground">
              <CheckGlyph state="error" className="[&>svg]:size-icon-sm" />
              {lookups.questionText(question.id) ?? 'A test question'}: couldn't be read
            </li>
          ))}
        </ul>
      ) : null}
      {details.note ? <p className="text-caption text-muted-foreground">{details.note}</p> : null}
    </div>
  )
}

const runStateNames: Record<NonNullable<Details<'answer_full'>['runState']>, string> = {
  estimated: 'Estimated',
  awaiting_approval: 'Waiting for an admin to approve the cost',
  queued: 'Queued',
  running: 'Running',
  finished: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
  incomplete: 'Stopped before it finished',
}

/** "what agents got on 7 October 2026": what a run compared with, by its day. */
function gotOn(edition: string): string {
  const day = parseEditionLabel(edition)?.day
  return day ? `what agents got on ${formatDay(day, 'long')}` : 'what agents got then'
}

function AnswerDetails({ details }: { details: Details<'answer_impact'> }) {
  return (
    <Facts label="Answer run">
      {details.runState ? <Fact term="Run">{runStateNames[details.runState]}</Fact> : null}
      {details.questions !== undefined ? (
        <Fact term="Questions">
          {details.questions}
          {details.setAside ? `, ${details.setAside} set aside` : ''}
        </Fact>
      ) : null}
      {details.estimate ? <Fact term="Cost">{details.estimate}</Fact> : null}
      {details.edition ? <Fact term="Compared with">{gotOn(details.edition)}</Fact> : null}
      {details.previous ? (
        <Fact term="Before">
          {details.previous === 'passed'
            ? 'Passed'
            : details.previous === 'failed'
              ? 'Failed'
              : "Didn't finish"}
          {details.previousEdition ? `, with ${gotOn(details.previousEdition)}` : ''}
        </Fact>
      ) : null}
    </Facts>
  )
}

/** The details of one level, or null when there is nothing beyond the summary to show. */
export function LevelDetails({
  result,
  lookups,
  className,
}: {
  result: LevelResult
  lookups: CheckDetailLookups
  className?: string
}) {
  let content: React.ReactNode = null
  switch (result.level) {
    case 'format': {
      const findings = result.details.findings ?? []
      content = findings.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-caption">
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${index}`}>{finding.message}</li>
          ))}
        </ul>
      ) : null
      break
    }
    case 'matching':
      content = result.details.probes?.length ? (
        <MatchingDetails details={result.details} lookups={lookups} />
      ) : null
      break
    case 'delivery':
      content =
        result.details.delivered !== undefined ? (
          <DeliveryDetails details={result.details} lookups={lookups} />
        ) : null
      break
    case 'answer_impact':
    case 'answer_full':
      content =
        result.details.runState || result.details.questions !== undefined ? (
          <AnswerDetails details={result.details} />
        ) : null
      break
  }
  if (!content) return null
  return (
    <div
      data-slot="level-details"
      data-level={result.level}
      className={cn('flex flex-col gap-2', className)}
    >
      {content}
    </div>
  )
}

/** Whether a level has details beyond its summary sentence. */
export function hasLevelDetails(result: LevelResult): boolean {
  switch (result.level) {
    case 'format':
      return (result.details.findings?.length ?? 0) > 0
    case 'matching':
      return (result.details.probes?.length ?? 0) > 0
    case 'delivery':
      return result.details.delivered !== undefined
    case 'answer_impact':
    case 'answer_full':
      return Boolean(result.details.runState) || result.details.questions !== undefined
  }
}
