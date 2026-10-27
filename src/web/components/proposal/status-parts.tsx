import { useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { previewItemId } from '@domain/served-review'
import { toApiError, type ProposalRecord } from '@/api'
import {
  areasQuery,
  libraryQuery,
  peopleQuery,
  proposalEventsQuery,
  proposalOverlapQuery,
  proposalPreviewQuery,
  proposalQuery,
  reviewQuery,
  useApiWrite,
} from '@/api/queries'
import { useDomainOf, useQuestionAbout } from '@/components/context/context-companion'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  CalendarCheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  FilePenIcon,
  GitCommitHorizontalIcon,
  HashIcon,
  InfoIcon,
  MessageSquareIcon,
  PencilIcon,
  PencilLineIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TimerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  type Icon,
} from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { DomainBadge, KindBadge, ProposalStatusBadge } from '@/components/item/item-marks'
import { RailSection } from '@/components/page/page-rail'
import { AgentPreview } from '@/components/proposal/agent-preview'
import { CheckOutcomes, GateResult } from '@/components/proposal/gate-result'
import { OverlapList } from '@/components/proposal/overlap-list'
import { AttachedTests } from '@/components/proposal/attached-tests'
import { PartCard } from '@/components/proposal/part-card'
import { PersonChip } from '@/components/proposal/person-chip'
import { ProposalFields } from '@/components/proposal/proposal-fields'
import { Discussion } from '@/components/proposal/discussion'
import { Quote, Said } from '@/components/proposal/said'
import { Timeline, TimelineEvent, TimelineSkeleton } from '@/components/proposal/timeline'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { previewInput } from '@/lib/context-form'
import { forgetDraftBackup } from '@/lib/discarding'
import { formatDay, formatMoment } from '@/lib/library'
import {
  buildActivity,
  historyRows,
  latestDecision,
  proposalSteps,
  withdrawal,
} from '@/lib/proposal-activity'
import {
  channelNames,
  draftFindingNotes,
  editLinkOf,
  openIssueReviewDays,
  proposalActions,
  proposalTitle,
} from '@/lib/proposals'
import { showToast } from '@/lib/toast'
import { usePermissions, useSession } from '@/lib/use-session'
import { lastDayFromEnd } from '@/lib/validity-range'

/*
  What a proposal in status mode is made of (frame B of the front end plan, slice W4): where it
  stands for the person who wrote it. The status page and the status panel of the Proposals page
  (design round 3, direction A) both build on these parts: the badges, the people, the
  reviewer's word, the activity with the reply, the fields, what an agent would answer, the
  checks, the overlaps and the details, and the actions (Continue editing, Edit and resubmit,
  Withdraw, Discard draft) with their dialogs.
*/

const firstName = (name: string) => name.split(' ')[0] ?? name

/** Runs a change on the proposal's newest revision when a comment moved it on meanwhile (G14). */
function useFreshRevision(id: string) {
  const queryClient = useQueryClient()
  return async <T,>(revision: number, change: (revision: number) => Promise<T>) => {
    try {
      return await change(revision)
    } catch (error) {
      const failure = toApiError(error)
      if (failure.kind !== 'conflict') throw error
      const fresh =
        failure.current ?? (await queryClient.fetchQuery({ ...proposalQuery(id), staleTime: 0 }))
      if (!fresh || fresh.revision === revision) throw error
      return change(fresh.revision)
    }
  }
}

function withdrawFailure(error: unknown): string {
  const failure = toApiError(error)
  if (failure.kind === 'conflict')
    return "It was decided in the meantime, so you can't withdraw it now. Reload the page to see the decision."
  if (failure.kind === 'invalid') return 'Write the reason as plain text, without @ mentions.'
  return "We couldn't withdraw it. Try again."
}

export function useProposalStatus(proposal: ProposalRecord) {
  const { data: session } = useSession()
  const permissions = usePermissions()
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { data: library } = useQuery(libraryQuery())
  const events = useQuery(proposalEventsQuery(proposal.id))
  const review = useQuery(reviewQuery(proposal.id))
  const overlap = useQuery(proposalOverlapQuery(proposal.id, proposal.revision))
  const withdraw = useApiWrite('withdrawProposal')
  const discard = useApiWrite('discardDraft')
  const fresh = useFreshRevision(proposal.id)
  const [withdrawing, setWithdrawing] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const viewerId = session?.person.id ?? ''
  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? null
  const area = areas.find((candidate) => candidate.id === proposal.areaId)
  const draft = proposal.draft
  const author = proposal.proposerId === viewerId
  const actions = proposalActions(proposal.state, {
    author,
    reviewer: permissions.canReview(proposal.areaId),
  })
  const reviewerId = proposal.claimedBy ?? draft.ownerId ?? area?.ownerIds[0] ?? null
  const reviewerName = reviewerId ? nameOf(reviewerId) : null
  // The discussion is for the proposer and the reviewers of its domain (FR-222).
  const reviews = permissions.capacitiesIn(proposal.areaId).length > 0 || permissions.isAdmin
  const gate = review.data?.gate ?? null
  const risk = draft.riskLevel ?? review.data?.proposal.riskLevel ?? null
  const eventList = events.data ?? []
  const libraryItems = new Map((library?.items ?? []).map((item) => [item.id, item]))

  /** The primary action: Edit and send again when changes were asked, Continue editing a draft. */
  const primary =
    actions.primary === 'resubmit'
      ? 'Edit and send again'
      : actions.primary === 'continue'
        ? 'Continue editing'
        : null
  const secondary: { label: string; icon: Icon; open: () => void } | null = actions.withdraw
    ? { label: 'Withdraw', icon: Undo2Icon, open: () => setWithdrawing(true) }
    : actions.discard
      ? { label: 'Discard draft', icon: Trash2Icon, open: () => setDiscarding(true) }
      : null

  return {
    proposal,
    viewerId,
    areas,
    library,
    events,
    review,
    overlap: {
      isError: overlap.isError,
      isPending: overlap.isPending,
      refetch: overlap.refetch,
      data: overlap.data
        ? {
            ...overlap.data,
            accepted: overlap.data.accepted.map((item) => {
              const entry = libraryItems.get(item.id)
              const domain = areas.find((candidate) => candidate.id === entry?.areaId)
              return { ...item, kind: entry?.kind, domain }
            }),
          }
        : undefined,
    },
    nameOf,
    area,
    draft,
    title: proposalTitle(proposal),
    author,
    actions,
    reviewerId,
    reviewerName,
    reviews,
    gate,
    risk,
    eventList,
    steps: proposalSteps(proposal, eventList, gate, { viewerId, nameOf }),
    activity: buildActivity(eventList, { viewerId, nameOf, proposal }),
    issueDays: openIssueReviewDays(draft),
    editLink: editLinkOf(proposal),
    primary,
    secondary,
    who: (id: string | null) =>
      !id ? 'The owner' : id === viewerId ? 'You' : (nameOf(id) ?? 'The owner'),
    dialogs: { withdrawing, setWithdrawing, discarding, setDiscarding },
    writes: { withdraw, discard, fresh },
  }
}

export type ProposalStatus = ReturnType<typeof useProposalStatus>

type Part = { status: ProposalStatus }

/** The proposal's badges: its kind, domain, state, risk and, for an issue, its end. */
export function StatusBadges({ status }: Part) {
  const { draft, area, proposal, risk } = status
  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="proposal-badges">
      <KindBadge kind={draft.kind ?? 'note'} />
      {area ? <DomainBadge name={area.name} label={area.label} /> : null}
      <ProposalStatusBadge state={proposal.state} />
      {risk ? <RiskBadge level={risk} /> : null}
      {draft.kind === 'issue' && draft.validity?.start ? (
        <Badge form="outline" icon={TimerIcon} data-slot="issue-chip">
          {draft.validity.end === null
            ? 'Still going on, no end date'
            : `Ended ${formatDay(lastDayFromEnd(draft.validity.end) ?? draft.validity.end)}`}
        </Badge>
      ) : null}
    </div>
  )
}

/** Who wrote it, who reviews it, and where it was written. */
export function StatusPeople({ status }: Part) {
  const { proposal, reviewerId, nameOf, viewerId } = status
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PersonChip
        role="proposer"
        personId={proposal.proposerId}
        name={nameOf(proposal.proposerId) ?? 'Someone'}
        you={status.author}
        date={proposal.createdAt}
      />
      {reviewerId ? (
        <PersonChip
          role={proposal.claimedBy ? 'claimed' : 'reviewer'}
          personId={reviewerId}
          name={nameOf(reviewerId) ?? 'The owner'}
          you={reviewerId === viewerId}
        />
      ) : null}
      {proposal.provenance ? null : (
        <Badge form="outline" icon={PencilLineIcon}>
          {channelNames[proposal.channel]}
        </Badge>
      )}
    </div>
  )
}

/** The edit link as a button: Continue editing or Edit and resubmit. */
export function StatusEditButton({
  status,
  label,
  size = 'default',
  variant,
  className,
}: Part & {
  label: string
  size?: 'default' | 'touch'
  variant?: 'outline'
  className?: string
}) {
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      render={<Link {...status.editLink} />}
      nativeButton={false}
    >
      <PencilIcon />
      {label}
    </Button>
  )
}

/** What the reviewer said, or where the proposal ended, as one alert. */
export function StatusWord({ status }: Part) {
  const { proposal, eventList, who, author, area, library } = status
  const asked = latestDecision(eventList, 'request_changes')
  const rejected = latestDecision(eventList, 'reject')
  const accepted = latestDecision(eventList, 'accept')
  const withdrawn = withdrawal(eventList)
  if (proposal.state === 'changes_requested' && asked)
    return (
      <Alert variant="warning" data-slot="decision-alert">
        <MessageSquareIcon aria-hidden="true" />
        <AlertContent>
          <AlertTitle>
            <Said who={who(asked.actorId)} what="asked for changes" at={asked.at} />
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            {asked.reason ? <Quote>{asked.reason}</Quote> : null}
            {author ? (
              <div className="flex flex-wrap items-center gap-3">
                <StatusEditButton
                  status={status}
                  label="Edit and send again"
                  variant="outline"
                  className="bg-background"
                />
                <span className="text-caption">You can also reply below first.</span>
              </div>
            ) : null}
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  if (proposal.state === 'rejected' && rejected)
    return (
      <Alert variant="danger" data-slot="decision-alert">
        <CircleXIcon aria-hidden="true" />
        <AlertContent>
          <AlertTitle>
            <Said who={who(rejected.actorId)} what="rejected it" at={rejected.at} />
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {rejected.reason ? <Quote>{rejected.reason}</Quote> : null}
            <p>Agents never get it. The reason stays with the proposal.</p>
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  if (proposal.state === 'withdrawn')
    return (
      <Alert data-slot="decision-alert">
        <Undo2Icon aria-hidden="true" />
        <AlertContent>
          <AlertTitle>
            {withdrawn ? (
              <Said who={who(proposal.proposerId)} what="withdrew it" at={withdrawn.at} />
            ) : (
              'Withdrawn'
            )}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {withdrawn?.reason ? <Quote>{withdrawn.reason}</Quote> : null}
            <p>It left the review, and agents never get it.</p>
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  if (proposal.state === 'accepted' && accepted) {
    const inLibrary =
      proposal.itemId !== null && library?.items.some((item) => item.id === proposal.itemId)
    return (
      <Alert data-slot="decision-alert">
        <CircleCheckIcon aria-hidden="true" />
        <AlertContent>
          <AlertTitle>
            <Said who={who(accepted.actorId)} what="accepted it" at={accepted.at} />
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {accepted.reason ? <Quote>{accepted.reason}</Quote> : null}
            <p>Agents get it.</p>
            {inLibrary && proposal.itemId ? (
              <div>
                <Button
                  variant="outline"
                  render={<Link to="/library/$itemId" params={{ itemId: proposal.itemId }} />}
                  nativeButton={false}
                  className="bg-background"
                >
                  Open the fact
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  }
  if (proposal.state === 'draft')
    return (
      <Alert variant="info" data-slot="decision-alert">
        <FilePenIcon aria-hidden="true" />
        <AlertContent>
          <AlertTitle>Not sent yet</AlertTitle>
          <AlertDescription>
            <p>
              Only you can see this draft. It saves as you write. Send it for review when it&apos;s
              ready, and an owner of {area?.name ?? 'its domain'} will look at it.
            </p>
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  return null
}

/** An open issue with no end date: when we ask again whether it is still going on. */
export function StatusIssueNote({ status }: Part) {
  const { issueDays, proposal } = status
  const open =
    issueDays !== null &&
    (proposal.state === 'draft' ||
      proposal.state === 'submitted' ||
      proposal.state === 'in_review' ||
      proposal.state === 'changes_requested')
  if (!open) return null
  return (
    <Alert variant="info" data-slot="issue-note">
      <InfoIcon aria-hidden="true" />
      <AlertContent>
        <AlertDescription>
          <p>
            No end date yet. Once it&apos;s accepted, we ask again in {issueDays} days:{' '}
            <b className="font-bold">“Is this still going on?”</b>
          </p>
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}

/** The checks: the format check of a draft, or the gate once it was sent. */
export function StatusChecks({
  status,
  variant,
  headingLevel = 2,
}: Part & { variant: 'folded' | 'card'; headingLevel?: 2 | 3 }) {
  const { proposal, review, gate, risk } = status
  if (proposal.state === 'draft')
    return (
      <GateResult
        gate={{
          required: ['format'],
          levels: [
            {
              level: 'format',
              outcome: proposal.findings.some((finding) => finding.severity === 'error')
                ? 'failed'
                : 'passed',
              ranAt: proposal.updatedAt,
              details: { findings: draftFindingNotes(proposal.findings) },
            },
          ],
        }}
        action={
          <span className="text-caption text-muted-foreground">
            The other checks run when you send it for review.
          </span>
        }
        variant={variant}
        headingLevel={headingLevel}
      />
    )
  if (review.isError)
    return (
      <PartCard title="Checks" headingLevel={headingLevel}>
        <p className="text-dense">We couldn&apos;t load the checks.</p>
        <div>
          <Button variant="outline" onClick={() => void review.refetch()}>
            <RefreshCwIcon />
            Try again
          </Button>
        </div>
      </PartCard>
    )
  if (review.isPending)
    return (
      <PartCard title="Checks" headingLevel={headingLevel}>
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading the checks</span>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </PartCard>
    )
  if (gate)
    return (
      <GateResult
        gate={gate}
        risk={risk}
        aside={risk ? <RiskBadge level={risk} size="sm" /> : undefined}
        variant={variant}
        headingLevel={headingLevel}
      />
    )
  return (
    <PartCard title="Checks" headingLevel={headingLevel}>
      <p className="text-dense">No check results yet.</p>
    </PartCard>
  )
}

/** The test questions attached to the proposal's check, reported with it (FR-524). */
export function StatusAttachedTests({ status, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  return (
    <AttachedTests
      proposal={status.proposal}
      results={status.gate?.attached}
      headingLevel={headingLevel}
    />
  )
}

/** The accepted items and other proposals that overlap this one. */
export function StatusOverlaps({ status, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  const { overlap } = status
  if (overlap.isError)
    return (
      <PartCard title="Overlaps" headingLevel={headingLevel}>
        <p className="text-dense">We couldn&apos;t load the overlaps.</p>
        <div>
          <Button variant="outline" onClick={() => void overlap.refetch()}>
            <RefreshCwIcon />
            Try again
          </Button>
        </div>
      </PartCard>
    )
  return (
    <OverlapList
      loading={overlap.isPending}
      limit={5}
      overlap={overlap.data}
      headingLevel={headingLevel}
    />
  )
}

/** The proposal's number, revision, channel, due day and next check. */
export function StatusDetails({ status, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  const { proposal, draft, issueDays } = status
  const waiting = proposal.state === 'submitted' || proposal.state === 'in_review'
  return (
    <RailSection title="Details" headingLevel={headingLevel}>
      <FieldTable label="Details">
        <FieldRow icon={HashIcon} label="Proposal">
          <span className="tabular-nums">#{proposal.number}</span>
        </FieldRow>
        <FieldRow icon={GitCommitHorizontalIcon} label="Revision">
          <span className="tabular-nums">{proposal.revision}</span>
        </FieldRow>
        <FieldRow icon={PencilLineIcon} label="Written">
          {channelNames[proposal.channel]}
        </FieldRow>
        {proposal.dueAt && proposal.state !== 'draft' ? (
          <FieldRow
            icon={TimerIcon}
            label="Review due"
            hint={
              proposal.state === 'changes_requested'
                ? 'Paused while changes are requested.'
                : waiting
                  ? undefined
                  : 'The review is over.'
            }
          >
            <time
              dateTime={proposal.dueAt}
              title={formatMoment(proposal.dueAt, 'long')}
              className="tabular-nums"
            >
              {formatMoment(proposal.dueAt)}
            </time>
          </FieldRow>
        ) : null}
        {draft.reviewDate ? (
          <FieldRow
            icon={CalendarCheckIcon}
            label="Check again by"
            hint={
              issueDays !== null
                ? "An owner asks whether it's still going on."
                : "An owner checks that it's still correct by then."
            }
          >
            <span className="tabular-nums">{formatDay(draft.reviewDate)}</span>
          </FieldRow>
        ) : null}
      </FieldTable>
    </RailSection>
  )
}

/** The discussion with its composer (FR-222), then the timeline of everything that happened. */
export function StatusActivity({ status, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  const { events, activity, actions, proposal, author, reviewerName, nameOf, area, viewerId } =
    status
  const writer = firstName(nameOf(proposal.proposerId) ?? 'the writer')
  const reviewer = reviewerName ? firstName(reviewerName) : null
  // Who discusses a proposal reads its discussion; anyone else reads the history only.
  const discusses = author || actions.reply || status.reviews
  const historyId = useId()
  const History = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className="flex flex-col gap-8">
      {discusses && !events.isError ? (
        <Discussion
          events={events.data}
          pending={events.isPending}
          proposerId={proposal.proposerId}
          area={area ?? null}
          nameOf={nameOf}
          viewerId={viewerId}
          headingLevel={headingLevel}
          audience={`Only ${author ? 'you' : writer}, the owners of ${area?.name ?? 'its domain'} and admins can read this.`}
          composer={
            actions.reply
              ? {
                  proposal,
                  title: author ? `Reply to ${reviewer ?? 'the owner'}` : `Comment for ${writer}`,
                  notice: author
                    ? `${reviewer ?? 'The owner'} is notified in the app.`
                    : `${writer} is notified in the app.`,
                  action: author ? 'Send reply' : 'Send comment',
                }
              : null
          }
        />
      ) : null}
      <section aria-labelledby={historyId} className="flex flex-col gap-4">
        <History id={historyId} className="text-large font-bold">
          History
        </History>
        {events.isError ? (
          <Alert variant="danger" role="alert">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertContent>
              <AlertTitle>We couldn&apos;t load the activity</AlertTitle>
              <AlertDescription>
                <Button variant="outline" onClick={() => void events.refetch()}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              </AlertDescription>
            </AlertContent>
          </Alert>
        ) : events.isPending ? (
          <TimelineSkeleton />
        ) : (
          <Timeline aria-label="History">
            {(discusses ? historyRows(activity) : activity).map((row) => (
              <TimelineEvent
                key={row.id}
                kind={row.kind}
                tone={row.tone}
                actor={row.actor}
                action={row.action}
                at={row.at}
                detail={row.detail}
                body={row.body}
              >
                {row.checks ? <CheckOutcomes gate={row.checks} /> : null}
              </TimelineEvent>
            ))}
          </Timeline>
        )}
      </section>
    </div>
  )
}

/** What the proposal says, field by field. */
export function StatusFields({ status }: Part) {
  return (
    <ProposalFields
      draft={status.draft}
      diff={status.review.data?.diff ?? null}
      change={status.proposal.action === 'change'}
      areas={status.areas}
      provenance={status.proposal.provenance}
    />
  )
}

/** The What an agent would answer tab: the reply for the proposal's own scope and first day. */
export function ProposalPreview({
  proposal,
  headingLevel = 2,
}: {
  proposal: ProposalRecord
  /** h3 in the docked panel, whose title is the h2. */
  headingLevel?: 2 | 3
}) {
  const ready = !proposal.findings.some((finding) => finding.severity === 'error')
  const preview = useQuery({
    ...proposalPreviewQuery(previewInput(proposal), proposal.revision),
    enabled: ready,
  })
  const about = useQuestionAbout()
  const domainOf = useDomainOf(proposal)
  return (
    <div className="flex flex-col gap-3">
      <AgentPreview
        draftItemId={previewItemId(proposal)}
        state={ready ? (preview.isPending ? 'loading' : 'ready') : 'waiting'}
        result={preview.data?.result}
        about={ready ? about(proposal.draft.scope, proposal.draft.validity?.start) : []}
        published={proposal.state === 'accepted'}
        domainOf={domainOf}
        waitingFor="Shows once the draft is complete. Keep editing to fix what the check found."
        headingLevel={headingLevel}
      />
      {preview.isError && ready ? (
        <p role="alert" className="text-dense text-status-danger-fg">
          We couldn&apos;t load the preview.{' '}
          <Button variant="link" onClick={() => void preview.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
      <p className="flex gap-2 text-caption text-muted-foreground">
        <ShieldCheckIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
        Agents would get this reply for a question about exactly where it applies, on its first day.
      </p>
    </div>
  )
}

/** The withdraw and discard dialogs. A discarded draft is gone: `onDiscarded` says where to go. */
export function StatusDialogs({
  status,
  onDiscarded,
}: Part & {
  onDiscarded?: () => void
}) {
  const navigate = useNavigate()
  const { proposal, dialogs, writes, reviewerName, viewerId } = status
  const done = async () => {
    if (onDiscarded) onDiscarded()
    else await navigate({ to: '/proposals' })
  }
  return (
    <>
      <ConfirmDialog
        open={dialogs.withdrawing}
        onOpenChange={dialogs.setWithdrawing}
        title="Withdraw this proposal?"
        effect="It leaves the review, and agents never get it. To send it again later, start a new proposal."
        action="Withdraw"
        actionIcon={Undo2Icon}
        tone="destructive"
        reason={{
          label: 'Why are you withdrawing it?',
          required: true,
          hint: `${reviewerName ? firstName(reviewerName) : 'The owner'} reads this. Plain text only.`,
        }}
        onConfirm={async ({ reason }) => {
          try {
            await writes.fresh(proposal.revision, (revision) =>
              writes.withdraw.mutateAsync({ id: proposal.id, revision, reason }),
            )
          } catch (error) {
            throw new Error(withdrawFailure(error), { cause: error })
          }
          showToast('Proposal withdrawn', 'Agents never got it.')
        }}
      />
      <ConfirmDialog
        open={dialogs.discarding}
        onOpenChange={dialogs.setDiscarding}
        title="Discard this draft?"
        effect="Nobody else has seen it. This cannot be undone."
        action="Discard draft"
        actionIcon={Trash2Icon}
        tone="destructive"
        onConfirm={async () => {
          try {
            await writes.fresh(proposal.revision, (revision) =>
              writes.discard.mutateAsync({ id: proposal.id, revision }),
            )
          } catch (error) {
            throw new Error(toApiError(error).message || "We couldn't discard the draft.", {
              cause: error,
            })
          }
          forgetDraftBackup(viewerId, proposal)
          showToast('Draft discarded')
          await done()
        }}
      />
    </>
  )
}
