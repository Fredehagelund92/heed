import { Link } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { GapStatus } from '@domain/gaps'
import type { GapDetail, ProposalRecord, TestQuestion } from '@/api'
import {
  areasQuery,
  gapQuery,
  proposalQuery,
  topicCountsQuery,
  vocabularyQuery,
} from '@/api/queries'
import { GapDetails, GapNotes, GapTopic, WeeklyCounts } from '@/components/gaps/gap-body'
import {
  FromPeopleBadge,
  GapStatusBadge,
  TopicDomainBadge,
  VerifiedBadge,
} from '@/components/gaps/gap-marks'
import { HistoryIcon, ShapesIcon } from '@/components/icons'
import { KindIcon, ProposalStatusBadge } from '@/components/item/item-marks'
import { RecordPane } from '@/components/page/record-pane'
import { RecordSection } from '@/components/page/record-parts'
import { RecordLink, type LinkTo } from '@/components/quality/panel-parts'
import type { QuestionFromGap } from '@/components/quality/question-dialog'
import { Badge } from '@/components/ui/badge'
import { TabsContent } from '@/components/ui/tabs'
import { gapOriginNames, gapTypeNames, monthText, reportedByPeople, topicTitle } from '@/lib/gaps'
import { scopeOfTopic } from '@/lib/gap-verification'
import { formatDay } from '@/lib/library'
import { proposalTitle } from '@/lib/proposals'
import { questionTitle } from '@/lib/quality'
import type { WorkbenchSearch, WorkbenchTab } from '@/lib/search-params'
import { workbenchRecordTabs, workbenchTab } from '@/lib/workbench-address'
import { gapHistory, type GapEvent } from '@/lib/workbench-evidence'
import { GapRecordActions } from './action-panel'
import { LinkedTests, RunName } from './gap-tests'
import { placeInBar, type ListPlace } from './links'

/*
  A gap's record in the Workbench (Workbench plan, slice W6c): the gap's record body from the
  Gaps page's docked panel (gap-body.tsx) with an Evidence tab (what agents asked about, the
  weekly counts as a chart with a table alternative, the details and, for the owners of its
  domain and administrators, its notes) and a History tab (first seen, the drafts it started,
  where it stands since when, last seen). The action panel holds its status changes with a
  reason and Start a draft, as the Gaps page does. A gap the person cannot manage reads the same,
  without the status changes and the notes; the service decides that (`canManage`).

  Since slice V5 it carries its verification by test (FR-610): the tests linked to it with their
  newest result, and in the action panel Resolved and Verified by test as two separate facts,
  linking a test and writing one from the gap. Its managers read its whole lifecycle in History,
  from the history log: each status change with its reason and edition, the tests linked and
  unlinked, its verification.

  Every count is anonymous and hidden below the privacy minimum (`shownCount`, `gapWeeks`); a
  topic is a scope, never a question, and nothing names who asked.
*/

const tabWords: Record<'evidence' | 'history', string> = {
  evidence: 'Overview',
  history: 'History',
}
const tabs = workbenchRecordTabs.gap.map((value) => ({ value, label: tabWords[value] }))

export function GapRecord({
  id,
  search,
  linkTo,
  questions,
  maintains,
  place,
  onTab,
  onClose,
  onRun,
  onWriteTest,
}: {
  id: string
  search: WorkbenchSearch
  linkTo: LinkTo
  /** The test questions the person may read, by id. */
  questions: ReadonlyMap<string, TestQuestion>
  /** Whether the person runs a domain (an owner or deputy of it, or an administrator). */
  maintains: (area: string) => boolean
  /** Where the record is in the work list. */
  place: ListPlace
  onTab: (tab: WorkbenchTab | undefined) => void
  onClose: () => void
  onRun: (area: string) => void
  /** Writes a test question from the gap, linked to it once saved. */
  onWriteTest: (area: string, gap: QuestionFromGap) => void
}) {
  const detail = useQuery(gapQuery(id))
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const counts = useQuery(topicCountsQuery())
  const bar = placeInBar('Gap', place)
  const shared = {
    ...bar,
    meta: <span className="truncate">{bar.meta}</span>,
    onClose,
    contentKey: `gap:${id}`,
  }
  if (detail.isPending) return <RecordPane title={null} label="Loading the gap" {...shared} />
  const gap = detail.data
  if (!gap)
    return (
      <RecordPane
        title={detail.isError ? "We couldn't load this gap" : "This gap isn't available"}
        {...shared}
      >
        <p className="text-body text-muted-foreground">
          {detail.isError
            ? 'Check your connection, then try again.'
            : 'It may have closed, or its counts are now too small to show.'}
        </p>
      </RecordPane>
    )

  const minimum = counts.data?.minimumCount ?? null
  const area: Area | undefined = gap.topic.areaId
    ? areas.find((candidate) => candidate.id === gap.topic.areaId)
    : undefined
  const tab = workbenchTab('gap', search.tab) as 'evidence' | 'history'
  return (
    <RecordPane
      title={topicTitle(gap.topic, vocabulary)}
      badges={
        <div className="flex flex-wrap items-center gap-2">
          <GapStatusBadge status={gap.status} />
          <Badge form="outline" icon={ShapesIcon}>
            {gapTypeNames[gap.type]}
          </Badge>
          <TopicDomainBadge topic={gap.topic} areas={areas} />
          {reportedByPeople(gap) ? <FromPeopleBadge /> : null}
          {gap.verifiedAt && gap.verifiedEdition ? (
            <VerifiedBadge title={`Checked ${formatDay(gap.verifiedAt, 'long')}`} />
          ) : null}
        </div>
      }
      note={
        <p className="text-dense text-muted-foreground">
          {monthText(gap.topic.month)}. {gapOriginNames[gap.openedBy]}. A topic says what was asked
          about, never the question itself. Its counts are anonymous.
        </p>
      }
      tabs={tabs}
      tab={tab}
      onTabChange={(next) => onTab(next === 'evidence' ? undefined : next)}
      tabsLabel="Gap sections"
      actions={
        <GapRecordActions
          gap={gap}
          area={area}
          areas={areas}
          maintains={gap.topic.areaId !== null && maintains(gap.topic.areaId)}
          questions={questions}
          linkTo={linkTo}
          onRun={onRun}
          onWriteTest={() => {
            if (gap.topic.areaId)
              onWriteTest(gap.topic.areaId, {
                id: gap.id,
                scope: scopeOfTopic(gap.topic),
                about: `${topicTitle(gap.topic, vocabulary)}, ${monthText(gap.topic.month)}`,
              })
          }}
        />
      }
      {...shared}
    >
      <TabsContent value="evidence" className="flex flex-col gap-8">
        <GapTopic gap={gap} vocabulary={vocabulary} />
        <LinkedTests gap={gap} questions={questions} linkTo={linkTo} />
        <WeeklyCounts gap={gap} minimum={minimum} />
        <GapDetails gap={gap} minimum={minimum} />
        <GapNotes gapId={gap.id} notes={gap.notes} />
      </TabsContent>
      <TabsContent value="history" className="flex flex-col gap-8">
        <History gap={gap} questions={questions} linkTo={linkTo} />
      </TabsContent>
    </RecordPane>
  )
}

/** Where a gap stands since a moment, in words. */
const statusEventWords: Record<GapStatus, string> = {
  open: 'Open again',
  proposal_made: 'Draft started',
  resolved: 'Marked resolved',
  wont_fix: "Closed as won't fix",
}

function History({
  gap,
  questions,
  linkTo,
}: {
  gap: GapDetail
  questions: ReadonlyMap<string, TestQuestion>
  linkTo: LinkTo
}) {
  const drafts = useQueries({ queries: gap.proposals.map((id) => proposalQuery(id)) })
  const readable = drafts.flatMap((read) => (read.data ? [read.data] : []))
  const unreadable = drafts.filter((read) => read.isSuccess && !read.data).length
  const titles = new Map(readable.map((proposal) => [proposal.id, proposal]))
  const events = gapHistory(
    gap,
    readable.map((proposal) => ({ id: proposal.id, createdAt: proposal.createdAt })),
    gap.history,
  )
  return (
    <RecordSection title="This gap over time" icon={HistoryIcon}>
      <ol className="flex flex-col divide-y" aria-label="History" data-slot="history">
        {events.map((event, index) => (
          <li key={index} className="flex min-w-0 flex-col gap-1 py-3 first:pt-0">
            <time dateTime={event.at} className="text-caption text-muted-foreground">
              {formatDay(event.at)}
            </time>
            <EventText
              event={event}
              gap={gap}
              proposal={titles}
              questions={questions}
              linkTo={linkTo}
            />
          </li>
        ))}
      </ol>
      {unreadable ? (
        <p className="text-caption text-muted-foreground">
          {unreadable === 1
            ? 'And one draft someone else is writing.'
            : `And ${unreadable.toLocaleString('en')} drafts someone else is writing.`}
        </p>
      ) : null}
    </RecordSection>
  )
}

function EventText({
  event,
  gap,
  proposal,
  questions,
  linkTo,
}: {
  event: GapEvent
  gap: GapDetail
  proposal: ReadonlyMap<string, ProposalRecord>
  questions: ReadonlyMap<string, TestQuestion>
  linkTo: LinkTo
}) {
  switch (event.kind) {
    case 'first_seen':
      return <span className="text-dense">First seen. {gapOriginNames[gap.openedBy]}.</span>
    case 'last_seen':
      return <span className="text-dense">Last seen: the newest call or report about it.</span>
    case 'status':
      return (
        <span className="flex min-w-0 flex-col gap-1 text-dense">
          <span className="flex flex-wrap items-center gap-2">
            <span>{statusEventWords[event.status]}</span>
            <GapStatusBadge status={event.status} size="sm" />
          </span>
          {event.reason ? (
            <span className="break-words text-muted-foreground">Why: {event.reason}</span>
          ) : null}
        </span>
      )
    case 'draft': {
      const draft = proposal.get(event.proposal)!
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-dense">
          <span>Draft started:</span>
          <KindIcon kind={draft.draft.kind ?? 'note'} size="sm" />
          <Link
            to="/proposals/$proposalId"
            params={{ proposalId: draft.id }}
            className="min-w-0 break-words underline-offset-3 hover:underline"
          >
            {proposalTitle(draft)}
          </Link>
          <ProposalStatusBadge state={draft.state} size="sm" />
        </span>
      )
    }
    case 'note':
      return <span className="text-dense">An owner added a note.</span>
    case 'test_linked':
    case 'test_unlinked':
      return (
        <span className="min-w-0 text-dense break-words">
          {event.kind === 'test_linked' ? 'Test linked: ' : 'Test unlinked: '}
          <RecordLink linkTo={linkTo} record={`question:${event.question}`} className="underline">
            {questionTitle(questions.get(event.question), event.question)}
          </RecordLink>
        </span>
      )
    case 'verified':
      return (
        <span className="flex flex-wrap items-center gap-2 text-dense">
          <span>
            Its tests passed
            {event.run ? (
              <>
                , by <RunName run={event.run} day={event.at} linkTo={linkTo} />
              </>
            ) : null}
          </span>
          <VerifiedBadge size="sm" />
        </span>
      )
    case 'verification_cleared':
      return (
        <span className="text-dense">
          No longer checked: it left Resolved, so its tests must pass again once it&apos;s resolved
          again.
        </span>
      )
  }
}
