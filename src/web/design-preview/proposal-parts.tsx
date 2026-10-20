import type { ReactNode } from 'react'
import { proposalStates } from '@domain/proposal-state'
import { DomainBadge, KindBadge, ProposalStatusBadge } from '@/components/item/item-marks'
import { Page, PageContent, PageDocument } from '@/components/page/page'
import { PageRail } from '@/components/page/page-rail'
import { AgentPreview } from '@/components/proposal/agent-preview'
import { EditionLabel } from '@/components/proposal/edition-label'
import { CheckOutcomes, GateResult } from '@/components/proposal/gate-result'
import { OverlapList } from '@/components/proposal/overlap-list'
import { PersonChip, personRoles } from '@/components/proposal/person-chip'
import { Timeline, TimelineEvent, TimelineSkeleton } from '@/components/proposal/timeline'
import {
  checkFailedReply,
  conflictReply,
  domains,
  formatFailedGate,
  fullOverlap,
  highGate,
  LIVE_EDITION,
  longTitleOverlap,
  matchedReply,
  mixedGate,
  noMatchReply,
  noOverlap,
  normalGate,
  statusOverlap,
  unreadableGate,
} from './proposal-samples'

/*
  The proposal parts (slice W1b of the front end plan) on one page: first composed the way the
  proposal's status page will use them, then every state of each part. The screenshot and axe
  tests open it at 1440, 1024 and 390 in both appearances (tests/e2e/support.ts, `previews`).
*/

const about = ['Units sold', 'Norway', '4 Aug 2026']
const domainOf = () => domains.sales

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h2 className="text-large font-bold">{title}</h2>
      {children}
    </section>
  )
}

/** The status page's activity for #231, newest first. */
export function StatusTimeline() {
  return (
    <Timeline>
      <TimelineEvent
        kind="commented"
        actor="You"
        action="replied"
        at="2026-10-08T09:30:00Z"
        body="Will do. The notice is in Norway's own language, so I will add the English summary as the quote."
      />
      <TimelineEvent
        kind="changes_requested"
        actor="Jon Abara"
        action="asked for changes"
        at="2026-10-08T09:12:00Z"
        body="Please add the link to the customs notice and say whether orders in other markets are affected. We do not know when it ends, so set a date to check this again."
      />
      <TimelineEvent
        kind="claimed"
        actor="Jon Abara"
        action="claimed this review"
        at="2026-10-08T09:05:00Z"
      />
      <TimelineEvent kind="checked" action="Checks ran" at="2026-10-07T16:40:00Z">
        <CheckOutcomes gate={normalGate} />
      </TimelineEvent>
      <TimelineEvent
        kind="submitted"
        actor="You"
        action="submitted it for review"
        at="2026-10-07T16:38:00Z"
        detail="Revision 3. Review time for Sales is 2 working days."
      />
      <TimelineEvent
        kind="started"
        actor="You"
        action="started this draft"
        at="2026-10-07T16:20:00Z"
        detail="Web form. Saved automatically 14 times."
      />
    </Timeline>
  )
}

/** The events the status timeline does not show above: the endings and the hand-overs. */
export function OtherEvents() {
  return (
    <Timeline aria-label="Other events">
      <TimelineEvent
        kind="accepted"
        actor="Jon Abara"
        action="accepted it"
        at="2026-10-09T10:02:00Z"
        detail={
          <span className="inline-flex flex-wrap items-center gap-1">
            Published in edition <EditionLabel label="2026-10-09.1" />
          </span>
        }
      />
      <TimelineEvent
        kind="approved"
        actor="Jon Abara"
        action="accepted it as owner"
        at="2026-10-09T09:40:00Z"
        detail="High risk: Lars Dahl, the approver, decides next."
      />
      <TimelineEvent
        kind="handed_over"
        actor="Jon Abara"
        action="handed it to Sofia Brandt"
        at="2026-10-08T15:00:00Z"
      />
      <TimelineEvent kind="checked" tone="danger" action="Checks ran" at="2026-10-08T14:10:00Z">
        <CheckOutcomes gate={mixedGate} />
      </TimelineEvent>
      <TimelineEvent
        kind="rejected"
        actor="Sofia Brandt"
        action="rejected it"
        at="2026-10-08T12:00:00Z"
        body="This changes how Units sold is defined. That belongs in the source tool, not in a context item."
      />
      <TimelineEvent
        kind="withdrawn"
        actor="You"
        action="withdrew it"
        at="2026-10-08T11:00:00Z"
        body="Duplicate of #226."
      />
    </Timeline>
  )
}

export function ProposalPartsPreview() {
  return (
    <Page title="Proposal parts" data-template="proposal-parts">
      <PageDocument>
        <article className="flex w-full max-w-reading min-w-0 flex-col gap-8" data-slot="paper">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind="event" />
              <DomainBadge name="Sales" label="teal" />
              <ProposalStatusBadge state="changes_requested" />
            </div>
            <p className="text-display font-bold text-balance">
              Online sales to Norway stopped on 4 August 2026 after a new customs rule
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PersonChip role="proposer" name="Maria Lindqvist" you date="2026-10-07" />
              <PersonChip role="reviewer" name="Jon Abara" />
            </div>
          </div>
          <Section title="Activity">
            <StatusTimeline />
          </Section>
        </article>
        <PageRail aria-label="Checks and overlaps" className="max-w-reading">
          <GateResult gate={normalGate} risk="normal" />
          <OverlapList overlap={statusOverlap} />
          <AgentPreview state="ready" result={matchedReply} about={about} domainOf={domainOf} />
        </PageRail>
      </PageDocument>
      <PageContent width="overview" className="pb-16">
        <Section title="Proposal states">
          <div className="flex flex-wrap items-center gap-3">
            {proposalStates.map((state) => (
              <ProposalStatusBadge key={state} state={state} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {proposalStates.map((state) => (
              <ProposalStatusBadge key={state} state={state} size="sm" />
            ))}
          </div>
        </Section>
        <Section title="People and editions">
          <div className="flex flex-wrap items-center gap-2">
            {personRoles.map((role) => (
              <PersonChip key={role} role={role} name="Jon Abara" />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {personRoles.map((role) => (
              <PersonChip key={role} role={role} name="Jon Abara" you />
            ))}
            <PersonChip role="claimed" name="Jon Abara" you form="soft" />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-dense">
            <span className="inline-flex items-center gap-2">
              Live edition <EditionLabel label={LIVE_EDITION} />
            </span>
            <span className="inline-flex items-center gap-2">
              Version <EditionLabel label="itm_gsw2q4i1 v2" what="version" />
            </span>
          </div>
        </Section>
        <Section title="Checks">
          <div className="grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
            <GateResult gate={highGate} risk="high" numbered />
            <GateResult gate={mixedGate} risk="high" numbered />
            <GateResult gate={formatFailedGate} risk="low" />
            <GateResult gate={unreadableGate} />
            <GateResult gate={normalGate} risk="normal" variant="folded" />
            <GateResult gate={mixedGate} risk="high" variant="folded" />
          </div>
        </Section>
        <Section title="Other events">
          <div className="max-w-reading">
            <OtherEvents />
          </div>
          <div className="max-w-reading">
            <TimelineSkeleton />
          </div>
        </Section>
        <Section title="What an agent will see">
          <div className="grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
            <AgentPreview state="ready" result={conflictReply} about={about} domainOf={domainOf} />
            <AgentPreview state="ready" result={noMatchReply} about={['Units sold', 'Spain']} />
            <AgentPreview state="waiting" />
            <AgentPreview state="loading" about={about} />
            <AgentPreview state="ready" result={checkFailedReply} />
            <AgentPreview state="ready" result={noMatchReply} published />
          </div>
        </Section>
        <Section title="Overlaps">
          <div className="grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
            <OverlapList overlap={fullOverlap} title="Already in the library" />
            <OverlapList overlap={noOverlap} title="Already in the library" />
            <OverlapList overlap={longTitleOverlap} />
            <OverlapList overlap={undefined} loading />
          </div>
        </Section>
      </PageContent>
    </Page>
  )
}
