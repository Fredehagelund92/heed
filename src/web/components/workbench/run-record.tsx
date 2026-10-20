import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { TestQuestion } from '@/api'
import { evalRunQuery } from '@/api/queries'
import { RecordPane } from '@/components/page/record-pane'
import type { LinkTo } from '@/components/quality/panel-parts'
import { AreaBadge } from '@/components/quality/quality-marks'
import {
  RunChanges,
  RunResults,
  RunStateBadge,
  RunSummary,
  Transcript,
} from '@/components/quality/run-body'
import { TabsContent } from '@/components/ui/tabs'
import { comparable, runTitle, runTriggerWords } from '@/lib/quality'
import type { WorkbenchSearch, WorkbenchTab } from '@/lib/search-params'
import { workbenchTab } from '@/lib/workbench-address'
import { RunActions } from './action-panel'
import { placeInBar, type ListPlace } from './links'

/*
  An answer run's record in the Workbench (Workbench plan, slice W6b): the run's record body from
  Quality's docked panel (run-body.tsx) with its Summary, Changes and Results tabs, a try's
  transcript in place of the results, and the run's actions beside it. Changes is there only for
  a run that can be compared, a finished weekly or full run of a domain.
*/

export function RunRecord({
  id,
  search,
  linkTo,
  areaOf,
  questions,
  maintains,
  isAdmin,
  place,
  onTab,
  onClose,
  onRun,
}: {
  id: string
  search: WorkbenchSearch
  linkTo: LinkTo
  areaOf: (id: string) => Area | undefined
  questions: ReadonlyMap<string, TestQuestion>
  maintains: (area: string) => boolean
  isAdmin: boolean
  /** Where the record is in the work list. */
  place: ListPlace
  onTab: (tab: WorkbenchTab | undefined) => void
  onClose: () => void
  onRun: (area: string) => void
}) {
  const detail = useQuery(evalRunQuery(id))
  const bar = placeInBar('Run', place)
  const shared = {
    ...bar,
    meta: <span className="truncate">{bar.meta}</span>,
    onClose,
    contentKey: `run:${id}`,
  }
  if (detail.isPending) return <RecordPane title={null} label="Loading the run" {...shared} />
  if (!detail.data)
    return (
      <RecordPane
        title={detail.isError ? "We couldn't load this run" : "This run isn't available"}
        {...shared}
      >
        <p className="text-body text-muted-foreground">
          {detail.isError
            ? 'Check your connection, then try again.'
            : "It may not exist, or it belongs to a domain you don't own."}
        </p>
      </RecordPane>
    )
  const { run } = detail.data
  const canCompare = comparable(run)
  const tabs = [
    { value: 'overview' as const, label: 'Summary' },
    ...(canCompare ? [{ value: 'changes' as const, label: 'Changes' }] : []),
    { value: 'results' as const, label: 'Results' },
  ]
  const asked = workbenchTab('run', search.tab)
  const tab = asked === 'changes' && !canCompare ? 'overview' : asked
  const area = run.areaId ? areaOf(run.areaId) : undefined
  return (
    <RecordPane
      title={runTitle(run)}
      badges={
        <div className="flex flex-wrap items-center gap-2">
          {run.areaId ? <AreaBadge area={area} /> : null}
          <RunStateBadge run={run} />
        </div>
      }
      note={
        run.trigger ? (
          <p className="text-body text-muted-foreground">
            Started because {runTriggerWords[run.trigger]}.
          </p>
        ) : undefined
      }
      tabs={tabs}
      tab={tab}
      onTabChange={(next) => onTab(next === 'overview' ? undefined : next)}
      tabsLabel="Run sections"
      actions={
        <RunActions
          run={run}
          area={area}
          maintains={run.areaId ? maintains(run.areaId) : false}
          isAdmin={isAdmin}
          onRun={() => run.areaId && onRun(run.areaId)}
        />
      }
      {...shared}
    >
      <TabsContent value="overview" className="flex flex-col gap-8">
        <RunSummary detail={detail.data} />
      </TabsContent>
      {canCompare ? (
        <TabsContent value="changes" className="flex flex-col gap-8">
          <RunChanges run={run} against={search.against} linkTo={linkTo} questions={questions} />
        </TabsContent>
      ) : null}
      <TabsContent value="results" className="flex flex-col gap-8">
        {search.cell ? (
          <Transcript cellId={search.cell} linkTo={linkTo} questions={questions} />
        ) : (
          <RunResults detail={detail.data} linkTo={linkTo} questions={questions} />
        )}
      </TabsContent>
    </RecordPane>
  )
}
