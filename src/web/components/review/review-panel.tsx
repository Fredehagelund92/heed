import { useId, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { ProposalRecord, Review } from '@/api'
import { useReviewScope } from '@/components/app-shell/command-scope'
import { CountBadge } from '@/components/item/item-marks'
import { DockPanel, useDockMode, type DockTab } from '@/components/page/dock-panel'
import { PageRail } from '@/components/page/page-rail'
import { TabsContent } from '@/components/ui/tabs'
import type { DecisionOutcome } from '@/lib/review'
import { discussionOf } from '@/lib/proposal-activity'
import { DecisionFooter } from './decision-bar'
import { ReviewDialogs, useReviewModel } from './review-model'
import {
  ClaimControl,
  hasOverlaps,
  ReviewActivity,
  ReviewApprovals,
  ReviewBadges,
  ReviewAttachedTests,
  ReviewDiscussion,
  ReviewChecks,
  ReviewDiff,
  ReviewMentions,
  ReviewNotes,
  ReviewOverlaps,
  ReviewPeople,
  SourceToolQuestion,
  WithdrawButton,
} from './review-sections'
import { ReviewTermBatch } from './term-batch'

/*
  A proposal under review in the docked panel of the Proposals page (design round 3, direction
  A): what an owner needs to triage a queue without leaving it. The badges, the title, who
  wrote it and, under that, the claim and the hand over (the page has them in its header); the
  tabs Changes (the source-tool question, the diff and the mentions), Checks (with the approvals
  and the test questions), Overlaps and Activity (with the comment); and the decision bar in the
  footer, each blocked decision with its reason. A, R and Shift R open the
  decisions' dialogs as on the page; j and k belong to the list. The review page (expand) keeps
  what needs the width: a long diff side by side, the review settings and what an agent will see.
*/

export const reviewPanelTabs = ['changes', 'checks', 'overlaps', 'activity'] as const
export type ReviewPanelTab = (typeof reviewPanelTabs)[number]

const tabNames: Record<ReviewPanelTab, string> = {
  changes: 'Changes',
  checks: 'Checks',
  overlaps: 'Overlaps',
  activity: 'Discussion',
}

/** How many checks did not pass, for the Checks tab: a failure asks for a look. */
function failedChecks(review: Review) {
  return review.gate?.levels.filter((level) => level.outcome === 'failed').length ?? 0
}

export function ReviewPanel({
  review,
  proposal,
  tab: requested,
  onTabChange,
  meta,
  onPrevious,
  onNext,
  onClose,
  expand,
  onDecided,
}: {
  review: Review
  /** The item proposal, for its draft; null for a retirement, a re-check or a term. */
  proposal: ProposalRecord | null
  /** The tab the address asks for; Changes when it is not one of the panel's. */
  tab: string | undefined
  onTabChange: (tab: ReviewPanelTab) => void
  meta: ReactNode
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
  expand: ReactElement
  /** After a decision: the list moves the panel on. */
  onDecided?: (outcome: DecisionOutcome) => void
}) {
  const model = useReviewModel(review, proposal, { onDecided })
  const touch = useDockMode() === 'full'
  const [compare, setCompare] = useState<'fields' | 'text'>('fields')
  const diffId = useId()
  const historyId = useId()
  const { bar } = model
  const overlaps = hasOverlaps(model)
  const tabs: DockTab<ReviewPanelTab>[] = reviewPanelTabs
    .filter((value) => value !== 'overlaps' || overlaps)
    .map((value) => {
      const failed = value === 'checks' ? failedChecks(review) : 0
      const overlapCount =
        value === 'overlaps' && model.overlap.data
          ? model.overlap.data.accepted.length + model.overlap.data.otherProposals.length
          : 0
      const count =
        value === 'changes'
          ? model.diff.entries.length
          : value === 'activity'
            ? discussionOf(model.events.data ?? [], {
                proposerId: model.record.proposerId,
                area: model.area ?? null,
              }).length
            : value === 'overlaps'
              ? overlapCount
              : failed
      return {
        value,
        label: tabNames[value],
        count: count ? (
          <CountBadge count={count} tone={value === 'checks' ? 'attention' : 'chip'} />
        ) : undefined,
      }
    })
  const tab: ReviewPanelTab = tabs.some((entry) => entry.value === requested)
    ? (requested as ReviewPanelTab)
    : 'changes'

  // The decisions' keys, as on the page; the list keeps j and k.
  const reviewScope = useMemo(
    () => ({
      canOpen: (outcome: DecisionOutcome) => bar.outcomes[outcome]?.allowed === true,
      open: (outcome: DecisionOutcome) => model.dialogs.openDecision(outcome),
      next: null,
      previous: null,
    }),
    // The bar is read fresh on every render; the scope follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      bar.state,
      bar.outcomes.accept?.allowed,
      bar.outcomes.reject?.allowed,
      bar.outcomes.request_changes?.allowed,
    ],
  )
  useReviewScope(reviewScope)

  const size = touch ? 'touch' : undefined

  return (
    <>
      <DockPanel
        title={model.title}
        contentKey={model.id}
        meta={meta}
        badges={<ReviewBadges model={model} />}
        note={
          <>
            <ReviewPeople model={model} />
            {model.claimable || model.canWithdraw ? (
              <div className="flex flex-wrap items-center gap-2" data-slot="review-claim">
                <ClaimControl model={model} size={size} />
                <WithdrawButton model={model} size={size} />
              </div>
            ) : null}
          </>
        }
        tabs={tabs}
        tab={tab}
        onTabChange={onTabChange}
        tabsLabel="Proposal sections"
        onPrevious={onPrevious}
        onNext={onNext}
        onClose={onClose}
        expand={expand}
        footer={
          <DecisionFooter
            bar={bar}
            onOpen={(outcome) => model.dialogs.openDecision(outcome)}
            touch={touch}
          />
        }
      >
        <PageRail placement="panel">
          <TabsContent value="changes" className="flex flex-col gap-8 text-body">
            <ReviewNotes model={model} />
            <ReviewDiff
              model={model}
              compare={compare}
              onCompare={setCompare}
              headingLevel={3}
              headingId={diffId}
            />
            <ReviewTermBatch model={model} headingLevel={3} />
            <ReviewMentions model={model} headingLevel={3} />
            {model.change !== 'retire' ? <SourceToolQuestion model={model} /> : null}
          </TabsContent>
          <TabsContent value="checks" className="flex flex-col gap-6 text-body">
            <ReviewChecks model={model} variant="card" headingLevel={3} />
            <ReviewAttachedTests model={model} headingLevel={3} />
            <ReviewApprovals model={model} headingLevel={3} />
          </TabsContent>
          {overlaps ? (
            <TabsContent value="overlaps" className="flex flex-col gap-6 text-body">
              <ReviewOverlaps model={model} limit={10} headingLevel={3} />
            </TabsContent>
          ) : null}
          <TabsContent value="activity" className="flex flex-col gap-8 text-body">
            <ReviewDiscussion model={model} headingLevel={3} />
            <section aria-labelledby={historyId} className="flex flex-col gap-4">
              <h3 id={historyId} className="text-large font-bold">
                History
              </h3>
              <ReviewActivity model={model} />
            </section>
          </TabsContent>
        </PageRail>
      </DockPanel>
      <ReviewDialogs model={model} />
    </>
  )
}
