import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import type { QuestionComparison, TestQuestion } from '@/api'
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleXIcon,
  Columns2Icon,
  FlaskConicalIcon,
  Minimize2Icon,
  MinusIcon,
} from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { rowLink } from '@/components/page/use-dock-list'
import { BarButton, RecordBar, RecordHeading, recordKeyDown } from '@/components/page/record-parts'
import { WorkbenchFocus, workbenchBarClass } from '@/components/page/workbench'
import { AreaBadge, VerdictBadge } from '@/components/quality/quality-marks'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatHotkey } from '@/lib/commands'
import { formatDay } from '@/lib/library'
import { checkName, questionTitle, runKindWords } from '@/lib/quality'
import type { WorkbenchSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { checkTallies, deliveredRows, type Given } from '@/lib/workbench-evidence'
import {
  namingWords,
  Outcome,
  runWords,
  triesWords,
  useItemTitles,
  type Side,
} from './question-evidence'
import { HeldConstant } from './question-result'
import { useQuestionRuns } from './use-question-runs'

/*
  The compare focus (Workbench plan, slice W7; design round 2, "compare as a focus mode"): a test
  question's two runs side by side, the run it is compared with as the baseline and the newer run
  as the candidate. It widens the record over the work list and the action panel, which stay
  where they were underneath, inert, so leaving it (Escape, Shift C or Leave compare) returns to
  the same row with the list scrolled as it was. The address keeps it (`mode=compare`).

  Its header names the two runs and whether only the edition differs between them (a comparison
  where something else changed too is labelled, never read as the edition's doing). Its rows: the
  run and its models, the tries per wording, the checks, the must-have caveat per try, what Heed
  gave the test, the first try's answer and the judge's reason. On a phone, and wherever the
  focus is narrow, the two columns stack and each cell says which side it is.

  Everything here is a controlled test: owner-written questions run by the evaluation runner.
*/

const COMPARE_KEY = 'shift+c'

/** The record bar's Compare: a labelled button with its key, an icon of 44 on a phone. */
export function CompareButton({
  onCompare,
  disabled,
}: {
  onCompare: () => void
  disabled: boolean
}) {
  const phone = useIsMobile()
  const label = 'Compare side by side'
  if (phone)
    return (
      <BarButton label={label} touch onClick={onCompare} disabled={disabled}>
        <Columns2Icon />
      </BarButton>
    )
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onCompare}
      disabled={disabled}
      aria-keyshortcuts="Shift+C"
      title={disabled ? 'There is no earlier run to compare with' : undefined}
      data-slot="compare-open"
    >
      <Columns2Icon aria-hidden="true" />
      Compare
      <Kbd aria-hidden="true">{formatHotkey(COMPARE_KEY).join('')}</Kbd>
    </Button>
  )
}

export function CompareFocus({
  id,
  question,
  loading,
  area,
  search,
  meta,
  returnFocus,
  onLeave,
}: {
  id: string
  question: TestQuestion | undefined
  /** The questions are still loading. */
  loading: boolean
  area: Area | undefined
  search: WorkbenchSearch
  /** What the record is and where it is in the list ("Test question · 1 of 9"). */
  meta: string
  /** What had focus before the focus mode opened (the Compare button, or the row). */
  returnFocus: { readonly current: Element | null }
  onLeave: () => void
}) {
  const phone = useIsMobile()
  const titleId = useId()
  const region = useRef<HTMLElement>(null)
  const { history, comparison, noRun } = useQuestionRuns({ id, question, search })
  const data = comparison.data

  // Focus moves into the focus mode; leaving it gives focus back to where it was (the Compare
  // button, or the row), else to the row or the record, without scrolling the list.
  useEffect(() => {
    const before = returnFocus.current
    region.current?.focus({ preventScroll: true })
    return () => {
      requestAnimationFrame(() => {
        const shown = (element: HTMLElement | null | undefined) =>
          element?.isConnected && element.getClientRects().length > 0 ? element : null
        const back =
          (before instanceof HTMLElement && before !== document.body ? shown(before) : null) ??
          shown(
            rowLink(
              document.querySelector<HTMLElement>('[data-slot="workbench-list"]'),
              `question:${id}`,
            ),
          ) ??
          shown(document.querySelector<HTMLElement>('[data-slot="record-pane"]'))
        back?.focus({ preventScroll: true })
      })
    }
    // Once, for the time the focus is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leaveKeys = formatHotkey('escape').join('')
  let body: ReactNode
  if (!question)
    body = loading ? null : (
      <p className="text-body text-muted-foreground">
        This test question isn&apos;t available. It may have been renamed, or it&apos;s a hidden
        test question of a domain you don&apos;t own.
      </p>
    )
  else if (noRun)
    body = (
      <p className="text-body text-muted-foreground">
        No weekly run has tested this question yet, so there is nothing to compare.
      </p>
    )
  else if (history.isError || comparison.isError)
    body = (
      <p className="text-body text-muted-foreground">
        We couldn&apos;t compare the runs.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void (history.isError ? history.refetch() : comparison.refetch())}
        >
          Try again
        </button>
      </p>
    )
  else if (!data)
    body = <Skeleton role="status" aria-label="Comparing the runs" className="h-chart w-full" />
  else if (!data.against)
    body = (
      <p className="text-body text-muted-foreground">
        There is no earlier run of {area?.name ?? 'this domain'} to compare with:{' '}
        {runWords(data.run)} is its first.
      </p>
    )
  else body = <CompareGrid question={question} data={data} baseline={data.against} />

  return (
    <WorkbenchFocus
      ref={region}
      tabIndex={-1}
      aria-labelledby={question ? titleId : undefined}
      aria-label={question ? undefined : 'Compare the two runs'}
      data-slot="compare-focus"
      onKeyDown={(event) => recordKeyDown(event, onLeave)}
    >
      <RecordBar
        meta={<span className="truncate">Comparing · {meta}</span>}
        back={
          phone ? (
            <Button
              variant="ghost"
              size="icon-touch"
              aria-label="Leave compare"
              onClick={onLeave}
              className="text-muted-foreground"
            >
              <ArrowLeftIcon />
            </Button>
          ) : null
        }
        controls={
          phone ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLeave}
              aria-keyshortcuts="Escape"
              data-slot="compare-leave"
            >
              <Minimize2Icon aria-hidden="true" />
              Leave compare
              <Kbd aria-hidden="true">{leaveKeys}</Kbd>
            </Button>
          )
        }
        browse={false}
        touch={phone}
        className={workbenchBarClass}
      />
      <RecordHeading
        title={question ? questionTitle(question, question.id) : loading ? null : 'Compare'}
        titleId={titleId}
        badges={
          question ? (
            <div className="flex flex-wrap items-center gap-2">
              <AreaBadge area={area} />
            </div>
          ) : null
        }
        note={
          question ? (
            <div className="flex flex-col gap-2">
              {data?.against ? <HeldConstant data={data} /> : null}
              <p className="text-dense text-muted-foreground" data-slot="fixture">
                <FlaskConicalIcon aria-hidden="true" className="inline size-icon-sm heed-ink" /> A
                test question an owner wrote, asked in a controlled test. Nobody asked it for real.
              </p>
            </div>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-6 pb-8 @md:px-6">{body}</div>
    </WorkbenchFocus>
  )
}

/** The two sides as the focus names them. */
type Column = { side: Side; name: 'Baseline' | 'Candidate'; label: string }

/** Each side's name on screen: the earlier run, and the newer one compared with it. */
const sideWords: Record<Column['name'], string> = {
  Baseline: 'Earlier run',
  Candidate: 'Newer run',
}

/** The label column and the two sides, from where the focus is wide enough for both. */
const columns = '@3xl:grid-cols-compare'

function CompareGrid({
  question,
  data,
  baseline,
}: {
  question: TestQuestion
  data: QuestionComparison
  baseline: Side
}) {
  const sides: [Column, Column] = [
    {
      side: baseline,
      name: 'Baseline',
      label: `${sideWords.Baseline} · ${formatDay(baseline.run.finishedAt)}`,
    },
    {
      side: data.run,
      name: 'Candidate',
      label: `${sideWords.Candidate} · ${formatDay(data.run.run.finishedAt)}`,
    },
  ]
  const delivered = deliveredRows(question, data)
  const titleOf = useItemTitles(data)
  const changed = new Set(data.changed)
  const wordingWords = (index: number) =>
    question.wordings[index]?.kind === 'precise' ? 'Precise' : 'Natural'
  const absent = (side: Side) =>
    side.revision === null ? (
      <p className="text-muted-foreground">Not in {runWords(side)}.</p>
    ) : null

  const rows: { label: string; slot: string; cell: (column: Column) => ReactNode }[] = [
    {
      label: 'Run',
      slot: 'run',
      cell: ({ side }) => (
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={side.verdict} size="sm" />
            <span>
              {runKindWords[side.run.kind]}, {formatDay(side.run.finishedAt)}
            </span>
          </span>
          <Setup
            name="Answered by"
            value={side.run.modelId}
            differs={changed.has('answer_model')}
          />
          <Setup
            name="Judged by"
            value={side.run.judgeModelId ?? 'no judge'}
            differs={changed.has('judge_model')}
          />
          <Setup
            name="Question revision"
            value={side.revision === null ? 'not in the run' : String(side.revision)}
            differs={changed.has('revision')}
          />
        </div>
      ),
    },
    {
      label: 'Tries',
      slot: 'tries',
      cell: ({ side, label }) =>
        absent(side) ?? (
          <Tries
            side={side}
            label={label}
            wordingWords={wordingWords}
            held={(attempt) => attempt.passed}
            words={{ true: 'passed', false: 'failed', null: 'not scored' }}
          />
        ),
    },
    {
      label: 'Checks',
      slot: 'checks',
      cell: ({ side }) => {
        const tallies = checkTallies(side)
        return (
          absent(side) ??
          (tallies.length ? (
            <ul className="flex flex-col gap-1" aria-label="Checks">
              {tallies.map((tally) => (
                <li key={tally.check} className="flex flex-wrap items-center gap-x-2">
                  <span className="min-w-0 flex-1">{sentence(checkName(tally.check))}</span>
                  <Outcome held={tally.held === tally.tries} />
                  <span className="text-muted-foreground tabular-nums">{triesWords(tally)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No try was scored.</p>
          ))
        )
      },
    },
    ...(question.expected.caveat
      ? [
          {
            label: 'Mentions what it must',
            slot: 'caveat',
            cell: ({ side, label }: Column) =>
              absent(side) ?? (
                <Tries
                  side={side}
                  label={`${label}, what it must mention`}
                  wordingWords={wordingWords}
                  held={(attempt) => attempt.checks.caveat ?? null}
                  words={{ true: 'mentioned', false: 'missing', null: 'not checked' }}
                />
              ),
          },
        ]
      : []),
    {
      label: 'Facts it got',
      slot: 'delivered',
      cell: ({ side, name }) =>
        absent(side) ??
        (delivered.length ? (
          <ul className="flex flex-col gap-2" aria-label="Facts it got">
            {delivered.map((row) => {
              const { title, kind } = titleOf(row.itemId)
              const given = name === 'Baseline' ? row.against : row.run
              const lost =
                (row.named === 'must_deliver' && !!given && given.tries < given.of) ||
                (row.named === 'must_not_deliver' && !!given && given.tries > 0)
              return (
                <li key={row.itemId} className="flex min-w-0 items-start gap-2">
                  {kind ? <KindIcon kind={kind} size="sm" /> : null}
                  <span className="flex min-w-0 flex-col">
                    <Link
                      to="/library/$itemId"
                      params={{ itemId: row.itemId }}
                      className="break-words underline-offset-3 hover:underline"
                    >
                      {title || <Skeleton className="h-4 w-1/2" />}
                    </Link>
                    <span className="text-caption text-muted-foreground">
                      {row.named ? namingWords[row.named] : 'Not named by the question'}
                      {' · '}
                      <GivenWords given={given} lost={lost} />
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            The question names no fact, and the agent got none.
          </p>
        )),
    },
    {
      label: 'Answer, try 1',
      slot: 'answer',
      cell: ({ side }) => {
        const attempt = side.wordings[0]?.tries[0]
        return (
          absent(side) ??
          (attempt?.answer ? (
            <p className="text-body whitespace-pre-wrap">{attempt.answer}</p>
          ) : (
            <p className="text-muted-foreground">
              {attempt?.refused
                ? 'The agent declined to answer.'
                : attempt?.error
                  ? 'The try failed to run.'
                  : 'No answer was kept for this try.'}
            </p>
          ))
        )
      },
    },
    {
      label: 'Judge',
      slot: 'judge',
      cell: ({ side }) =>
        absent(side) ?? (
          <p>{side.wordings[0]?.tries[0]?.judgeReason ?? 'No verdict for this try.'}</p>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div data-slot="compare-grid" className="overflow-hidden rounded-sm border text-dense">
        {/* The columns' names, once, where the sides stand side by side; each cell also says. */}
        <div
          aria-hidden="true"
          className={cn('hidden border-b bg-sidebar text-caption @3xl:grid', columns)}
        >
          <span />
          {sides.map(({ side, name }) => (
            <span
              key={name}
              className="flex min-h-row flex-wrap items-center gap-x-2 border-l px-3 py-2"
            >
              <b className="text-foreground">{sideWords[name]}</b>
              <span className="text-foreground">{formatDay(side.run.finishedAt)}</span>
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <CompareRow key={row.slot} label={row.label} slot={row.slot}>
            {sides.map((column) => (
              <div
                key={column.name}
                data-side={column.name.toLowerCase()}
                className={cn(
                  'flex min-h-row min-w-0 flex-col gap-1 px-3 py-2 @3xl:border-l',
                  // Stacked, a hairline parts the candidate from the baseline above it.
                  column.name === 'Candidate' && 'border-t border-border-subtle @3xl:border-t-0',
                )}
              >
                <p className="text-caption text-muted-foreground @3xl:sr-only">{column.label}</p>
                {row.cell(column)}
              </div>
            ))}
          </CompareRow>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">
        The newer run beside the earlier one: the run before it, or the run the strip above compares
        with. Both ask a question an owner wrote, in controlled tries. Every try must pass for a
        wording to pass.
      </p>
    </div>
  )
}

/** A row of the comparison: its name, then the baseline's cell and the candidate's. */
function CompareRow({
  label,
  slot,
  children,
}: {
  label: string
  slot: string
  children: ReactNode
}) {
  const labelId = useId()
  return (
    <section
      aria-labelledby={labelId}
      data-slot={`compare-${slot}`}
      className={cn('grid grid-cols-1 border-b last:border-b-0', columns)}
    >
      <h3
        id={labelId}
        className="flex items-start bg-sidebar px-3 pt-2 pb-1 text-caption text-muted-foreground @3xl:min-h-row @3xl:pb-2"
      >
        {label}
      </h3>
      {children}
    </section>
  )
}

/** A fact of a run's set-up, in the warning ink when it differs between the two runs. */
function Setup({ name, value, differs }: { name: string; value: string; differs: boolean }) {
  return (
    <span className="text-caption text-muted-foreground">
      {name}{' '}
      <span
        data-tone={differs ? 'warning' : undefined}
        className={cn('font-mono break-all', differs ? 'text-tone-ink' : 'text-foreground')}
      >
        {value}
      </span>
      {differs ? ' (differs)' : ''}
    </span>
  )
}

type Try = Side['wordings'][number]['tries'][number]

/** A side's tries, wording by wording: a mark per try for whether it held. */
function Tries({
  side,
  label,
  wordingWords,
  held,
  words,
}: {
  side: Side
  /** The side, to name each list ("Newer run · 5 Oct 2026"). */
  label: string
  wordingWords: (index: number) => string
  held: (attempt: Try) => boolean | null
  words: Record<'true' | 'false' | 'null', string>
}) {
  if (side.wordings.length === 0) return <p className="text-muted-foreground">Not run.</p>
  return (
    <dl className="flex flex-col gap-1">
      {side.wordings.map((wording) => (
        <div key={wording.wording} className="flex items-center gap-3">
          <dt className="w-16 shrink-0 text-muted-foreground">{wordingWords(wording.wording)}</dt>
          <dd>
            <ul
              className="flex flex-wrap gap-1"
              aria-label={`${label}, ${wordingWords(wording.wording).toLowerCase()} wording`}
            >
              {wording.tries.map((attempt) => {
                const outcome = attempt.error !== null ? null : held(attempt)
                const Glyph = outcome ? CheckIcon : outcome === false ? CircleXIcon : MinusIcon
                return (
                  <li
                    key={attempt.cell}
                    data-slot="try-mark"
                    data-tone={outcome ? 'success' : outcome === false ? 'danger' : undefined}
                    className="flex size-control-sm items-center justify-center rounded-sm border text-tone-ink"
                  >
                    <Glyph aria-hidden="true" className="size-icon-sm" />
                    <span className="sr-only">
                      Try {attempt.trial}: {words[String(outcome) as 'true' | 'false' | 'null']}
                    </span>
                  </li>
                )
              })}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** "Given in 6 of 6", "Not given" or "Not run"; in the danger ink when an expected item was lost. */
function GivenWords({ given, lost }: { given: Given | null; lost: boolean }) {
  if (!given || given.of === 0) return <span>not run</span>
  return (
    <span data-tone={lost ? 'danger' : undefined} className={cn(lost && 'font-bold text-tone-ink')}>
      {given.tries === 0
        ? 'not given'
        : `given in ${given.tries.toLocaleString('en')} of ${given.of.toLocaleString('en')}`}
    </span>
  )
}

/** A check's name as a label: "Caveat kept". */
const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)
