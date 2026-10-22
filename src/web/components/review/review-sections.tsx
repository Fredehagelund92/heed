import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { previewItemId } from '@domain/served-review'
import type { ProposalRecord } from '@/api'
import { proposalPreviewQuery } from '@/api/queries'
import { useDomainOf, useQuestionAbout } from '@/components/context/context-companion'
import {
  ArrowRightLeftIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  EyeIcon,
  GitCompareArrowsIcon,
  InfoIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  TimerIcon,
  Undo2Icon,
  UserRoundCheckIcon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { RiskBadge } from '@/components/item/fact-badges'
import {
  DateBadge,
  DomainBadge,
  KindBadge,
  ProposalStatusBadge,
} from '@/components/item/item-marks'
import { AgentPreview } from '@/components/proposal/agent-preview'
import { AttachedTests } from '@/components/proposal/attached-tests'
import { CheckOutcomes, GateResult } from '@/components/proposal/gate-result'
import { OverlapList } from '@/components/proposal/overlap-list'
import { PartCard } from '@/components/proposal/part-card'
import { PersonChip } from '@/components/proposal/person-chip'
import { ExternalSources } from '@/components/proposal/provenance-notes'
import { Quote, Said } from '@/components/proposal/said'
import { Timeline, TimelineEvent, TimelineSkeleton } from '@/components/proposal/timeline'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { previewInput } from '@/lib/context-form'
import { formatDay } from '@/lib/library'
import { historyRows, latestDecision, replyAfter } from '@/lib/proposal-activity'
import { changeTypeLong, underReview } from '@/lib/review'
import { lastDayFromEnd } from '@/lib/validity-range'
import { LevelDetails, hasLevelDetails } from './check-details'
import { Discussion } from '@/components/proposal/discussion'
import { FieldDiff, TextDiff } from './field-diff'
import { TermDiff } from './term-diff'
import { firstName, type ReviewModel } from './review-model'
import { ApprovalsCard, ImpactDelta, MentionChanges } from './review-parts'
import { OwnerEditCard } from './owner-edit'

/*
  The parts of a proposal in review mode that the review page and the review panel both show
  (review-model.tsx holds what they are made of). The page lays them out as the paper and its
  rail; the panel as its tabs, Changes, Checks, Overlaps and Activity, with the decision bar in
  its footer. A part never reads the layout it is in, except where the caller says so.
*/

type Part = { model: ReviewModel }

/**
 * The source-tool question (FR-210) as one quiet line at the end of what is read, just above the
 * decision bar, with "Reject with this reason" for whoever may reject (heed-ux A9): it is asked
 * of every proposal, so it does not take the top of the page from what changed.
 */
export function SourceToolQuestion({ model }: Part) {
  return (
    <p
      data-slot="source-tool-question"
      className="flex flex-col items-start gap-1 text-dense text-muted-foreground @xl:flex-row @xl:items-center @xl:gap-2"
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <CircleHelpIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-0.5" />
        <span className="min-w-0">{model.review.sourceToolQuestion}</span>
      </span>
      {model.bar.outcomes.reject?.allowed ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-dense text-foreground underline"
          onClick={() =>
            model.dialogs.openDecision(
              'reject',
              'This changes how a metric is defined, so it belongs in Cube.',
            )
          }
        >
          Reject with this reason
        </Button>
      ) : null}
    </p>
  )
}

/** The proposal's badges: its kind, domain, change, state, risk and, for an issue, its end. */
export function ReviewBadges({ model, size }: Part & { size?: 'sm' }) {
  const { kind, area, change, record, issue, draft } = model
  const validity = draft?.validity
  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="proposal-badges">
      {kind ? <KindBadge kind={kind} size={size} /> : null}
      {area ? <DomainBadge name={area.name} label={area.label} size={size} /> : null}
      <Badge form="outline" icon={GitCompareArrowsIcon} size={size}>
        {changeTypeLong[change]}
      </Badge>
      <ProposalStatusBadge state={record.state} size={size} />
      {record.riskLevel ? <RiskBadge level={record.riskLevel} size={size} /> : null}
      {issue && validity?.start ? (
        <Badge form="outline" icon={TimerIcon} size={size} data-slot="issue-chip">
          {validity.end === null
            ? 'Still going on, no end date'
            : `Ended ${formatDay(lastDayFromEnd(validity.end) ?? validity.end)}`}
        </Badge>
      ) : null}
    </div>
  )
}

/** Who wrote it and when, the item version it changes, and when the review is due. */
export function ReviewPeople({ model }: Part) {
  const { record, liveVersion, library } = model
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PersonChip
        role="proposer"
        personId={record.proposerId}
        name={model.proposerName}
        you={model.author}
        date={record.submittedAt ?? record.createdAt}
      />
      {liveVersion !== null && record.itemId ? (
        <Badge
          form="outline"
          render={<Link to="/library/$itemId" params={{ itemId: record.itemId }} />}
          className="hover:bg-muted"
        >
          Version {liveVersion + 1} of the fact
        </Badge>
      ) : null}
      {record.dueAt && underReview(record.state) ? (
        <DateBadge date={record.dueAt.slice(0, 10)} today={library?.today ?? null} deadline />
      ) : null}
    </div>
  )
}

/**
 * A resubmission's request for changes and the proposer's reply (heed-ux B2), so a reviewer reads
 * what was asked and what was answered before what changed.
 */
function RequestAndReply({ model }: Part) {
  const { review, events, record, viewerId, nameOf } = model
  if (!review.sinceRequest) return null
  const asked = latestDecision(events.data ?? [], 'request_changes')
  if (!asked) return null
  const reply = replyAfter(events.data ?? [], record.proposerId, asked.at)
  const who = (personId: string | null, fallback: string) =>
    personId === viewerId ? 'You' : ((personId ? nameOf(personId) : null) ?? fallback)
  return (
    <Alert variant="info" data-slot="request-and-reply">
      <MessageSquareIcon aria-hidden="true" />
      <AlertContent>
        <AlertTitle>
          <Said who={who(asked.actorId, 'The owner')} what="asked for changes" at={asked.at} />
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          {asked.reason ? <Quote>{asked.reason}</Quote> : null}
          {reply ? (
            <div className="flex flex-col gap-1" data-slot="proposer-reply">
              <p className="font-bold">
                <Said
                  who={who(record.proposerId, model.proposerName)}
                  what="replied"
                  at={reply.at}
                />
              </p>
              <Quote>{reply.text}</Quote>
            </div>
          ) : null}
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}

/**
 * A retirement's or a re-check's reason, or what the proposer says is wrong with the current
 * version on a change (heed-ux B5), then a resubmission's request and reply, and the ask-again
 * note of an issue with no end date. A withdrawn proposal's reason is the withdrawal's, which its
 * activity shows.
 */
export function ReviewNotes({ model }: Part) {
  const { record, change, draft, issue, review, viewerId, nameOf } = model
  const rescue = review.rescue
  const said =
    change === 'retire' || change === 'recheck'
      ? `${model.proposerName}'s reason`
      : change === 'change' && record.state !== 'withdrawn'
        ? `${model.proposerName} on what's wrong with the current version`
        : null
  return (
    <>
      {record.reason && said ? (
        <blockquote
          className="max-w-prose border-l-2 pl-3 text-body break-words whitespace-pre-line"
          data-slot="proposal-reason"
        >
          “{record.reason}”<span className="block text-caption text-muted-foreground">{said}</span>
        </blockquote>
      ) : null}
      {rescue ? (
        // A rescue (FR-814): the item's domain was deleted, and an administrator restored it here.
        <Alert variant="info" data-slot="rescue-note">
          <InfoIcon aria-hidden="true" />
          <AlertContent>
            <AlertTitle>Restored from the Bin into this domain</AlertTitle>
            <AlertDescription>
              <p>
                {rescue.restoredBy === viewerId ? 'You' : (nameOf(rescue.restoredBy) ?? 'An admin')}{' '}
                restored it on {formatDay(rescue.restoredAt.slice(0, 10))}, because its domain,{' '}
                {rescue.deletedDomain}, was deleted. This proposal brings back its last text, fitted
                to this domain. The changes are below. The fact stays archived until it's accepted,
                and then agents get it again.
              </p>
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
      <RequestAndReply model={model} />
      {issue && draft?.validity?.end === null && underReview(record.state) ? (
        <Alert variant="info" data-slot="issue-note">
          <InfoIcon aria-hidden="true" />
          <AlertContent>
            <AlertDescription>
              <p>
                No end date yet. Once it's accepted, we ask again
                {draft.reviewDate ? ` on ${formatDay(draft.reviewDate)}` : ' in 14 days'}:{' '}
                <b className="font-bold">“Is this still going on?”</b>
              </p>
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
    </>
  )
}

/** The checks with their details, and Run again for an owner. */
export function ReviewChecks({
  model,
  variant,
  headingLevel = 2,
}: Part & { variant: 'folded' | 'card'; headingLevel?: 2 | 3 }) {
  const { review, record, reviewer, change } = model
  if (!review.gate)
    return (
      <PartCard title="Checks" headingLevel={headingLevel}>
        <p className="text-dense text-muted-foreground">
          {change === 'retire'
            ? 'Archiving a fact runs no checks. Agents stop getting it at once.'
            : change === 'term'
              ? 'We check the name against the names we know when you decide.'
              : 'No check results yet.'}
        </p>
      </PartCard>
    )
  const gate = review.gate
  return (
    <GateResult
      gate={gate}
      risk={record.riskLevel}
      numbered
      headingLevel={headingLevel}
      aside={record.riskLevel ? <RiskBadge level={record.riskLevel} size="sm" /> : undefined}
      help={<HelpLink to="glossary#check">What's a check?</HelpLink>}
      action={
        reviewer ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void model.actions.doRunChecks()}
            aria-busy={model.pending.runChecks || undefined}
            disabled={model.pending.runChecks}
          >
            <RefreshCwIcon />
            Run again
          </Button>
        ) : undefined
      }
      variant={variant}
      renderDetails={(level) => {
        const result = gate.levels.find((candidate) => candidate.level === level)
        return result && hasLevelDetails(result) ? (
          <LevelDetails result={result} lookups={model.detailLookups} />
        ) : null
      }}
    />
  )
}

/** The test questions attached to the proposal, reported with the change (FR-524). */
export function ReviewAttachedTests({ model, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  const { review, record } = model
  // Only a change to an item is checked, so only it carries attached tests.
  if (!review.gate) return null
  return (
    <AttachedTests
      proposal={record}
      results={review.gate.attached}
      risk={record.riskLevel}
      headingLevel={headingLevel}
    />
  )
}

/** The approvals still needed and the answer tests' change, under the checks. */
export function ReviewApprovals({ model, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  const { review, record } = model
  if (!review.gate) return null
  return (
    <>
      <ApprovalsCard
        gate={review.gate}
        decisions={review.decisions}
        reviewerId={model.reviewerId}
        viewerId={model.viewerId}
        nameOf={model.nameOf}
        risk={record.riskLevel}
        headingLevel={headingLevel}
      />
      {review.gate.required.some((level) => level.startsWith('answer')) ? (
        <ImpactDelta
          run={model.run.data}
          loading={model.run.loading}
          message={model.answerMessage}
          questionText={model.questionText}
          headingLevel={headingLevel}
        />
      ) : null}
    </>
  )
}

/** Whether the proposal has overlaps to compare: an item's create or change. */
export const hasOverlaps = (model: ReviewModel) => Boolean(model.proposal) && model.itemEdit

/** The accepted items and other proposals that overlap this one. */
export function ReviewOverlaps({
  model,
  limit = 5,
  headingLevel = 2,
}: Part & { limit?: number; headingLevel?: 2 | 3 }) {
  if (!hasOverlaps(model)) return null
  return (
    <OverlapList
      title="Overlaps and conflicts"
      headingLevel={headingLevel}
      loading={model.overlap.loading}
      limit={limit}
      overlap={model.overlap.data}
    />
  )
}

/** The review settings an owner may change (risk, reviewer, dates), with Change. */
export function ReviewSettings({ model }: Part) {
  if (!model.ownerFields) return null
  return (
    <OwnerEditCard
      fields={model.ownerFields.fields}
      areas={model.areas}
      nameOf={model.nameOf}
      ends={model.ends}
      block={model.editBlock}
      onChange={() => model.dialogs.setEditing(true)}
    />
  )
}

/** What changed: the field diff, or the text diff, or a term against the term in service. */
export function ReviewDiff({
  model,
  compare,
  onCompare,
  headingLevel = 2,
  headingId = 'what-changed',
}: Part & {
  compare: 'fields' | 'text'
  onCompare: (compare: 'fields' | 'text') => void
  headingLevel?: 2 | 3
  headingId?: string
}) {
  const { review, draft, targets } = model
  const { view, entries } = model.diff
  const since = view === 'since'
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const request = model.diff.askedBy === model.viewerId ? 'your request' : 'the request'
  const change = since || (model.change !== 'create' && model.change !== 'term')
  // The text compare is for a change to the text; without one the fields show.
  const hasText = entries.some((entry) =>
    ['summary', 'summaryMarkup', 'body', 'bodyMarkup'].includes(entry.field),
  )
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={headingId} className="text-large font-bold tracking-large">
          {since ? `What changed since ${request}` : 'What changed'}
        </Heading>
        <div className="flex flex-wrap items-center gap-2">
          {review.sinceRequest ? (
            <ToggleGroup
              aria-label="Show"
              value={[view]}
              onValueChange={(value: string[]) => {
                const next = value[0]
                if (next === 'since' || next === 'whole') model.diff.setView(next)
              }}
            >
              <ToggleGroupItem value="since">{`Since ${request}`}</ToggleGroupItem>
              <ToggleGroupItem value="whole">Whole proposal</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {hasText ? (
            <ToggleGroup
              aria-label="Compare by"
              value={[compare]}
              onValueChange={(value: string[]) => {
                const next = value[0]
                if (next === 'fields' || next === 'text') onCompare(next)
              }}
            >
              <ToggleGroupItem value="fields">Fields</ToggleGroupItem>
              <ToggleGroupItem value="text">Text</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
      </div>
      {review.provenance && !review.vocabulary ? (
        <ExternalSources
          provenance={review.provenance}
          where="review"
          className="text-caption text-muted-foreground"
        />
      ) : null}
      {review.vocabulary ? (
        <TermDiff term={review.vocabulary} areas={model.areas} targets={targets} />
      ) : since && !entries.length ? (
        <p
          data-slot="nothing-since-request"
          className="rounded-lg border bg-card px-4 py-3 text-dense text-muted-foreground"
        >
          {`Nothing changed since ${request}. ${firstName(model.proposerName)} sent it again as it was.`}
        </p>
      ) : compare === 'text' && hasText ? (
        <TextDiff
          diff={entries}
          targets={targets}
          current={{
            summary: draft?.summaryMarkup ?? draft?.summary ?? '',
            body: draft?.bodyMarkup ?? draft?.body ?? '',
          }}
        />
      ) : (
        <FieldDiff
          diff={entries}
          lookups={{
            targets,
            areas: model.areas,
            nameOf: model.nameOf,
            ...(review.rescue ? { deletedDomain: review.rescue.deletedDomain } : {}),
          }}
          issue={model.issue}
          liveVersion={model.liveVersion}
          change={change}
          columns={
            since
              ? { before: 'At the request', after: 'Sent again' }
              : review.rescue
                ? // A rescue's item is retired: it compares with the version agents got before the Bin.
                  rescueColumns(model.liveVersion)
                : undefined
          }
          provenance={review.provenance}
        />
      )}
    </section>
  )
}

/** A rescue's two columns (FR-814): the version agents got before the Bin, and the proposed one. */
const rescueColumns = (version: number | null) =>
  version === null
    ? { before: 'Before the Bin', after: 'Proposed' }
    : { before: `Version ${version}, before the Bin`, after: `Proposed version ${version + 1}` }

/** The mentions a change adds or drops, with the narrower-audience warning. */
export function ReviewMentions({ model, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  if (!model.itemEdit) return null
  return (
    <MentionChanges
      headingLevel={headingLevel}
      mentions={model.review.mentions}
      warnings={model.review.warnings}
      targets={model.targets}
    />
  )
}

/** How many events the activity holds, for its heading. */
export const activityCount = (model: ReviewModel) =>
  model.activity.length
    ? `${model.activity.length} ${model.activity.length === 1 ? 'event' : 'events'}`
    : ''

/** The timeline of everything that happened; a comment is one line here, its words in the discussion. */
export function ReviewActivity({ model }: Part) {
  const { events, activity } = model
  return events.isPending ? (
    <TimelineSkeleton />
  ) : (
    <Timeline aria-label="History">
      {historyRows(activity).map((row) => (
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
  )
}

/**
 * The proposal's discussion (FR-222), for its proposer and its reviewers whatever it changes,
 * with the composer while it waits for a decision.
 */
export function ReviewDiscussion({ model, headingLevel = 2 }: Part & { headingLevel?: 2 | 3 }) {
  const { events, record, author, area, nameOf, viewerId, proposerName } = model
  if (!model.discusses) return null
  const proposer = firstName(proposerName)
  const reviewerName = record.claimedBy ? nameOf(record.claimedBy) : null
  const owners = area ? `the owners of ${area.name}` : 'the admins'
  return (
    <Discussion
      events={events.data}
      pending={events.isPending}
      proposerId={record.proposerId}
      area={area ?? null}
      nameOf={nameOf}
      viewerId={viewerId}
      headingLevel={headingLevel}
      audience={`Only ${author ? 'you' : proposer}, ${owners} and admins can read this.`}
      composer={
        underReview(record.state) || record.state === 'changes_requested'
          ? {
              proposal: record,
              title: author
                ? `Reply to ${reviewerName ? firstName(reviewerName) : 'the owners'}`
                : `Comment for ${proposer}`,
              notice: `We'll tell ${author ? (reviewerName ? firstName(reviewerName) : 'the owners') : proposer} in the app.`,
              action: author ? 'Send reply' : 'Send comment',
            }
          : null
      }
    />
  )
}

/** Claim, or who holds the review, and Hand over for the one who holds it. */
export function ClaimControl({ model, size }: Part & { size?: 'touch' }) {
  const { record, viewerId, nameOf } = model
  if (!model.claimable) return null
  if (record.claimedBy === viewerId)
    return (
      <>
        <PersonChip
          role="claimed"
          personId={viewerId}
          name={nameOf(viewerId) ?? 'You'}
          you
          form="soft"
        />
        {model.otherReviewers.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size={size} />}>
              <ArrowRightLeftIcon />
              Hand over
              <ChevronDownIcon className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Hand the review to</DropdownMenuLabel>
                {model.otherReviewers.map((personId) => (
                  <DropdownMenuItem
                    key={personId}
                    onClick={() => void model.actions.doHandOver(personId)}
                  >
                    <UserRoundCheckIcon />
                    {nameOf(personId) ?? 'Another owner'}
                    <span className="text-muted-foreground">owner</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </>
    )
  if (record.claimedBy)
    return (
      <PersonChip
        role="claimed"
        personId={record.claimedBy}
        name={nameOf(record.claimedBy) ?? 'Another owner'}
      />
    )
  return (
    <Button
      variant="outline"
      size={size}
      onClick={() => void model.actions.doClaim()}
      aria-busy={model.pending.claim || undefined}
    >
      <UserRoundCheckIcon />
      Claim
    </Button>
  )
}

/** Withdraw, for the proposer while it waits for a decision. */
export function WithdrawButton({ model, size }: Part & { size?: 'touch' }) {
  if (!model.canWithdraw) return null
  return (
    <Button variant="outline" size={size} onClick={() => model.dialogs.setWithdrawing(true)}>
      <Undo2Icon />
      Withdraw
    </Button>
  )
}

/** The reply an agent would get for the proposal's own scope and first day, from the service. */
function useProposalPreview(proposal: ProposalRecord, enabled: boolean) {
  const preview = useQuery({
    ...proposalPreviewQuery(previewInput(proposal), proposal.revision),
    enabled,
  })
  const about = useQuestionAbout()
  const domainOf = useDomainOf(proposal)
  return { preview, about: about(proposal.draft.scope, proposal.draft.validity?.start), domainOf }
}

function PreviewError({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert" className="text-dense text-status-danger-fg">
      We couldn't load the preview.{' '}
      <Button variant="link" onClick={onRetry}>
        Try again
      </Button>
    </p>
  )
}

/**
 * What an agent will see, for a new item (heed-ux A9): the agent's card itself, first on the
 * review page, since it is what a reviewer most needs and a new item has no before.
 */
export function AgentCard({ proposal }: { proposal: ProposalRecord }) {
  const { preview, about, domainOf } = useProposalPreview(proposal, true)
  return (
    <div className="flex flex-col gap-2">
      <AgentPreview
        draftItemId={previewItemId(proposal)}
        state={preview.isPending ? 'loading' : 'ready'}
        result={preview.data?.result}
        about={about}
        domainOf={domainOf}
      />
      {preview.isError ? <PreviewError onRetry={() => void preview.refetch()} /> : null}
    </div>
  )
}

/**
 * What an agent will see, before and after (frame C2, 4): collapsed by default. The reply for the
 * proposal's own scope and first day comes from the same code as delivery; before it, the live
 * item's text (the service previews the candidate only, gap G9).
 */
export function BeforeAndAfter({
  proposal,
  live,
}: {
  proposal: ProposalRecord
  live: string | null
}) {
  const [open, setOpen] = useState(false)
  const { preview, about, domainOf } = useProposalPreview(proposal, open)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex flex-col gap-3 rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="group/preview flex min-h-control-touch items-center gap-3 rounded-lg px-4 text-left">
        <EyeIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-body font-bold">What agents get, before and after</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/preview:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 px-4 pb-4">
        <section aria-label="Before" className="flex flex-col gap-2">
          <h3 className="text-caption font-bold text-muted-foreground">
            Before: what agents get today
          </h3>
          <p className="text-dense">
            {live ??
              (proposal.action === 'create'
                ? 'Nothing yet. This is a new fact.'
                : "The current version isn't in the library.")}
          </p>
        </section>
        <AgentPreview
          draftItemId={previewItemId(proposal)}
          state={preview.isPending ? 'loading' : 'ready'}
          result={preview.data?.result}
          about={about}
          domainOf={domainOf}
          headingLevel={3}
        />
        {preview.isError ? <PreviewError onRetry={() => void preview.refetch()} /> : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
