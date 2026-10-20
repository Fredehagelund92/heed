import { useId, useState, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { Gap, GapDetail, GapTest, TestQuestion } from '@/api'
import { evalRunQuery, gapQuery, useApiWrite, vocabularyQuery } from '@/api/queries'
import { GapStatusBadge, VerifiedBadge } from '@/components/gaps/gap-marks'
import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FlaskConicalIcon,
  LinkIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  PlayIcon,
  SplitIcon,
  UnlinkIcon,
  type Icon,
} from '@/components/icons'
import { RailSection } from '@/components/page/page-rail'
import { RecordSection } from '@/components/page/record-parts'
import { RecordLink, type LinkTo } from '@/components/quality/panel-parts'
import { VerdictBadge } from '@/components/quality/quality-marks'
import { refusalText } from '@/components/quality/question-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { TruncatedText } from '@/components/ui/truncated-text'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { gapVerificationView, linkCandidates } from '@/lib/gap-verification'
import { topicTitle } from '@/lib/gaps'
import { formatDay } from '@/lib/library'
import { questionTitle, runKindWords } from '@/lib/quality'
import { showToast } from '@/lib/toast'

/*
  A gap's verification by test and its test links in the Workbench (Workbench plan, slice V5;
  FR-610). Resolved and Verified by test are two separate facts in the action panel: an owner
  resolves a gap, and a finished weekly or full run in which every linked, active test passes on
  the resolving edition or a later one verifies it. The record lists the linked tests with their
  newest result; the action panel links a test question of the gap's domain or writes one from
  the gap. A test question's record lists the gaps it is linked to.

  The tests and the history are for the gap's managers (the owners and deputies of its domain
  and administrators); anyone else reads only whether it is verified. The service checks every
  link and unlink; the panel offers them only to those who may.
*/

const actionClass = 'w-full min-w-0 justify-start'

/** One fact of the Verification section: its name with a glyph, and where it stands in words. */
function Fact({ icon: Glyph, name, children }: { icon: Icon; name: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-2 text-dense font-bold">
        <Glyph
          aria-hidden="true"
          className="size-icon-sm shrink-0 text-muted-foreground heed-ink"
        />
        {name}
      </dt>
      <dd className="text-dense break-words text-muted-foreground">{children}</dd>
    </div>
  )
}

/** "the weekly run of 13 Oct 2026", or "a run of …" while the run's kind is not known. */
export function RunName({ run, day, linkTo }: { run: string; day: string; linkTo: LinkTo }) {
  const read = useQuery(evalRunQuery(run))
  const kind = read.data?.run.kind
  return (
    <RecordLink linkTo={linkTo} record={`run:${run}`} className="underline">
      {kind ? `the ${runKindWords[kind].toLowerCase()}` : 'the run'} of {formatDay(day)}
    </RecordLink>
  )
}

/**
 * Verification (FR-610): Resolved and Verified by test, side by side and never one for the
 * other. While a resolved gap waits for a passing run, an owner of its domain can run it now.
 */
export function GapVerification({
  gap,
  area,
  maintains,
  questions,
  linkTo,
  onRun,
}: {
  gap: GapDetail
  area: Area | undefined
  /** The person runs the gap's domain (an owner or deputy of it, or an administrator). */
  maintains: boolean
  questions: ReadonlyMap<string, TestQuestion>
  linkTo: LinkTo
  onRun: (area: string) => void
}) {
  const view = gapVerificationView(gap)
  const active = (gap.tests ?? []).filter((test) => test.active).length
  const waiting = view.state === 'waiting' && view.of !== null
  return (
    <RailSection
      title="Checked by a test"
      icon={BadgeCheckIcon}
      description="Resolved is an owner's decision. Checked by a test means a run passed."
      data-slot="gap-verification"
    >
      <dl className="flex flex-col gap-3">
        <Fact icon={gap.status === 'resolved' ? CircleCheckIcon : CircleDashedIcon} name="Resolved">
          {gap.status === 'resolved' ? (
            <>Marked resolved {formatDay(gap.statusSince)}.</>
          ) : gap.status === 'wont_fix' ? (
            "No. It's closed as won't fix."
          ) : (
            <>
              Not yet. An owner of {area?.name ?? 'its domain'} marks it resolved once AI apps get
              the fix.
            </>
          )}
        </Fact>
        <Fact
          icon={view.state === 'verified' ? BadgeCheckIcon : CircleDashedIcon}
          name="Checked by a test"
        >
          {view.state === 'verified' ? (
            <span className="flex flex-col gap-1" data-slot="verified">
              <span>
                Yes
                {view.run && gap.tests ? (
                  <>
                    , by <RunName run={view.run} day={view.hour} linkTo={linkTo} />.
                  </>
                ) : (
                  <>, {formatDay(view.hour)}.</>
                )}
              </span>
              {view.failing.map((failing) => (
                <span key={failing.question} className="text-foreground" data-slot="fails-since">
                  Fails since {formatDay(failing.finishedAt)}:{' '}
                  {questionTitle(questions.get(failing.question), failing.question)}
                </span>
              ))}
            </span>
          ) : view.state === 'waiting' ? (
            <>
              Not yet. It waits for a weekly or full run to pass on what AI apps get since it was
              resolved.
              {view.of !== null
                ? ` ${view.passed!.toLocaleString('en')} of ${view.of.toLocaleString('en')} linked ${view.of === 1 ? 'test has' : 'tests have'} passed.`
                : ''}
            </>
          ) : view.state === 'no_tests' ? (
            <>
              Not yet. Link a test question that captures the gap. A run that passes after it was
              resolved checks it.
            </>
          ) : view.state === 'no_edition' ? (
            "It can't be: it was resolved before we recorded what AI apps got. Reopen it and resolve it again, so a test can check it."
          ) : gap.status === 'wont_fix' ? (
            "No. A gap closed as won't fix is never checked."
          ) : active ? (
            `Not yet. Once it's resolved, it counts as checked when ${active === 1 ? 'its linked test passes' : `its ${active.toLocaleString('en')} linked tests pass`}.`
          ) : (
            "Not yet. Once it's resolved, a passing run of its linked tests checks it."
          )}
        </Fact>
      </dl>
      {waiting && maintains && area ? (
        <Button variant="outline" className={actionClass} onClick={() => onRun(area.id)}>
          <PlayIcon aria-hidden="true" />
          <TruncatedText text={`Run ${area.name} now`} />
        </Button>
      ) : null}
    </RailSection>
  )
}

/**
 * Test (FR-610): link a test question of the gap's domain that captures it, those on the gap's
 * scope first, or write one from the gap, which is linked once saved.
 */
export function GapTestActions({
  gap,
  area,
  questions,
  onWrite,
}: {
  gap: GapDetail
  area: Area | undefined
  questions: ReadonlyMap<string, TestQuestion>
  onWrite: () => void
}) {
  if (!gap.canManage)
    return (
      <RailSection title="Test" icon={FlaskConicalIcon}>
        <p className="text-dense text-muted-foreground">
          Only the owners of {area?.name ?? 'its domain'} and admins link tests to it.
        </p>
      </RailSection>
    )
  if (!gap.topic.areaIds.length)
    return (
      <RailSection title="Test" icon={FlaskConicalIcon}>
        <p className="text-dense text-muted-foreground">
          A topic with no domain has no tests. Link them to a gap of one domain.
        </p>
      </RailSection>
    )
  return (
    <RailSection
      title="Test"
      icon={FlaskConicalIcon}
      description="A linked test checks the gap once it passes after the gap is resolved."
    >
      <LinkTest gap={gap} area={area} questions={questions} />
      {gap.topic.areaId !== null ? (
        <Button variant="outline" className={actionClass} onClick={onWrite}>
          <PencilLineIcon aria-hidden="true" />
          Write a test from this gap
        </Button>
      ) : null}
    </RailSection>
  )
}

type Group = { value: string; items: TestQuestion[] }

function LinkTest({
  gap,
  area,
  questions,
}: {
  gap: GapDetail
  area: Area | undefined
  questions: ReadonlyMap<string, TestQuestion>
}) {
  const inputId = useId()
  const link = useApiWrite('linkGapTest')
  const linking = usePendingIndicator(link.isPending)
  const [chosen, setChosen] = useState<TestQuestion | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { onScope, others } = linkCandidates(
    gap,
    questions.values(),
    (gap.tests ?? []).map((test) => test.question),
  )
  const domain = area?.name ?? 'its domains'
  const groups: Group[] = [
    ...(onScope.length ? [{ value: 'On the gap’s scope', items: onScope }] : []),
    ...(others.length
      ? [
          {
            value: `${onScope.length ? 'Other test questions' : 'Test questions'} of ${domain}`,
            items: others,
          },
        ]
      : []),
  ]
  if (!groups.length)
    return (
      <p className="text-dense text-muted-foreground">
        {questions.size && [...questions.values()].some((q) => gap.topic.areaIds.includes(q.area))
          ? `Every active test question of ${domain} is linked.`
          : gap.topic.areaId === null
            ? 'None of its domains has a test question yet.'
            : `${domain} has no test question yet. Write one from this gap.`}
      </p>
    )
  const submit = async () => {
    if (!chosen || link.isPending) return
    setFailure(null)
    try {
      await link.mutateAsync({ id: gap.id, question: chosen.id })
      showToast('The test is linked', 'The next run tests it for the gap.')
      setChosen(null)
    } catch (error) {
      setFailure(refusalText(error))
    }
  }
  return (
    <Field invalid={Boolean(failure)} className="gap-2">
      <FieldLabel htmlFor={inputId}>Link a test question</FieldLabel>
      <Combobox
        items={groups}
        value={chosen}
        onValueChange={(next: TestQuestion | null) => {
          setChosen(next)
          setFailure(null)
        }}
        itemToStringLabel={(question: TestQuestion) => questionTitle(question, question.id)}
        isItemEqualToValue={(a: TestQuestion, b: TestQuestion) => a.id === b.id}
      >
        <ComboboxInput id={inputId} placeholder="Find a test question" size="lg" />
        <ComboboxContent className="w-popover">
          <ComboboxEmpty>No test question of {domain} has those words.</ComboboxEmpty>
          <ComboboxList>
            {(group: Group) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.value}</ComboboxLabel>
                <ComboboxCollection>
                  {(question: TestQuestion) => (
                    <ComboboxItem key={question.id} value={question}>
                      <span className="min-w-0 break-words">
                        {questionTitle(question, question.id)}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {failure ? (
        <p role="alert" className="text-dense text-destructive">
          {failure}
        </p>
      ) : (
        <FieldDescription>Those on the gap’s topic come first.</FieldDescription>
      )}
      <Button
        variant="outline"
        className={actionClass}
        aria-disabled={!chosen || link.isPending || undefined}
        onClick={() => void submit()}
      >
        {linking ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        ) : (
          <LinkIcon aria-hidden="true" />
        )}
        Link the test
      </Button>
    </Field>
  )
}

/** A linked test's newest result: the verdict, and the run and edition it came from. */
function Newest({ test, linkTo }: { test: GapTest; linkTo: LinkTo }) {
  if (!test.latest)
    return (
      <p className="text-dense text-muted-foreground">Not tested by a weekly or full run yet.</p>
    )
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-2 text-dense">
      <VerdictBadge verdict={test.latest.verdict} size="sm" />
      <span className="text-muted-foreground">
        In the{' '}
        <RecordLink linkTo={linkTo} record={`run:${test.latest.run}`} className="underline">
          {runKindWords[test.latest.kind].toLowerCase()} of {formatDay(test.latest.finishedAt)}
        </RecordLink>
      </span>
    </p>
  )
}

/**
 * The tests linked to a gap with their newest result, for its managers, and Unlink. Its first pass
 * on the resolving edition or a later one counts towards the verification; a set-aside question
 * does not count.
 */
export function LinkedTests({
  gap,
  questions,
  linkTo,
}: {
  gap: GapDetail
  questions: ReadonlyMap<string, TestQuestion>
  linkTo: LinkTo
}) {
  const unlink = useApiWrite('unlinkGapTest')
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const title = 'Tests linked to it'
  if (gap.tests === null)
    return (
      <RecordSection title={title} icon={FlaskConicalIcon}>
        <p className="text-body text-muted-foreground">
          Only the owners of this domain and admins see which tests check it.
        </p>
      </RecordSection>
    )
  if (!gap.topic.areaIds.length) return null
  const remove = async (question: string, name: string) => {
    setUnlinking(question)
    try {
      await unlink.mutateAsync({ id: gap.id, question })
      showToast('Test unlinked', `${name} no longer counts for this gap.`)
    } catch (error) {
      showToast("Couldn't unlink the test", refusalText(error))
    } finally {
      setUnlinking(null)
    }
  }
  return (
    <RecordSection title={title} icon={FlaskConicalIcon}>
      {gap.tests.length === 0 ? (
        <p className="text-body text-muted-foreground">
          No test is linked yet. Link a test question that captures the gap, or write one from it.
          Once the gap is resolved, a passing run checks it.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-label="Linked tests">
          {gap.tests.map((test) => {
            const name = questionTitle(questions.get(test.question), test.question)
            return (
              <li
                key={test.question}
                className="flex min-w-0 items-start gap-3 p-3"
                data-slot="linked-test"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <RecordLink
                      linkTo={linkTo}
                      record={`question:${test.question}`}
                      className="min-w-0 text-body font-bold break-words"
                    >
                      {name}
                    </RecordLink>
                    {test.split === 'held_out' ? (
                      <Badge form="outline" size="sm" icon={SplitIcon}>
                        Hidden
                      </Badge>
                    ) : null}
                    {test.active ? null : (
                      <Badge tone="warning" size="sm" icon={CircleSlashIcon}>
                        Set aside, doesn&apos;t count
                      </Badge>
                    )}
                  </div>
                  <Newest test={test} linkTo={linkTo} />
                  <p className="text-caption text-muted-foreground">
                    {test.passed ? (
                      <>
                        Passed {formatDay(test.passed.hour)}. Linked {formatDay(test.linkedHour)}.
                      </>
                    ) : (
                      <>Linked {formatDay(test.linkedHour)}.</>
                    )}
                  </p>
                </div>
                {gap.canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Unlink ${name}`}
                    aria-disabled={unlinking !== null || undefined}
                    onClick={() => {
                      if (unlinking === null) void remove(test.question, name)
                    }}
                  >
                    {unlinking === test.question ? (
                      <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                    ) : (
                      <UnlinkIcon aria-hidden="true" />
                    )}
                    Unlink
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </RecordSection>
  )
}

/**
 * The gaps a test question is linked to (Workbench plan, V5), read from the gaps of its domain,
 * for whoever maintains it: each gap's status and whether it is verified by test.
 */
export function LinkedGaps({
  question,
  gaps,
  linkTo,
}: {
  question: TestQuestion
  /** The gaps the person can see, from the gap list; undefined while they load. */
  gaps: readonly Gap[] | undefined
  linkTo: LinkTo
}) {
  const vocabulary = useQuery(vocabularyQuery())
  const ofDomain = (gaps ?? []).filter((gap) => gap.topic.areaIds.includes(question.area))
  const details = useQueries({ queries: ofDomain.map((gap) => gapQuery(gap.id)) })
  const loading = gaps === undefined || details.some((read) => read.isPending)
  const linked = details.flatMap((read) =>
    read.data?.tests?.some((test) => test.question === question.id) ? [read.data] : [],
  )
  return (
    <RecordSection title="Gaps it checks" icon={BadgeCheckIcon}>
      {loading ? (
        <Skeleton
          role="status"
          aria-label="Loading the linked gaps"
          className="h-control-lg w-full"
        />
      ) : linked.length === 0 ? (
        <p className="text-body text-muted-foreground">
          Not linked to a gap. Link it from a gap’s record. Once the gap is resolved, a passing run
          of this question checks it.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Linked gaps">
          {linked.map((gap) => {
            const view = gapVerificationView(gap)
            return (
              <li
                key={gap.id}
                className="flex min-w-0 flex-wrap items-center gap-2"
                data-slot="linked-gap"
              >
                <RecordLink
                  linkTo={linkTo}
                  record={`gap:${gap.id}`}
                  className="text-body font-bold"
                >
                  {topicTitle(gap.topic, vocabulary.data)}
                </RecordLink>
                <GapStatusBadge status={gap.status} size="sm" />
                {view.state === 'verified' ? (
                  <VerifiedBadge size="sm" />
                ) : view.state === 'waiting' ? (
                  <span className="text-dense text-muted-foreground">Not checked yet</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </RecordSection>
  )
}
