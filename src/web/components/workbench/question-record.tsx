import { useMemo, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { QuestionComparison, TestQuestion } from '@/api'
import { editionItemComparisonQuery } from '@/api/edition-queries'
import { gapListQuery } from '@/api/queries'
import {
  CircleSlashIcon,
  CircleXIcon,
  FlaskConicalIcon,
  HistoryIcon,
  SplitIcon,
} from '@/components/icons'
import { EditionChangeBadge } from '@/components/editions/change-card'
import { RecordPane } from '@/components/page/record-pane'
import { RecordSection } from '@/components/page/record-parts'
import { RecordLink, type LinkTo } from '@/components/quality/panel-parts'
import { AreaBadge, VerdictBadge } from '@/components/quality/quality-marks'
import { QuestionText } from '@/components/quality/question-body'
import { Transcript } from '@/components/quality/run-body'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { versionWords } from '@/lib/editions'
import { formatDay } from '@/lib/library'
import { checkName, isActive, questionStateWords, questionTitle, runKindWords } from '@/lib/quality'
import type { WorkbenchSearch, WorkbenchTab } from '@/lib/search-params'
import { workbenchRecordTabs, workbenchTab } from '@/lib/workbench-address'
import { gapsForScope, questionHistory } from '@/lib/workbench-evidence'
import { QuestionActions } from './action-panel'
import { placeInBar, type ListPlace } from './links'
import { Checks, Delivered, ItemChanges, Outcome, runWords, SameScope } from './question-evidence'
import { CompareButton } from './compare-focus'
import { LinkedGaps } from './gap-tests'
import { TestResult } from './question-result'
import { useQuestionRuns } from './use-question-runs'

/*
  A test question's record in the Workbench (Workbench plan, slice W6b; design round 2, the
  Evidence, Test result and History tabs). It reads the question across two runs (W3's
  `quality.compareQuestion`): the newest weekly run of its domain, or the run in the address, and
  the run the scope strip compares with, or the weekly run before. Evidence: each check on both
  runs, what Heed gave the controlled test on each edition, what changed in those items between
  the two editions (the diff kit's card from `editions.compareItem`), and the gaps on the same
  scope with their anonymous weekly counts, and for whoever maintains its domain the gaps it is
  linked to, which a passing run of it verifies (V5). Test result: the tries per wording on each edition,
  the must-have caveat, a try's answer with the judge's reason, a try's transcript in place.
  History: its runs, the retrieval passes that changed, and the editions that changed its items.

  Everything here is a controlled test: owner-written questions run by the evaluation runner.
  Nothing comes from a person's question in production; the gaps' counts are anonymous calls,
  hidden below the privacy minimum.
*/

const tabWords: Record<'evidence' | 'result' | 'history', string> = {
  evidence: 'Checks',
  result: 'Test result',
  history: 'History',
}
const tabs = workbenchRecordTabs.question.map((value) => ({ value, label: tabWords[value] }))

export function QuestionRecord({
  id,
  question,
  loading,
  area,
  search,
  linkTo,
  maintains,
  questions,
  place,
  onTab,
  onClose,
  onEdit,
  onRun,
  onCompare,
}: {
  id: string
  question: TestQuestion | undefined
  /** The questions are still loading. */
  loading: boolean
  area: Area | undefined
  search: WorkbenchSearch
  linkTo: LinkTo
  maintains: boolean
  questions: ReadonlyMap<string, TestQuestion>
  /** Where the record is in the work list. */
  place: ListPlace
  onTab: (tab: WorkbenchTab | undefined) => void
  onClose: () => void
  onEdit: (question: TestQuestion) => void
  onRun: (area: string) => void
  /** Opens the compare focus: the two runs side by side over the list and the actions. */
  onCompare: () => void
}) {
  const { history, comparison, noRun } = useQuestionRuns({ id, question, search })
  const from = comparison.data?.against?.run.edition
  const to = comparison.data?.run.run.edition
  const items = comparison.data?.items ?? []
  const changes = useQueries({
    queries: items.map((item) => ({
      ...editionItemComparisonQuery({ id: item.itemId, to: to ?? '', from }),
      enabled: !!from && !!to,
    })),
  })
  const changed = items.map((item, index) => ({ item, comparison: changes[index] }))
  const gaps = useQuery({ ...gapListQuery({ limit: 200 }), enabled: !!question })
  const scopeGaps = useMemo(
    () => (question ? gapsForScope(question, gaps.data ?? []) : []),
    [question, gaps.data],
  )

  const { meta: where, ...browsing } = placeInBar('Test question', place)
  const meta = <span className="truncate">{where}</span>
  if (!question)
    return (
      <RecordPane
        title={loading ? null : "This test question isn't available"}
        label="Loading the test question"
        meta={meta}
        {...browsing}
        onClose={onClose}
        contentKey={`question:${id}`}
      >
        {loading ? null : (
          <p className="text-body text-muted-foreground">
            It may have been renamed, or it&apos;s a hidden test question of a domain you don&apos;t
            own.
          </p>
        )}
      </RecordPane>
    )

  const tab = workbenchTab('question', search.tab) as 'evidence' | 'result' | 'history'
  const data = comparison.data
  const worse = data?.against?.verdict === 'pass' && data.run.verdict === 'fail'
  const reading = (body: (data: QuestionComparison) => ReactNode) =>
    noRun ? (
      <p className="text-body text-muted-foreground">
        No weekly run has tested this question yet. A weekly run tests a domain every Monday
        morning.
      </p>
    ) : history.isError || comparison.isError ? (
      <p className="text-body text-muted-foreground">
        We couldn&apos;t compare the runs.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void (history.isError ? history.refetch() : comparison.refetch())}
        >
          Try again
        </button>
      </p>
    ) : !data ? (
      <Skeleton role="status" aria-label="Comparing the runs" className="h-chart w-full" />
    ) : (
      body(data)
    )

  return (
    <RecordPane
      title={questionTitle(question, question.id)}
      meta={meta}
      badges={
        <div className="flex flex-wrap items-center gap-2">
          <AreaBadge area={area} />
          {worse ? (
            <Badge tone="danger" icon={CircleXIcon} data-slot="got-worse">
              Got worse
            </Badge>
          ) : data ? (
            <VerdictBadge verdict={data.run.verdict} />
          ) : null}
          {question.split === 'held_out' ? (
            <Badge form="outline" icon={SplitIcon}>
              Held out
            </Badge>
          ) : null}
          {!isActive(question) ? (
            <Badge tone="warning" icon={CircleSlashIcon}>
              {questionStateWords(question)}
            </Badge>
          ) : null}
        </div>
      }
      note={
        <p className="text-dense text-muted-foreground" data-slot="fixture">
          <FlaskConicalIcon aria-hidden="true" className="inline size-icon-sm heed-ink" /> A test
          question an owner wrote, asked in a controlled test. Nobody asked it for real.
          {data
            ? ` Read from ${runWords(data.run)}${data.against ? `, against ${runWords(data.against)}` : ''}.`
            : ''}
        </p>
      }
      tabs={tabs}
      tab={tab}
      onTabChange={(next) => onTab(next === 'evidence' ? undefined : next)}
      tabsLabel="Test question sections"
      controls={
        <CompareButton
          onCompare={onCompare}
          // Until the runs are read there may be nothing to compare with.
          disabled={!data?.against}
        />
      }
      {...browsing}
      onClose={onClose}
      contentKey={`question:${id}`}
      actions={
        <QuestionActions
          question={question}
          area={area}
          maintains={maintains}
          changed={items}
          gaps={scopeGaps}
          onEdit={() => onEdit(question)}
          onRun={() => onRun(question.area)}
        />
      }
    >
      <TabsContent value="evidence" className="flex flex-col gap-8">
        {reading((data) => (
          <>
            <Checks data={data} retrieval={history.data?.retrieval ?? []} />
            <Delivered question={question} data={data} />
            <ItemChanges data={data} changed={changed} />
          </>
        ))}
        {maintains ? <LinkedGaps question={question} gaps={gaps.data} linkTo={linkTo} /> : null}
        <SameScope gaps={gaps} matching={scopeGaps} linkTo={linkTo} />
        <QuestionText question={question} />
      </TabsContent>
      <TabsContent value="result" className="flex flex-col gap-8">
        {search.cell ? (
          <Transcript cellId={search.cell} linkTo={linkTo} questions={questions} />
        ) : (
          reading((data) => (
            <TestResult question={question} data={data} linkTo={linkTo} onCompare={onCompare} />
          ))
        )}
      </TabsContent>
      <TabsContent value="history" className="flex flex-col gap-8">
        {history.isPending ? (
          <Skeleton role="status" aria-label="Loading the history" className="h-chart w-full" />
        ) : history.isError ? (
          <p className="text-body text-muted-foreground">
            We couldn&apos;t load the history.{' '}
            <button type="button" className="underline" onClick={() => void history.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <History
            events={questionHistory(
              history.data,
              changed.flatMap(({ item, comparison }) =>
                comparison?.data
                  ? [{ itemId: item.itemId, title: item.title, steps: comparison.data.steps }]
                  : [],
              ),
            )}
            linkTo={linkTo}
          />
        )}
      </TabsContent>
    </RecordPane>
  )
}

type Event = ReturnType<typeof questionHistory>[number]

function History({ events, linkTo }: { events: Event[]; linkTo: LinkTo }) {
  if (events.length === 0)
    return (
      <p className="text-body text-muted-foreground">
        Nothing yet: no run or retrieval pass has tested this question.
      </p>
    )
  return (
    <RecordSection title="This test question over time" icon={HistoryIcon}>
      <ol className="flex flex-col divide-y" aria-label="History" data-slot="history">
        {events.map((event, index) => (
          <li key={index} className="flex min-w-0 flex-col gap-1 py-3 first:pt-0">
            <time dateTime={event.at} className="text-caption text-muted-foreground">
              {formatDay(event.at)}
            </time>
            <EventText event={event} linkTo={linkTo} />
          </li>
        ))}
      </ol>
    </RecordSection>
  )
}

function EventText({ event, linkTo }: { event: Event; linkTo: LinkTo }) {
  if (event.kind === 'run')
    return (
      <span className="flex min-w-0 flex-col gap-1 text-dense">
        <span className="flex flex-wrap items-center gap-2">
          <span>
            <RecordLink linkTo={linkTo} record={`run:${event.run.run}`}>
              {runKindWords[event.run.kind]}
            </RecordLink>
          </span>
          {event.run.state === 'tested' ? (
            <VerdictBadge verdict={event.run.verdict} size="sm" />
          ) : (
            <Badge form="outline" quiet size="sm" icon={CircleSlashIcon}>
              {event.run.state === 'set_aside' ? 'Set aside' : 'Not in the run'}
            </Badge>
          )}
        </span>
        {event.run.state === 'tested' && event.run.layers?.failedChecks.length ? (
          <span className="text-muted-foreground">
            Failed: {event.run.layers.failedChecks.map(checkName).join(', ')}.
          </span>
        ) : null}
      </span>
    )
  if (event.kind === 'retrieval')
    return (
      <span className="flex flex-wrap items-center gap-2 text-dense">
        <span>
          Right facts check
          {event.change === 'changed' ? (event.passed ? ', passes again' : ', starts failing') : ''}
        </span>
        <Outcome held={event.passed} />
      </span>
    )
  return (
    <span className="flex min-w-0 flex-col gap-1 text-dense">
      <span className="flex flex-wrap items-center gap-2">
        <EditionChangeBadge change={event.change} />
        <Link
          to="/library/$itemId"
          params={{ itemId: event.itemId }}
          className="min-w-0 break-words underline-offset-3 hover:underline"
        >
          {event.title}
        </Link>
      </span>
      <span className="text-muted-foreground">
        {versionWords({ from: event.from, to: event.to })}
      </span>
    </span>
  )
}
