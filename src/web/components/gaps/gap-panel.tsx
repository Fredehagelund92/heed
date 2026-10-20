import { useQuery } from '@tanstack/react-query'
import { type Gap, type GapDetail } from '@/api'
import { areasQuery, gapQuery, vocabularyQuery } from '@/api/queries'
import { ShapesIcon } from '@/components/icons'
import { DockPanel } from '@/components/page/dock-panel'
import { Badge } from '@/components/ui/badge'
import { gapOriginNames, gapTypeNames, monthText, reportedByPeople, topicTitle } from '@/lib/gaps'
import { formatDay } from '@/lib/library'
import { GapActions, GapDetails, GapDrafts, GapNotes, GapTopic, WeeklyCounts } from './gap-body'
import { FromPeopleBadge, GapStatusBadge, TopicDomainBadge, VerifiedBadge } from './gap-marks'

/*
  One gap in the docked panel beside the list (the Gaps page, slice W9; design round 3,
  direction A): what agents asked about, the weekly counts as a chart with a table alternative,
  the details, the drafts it started and, for the domain's owners and administrators, its
  notes and its status with a reason. Start a draft makes a draft filled with the topic's scope
  and opens it in the Add context form (FR-616). It was a modal sheet; as a panel the list stays
  in reach, j and k step through the gaps and Escape closes it, back to the row. The body is
  the gap's record body (gap-body.tsx), which the Workbench shows too. Verified by test shows
  beside the status for every reader (FR-610); which tests verify it is for its owners.
*/
export function GapPanel({
  gapId,
  placeholder,
  minimum,
  position,
  onPrevious,
  onNext,
  onClose,
}: {
  gapId: string
  /** The gap as the list has it, shown while its details load. */
  placeholder: Gap | undefined
  /** `privacy.min_count`, or null while it is not known (every count but zero is hidden). */
  minimum: number | null
  /** Where the gap is in the list, when it is in it. */
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}) {
  const detail = useQuery(gapQuery(gapId))
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const gap: Gap | GapDetail | undefined = detail.data ?? placeholder
  const shared = {
    meta: (
      <>
        <span className="truncate">Gap</span>
        {position ? (
          <span className="shrink-0">
            · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
          </span>
        ) : null}
      </>
    ),
    onPrevious,
    onNext,
    onClose,
  }

  if (detail.data === null || (!gap && detail.isError)) {
    return (
      <DockPanel
        title={detail.isError ? "We couldn't load this gap" : "This gap isn't available"}
        {...shared}
      >
        <p className="text-body text-muted-foreground">
          {detail.isError
            ? 'Check your connection, then try again.'
            : 'It may have closed, or its counts are now too small to show.'}
        </p>
      </DockPanel>
    )
  }
  if (!gap) return <DockPanel title={null} {...shared} />

  const title = topicTitle(gap.topic, vocabulary)
  const notes = detail.data ? detail.data.notes : undefined
  return (
    <DockPanel
      title={title}
      contentKey={gap.id}
      badges={
        <div className="flex flex-wrap items-center gap-2">
          <GapStatusBadge status={gap.status} />
          {detail.data?.verifiedAt && detail.data.verifiedEdition ? (
            <VerifiedBadge title={`Checked ${formatDay(detail.data.verifiedAt, 'long')}`} />
          ) : null}
          <Badge form="outline" icon={ShapesIcon}>
            {gapTypeNames[gap.type]}
          </Badge>
          <TopicDomainBadge topic={gap.topic} areas={areas} />
          {reportedByPeople(gap) ? <FromPeopleBadge /> : null}
        </div>
      }
      note={
        <p className="text-body text-muted-foreground">
          {monthText(gap.topic.month)}. {gapOriginNames[gap.openedBy]}.
        </p>
      }
      {...shared}
    >
      <div key={gap.id} className="flex flex-col gap-8">
        <GapActions gap={gap} areas={areas} />

        <div className="flex flex-col gap-8 border-t pt-6">
          <GapTopic gap={gap} vocabulary={vocabulary} />

          <WeeklyCounts gap={gap} minimum={minimum} />

          <GapDetails gap={gap} minimum={minimum} />

          <GapDrafts gap={gap} />

          <GapNotes gapId={gap.id} notes={notes} />
        </div>
      </div>
    </DockPanel>
  )
}
