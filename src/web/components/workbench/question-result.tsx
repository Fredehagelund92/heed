import { Link } from '@tanstack/react-router'
import type { QuestionComparison, TestQuestion } from '@/api'
import {
  ArrowRightLeftIcon,
  CheckIcon,
  Columns2Icon,
  CircleXIcon,
  FlaskConicalIcon,
  MinusIcon,
  ScaleIcon,
  TextQuoteIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { RecordSection } from '@/components/page/record-parts'
import type { LinkTo } from '@/components/quality/panel-parts'
import { VerdictBadge } from '@/components/quality/quality-marks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatDay } from '@/lib/library'
import { checkName } from '@/lib/quality'
import { cn } from '@/lib/utils'
import { checkTallies, comparisonFactors } from '@/lib/workbench-evidence'
import { Outcome, triesWords, type Side } from './question-evidence'

/*
  The Test result tab of a test question's record in the Workbench (Workbench plan, slice W6b):
  the tries per wording on each edition, each opening its transcript in place, the must-have
  caveat, a try's answer with the judge's reason, and what else differed between the two runs;
  from here the two runs open side by side in the compare focus (compare-focus.tsx).
*/

export const factorWords = {
  edition: 'the facts agents got',
  revision: 'the question’s revision',
  wordings: 'the wordings',
  tries: 'the number of tries',
  answer_model: 'the answering AI',
  judge_model: 'the judge',
  tool_descriptions: 'the tool descriptions',
  prompt: 'the answering prompt',
} as const

/**
 * What else differed between the two runs: a green "Only the edition differs" when nothing but
 * the edition did, or a warning naming what else changed and what neither run recorded, so a
 * confounded comparison is never read as the edition's doing. Nothing without a run to compare.
 */
export function HeldConstant({ data }: { data: QuestionComparison }) {
  const factors = comparisonFactors(data)
  if (!factors) return null
  return factors.onlyEdition ? (
    <p className="flex flex-wrap items-center gap-2 text-dense text-muted-foreground">
      <Badge tone="success" icon={CheckIcon} data-slot="only-edition">
        Only the facts differ
      </Badge>
      The same revision, wordings, tries, answering AI, judge, tool descriptions and prompt in both
      runs.
    </p>
  ) : (
    <p className="flex flex-wrap items-center gap-2 text-dense" data-slot="confounded">
      <Badge tone="warning" icon={TriangleAlertIcon}>
        Not only the facts
      </Badge>
      <span>
        {factors.changed.length
          ? `Also different: ${factors.changed.map((factor) => factorWords[factor]).join(', ')}. `
          : ''}
        {factors.unknown.length
          ? `Not recorded by both runs: ${factors.unknown.map((factor) => factorWords[factor]).join(', ')}. `
          : ''}
        A difference may come from these, not the context.
      </span>
    </p>
  )
}

/** One try as a mark that opens its transcript in place. */
function TryMark({
  attempt,
  when,
  wording,
  linkTo,
  touch,
}: {
  attempt: Side['wordings'][number]['tries'][number]
  /** The run's day, in words. */
  when: string
  wording: string
  linkTo: LinkTo
  /** On a phone each try is a 44 pixel target. */
  touch: boolean
}) {
  const outcome =
    attempt.error !== null
      ? 'failed to run'
      : attempt.refused
        ? 'refused'
        : attempt.passed === null
          ? 'not scored'
          : attempt.passed
            ? 'passed'
            : 'failed'
  const Glyph = attempt.passed ? CheckIcon : attempt.passed === false ? CircleXIcon : MinusIcon
  return (
    <Link
      {...linkTo({ tab: 'results', cell: attempt.cell })}
      replace
      resetScroll={false}
      aria-label={`${wording}, try ${attempt.trial} on ${when}: ${outcome}. Open its transcript`}
      title={`Try ${attempt.trial}: ${outcome}`}
      data-tone={attempt.passed ? 'success' : attempt.passed === false ? 'danger' : undefined}
      data-slot="try"
      className={cn(
        'flex items-center justify-center rounded-sm border text-tone-ink hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
        touch ? 'size-control-touch' : 'size-control-sm',
      )}
    >
      <Glyph aria-hidden="true" className="size-icon-sm" />
    </Link>
  )
}

/** The tries per wording on each edition, the caveat, a try's answer and the judge's reason. */
export function TestResult({
  question,
  data,
  linkTo,
  onCompare,
}: {
  question: TestQuestion
  data: QuestionComparison
  linkTo: LinkTo
  /** Opens the compare focus: this question's two runs side by side. */
  onCompare: () => void
}) {
  const sides = [...(data.against ? [data.against] : []), data.run]
  const wordingWords = (index: number) =>
    question.wordings[index]?.kind === 'precise' ? 'Precise wording' : 'Natural wording'
  const touch = useIsMobile()
  const caveat = question.expected.caveat
  const day = (side: Side) => formatDay(side.run.finishedAt)
  const caveatOf = (side: Side) =>
    checkTallies(side).find((tally) => tally.check === 'caveat') ?? null
  return (
    <>
      <RecordSection title="Tries, wording by wording" icon={FlaskConicalIcon}>
        <HeldConstant data={data} />
        <ul aria-label="Wordings" data-slot="tries" className="flex flex-col gap-2">
          {question.wordings.map((wording, index) => {
            const failed = [
              ...new Set(
                (data.run.wordings.find((entry) => entry.wording === index)?.tries ?? []).flatMap(
                  (attempt) =>
                    Object.entries(attempt.checks)
                      .filter(([, held]) => !held)
                      .map(([check]) => check),
                ),
              ),
            ]
            return (
              <li
                key={index}
                className="flex min-w-0 flex-col gap-2 rounded-sm border px-3 py-2 text-dense"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-caption text-muted-foreground">{wordingWords(index)}</span>
                  <span className="break-words">{wording.text}</span>
                </span>
                <dl className="flex flex-col gap-1">
                  {sides.map((side) => {
                    const tries =
                      side.wordings.find((entry) => entry.wording === index)?.tries ?? []
                    return (
                      <div key={side.run.id} className="flex flex-wrap items-center gap-3">
                        <dt className="whitespace-nowrap text-muted-foreground">{day(side)}</dt>
                        <dd>
                          {tries.length ? (
                            <ul className="flex gap-1" aria-label={`Tries on ${day(side)}`}>
                              {tries.map((attempt) => (
                                <li key={attempt.cell}>
                                  <TryMark
                                    attempt={attempt}
                                    when={day(side)}
                                    wording={wordingWords(index)}
                                    linkTo={linkTo}
                                    touch={touch}
                                  />
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted-foreground">Not run</span>
                          )}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
                {failed.length ? (
                  <span data-tone="danger" className="text-caption text-tone-ink">
                    Failed on {day(data.run)}: {failed.map(checkName).join(', ')}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="text-caption text-muted-foreground">
          Choose a try to read its transcript. Every try must pass for a wording to pass.
        </p>
      </RecordSection>
      {caveat ? (
        <RecordSection title="What it must mention" icon={ScaleIcon}>
          <blockquote className="border-l-2 px-3 text-body">{caveat}</blockquote>
          <ul className="flex flex-col gap-1 text-dense" aria-label="Mentioned">
            {sides.map((side) => {
              const tally = caveatOf(side)
              return (
                <li key={side.run.id} className="flex flex-wrap items-center gap-2">
                  <span>{day(side)}</span>
                  <Outcome held={tally ? tally.held === tally.tries : null} />
                  <span className="text-muted-foreground">
                    {tally ? `mentioned in ${triesWords(tally)}` : 'not checked'}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-caption text-muted-foreground">
            This is strict: one try that leaves it out fails the wording.
          </p>
        </RecordSection>
      ) : null}
      <RecordSection title="The answer and the judge" icon={TextQuoteIcon}>
        <ul className="flex flex-col gap-4" aria-label="Answers">
          {[...sides].reverse().map((side) => {
            const attempt = side.wordings[0]?.tries[0]
            return (
              <li
                key={side.run.id}
                className="flex min-w-0 flex-col gap-2 rounded-sm border px-4 py-3"
                data-slot="answer"
              >
                <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                  <span>{day(side)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {wordingWords(side.wordings[0]?.wording ?? 0)}, try {attempt?.trial ?? 1}
                  </span>
                  {side.verdict ? <VerdictBadge verdict={side.verdict} size="sm" /> : null}
                </p>
                {attempt?.answer ? (
                  <p className="text-body whitespace-pre-wrap">{attempt.answer}</p>
                ) : (
                  <p className="text-body text-muted-foreground">
                    {attempt?.refused
                      ? 'The agent declined to answer.'
                      : attempt?.error
                        ? 'The try failed to run.'
                        : 'No answer was kept for this try.'}
                  </p>
                )}
                <p className="text-dense text-muted-foreground">
                  Judge: {attempt?.judgeReason ?? 'no verdict for this try.'}
                </p>
              </li>
            )
          })}
        </ul>
        <p className="text-caption text-muted-foreground">
          Answers come from controlled tries of a question an owner wrote.
        </p>
      </RecordSection>
      {data.against ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onCompare}>
            <Columns2Icon aria-hidden="true" />
            Compare side by side
          </Button>
          <Button
            variant="outline"
            render={
              <Link
                {...linkTo({
                  record: `run:${data.run.run.id}`,
                  tab: 'changes',
                  against: data.against.run.id,
                })}
                replace
                resetScroll={false}
              />
            }
          >
            <ArrowRightLeftIcon aria-hidden="true" />
            Every question in the two runs
          </Button>
        </div>
      ) : null}
    </>
  )
}
