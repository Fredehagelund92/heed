import type { ReactElement, ReactNode } from 'react'
import type { ProposalRecord } from '@/api'
import { DockPanel, useDockMode, type DockTab } from '@/components/page/dock-panel'
import { PageRail } from '@/components/page/page-rail'
import { ProposalStepper } from '@/components/proposal/proposal-stepper'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import {
  ProposalPreview,
  StatusActivity,
  StatusBadges,
  StatusAttachedTests,
  StatusChecks,
  StatusDetails,
  StatusDialogs,
  StatusEditButton,
  StatusFields,
  StatusIssueNote,
  StatusOverlaps,
  StatusPeople,
  StatusWord,
  useProposalStatus,
} from './status-parts'

/*
  A proposal in status mode in the docked panel of the Proposals page (design round 3, direction
  A): where one of the person's own proposals stands, read beside the list. The badges, the title,
  who is involved and the reviewer's word; the tabs Activity (the four steps, the timeline and
  the reply), Fields, What an agent would answer, and Checks (with the overlaps and the details);
  and the page's actions in the footer: Continue editing or Edit and resubmit, Withdraw or
  Discard draft. Writing stays on the page editor, which the edit button opens.
*/

export const statusPanelTabs = ['activity', 'fields', 'preview', 'checks'] as const
export type StatusPanelTab = (typeof statusPanelTabs)[number]

const tabs: DockTab<StatusPanelTab>[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'fields', label: 'Fields' },
  { value: 'preview', label: 'What AI apps get' },
  { value: 'checks', label: 'Checks' },
]

export function StatusPanel({
  proposal,
  tab: requested,
  onTabChange,
  meta,
  onPrevious,
  onNext,
  onClose,
  expand,
}: {
  proposal: ProposalRecord
  /** The tab the address asks for; Activity when it is not one of the panel's. */
  tab: string | undefined
  onTabChange: (tab: StatusPanelTab) => void
  meta: ReactNode
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
  expand: ReactElement
}) {
  const status = useProposalStatus(proposal)
  const touch = useDockMode() === 'full'
  const size = touch ? 'touch' : undefined
  const { primary, secondary } = status
  const tab: StatusPanelTab = (statusPanelTabs as readonly string[]).includes(requested ?? '')
    ? (requested as StatusPanelTab)
    : 'activity'

  return (
    <>
      <DockPanel
        title={status.title}
        contentKey={proposal.id}
        meta={meta}
        badges={<StatusBadges status={status} />}
        note={
          <>
            <StatusPeople status={status} />
            <StatusWord status={status} />
            <StatusIssueNote status={status} />
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
          primary || secondary ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              {secondary ? (
                <Button
                  variant="outline"
                  size={size}
                  className={touch && !primary ? 'flex-1' : undefined}
                  onClick={secondary.open}
                >
                  <secondary.icon />
                  {secondary.label}
                </Button>
              ) : null}
              {primary ? (
                <StatusEditButton
                  status={status}
                  label={primary}
                  size={touch ? 'touch' : 'default'}
                  className={touch ? 'flex-1' : undefined}
                />
              ) : null}
            </div>
          ) : undefined
        }
      >
        <PageRail placement="panel">
          <TabsContent value="activity" className="flex flex-col gap-8 text-body">
            <ProposalStepper steps={status.steps} />
            <StatusActivity status={status} headingLevel={3} />
          </TabsContent>
          <TabsContent value="fields" className="flex flex-col gap-8 text-body">
            <StatusFields status={status} />
          </TabsContent>
          <TabsContent value="preview" className="flex flex-col gap-8 text-body">
            <ProposalPreview proposal={proposal} headingLevel={3} />
          </TabsContent>
          <TabsContent value="checks" className="flex flex-col gap-6 text-body">
            <StatusChecks status={status} variant="card" headingLevel={3} />
            <StatusAttachedTests status={status} headingLevel={3} />
            <StatusOverlaps status={status} headingLevel={3} />
            <StatusDetails status={status} headingLevel={3} />
          </TabsContent>
        </PageRail>
      </DockPanel>
      <StatusDialogs status={status} onDiscarded={onClose} />
    </>
  )
}
