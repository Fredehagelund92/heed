import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueries } from '@tanstack/react-query'
import type { ProposalState } from '@domain/proposal-state'
import type { Area } from '@domain/item'
import type { ContextItem } from '@domain/item'
import type { EvalRun, Gap, GapDetail, QuestionComparison, TestQuestion } from '@/api'
import {
  DraftDomainField,
  DraftLink,
  GapStatusDialog,
  StartDraftButton,
  StartDraftFailure,
  statusMove,
  statusMoves,
  useStartDraft,
  type GapMove,
} from '@/components/gaps/gap-body'
import { proposalListQuery, proposalQuery, proposalTestsQuery, useApiWrite } from '@/api/queries'
import { GapStatusBadge } from '@/components/gaps/gap-marks'
import {
  CheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleStopIcon,
  FileTextIcon,
  FilePenIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  PencilIcon,
  PencilLineIcon,
  PlayIcon,
  RotateCcwIcon,
} from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { RailSection } from '@/components/page/page-rail'
import { SetAsideDialog } from '@/components/quality/question-body'
import { refusalText } from '@/components/quality/question-dialog'
import { ended, RunDecision, type RunDecisionAction } from '@/components/quality/run-body'
import { Button } from '@/components/ui/button'
import { TruncatedText } from '@/components/ui/truncated-text'
import { formatMoment } from '@/lib/library'
import { proposalTitle } from '@/lib/proposals'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import type { LinkTo } from '@/components/quality/panel-parts'
import { GapTestActions, GapVerification } from './gap-tests'

/*
  Health's action panel (Workbench plan, 3.2 and slice W6b): beside the open record, what the
  person can do about it. Test: write, change or set aside a test question and run its
  domain, with the dialogs Quality uses. Correction: suggest a change to an item that changed
  between the two runs' editions, the open changes to those items and the drafts already started
  from a gap on the same scope, to which the question is attached so their checks report it (V6,
  FR-524).
  Run: cancel a run, or approve one over the budget. For a gap (W6c), Gap: its status and the
  owner's changes with a reason; Correction: Start a draft and the drafts it started. For an
  item, Item: open it or suggest a change; Test: write a test question for it. For a domain,
  State: where it is on its way to agents, which an administrator moves. Writing a change
  stays its own page (the change form and Proposals); the panel only leads there. The service
  checks every call; the panel offers only what the person may do.
*/

const actionClass = 'w-full min-w-0 justify-start'

/** Where every draft and proposal is reviewed. */
function ToProposals() {
  return (
    <Link
      to="/proposals"
      className="inline-flex items-center self-start text-dense underline-offset-3 hover:underline @max-md:min-h-control-touch pointer-coarse:min-h-control-touch"
      data-slot="to-proposals"
    >
      All proposals
    </Link>
  )
}

/** Who changes a domain's tests, said to anyone else. */
function NotYours({ area }: { area: Area | undefined }) {
  return (
    <p className="text-dense text-muted-foreground">
      Only the owners of {area?.name ?? 'this domain'} and admins change its test questions and run
      them.
    </p>
  )
}

/** A test question's actions: its test, and the correction of what made it fail. */
export function QuestionActions({
  question,
  area,
  maintains,
  changed,
  gaps,
  onEdit,
  onRun,
}: {
  question: TestQuestion
  area: Area | undefined
  maintains: boolean
  /** The items the question names or was given that changed between the two runs' editions. */
  changed: readonly QuestionComparison['items'][number][]
  /** The gaps on the question's scope (`gapsForScope`). */
  gaps: readonly Gap[]
  onEdit: () => void
  onRun: () => void
}) {
  const [settingAside, setSettingAside] = useState(false)
  const setAside = question.setAsideReason !== null
  const drafts = [...new Set(gaps.flatMap((gap) => gap.proposals))]
  const changes = useQueries({
    queries: changed.map((item) => proposalListQuery({ itemId: item.itemId, limit: 20 })),
  })
  const corrections = [
    ...new Set(
      changes.flatMap((read) =>
        (read.data?.rows ?? []).flatMap((proposal) =>
          undecided.includes(proposal.state) ? [proposal.id] : [],
        ),
      ),
    ),
  ].filter((id) => !drafts.includes(id))
  return (
    <>
      <RailSection title="Test" icon={FlaskConicalIcon}>
        {maintains ? (
          <div className="flex flex-col gap-2">
            <Button variant="outline" className={actionClass} onClick={onEdit}>
              <PencilIcon aria-hidden="true" />
              Edit the test question
            </Button>
            <Button variant="outline" className={actionClass} onClick={() => setSettingAside(true)}>
              {setAside ? (
                <RotateCcwIcon aria-hidden="true" />
              ) : (
                <CircleSlashIcon aria-hidden="true" />
              )}
              {setAside ? 'Bring it back' : 'Set it aside'}
            </Button>
            <Button variant="outline" className={actionClass} onClick={onRun}>
              <PlayIcon aria-hidden="true" />
              <TruncatedText text={`Run ${area?.name ?? 'the domain'}`} />
            </Button>
          </div>
        ) : (
          <NotYours area={area} />
        )}
      </RailSection>
      <RailSection
        title="Correction"
        icon={FilePenIcon}
        description="A correction changes a fact in a draft, which its owners review like any change."
      >
        {changed.length ? (
          <ul className="flex flex-col gap-3" aria-label="Facts to correct">
            {changed.map((item) => (
              <li key={item.itemId} className="flex min-w-0 flex-col gap-2">
                <span className="flex min-w-0 items-start gap-2 text-dense">
                  <KindIcon kind={item.kind} size="sm" />
                  <Link
                    to="/library/$itemId"
                    params={{ itemId: item.itemId }}
                    className="min-w-0 break-words underline-offset-3 hover:underline"
                  >
                    {item.title}
                  </Link>
                </span>
                <Button
                  variant="outline"
                  className={actionClass}
                  render={<Link to="/library/$itemId/suggest" params={{ itemId: item.itemId }} />}
                >
                  <PencilLineIcon aria-hidden="true" />
                  Suggest a change
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dense text-muted-foreground">
            None of the facts it names or got changed between the two runs.
          </p>
        )}
        {corrections.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-dense text-muted-foreground">Open changes to these facts</h3>
            <ul className="flex flex-col divide-y rounded-sm border" aria-label="Open changes">
              {corrections.map((id) => (
                <DraftLink key={id} id={id} />
              ))}
            </ul>
          </div>
        ) : null}
        {drafts.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-dense text-muted-foreground">Drafts from gaps on the same topic</h3>
            <ul className="flex flex-col divide-y rounded-sm border" aria-label="Drafts">
              {drafts.map((id) => (
                <DraftLink key={id} id={id} />
              ))}
            </ul>
          </div>
        ) : null}
        {corrections.length || drafts.length ? (
          <AttachToDrafts question={question} drafts={[...corrections, ...drafts]} />
        ) : null}
        <ToProposals />
      </RailSection>
      {settingAside ? (
        <SetAsideDialog question={question} onClose={() => setSettingAside(false)} />
      ) : null}
    </>
  )
}

/** A change that is not decided yet, so a test can still be reported with it. */
const undecided: readonly ProposalState[] = ['draft', 'changes_requested', 'submitted', 'in_review']

/**
 * Attach the record's test to the open changes to its items and the open drafts from gaps on its
 * scope (FR-524, Workbench plan V6), so their checks report it with the change. Offered for each draft the person may attach to: their
 * own while it is a draft, any until a decision for an owner, deputy or administrator of its
 * domain. A held-out question is never attached (FR-503), and a set-aside one is not checked.
 */
function AttachToDrafts({
  question,
  drafts,
}: {
  question: TestQuestion
  drafts: readonly string[]
}) {
  const { canAttachTests } = usePermissions()
  const proposals = useQueries({ queries: drafts.map((id) => proposalQuery(id)) })
  const open = proposals.flatMap((read) =>
    read.data && read.data.areaId === question.area && canAttachTests(read.data) ? [read.data] : [],
  )
  const attached = useQueries({ queries: open.map((proposal) => proposalTestsQuery(proposal.id)) })
  const attach = useApiWrite('attachProposalTest')
  const [attaching, setAttaching] = useState<string | null>(null)
  if (!open.length) return null
  if (question.split === 'held_out')
    return (
      <p className="text-dense text-muted-foreground">
        A hidden test question stays out of drafts.
      </p>
    )
  if (question.setAsideReason !== null)
    return (
      <p className="text-dense text-muted-foreground">
        It&apos;s set aside. Bring it back to attach it to a draft.
      </p>
    )
  const add = async (id: string, title: string) => {
    setAttaching(id)
    try {
      await attach.mutateAsync({ id, question: question.id })
      showToast('Test attached', `It shows with the checks of ${title}, and never blocks it.`)
    } catch (error) {
      showToast("Couldn't attach the test", refusalText(error))
    } finally {
      setAttaching(null)
    }
  }
  return (
    <div className="flex flex-col gap-2" data-slot="attach-to-drafts">
      {open.map((proposal, index) => {
        const title = proposalTitle(proposal)
        if (attached[index]?.data?.some((test) => test.question === question.id))
          return (
            <p key={proposal.id} className="flex items-start gap-2 text-dense">
              <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">
                Attached to {title}. It shows with its checks, and never blocks it.
              </span>
            </p>
          )
        return (
          <Button
            key={proposal.id}
            variant="outline"
            className={actionClass}
            aria-disabled={attaching !== null || !attached[index]?.data || undefined}
            onClick={() => {
              if (attaching === null && attached[index]?.data) void add(proposal.id, title)
            }}
          >
            {attaching === proposal.id ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <PaperclipIcon aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">Attach to {title}</span>
          </Button>
        )
      })}
    </div>
  )
}

/** A domain's actions: run it, and write a test question for it. */
export function DomainActions({
  area,
  maintains,
  onRun,
  onWrite,
}: {
  area: Area
  maintains: boolean
  onRun: () => void
  onWrite: () => void
}) {
  return (
    <>
      <RailSection title="Test" icon={FlaskConicalIcon}>
        {maintains ? (
          <div className="flex flex-col gap-2">
            <Button variant="outline" className={actionClass} onClick={onRun}>
              <PlayIcon aria-hidden="true" />
              <TruncatedText text={`Run ${area.name}`} />
            </Button>
            <Button variant="outline" className={actionClass} onClick={onWrite}>
              <PencilLineIcon aria-hidden="true" />
              Write a test question
            </Button>
          </div>
        ) : (
          <NotYours area={area} />
        )}
      </RailSection>
    </>
  )
}

/** A run's actions: cancel it while it runs, approve it over the budget, or run its domain again. */
export function RunActions({
  run,
  area,
  maintains,
  isAdmin,
  onRun,
}: {
  run: EvalRun
  area: Area | undefined
  maintains: boolean
  isAdmin: boolean
  onRun: () => void
}) {
  const [confirm, setConfirm] = useState<RunDecisionAction | null>(null)
  const may = run.areaId ? maintains : isAdmin
  const canCancel = !ended(run) && run.state !== 'estimated' && may
  const canApprove = isAdmin && run.state === 'awaiting_approval'
  // A run approved at the command line with a cost ceiling is resumed there, with its models.
  const canResume = run.state === 'incomplete' && run.costCeilingMicros === null && may
  return (
    <>
      <RailSection title="Run" icon={FlaskConicalIcon}>
        {canCancel || canApprove || canResume ? (
          <div className="flex flex-col gap-2">
            {canResume ? (
              <Button
                variant="outline"
                className={actionClass}
                onClick={() => setConfirm('resume')}
              >
                <RotateCcwIcon aria-hidden="true" />
                Resume run
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                variant="outline"
                className={actionClass}
                onClick={() => setConfirm('approve')}
              >
                <CheckIcon aria-hidden="true" />
                Approve
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="outline"
                className={actionClass}
                onClick={() => setConfirm('cancel')}
              >
                <CircleStopIcon aria-hidden="true" />
                Cancel run
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-dense text-muted-foreground">
            {ended(run)
              ? 'This run has ended. Its results stay as they are.'
              : 'Only the owners of its domain and admins stop a run.'}
          </p>
        )}
        {run.areaId && maintains ? (
          <Button variant="outline" className={actionClass} onClick={onRun}>
            <PlayIcon aria-hidden="true" />
            <TruncatedText text={`Run ${area?.name ?? 'the domain'} again`} />
          </Button>
        ) : null}
      </RailSection>
      {confirm ? <RunDecision run={run} action={confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  )
}

/**
 * A gap's actions (Workbench plan, W6c and V5). Gap: where it stands and, for an owner of its
 * domain or an administrator, the status changes with a reason (FR-609); anyone else reads it.
 * Verification: Resolved and Verified by test, two separate facts, and Run the domain while it
 * waits for a passing run (FR-610). Test: link a test question to it, or write one from it.
 * Correction: Start a draft for everyone (FR-616), with the domain asked first when the topic
 * spans domains, and the drafts the gap started.
 */
export function GapRecordActions({
  gap,
  area,
  areas,
  maintains,
  questions,
  linkTo,
  onRun,
  onWriteTest,
}: {
  gap: GapDetail
  /** The gap's domain; undefined when its topic spans domains, or the domain is not known. */
  area: Area | undefined
  /** Every domain, for a draft from a topic that spans domains. */
  areas: readonly Area[]
  /** The person runs the gap's domain. */
  maintains: boolean
  /** The test questions the person may read, by id. */
  questions: ReadonlyMap<string, TestQuestion>
  linkTo: LinkTo
  onRun: (area: string) => void
  onWriteTest: () => void
}) {
  const draft = useStartDraft(gap)
  const [move, setMove] = useState<GapMove | null>(null)
  return (
    <>
      <RailSection
        title="Gap"
        icon={CircleDashedIcon}
        aside={<GapStatusBadge status={gap.status} size="sm" />}
        description={`Since ${formatMoment(gap.statusSince)}.`}
      >
        {gap.canManage ? (
          <div className="flex flex-col gap-2">
            {statusMoves[gap.status].map((next) => {
              const look = statusMove[next]
              return (
                <Button
                  key={next}
                  variant="outline"
                  className={actionClass}
                  onClick={() => setMove(next)}
                >
                  <look.icon aria-hidden="true" />
                  {look.label}
                </Button>
              )
            })}
          </div>
        ) : (
          <p className="text-dense text-muted-foreground">
            Only the owners of {area?.name ?? 'its domain'} and admins change where it stands.
          </p>
        )}
      </RailSection>
      <GapVerification
        gap={gap}
        area={area}
        maintains={maintains}
        questions={questions}
        linkTo={linkTo}
        onRun={onRun}
      />
      <GapTestActions gap={gap} area={area} questions={questions} onWrite={onWriteTest} />
      <RailSection
        title="Correction"
        icon={FilePenIcon}
        description="A draft from the gap starts with its topic filled in. Its owners review it like any change."
      >
        {draft.spansDomains ? <DraftDomainField draft={draft} areas={areas} /> : null}
        <StartDraftButton draft={draft} className={actionClass} />
        <StartDraftFailure draft={draft} />
        {gap.proposals.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-dense text-muted-foreground">Drafts from this gap</h3>
            <ul className="flex flex-col divide-y rounded-sm border" aria-label="Drafts">
              {gap.proposals.map((id) => (
                <DraftLink key={id} id={id} />
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-dense text-muted-foreground">No draft from this gap yet.</p>
        )}
        <ToProposals />
      </RailSection>
      {move ? <GapStatusDialog gap={gap} move={move} onClose={() => setMove(null)} /> : null}
    </>
  )
}

/** An item's actions: open it or suggest a change, and write a test question for it. */
export function ItemRecordActions({
  item,
  area,
  maintains,
  onWrite,
}: {
  item: ContextItem
  area: Area | undefined
  maintains: boolean
  onWrite: () => void
}) {
  return (
    <>
      <RailSection
        title="Fact"
        icon={FileTextIcon}
        description="You read and change the fact on its own page."
      >
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className={actionClass}
            render={<Link to="/library/$itemId" params={{ itemId: item.id }} />}
          >
            <FileTextIcon aria-hidden="true" />
            Open the fact
          </Button>
          {item.status === 'retired' ? null : (
            <Button
              variant="outline"
              className={actionClass}
              render={<Link to="/library/$itemId/suggest" params={{ itemId: item.id }} />}
            >
              <PencilLineIcon aria-hidden="true" />
              Suggest a change
            </Button>
          )}
        </div>
      </RailSection>
      <RailSection title="Test" icon={FlaskConicalIcon}>
        {maintains ? (
          <Button variant="outline" className={actionClass} onClick={onWrite}>
            <PencilLineIcon aria-hidden="true" />
            Write a test question
          </Button>
        ) : (
          <NotYours area={area} />
        )}
      </RailSection>
    </>
  )
}
