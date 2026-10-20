import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Comparison, EvalRun, EvalRunDetail, TestQuestion } from '@/api'
import {
  evalRunsQuery,
  evalTranscriptQuery,
  peopleQuery,
  runComparisonQuery,
  useApiWrite,
} from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  ArrowUpIcon,
  BotIcon,
  CalendarIcon,
  CheckIcon,
  CircleStopIcon,
  CircleXIcon,
  FlaskConicalIcon,
  LayersIcon,
  ListChecksIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  ScaleIcon,
  SigmaIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { RecordSection } from '@/components/page/record-parts'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDay, formatMoment } from '@/lib/library'
import {
  checkName,
  comparable,
  formatRate,
  formatUsd,
  questionTitle,
  runKindWords,
  runOutcome,
  runStateWords,
  runTitle,
  runTriggerWords,
  transcriptChecks,
  transcriptTurns,
  verdictOfResult,
  verdictWords,
} from '@/lib/quality'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { VerdictBadge } from './quality-marks'
import { RecordLink, type LinkTo } from './panel-parts'

/*
  An answer run's record body, without a frame (Workbench plan, slice W6a): its state, what it
  tested with which models and what it cost; against an earlier run of its domain, the questions
  that got better and worse with the sign test; each question's result with its tries, and a
  try's transcript; and cancelling or approving it. The Workbench's run and question records show
  it.
*/

/** Whether the run has stopped, by finishing, failing or being cancelled. */
export const ended = (run: EvalRun) => ['finished', 'failed', 'cancelled'].includes(run.state)

export function RunStateBadge({ run }: { run: EvalRun }) {
  if (run.state === 'finished')
    return (
      <Badge form="outline" icon={FlaskConicalIcon}>
        {runKindWords[run.kind]}
      </Badge>
    )
  const tone =
    run.state === 'failed'
      ? 'danger'
      : run.state === 'awaiting_approval' || run.state === 'incomplete'
        ? 'warning'
        : run.state === 'cancelled'
          ? 'neutral'
          : 'info'
  return (
    <Badge
      tone={tone}
      icon={
        run.state === 'failed'
          ? CircleXIcon
          : run.state === 'incomplete'
            ? TriangleAlertIcon
            : FlaskConicalIcon
      }
    >
      {runStateWords[run.state]}
    </Badge>
  )
}

export function RunSummary({ detail }: { detail: EvalRunDetail }) {
  const { run } = detail
  const { data: people } = useQuery(peopleQuery())
  const outcome = runOutcome(detail)
  const layers = detail.scorecard?.layers
  // Judge against code on the side the run scores: the change, or the edition as it is.
  const agreement = detail.agreement?.candidate ?? detail.agreement?.baseline ?? null
  const who = run.requestedBy
    ? (people?.find((person) => person.id === run.requestedBy)?.name ?? 'A person')
    : run.kind === 'scheduled'
      ? 'The weekly schedule'
      : run.trigger
        ? `A change: ${runTriggerWords[run.trigger]}`
        : run.proposalId
          ? 'A proposal'
          : 'The service'
  return (
    <>
      {run.failure ? (
        <Alert variant={run.state === 'incomplete' ? 'warning' : 'danger'}>
          <TriangleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>
              {run.state === 'incomplete'
                ? 'The run stopped before it finished'
                : run.state === 'failed'
                  ? 'The run failed'
                  : 'Not every check passed'}
            </AlertTitle>
            <AlertDescription>{run.failure}</AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
      {run.state === 'awaiting_approval' ? (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>Waiting for an admin</AlertTitle>
            <AlertDescription>
              Its estimate, {formatUsd(run.estimatedCostMicros)}, is above the budget a run may
              spend without approval.
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
      <FieldTable label="Summary of the run" wideLabels>
        <FieldRow icon={ListChecksIcon} label="Result">
          {run.state === 'finished' ? (
            <span className="tabular-nums">
              {outcome.passed} of {outcome.questions} pass ({formatRate(outcome.rate) ?? 'none'})
              {outcome.failed ? `, ${outcome.failed} fail` : ''}
              {outcome.noAnswer ? `, ${outcome.noAnswer} without an answer` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">{runStateWords[run.state]}</span>
          )}
        </FieldRow>
        {layers ? (
          <FieldRow
            icon={LayersIcon}
            label="By layer"
            hint="Code checks the facts and what the answer cites. An AI judge checks the wording: what it must mention, causes and what a right answer says."
          >
            Code: {layers.code.passed} pass, {layers.code.failed} fail. Judge: {layers.judge.passed}{' '}
            pass, {layers.judge.failed} fail.
          </FieldRow>
        ) : null}
        {agreement?.questions ? (
          <FieldRow
            icon={ScaleIcon}
            label="Judge and code"
            hint="Where the AI judge and the code checks disagree on a question. A judge that passes what the code checks fail is more lenient than the record of what the AI app got."
          >
            {agreement.judgePassedCodeFailed.length || agreement.codePassedJudgeFailed.length
              ? [
                  agreement.judgePassedCodeFailed.length
                    ? `The judge passed ${agreement.judgePassedCodeFailed.length} the code checks failed`
                    : null,
                  agreement.codePassedJudgeFailed.length
                    ? `the code checks passed ${agreement.codePassedJudgeFailed.length} the judge failed`
                    : null,
                ]
                  .filter(Boolean)
                  .join('; ')
                  .replace(/^t/, 'T') + ` (of ${agreement.questions} questions).`
              : `They agree on all ${agreement.questions} questions.`}
          </FieldRow>
        ) : null}
        {detail.judging.errors ? (
          <FieldRow
            icon={TriangleAlertIcon}
            label="Judge errors"
            hint="Answers the AI judge gave no usable verdict for, even after one retry. It left a point out, graded one twice, or graded one the question doesn't have. Such an answer is neither a pass nor a fail."
          >
            <span className="tabular-nums">
              {detail.judging.errors} of {detail.judging.judged} judged answers (
              {formatRate(detail.judging.errors / detail.judging.judged) ?? 'none'})
            </span>
          </FieldRow>
        ) : null}
        <FieldRow icon={FlaskConicalIcon} label="Tested">
          {run.questions.toLocaleString('en')} questions, {run.tries} tries each wording
          {run.setAside ? `, ${run.setAside} set aside` : ''}
        </FieldRow>
        <FieldRow icon={UserRoundIcon} label="Started by">
          {who}
        </FieldRow>
        <FieldRow icon={CalendarIcon} label="Finished">
          {run.finishedAt ? formatMoment(run.finishedAt) : 'Not yet'}
        </FieldRow>
        <FieldRow icon={BotIcon} label="Answering AI">
          <span className="font-mono">{run.modelId}</span>
        </FieldRow>
        <FieldRow
          icon={ScaleIcon}
          label="Judge"
          hint={
            run.judgeSameFamily === true
              ? 'The judge is from the answering AI’s own family, which may favour its answers.'
              : run.judgeSameFamily === false
                ? 'The judge is from another family than the answering AI.'
                : undefined
          }
        >
          <span className="font-mono">{run.judgeModelId ?? 'None'}</span>
        </FieldRow>
        <FieldRow icon={SigmaIcon} label="Cost">
          {formatUsd(run.actualCostMicros)} of an estimated {formatUsd(run.estimatedCostMicros)}
          {run.costCeilingMicros === null ? '' : `, ceiling ${formatUsd(run.costCeilingMicros)}`}
        </FieldRow>
      </FieldTable>
    </>
  )
}

/** The questions that got better and worse against an earlier run, and the sign test. */
export function RunChanges({
  run,
  against,
  linkTo,
  questions,
}: {
  run: EvalRun
  against: string | undefined
  linkTo: LinkTo
  questions: ReadonlyMap<string, TestQuestion>
}) {
  const navigate = useNavigate()
  const comparison = useQuery(runComparisonQuery({ id: run.id, ...(against ? { against } : {}) }))
  const runs = useQuery(evalRunsQuery({ area: run.areaId ?? undefined, limit: 50 }))
  const earlier = (runs.data ?? []).filter(
    (candidate) =>
      candidate.id !== run.id &&
      comparable(candidate) &&
      candidate.areaId === run.areaId &&
      (candidate.finishedAt ?? '') < (run.finishedAt ?? ''),
  )
  const chosen = comparison.data?.against?.id ?? against ?? ''
  return (
    <>
      <Field>
        <FieldLabel>Compared with</FieldLabel>
        <Select
          value={chosen}
          onValueChange={(value: string | null) =>
            void navigate({
              ...linkTo({ against: value || undefined, cell: undefined }),
              replace: true,
              resetScroll: false,
            })
          }
        >
          <SelectTrigger aria-label="Compared with" className="w-full">
            <SelectValue>
              {(value: string) => {
                const found = earlier.find((candidate) => candidate.id === value)
                return found
                  ? runTitle(found)
                  : comparison.data?.against
                    ? `Weekly run, ${formatDay(comparison.data.against.finishedAt)}`
                    : 'The run before'
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {earlier.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                <SelectItemText>{runTitle(candidate)}</SelectItemText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {comparison.isPending ? (
        <Skeleton role="status" aria-label="Comparing the runs" className="h-16 w-full" />
      ) : comparison.isError ? (
        <p className="text-body text-muted-foreground">We couldn&apos;t compare these runs.</p>
      ) : (
        <ComparisonView comparison={comparison.data} linkTo={linkTo} questions={questions} />
      )}
    </>
  )
}

export function ComparisonView({
  comparison,
  linkTo,
  questions,
}: {
  comparison: Comparison
  linkTo: LinkTo
  questions: ReadonlyMap<string, TestQuestion>
}) {
  if (!comparison.against)
    return (
      <p className="text-body text-muted-foreground">
        This is the domain’s first weekly run, so there is nothing to compare it with yet.
      </p>
    )
  const { better, worse, pValue } = comparison.signTest
  const sentence =
    better + worse === 0
      ? 'Every question both runs tested gave the same result.'
      : pValue !== null && pValue < 0.05
        ? `${better > worse ? 'Better' : 'Worse'}, and unlikely to be noise (sign test, p = ${pValue < 0.001 ? '< 0.001' : pValue.toFixed(2)}).`
        : `No clear change: a difference this small can be noise (sign test, p = ${pValue?.toFixed(2)}).`
  return (
    <>
      <p data-slot="comparison-verdict" className="text-body">
        <span className="font-bold">
          {better} better, {worse} worse.
        </span>{' '}
        {sentence}
      </p>
      <ChangeList
        title="Got worse"
        icon={ArrowDownIcon}
        tone="danger"
        changes={comparison.worse}
        empty="No question got worse."
        linkTo={linkTo}
        questions={questions}
      />
      <ChangeList
        title="Got better"
        icon={ArrowUpIcon}
        tone="success"
        changes={comparison.better}
        empty="No question got better."
        linkTo={linkTo}
        questions={questions}
      />
      <p className="text-dense text-muted-foreground">
        Unchanged: {comparison.unchanged.pass} still pass, {comparison.unchanged.fail} still fail,{' '}
        {comparison.unchanged.noAnswer} still without an answer.
        {comparison.added ? ` ${comparison.added} new since the earlier run.` : ''}
        {comparison.removed ? ` ${comparison.removed} no longer tested.` : ''}
      </p>
    </>
  )
}

function ChangeList({
  title,
  icon: Glyph,
  tone,
  changes,
  empty,
  linkTo,
  questions,
}: {
  title: string
  icon: typeof ArrowUpIcon
  tone: 'success' | 'danger'
  changes: Comparison['worse']
  empty: string
  linkTo: LinkTo
  questions: ReadonlyMap<string, TestQuestion>
}) {
  return (
    <RecordSection title={`${title} (${changes.length})`} icon={Glyph}>
      {changes.length === 0 ? (
        <p className="text-body text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {changes.map((change, index) => (
            <li key={`${change.id}-${index}`} className="flex flex-col gap-1 py-2">
              {change.id === 'held-out' ? (
                <span className="text-body font-bold">{questionTitle(undefined, change.id)}</span>
              ) : (
                <RecordLink
                  linkTo={linkTo}
                  record={`question:${change.id}`}
                  className="text-body font-bold"
                >
                  {questionTitle(questions.get(change.id), change.id)}
                </RecordLink>
              )}
              <span
                className={cn(
                  'text-dense',
                  tone === 'danger' ? 'text-status-danger-fg' : 'text-status-success-fg',
                )}
              >
                {verdictWords[change.from]} before, {verdictWords[change.to].toLowerCase()} now
                {change.failedChecks.length
                  ? `. ${tone === 'danger' ? 'Fails' : 'Failed'}: ${change.failedChecks.map(checkName).join(', ')}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  )
}

/** Each question's result, with its tries. */
export function RunResults({
  detail,
  linkTo,
  questions,
}: {
  detail: EvalRunDetail
  linkTo: LinkTo
  questions: ReadonlyMap<string, TestQuestion>
}) {
  if (detail.results.length === 0)
    return (
      <p className="text-body text-muted-foreground">
        {ended(detail.run)
          ? 'This run has no results.'
          : 'Results show here once the run has finished.'}
      </p>
    )
  const failing = [...detail.results].sort(
    (a, b) =>
      Number(verdictOfResult(a) === 'pass') - Number(verdictOfResult(b) === 'pass') ||
      a.id.localeCompare(b.id),
  )
  return (
    <ul aria-label="Results" className="flex flex-col divide-y">
      {failing.map((result) => {
        const cells = detail.cells.filter((cell) => cell.questionId === result.id)
        const layers = result.layers?.candidate ?? result.layers?.baseline
        return (
          <li key={result.id} className="flex flex-col gap-2 py-3">
            <div className="flex items-start justify-between gap-3">
              {result.id === 'held-out' ? (
                <span className="text-body font-bold">{questionTitle(undefined, result.id)}</span>
              ) : (
                <RecordLink
                  linkTo={linkTo}
                  record={`question:${result.id}`}
                  className="text-body font-bold"
                >
                  {questionTitle(questions.get(result.id), result.id)}
                </RecordLink>
              )}
              <VerdictBadge verdict={verdictOfResult(result)} size="sm" />
            </div>
            {layers?.failedChecks.length ? (
              <p className="text-dense text-muted-foreground">
                Failed: {layers.failedChecks.map(checkName).join(', ')}.
              </p>
            ) : null}
            {cells.length ? (
              <ul aria-label="Tries" className="flex flex-wrap gap-2">
                {cells.map((cell) => (
                  <li key={cell.id}>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          {...linkTo({ tab: 'results', cell: cell.id })}
                          replace
                          resetScroll={false}
                        />
                      }
                    >
                      Wording {cell.wording + 1}, try {cell.trial}
                      <span className="text-muted-foreground">
                        {cell.error
                          ? 'error'
                          : cell.passed === null
                            ? 'no score'
                            : cell.passed
                              ? 'passed'
                              : 'failed'}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** One try's transcript: the question, the tool calls and their results, and the answer. */
export function Transcript({
  cellId,
  linkTo,
  questions,
}: {
  cellId: string
  linkTo: LinkTo
  questions: ReadonlyMap<string, TestQuestion>
}) {
  const transcript = useQuery(evalTranscriptQuery(cellId))
  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      nativeButton={false}
      render={<Link {...linkTo({ cell: undefined })} replace resetScroll={false} />}
    >
      <ArrowLeftIcon aria-hidden="true" />
      All results
    </Button>
  )
  if (transcript.isPending)
    return (
      <>
        {back}
        <Skeleton role="status" aria-label="Loading the transcript" className="h-chart w-full" />
      </>
    )
  if (!transcript.data)
    return (
      <>
        {back}
        <p className="text-body text-muted-foreground">
          {transcript.isError
            ? "We couldn't load the transcript."
            : "This transcript isn't available. Only the owners of its domain and admins read transcripts."}
        </p>
      </>
    )
  const data = transcript.data
  const checks = transcriptChecks(data.scores)
  return (
    <section aria-label="Transcript" data-slot="transcript" className="flex flex-col gap-6">
      {back}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge
            verdict={
              data.refused
                ? 'no_answer'
                : data.passed === null
                  ? null
                  : data.passed
                    ? 'pass'
                    : 'fail'
            }
          />
          <span className="text-dense text-muted-foreground">
            Try {data.trial}: {questionTitle(questions.get(data.questionId), data.questionId)}
          </span>
        </div>
        {checks.length ? (
          <ul aria-label="Checks" className="flex flex-wrap gap-2">
            {checks.map(({ check, held }) => (
              <li key={check}>
                <Badge
                  form={held ? 'outline' : 'soft'}
                  tone={held ? 'success' : 'danger'}
                  size="sm"
                  icon={held ? CheckIcon : CircleXIcon}
                >
                  {checkName(check)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ol className="flex flex-col gap-4">
        {transcriptTurns(data.messages).map((turn, index) => (
          <li key={index} className="flex flex-col gap-1">
            {turn.kind === 'text' ? (
              <>
                <span className="flex items-center gap-2 text-caption text-muted-foreground">
                  {turn.role === 'person' ? (
                    <MessageSquareIcon aria-hidden="true" className="size-icon-sm" />
                  ) : (
                    <SparklesIcon aria-hidden="true" className="size-icon-sm" />
                  )}
                  {turn.role === 'person' ? 'Question' : 'AI app'}
                </span>
                <p className="text-body whitespace-pre-wrap">{turn.text}</p>
              </>
            ) : (
              <>
                <span className="flex items-center gap-2 text-caption text-muted-foreground">
                  <ArrowRightLeftIcon aria-hidden="true" className="size-icon-sm" />
                  {turn.kind === 'call' ? `Calls ${turn.tool}` : `${turn.tool} answers`}
                </span>
                <pre
                  // A long call scrolls: the keyboard reaches it too.
                  tabIndex={0}
                  aria-label={
                    turn.kind === 'call'
                      ? `What ${turn.tool} was asked`
                      : `What ${turn.tool} answered`
                  }
                  className="max-h-chart overflow-auto rounded-md border bg-muted px-3 py-2 font-mono text-caption whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {turn.kind === 'call' ? turn.input : turn.output}
                </pre>
              </>
            )}
          </li>
        ))}
      </ol>
      {!data.wording ? null : (
        <p className="text-caption text-muted-foreground">Asked as: {data.wording}</p>
      )}
      <RecordLink linkTo={linkTo} record={`question:${data.questionId}`} className="text-dense">
        Open the test question
      </RecordLink>
    </section>
  )
}

/** What each decision on a run says and does. */
const decisions = {
  cancel: {
    title: 'Cancel this run?',
    action: 'Cancel run',
    icon: CircleStopIcon,
    tone: 'destructive',
    done: 'The run is cancelled',
  },
  approve: {
    title: 'Approve this run?',
    action: 'Approve',
    icon: CheckIcon,
    tone: 'default',
    done: 'The run is approved',
  },
  resume: {
    title: 'Resume this run?',
    action: 'Resume run',
    icon: RotateCcwIcon,
    tone: 'default',
    done: 'The run is resumed',
  },
} as const
export type RunDecisionAction = keyof typeof decisions

/** Cancelling a run, approving one above the budget (FR-516), or resuming one that stopped (R6). */
export function RunDecision({
  run,
  action,
  onClose,
}: {
  run: EvalRun
  action: RunDecisionAction
  onClose: () => void
}) {
  const cancel = useApiWrite('cancelEvalRun')
  const approve = useApiWrite('approveEvalRun')
  const resume = useApiWrite('resumeEvalRun')
  const decision = decisions[action]
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={decision.title}
      effect={
        action === 'cancel'
          ? 'It stops now. Tries already answered are kept and charged.'
          : action === 'resume'
            ? 'It makes only the answers it is missing; the answers it already made are kept.'
            : `It starts and may spend up to its estimate, ${formatUsd(run.estimatedCostMicros)}.`
      }
      action={decision.action}
      actionIcon={decision.icon}
      tone={decision.tone}
      cancelLabel="Keep it"
      onConfirm={async () => {
        const mutation = action === 'cancel' ? cancel : action === 'approve' ? approve : resume
        await mutation.mutateAsync({ id: run.id })
        showToast(decision.done)
        onClose()
      }}
    />
  )
}
