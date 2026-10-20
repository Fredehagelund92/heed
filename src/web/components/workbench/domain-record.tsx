import { useMemo } from 'react'
import type { Area } from '@domain/item'
import type { TestQuestion } from '@/api'
import { RecordPane } from '@/components/page/record-pane'
import { DomainOverview, DomainQuestions, DomainRuns } from '@/components/quality/domain-body'
import type { LinkTo } from '@/components/quality/panel-parts'
import { DomainStateMark } from '@/components/quality/quality-marks'
import { useDomainHealth, useLatestVerdicts } from '@/components/quality/use-quality'
import { TabsContent } from '@/components/ui/tabs'
import { formatDay } from '@/lib/library'
import { isActive, type FixAction } from '@/lib/quality'
import type { WorkbenchSearch, WorkbenchTab } from '@/lib/search-params'
import { workbenchTab } from '@/lib/workbench-address'
import { DomainActions } from './action-panel'
import { DomainAbout } from './domain-about'
import { DomainTeam } from './domain-team'
import { placeInBar, type ListPlace } from './links'

/*
  A domain's record in Health (Workbench plan, slice W6b): what the domain is (FR-813), which its
  owner, deputy or an administrator writes on the Overview tab, the domain's record body from
  Quality's docked panel (domain-body.tsx) with its Overview, Test questions and Runs tabs, and
  its Team: the owner, deputy and high-risk approvers, which an administrator changes there.
  The action panel runs it and writes a test question for it.
*/

const tabs = [
  { value: 'overview', label: 'Overview' },
  { value: 'questions', label: 'Test questions' },
  { value: 'runs', label: 'Runs' },
  { value: 'team', label: 'Team' },
] as const

export function DomainRecord({
  id,
  area,
  ready,
  search,
  linkTo,
  questions,
  maintains,
  areaOf,
  place,
  onTab,
  onClose,
  onRun,
  onWrite,
}: {
  id: string
  /** The domain, when the person looks after it. */
  area: Area | undefined
  /** Whether the domains have loaded, so a missing one is missing. */
  ready: boolean
  search: WorkbenchSearch
  linkTo: LinkTo
  /** The domain's test questions the person may read. */
  questions: readonly TestQuestion[]
  maintains: boolean
  areaOf: (id: string | null) => Area | undefined
  /** Where the record is in the work list. */
  place: ListPlace
  onTab: (tab: WorkbenchTab | undefined) => void
  onClose: () => void
  onRun: () => void
  onWrite: (action?: Extract<FixAction, { kind: 'write' }>) => void
}) {
  const areas = useMemo(() => (area ? [area] : []), [area])
  const health = useDomainHealth(areas, questions, Boolean(area))
  const verdicts = useLatestVerdicts(areas, Boolean(area))
  const bar = placeInBar('Domain', place)
  const shared = {
    ...bar,
    meta: <span className="truncate">{bar.meta}</span>,
    onClose,
    contentKey: `domain:${id}`,
  }
  if (!area)
    return (
      <RecordPane
        title={ready ? "This domain isn't available" : null}
        label="Loading the domain"
        {...shared}
      >
        {ready ? (
          <p className="text-body text-muted-foreground">
            It may not exist, or you aren&apos;t one of its owners.
          </p>
        ) : null}
      </RecordPane>
    )
  const row = health.state === 'ready' ? health.rows[0] : undefined
  const active = questions.filter(isActive)
  return (
    <RecordPane
      title={area.name}
      badges={row ? <DomainStateMark state={row.state} /> : null}
      note={
        <p className="text-body text-muted-foreground">
          {active.length.toLocaleString('en')} active test{' '}
          {active.length === 1 ? 'question' : 'questions'}
          {row?.answers ? `, newest weekly run ${formatDay(row.answers.finishedAt)}` : ''}.
        </p>
      }
      tabs={tabs}
      tab={workbenchTab('domain', search.tab) as (typeof tabs)[number]['value']}
      onTabChange={(next) => onTab(next === 'overview' ? undefined : next)}
      tabsLabel={`${area.name} sections`}
      actions={
        <DomainActions area={area} maintains={maintains} onRun={onRun} onWrite={() => onWrite()} />
      }
      {...shared}
    >
      <TabsContent value="overview" className="flex flex-col gap-8">
        <DomainAbout area={area} />
        <DomainOverview
          area={area}
          health={health}
          questions={questions}
          maintains={maintains}
          areaOf={areaOf}
          onWrite={onWrite}
          linkTo={linkTo}
        />
      </TabsContent>
      <TabsContent value="questions" className="flex flex-col gap-3">
        <DomainQuestions area={area} questions={questions} verdicts={verdicts} linkTo={linkTo} />
      </TabsContent>
      <TabsContent value="runs" className="flex flex-col gap-3">
        <DomainRuns areaId={area.id} linkTo={linkTo} />
      </TabsContent>
      <TabsContent value="team" className="flex flex-col gap-3">
        <DomainTeam area={area} />
      </TabsContent>
    </RecordPane>
  )
}
