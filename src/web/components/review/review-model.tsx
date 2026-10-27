import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { textFindings } from '@domain/draft'
import { parseMentions } from '@domain/mentions'
import type { Area } from '@domain/item'
import { toApiError, type ProposalRecord, type Review } from '@/api'
import {
  areasQuery,
  evalRunQuery,
  libraryQuery,
  peopleQuery,
  proposalEventsQuery,
  proposalOverlapQuery,
  queryKeys,
  reviewQuery,
  testQuestionsQuery,
  useApiWrite,
  vocabularyQuery,
} from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { Undo2Icon } from '@/components/icons'
import { targetsByKey } from '@/lib/mention-targets'
import { markDeciding, useDeciding } from '@/lib/deciding'
import { buildActivity } from '@/lib/proposal-activity'
import { proposalStateNames, proposalTitle, refusedTextMessage } from '@/lib/proposals'
import {
  changeTypeOf,
  decisionBar,
  reviewersOf,
  savingBar,
  ownerFieldsOf,
  underReview,
  type DecisionOutcome,
} from '@/lib/review'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import { useMentionTargets } from '@/lib/use-mention-targets'
import type { CheckDetailLookups } from './check-details'
import { DecisionDialogs, type DecisionDialogCopy } from './decision-bar'
import { OwnerEditDialog, type OwnerEditBlock } from './owner-edit'

/*
  What a proposal in review mode is made of (frame C2 of the front end plan): the reads, the
  facts the screen derives from them, and the actions (claim, hand over, run the checks again,
  decide, withdraw) with their dialogs. The review page and the review panel of the Proposals
  page (design round 3, direction A) both build on it and lay its parts out their own way
  (review-sections.tsx), so a decision means the same in both.
*/

/** What the review's diff shows: since the request for changes, or the whole proposal. */
export type DiffView = 'since' | 'whole'

export const firstName = (name: string) => name.split(' ')[0] ?? name

/** A change to the proposal that a comment may have moved on meanwhile (G14): read it again. */
function useFreshReview(id: string) {
  const queryClient = useQueryClient()
  return async <T,>(review: Review, change: (revision: number) => Promise<T>) => {
    try {
      return await change(review.proposal.revision)
    } catch (error) {
      const failure = toApiError(error)
      if (failure.kind !== 'conflict') throw error
      const fresh = await queryClient.fetchQuery({ ...reviewQuery(id), staleTime: 0 })
      // Only a comment moved it on: the same version, still waiting for a decision.
      if (
        !fresh ||
        fresh.proposal.revision === review.proposal.revision ||
        fresh.proposal.itemVersionId !== review.proposal.itemVersionId ||
        !underReview(fresh.proposal.state)
      )
        throw error
      return change(fresh.proposal.revision)
    }
  }
}

const plainTextOnly = 'Write the reason as plain text, without @ mentions.'

/**
 * What the service would refuse in a decision's reason or comment, checked before the dialog
 * closes so the words are never lost: sensitive text, and mentions (it takes plain text only).
 */
function decisionTextProblem(...texts: (string | undefined)[]): string | null {
  for (const text of texts) {
    if (text === undefined) continue
    const refused = refusedTextMessage(textFindings(text))
    if (refused) return refused
    const parsed = parseMentions(text)
    if (parsed.mentions.length || parsed.errors.length) return plainTextOnly
  }
  return null
}

/** Why a decision did not go through, in words for the message that brings it back. */
function decisionFailure(error: unknown): string {
  const failure = toApiError(error)
  const refused = refusedTextMessage(failure.findings)
  if (refused) return refused
  if (failure.kind === 'invalid' && failure.gate)
    return "A check it needs hasn't passed. Run the checks again, or ask for changes."
  if (failure.kind === 'invalid') return plainTextOnly
  // The service says what changed; a message of more than one sentence also says what to do.
  if (failure.kind === 'conflict')
    return /\.\s/.test(failure.message)
      ? failure.message
      : `It changed while you were deciding: ${failure.message.replace(/\.$/, '')}. Read the latest version, then decide.`
  if (failure.kind === 'forbidden') return failure.message
  return "We couldn't save your decision. Try again."
}

/** The message's title when a decision is refused: what did not happen. */
const notDone: Record<DecisionOutcome, string> = {
  accept: 'Not accepted',
  request_changes: 'Changes not asked for',
  reject: 'Not rejected',
}

export function useReviewModel(
  review: Review,
  proposal: ProposalRecord | null,
  {
    onDecided,
  }: {
    /** After a decision was recorded (the panel moves on to the next proposal). */
    onDecided?: (outcome: DecisionOutcome) => void
  } = {},
) {
  const permissions = usePermissions()
  const viewerId = permissions.personId
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { data: library } = useQuery(libraryQuery())
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const { targets: targetList } = useMentionTargets()
  const targets = useMemo(() => targetsByKey(targetList), [targetList])
  const record = review.proposal
  const id = record.id
  const events = useQuery(proposalEventsQuery(id))
  const overlap = useQuery({
    ...proposalOverlapQuery(id, record.revision),
    // Overlaps compare an item's scope and dates: a retirement or a re-check has none to compare.
    enabled: Boolean(proposal) && (record.action === 'create' || record.action === 'change'),
  })
  const answerRun = review.gate?.levels.find(
    (level) => level.level === 'answer_full' || level.level === 'answer_impact',
  )
  const runId =
    answerRun && (answerRun.level === 'answer_full' || answerRun.level === 'answer_impact')
      ? (answerRun.details.run ?? null)
      : null
  const run = useQuery({ ...evalRunQuery(runId ?? ''), enabled: Boolean(runId) })
  const questions = useQuery({
    ...testQuestionsQuery({ area: record.areaId ?? undefined }),
    enabled:
      Boolean(runId) || Boolean(review.gate?.levels.some((level) => level.level === 'delivery')),
  })
  const claim = useApiWrite('claimProposal')
  const handOver = useApiWrite('handOverProposal')
  const runChecks = useApiWrite('runChecks')
  const decide = useApiWrite('decide')
  const withdraw = useApiWrite('withdrawProposal')
  const fresh = useFreshReview(id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<DecisionOutcome | null>(null)
  const [rejectWith, setRejectWith] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  // The version a person chose to read whole; a new version starts on what changed since.
  const [wholeFor, setWholeFor] = useState<string | null>(null)

  const nameOf = (personId: string | null) =>
    people.find((person) => person.id === personId)?.name ?? null
  const area: Area | undefined = areas.find((candidate) => candidate.id === record.areaId)
  const change = changeTypeOf(record)
  const libraryItem = record.itemId
    ? library?.items.find((item) => item.id === record.itemId)
    : undefined
  const kind = proposal?.draft.kind ?? libraryItem?.kind ?? null
  const title = proposal ? proposalTitle(proposal) : record.title
  const proposerName = nameOf(record.proposerId) ?? 'The writer'
  const author = record.proposerId === viewerId
  const capacities = permissions.capacitiesIn(record.areaId)
  const reviewer = capacities.includes('owner')
  // The discussion is the proposer's and the reviewers': an approver too, and an administrator
  // for a term, which an administrator decides (FR-222).
  const discusses =
    author || capacities.length > 0 || (record.subject === 'vocabulary' && permissions.isAdmin)
  // Claiming, handing over, comments and the preview are for item creates and changes.
  const itemEdit = change === 'create' || change === 'change'
  const claimable = Boolean(proposal) && itemEdit && reviewer && underReview(record.state)
  // While the person's decision is on its way the bar says so and offers nothing else.
  const saving = useDeciding().get(id)
  const bar = saving
    ? savingBar(saving, change)
    : decisionBar(review, { viewerId, permissions: permissions.permissions, area, nameOf })
  const issue = kind === 'issue'
  const draft = proposal?.draft
  const ends = Boolean(draft?.validity?.end)
  const liveVersion = change === 'change' && libraryItem ? libraryItem.version : null
  const reviewerId = record.claimedBy ?? draft?.ownerId ?? area?.ownerIds[0] ?? null

  /** Opens a decision's dialog, with a reason filled in from "Reject with this reason". */
  const openDecision = (outcome: DecisionOutcome, reason: string | null = null) => {
    setRejectWith(reason)
    setDialog(outcome)
  }

  // ---- actions ----
  const doClaim = async () => {
    if (!proposal) return
    try {
      await claim.mutateAsync({ id, revision: record.revision })
      showToast('Review claimed', "The other owners see that you're on it.")
    } catch (error) {
      const failure = toApiError(error)
      showToast(
        "Couldn't claim it",
        failure.kind === 'conflict'
          ? 'Someone claimed or changed it first. Read it again.'
          : failure.message,
      )
    }
  }
  const doHandOver = async (personId: string) => {
    try {
      await handOver.mutateAsync({ id, revision: record.revision, personId })
      showToast(
        `Handed over to ${nameOf(personId) ?? 'another owner'}`,
        "We've told them in the app.",
      )
    } catch (error) {
      showToast("Couldn't hand it over", toApiError(error).message)
    }
  }
  const doRunChecks = async () => {
    try {
      await runChecks.mutateAsync(id)
      showToast('Checks ran again', 'Against what agents get today.')
    } catch (error) {
      showToast("Couldn't run the checks", toApiError(error).message)
    }
  }
  /**
   * A decision shows at once (lib/deciding.ts, contract 9.3): the dialog closes, the bar says it is
   * being saved, the proposal leaves To review and the panel moves on, while the service checks,
   * records and publishes it. Its answer then replaces what the screen shows; a refusal brings
   * everything back as it was, with a message that says why.
   */
  const onDecide = (outcome: DecisionOutcome, reason: string, comment?: string) => {
    // What the service would refuse in the words keeps the dialog open, with the words in it.
    const problem = decisionTextProblem(reason, comment)
    if (problem) return Promise.reject(new Error(problem))
    const release = markDeciding([id], outcome)
    onDecided?.(outcome)
    void fresh(review, (revision) =>
      decide.mutateAsync({
        id,
        revision,
        outcome,
        reason,
        ...(bar.capacity ? { capacity: bar.capacity } : {}),
        ...(comment ? { comment } : {}),
      }),
    ).then(
      async (result) => {
        // A decided proposal shows its new state at once (the cache has the answer); one that still
        // waits shows its new state once its review is read again, and stays busy until then.
        if (underReview(result.proposal.state))
          await queryClient.invalidateQueries(
            { queryKey: queryKeys.reviewOf(id) },
            { cancelRefetch: false },
          )
        release()
        if (outcome === 'accept')
          showToast(
            'Accepted',
            result.edition
              ? 'Agents get it within a minute.'
              : 'Agents get it once its checks pass.',
          )
        else if (outcome === 'request_changes')
          showToast(
            'Changes asked for',
            comment
              ? `We've told ${firstName(proposerName)}. Your comment is in the discussion.`
              : `We've told ${firstName(proposerName)}, who can change it and send it again.`,
          )
        else showToast('Rejected', `We've told ${firstName(proposerName)}. Agents won't get it.`)
      },
      (error: unknown) => {
        release()
        // The panel has moved on to the next proposal: the message opens this one again.
        showToast(`${notDone[outcome]}: ${title}`, decisionFailure(error), {
          timeout: 10000,
          ...(onDecided
            ? {
                action: {
                  label: 'Open',
                  onClick: () =>
                    void navigate({ to: '/proposals/$proposalId', params: { proposalId: id } }),
                },
              }
            : {}),
        })
      },
    )
    return Promise.resolve()
  }
  const doWithdraw = async (reason: string) => {
    try {
      await fresh(review, (revision) => withdraw.mutateAsync({ id, revision, reason }))
    } catch (error) {
      throw new Error(toApiError(error).message || "Couldn't withdraw it.", {
        cause: error,
      })
    }
    showToast('Proposal withdrawn', 'Agents never got it.')
  }

  const acceptEffect: ReactNode =
    change === 'retire'
      ? 'Agents stop getting it at once. You can still read the fact and its history.'
      : 'Agents get it within a minute.'
  const copy: DecisionDialogCopy = {
    proposerName,
    subject: change,
    acceptEffect,
    rejectWith,
  }

  // ---- the checks' details ----
  const termName = (key: string) => {
    const option = targets.get(key)
    if (option) return option.name
    if (key.startsWith('dim:')) {
      const dimension = vocabulary?.dimensions.find((candidate) => `dim:${candidate.id}` === key)
      return dimension?.name ?? key.slice(4)
    }
    return key
      .replace(/^[a-z]+:/, '')
      .replace(/^[a-z_]+\//, '')
      .replace(/_/g, ' ')
  }
  const questionText = (questionId: string) =>
    questions.data?.find((question) => question.id === questionId)?.wordings[0]?.text ?? null
  const detailLookups: CheckDetailLookups = { termName, questionText }
  const answerMessage =
    answerRun && (answerRun.level === 'answer_full' || answerRun.level === 'answer_impact')
      ? (answerRun.details.message ?? null)
      : null

  // ---- overlaps, with the library's kind and domain for each accepted item ----
  const libraryItems = new Map((library?.items ?? []).map((item) => [item.id, item]))
  const overlapData = overlap.data
    ? {
        ...overlap.data,
        accepted: overlap.data.accepted.map((item) => {
          const entry = libraryItems.get(item.id)
          const domain = areas.find((candidate) => candidate.id === entry?.areaId)
          return { ...item, kind: entry?.kind ?? item.kind, domain }
        }),
        otherProposals: overlap.data.otherProposals.map((other) => ({
          ...other,
          stateName: proposalStateNames[other.state],
        })),
      }
    : undefined

  // ---- who may change the review settings ----
  const editBlock: OwnerEditBlock = !reviewer
    ? {
        title: 'Only an owner can change these',
        reason: `Only the owners of ${area?.name ?? 'the domain'} can change the review settings.`,
      }
    : author
      ? {
          title: 'You wrote this proposal',
          reason: 'Another owner changes these while it waits for review.',
        }
      : record.claimedBy && record.claimedBy !== viewerId
        ? {
            title: `${firstName(nameOf(record.claimedBy) ?? 'Another owner')} is reviewing this`,
            reason: `${nameOf(record.claimedBy) ?? 'Another owner'} claimed it. Ask them to hand it over first.`,
          }
        : null
  const ownerFields =
    draft && itemEdit ? { draft, fields: ownerFieldsOf(draft, record, area) } : null

  const otherReviewers = reviewersOf(area).filter((personId) => personId !== viewerId)
  // An item proposal, or a proposed term, while it waits (a term has no item draft).
  const canWithdraw =
    author && (Boolean(proposal) || record.subject === 'vocabulary') && underReview(record.state)

  // ---- a resubmission: what changed since the request for changes (heed-ux B2) ----
  const askedBy = review.sinceRequest
    ? (review.decisions.find((decision) => decision.id === review.sinceRequest?.decisionId)
        ?.decidedBy ?? null)
    : null
  const diffView: DiffView =
    review.sinceRequest && wholeFor !== record.itemVersionId ? 'since' : 'whole'
  const diff = {
    view: diffView,
    setView: (view: DiffView) => setWholeFor(view === 'whole' ? record.itemVersionId : null),
    /** The rows the screen shows: since the request, or the whole proposal. */
    entries: diffView === 'since' && review.sinceRequest ? review.sinceRequest.diff : review.diff,
    askedBy,
  }

  const activity = buildActivity(events.data ?? [], {
    viewerId,
    nameOf,
    areaName: (areaId) => areas.find((candidate) => candidate.id === areaId)?.name ?? null,
    proposal: { channel: record.channel, proposerId: record.proposerId },
  })

  return {
    review,
    proposal,
    record,
    id,
    viewerId,
    areas,
    library,
    targets,
    events,
    overlap: { loading: overlap.isPending, data: overlapData },
    run: { data: run.data ?? null, loading: Boolean(runId) && run.isPending },
    nameOf,
    area,
    change,
    libraryItem,
    kind,
    title,
    proposerName,
    author,
    reviewer,
    discusses,
    itemEdit,
    claimable,
    bar,
    issue,
    draft,
    ends,
    liveVersion,
    reviewerId,
    detailLookups,
    questionText,
    answerMessage,
    editBlock,
    ownerFields,
    otherReviewers,
    canWithdraw,
    activity,
    diff,
    copy,
    pending: { claim: claim.isPending, runChecks: runChecks.isPending },
    actions: { doClaim, doHandOver, doRunChecks, onDecide, doWithdraw },
    dialogs: {
      dialog,
      setDialog,
      editing,
      setEditing,
      withdrawing,
      setWithdrawing,
      openDecision,
    },
  }
}

export type ReviewModel = ReturnType<typeof useReviewModel>

/** The decision dialogs, the review settings dialog and the withdraw dialog of a review. */
export function ReviewDialogs({ model }: { model: ReviewModel }) {
  const { record, draft, dialogs, actions } = model
  return (
    <>
      <DecisionDialogs
        open={dialogs.dialog}
        onOpenChange={dialogs.setDialog}
        copy={model.copy}
        acceptLabel={model.bar.outcomes.accept?.label ?? 'Accept'}
        onDecide={actions.onDecide}
      />
      {draft && model.itemEdit ? (
        <OwnerEditDialog
          key={record.revision}
          open={dialogs.editing}
          onOpenChange={dialogs.setEditing}
          proposal={record}
          draft={draft}
          areas={model.areas}
          nameOf={model.nameOf}
          ends={model.ends}
        />
      ) : null}
      {model.canWithdraw ? (
        <ConfirmDialog
          open={dialogs.withdrawing}
          onOpenChange={dialogs.setWithdrawing}
          title="Withdraw this proposal?"
          effect="It leaves review, and agents never get it."
          action="Withdraw"
          actionIcon={Undo2Icon}
          tone="destructive"
          reason={{
            label: 'Why are you withdrawing it?',
            required: true,
            hint: 'The owner reads this. Plain text only.',
          }}
          onConfirm={({ reason }) => actions.doWithdraw(reason)}
        />
      ) : null}
    </>
  )
}
