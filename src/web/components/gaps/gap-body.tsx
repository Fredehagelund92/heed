import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { GapStatus } from '@domain/gaps'
import { describeApiError, toApiError, type Gap, type GapDetail } from '@/api'
import { proposalQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  BotIcon,
  CalendarIcon,
  ChartColumnIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FilePenIcon,
  FilePlusIcon,
  FlagIcon,
  HistoryIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  NotebookPenIcon,
  RotateCcwIcon,
  ScaleIcon,
  SearchXIcon,
  ShapesIcon,
  SigmaIcon,
  TableIcon,
  TargetIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  UsersIcon,
  type Icon,
} from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { DomainBadge, KindIcon, ProposalStatusBadge } from '@/components/item/item-marks'
import { RecordSection } from '@/components/page/record-parts'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import {
  gapOriginNames,
  gapTypeHints,
  gapTypeNames,
  gapWeeks,
  monthText,
  privacyNote,
  shownCount,
  topicParts,
  type WeekPoint,
} from '@/lib/gaps'
import { formatDay, formatMoment } from '@/lib/library'
import { proposalTitle, refusedTextMessage } from '@/lib/proposals'
import { cn } from '@/lib/utils'
import { GapCount, GapStatusBadge } from './gap-marks'

/*
  A gap's record body, without a frame (Workbench plan, slice W6a): what agents asked about, the
  weekly counts as a chart with a table alternative, the details, the drafts it started and, for
  the domain's owners and administrators, its notes; and its actions, Start a draft and the
  status changes with a reason. The Gaps page's docked panel and the Workbench's record pane both
  show it. A count under the privacy minimum never shows (`shownCount`, `gapWeeks`).
*/

// Recharts is loaded only when a gap's record draws its chart (contract 7.1).
const WeeklyChart = lazy(() => import('./weekly-chart'))

/** A note is at most 500 characters (FR-611). */
const NOTE_MAX = 500

type Vocabulary = Parameters<typeof topicParts>[1]

/** What agents asked about: the topic's metrics, dimension values and month. */
export function GapTopic({ gap, vocabulary }: { gap: Gap; vocabulary: Vocabulary }) {
  return (
    <RecordSection title="What agents asked about" icon={TargetIcon}>
      <TopicBadges gap={gap} vocabulary={vocabulary} />
    </RecordSection>
  )
}

/** The gap's facts: its type, origin, days, status and severity, and its counts. */
export function GapDetails({ gap, minimum }: { gap: Gap; minimum: number | null }) {
  return (
    <RecordSection title="Details" icon={ShapesIcon}>
      <FieldTable label="Details of the gap">
        <FieldRow icon={ShapesIcon} label="Type" hint={gapTypeHints[gap.type]}>
          {gapTypeNames[gap.type]}
        </FieldRow>
        <FieldRow icon={FlagIcon} label="Opened by">
          {gapOriginNames[gap.openedBy]}
        </FieldRow>
        <FieldRow icon={CalendarIcon} label="First seen">
          {formatDay(gap.firstSeen, 'long')}
        </FieldRow>
        <FieldRow icon={HistoryIcon} label="Last seen">
          {formatDay(gap.lastSeen, 'long')}
        </FieldRow>
        <FieldRow icon={CircleDashedIcon} label="Status">
          <span>
            <GapStatusBadge status={gap.status} size="sm" />
          </span>
          <span className="text-caption text-muted-foreground">
            Since {formatMoment(gap.statusSince)}
          </span>
        </FieldRow>
        <FieldRow icon={ScaleIcon} label="Severity" hint="How much it matters, from 1 to 4.">
          <span className="tabular-nums">{gap.severity} of 4</span>
        </FieldRow>
        <FieldRow icon={MessageSquareIcon} label="Reports">
          <GapCount count={shownCount(gap.reports, minimum)} />
        </FieldRow>
        <FieldRow
          icon={UsersIcon}
          label="From people"
          hint="Reports people sent from Try a question or the assistant. We never record who sent them."
        >
          <GapCount count={shownCount(gap.personReports, minimum)} />
        </FieldRow>
        <FieldRow
          icon={SearchXIcon}
          label="Found nothing"
          hint="Times an agent asked and got no fact."
        >
          <GapCount count={shownCount(gap.noItemCalls, minimum)} />
        </FieldRow>
      </FieldTable>
    </RecordSection>
  )
}

/** The drafts and proposals the gap started. */
export function GapDrafts({ gap }: { gap: Gap }) {
  return (
    <RecordSection title="Drafts from this gap" icon={FilePenIcon}>
      {gap.proposals.length ? (
        <ul className="flex flex-col divide-y rounded-lg border" aria-label="Drafts from this gap">
          {gap.proposals.map((id) => (
            <DraftLink key={id} id={id} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">
          No draft yet. Start one to give agents what they were missing.
        </p>
      )}
    </RecordSection>
  )
}

/**
 * The gap's notes and a box to add one, for the owners of its domain and administrators. The
 * notes are undefined while they load and null for anyone else.
 */
export function GapNotes({
  gapId,
  notes,
}: {
  gapId: string
  notes: GapDetail['notes'] | undefined
}) {
  return (
    <RecordSection title="Notes" icon={NotebookPenIcon}>
      {notes === undefined ? (
        <Skeleton className="h-control-lg w-full" />
      ) : notes === null ? (
        <p className="text-body text-muted-foreground">
          Notes are for the owners of this domain and admins.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {notes.length ? (
            <ul className="flex flex-col gap-3" aria-label="Notes">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} />
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No notes yet.</p>
          )}
          <NoteComposer gapId={gapId} />
        </div>
      )}
    </RecordSection>
  )
}

/** The topic's scope as the outline chips of "Where it applies", and its month. */
function TopicBadges({ gap, vocabulary }: { gap: Gap; vocabulary: Vocabulary }) {
  const { metrics, values } = topicParts(gap.topic, vocabulary)
  return (
    <ul className="flex flex-wrap gap-2" aria-label="The metrics, names and month it's about">
      {metrics.map((metric) => (
        <li key={metric.key}>
          <Badge form="outline" icon={SigmaIcon}>
            {metric.name}
          </Badge>
        </li>
      ))}
      {values.map((value) => (
        <li key={value.key}>
          <Badge form="outline">
            <span className="text-muted-foreground">{value.dimension}</span>{' '}
            <span className="font-bold">{value.name}</span>
          </Badge>
        </li>
      ))}
      <li>
        <Badge form="outline" icon={CalendarIcon}>
          {monthText(gap.topic.month)}
        </Badge>
      </li>
    </ul>
  )
}

/**
 * The weekly counts as a chart, with the same numbers as a table (contract 11, "Charts"). The
 * chart is a picture only; the table is the version a screen reader reads, and anyone can switch
 * to it.
 */
export function WeeklyCounts({ gap, minimum }: { gap: Gap; minimum: number | null }) {
  const weeks = gapWeeks(gap, minimum)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  if (!weeks.length)
    return (
      <RecordSection title="Weekly counts" icon={ChartColumnIcon}>
        <p className="text-body text-muted-foreground">No weeks to show yet.</p>
      </RecordSection>
    )
  return (
    <Tabs value={view} onValueChange={(next: 'chart' | 'table') => setView(next)}>
      <RecordSection
        title="Weekly counts"
        icon={ChartColumnIcon}
        action={
          <TabsList aria-label="Show the weekly counts as">
            <TabsTrigger value="chart">
              <ChartColumnIcon aria-hidden="true" />
              Chart
            </TabsTrigger>
            <TabsTrigger value="table">
              <TableIcon aria-hidden="true" />
              Table
            </TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="chart" className="flex flex-col gap-3">
          <p className="sr-only">
            The chart shows the reports and the calls that found nothing of the table, which also
            shows the reports from people. Choose Table to read them.
          </p>
          <Suspense fallback={<Skeleton className="h-chart w-full" />}>
            <WeeklyChart weeks={weeks} />
          </Suspense>
        </TabsContent>
        <TabsContent value="table">
          <WeeksTable weeks={weeks} />
        </TabsContent>
        <p className="text-caption text-muted-foreground">{privacyNote(minimum)}</p>
      </RecordSection>
    </Tabs>
  )
}

export function WeeksTable({ weeks }: { weeks: readonly WeekPoint[] }) {
  return (
    <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-lg border text-dense">
      <caption className="sr-only">Weekly counts of the gap</caption>
      <thead className="text-left text-muted-foreground">
        <tr>
          <th scope="col" className="border-b px-3 py-2 font-bold">
            Week of
          </th>
          <th scope="col" className="border-b border-l px-3 py-2 text-right font-bold">
            Reports
          </th>
          <th scope="col" className="border-b border-l px-3 py-2 text-right font-bold">
            From people
          </th>
          <th scope="col" className="border-b border-l px-3 py-2 text-right font-bold">
            Found nothing
          </th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, index) => (
          <tr key={week.week}>
            <th
              scope="row"
              className={cn('px-3 py-2 text-left font-normal', index > 0 && 'border-t')}
            >
              {formatDay(week.week)}
            </th>
            <td className={cn('border-l px-3 py-2 text-right', index > 0 && 'border-t')}>
              <GapCount count={week.reports} />
            </td>
            <td className={cn('border-l px-3 py-2 text-right', index > 0 && 'border-t')}>
              <GapCount count={week.personReports} />
            </td>
            <td className={cn('border-l px-3 py-2 text-right', index > 0 && 'border-t')}>
              <GapCount count={week.noItemCalls} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A draft or proposal the gap started: its title and where it stands, when the person may see it. */
export function DraftLink({ id }: { id: string }) {
  const { data: proposal, isPending } = useQuery(proposalQuery(id))
  if (isPending)
    return (
      <li className="px-3 py-3">
        <Skeleton className="h-5 w-2/3" />
      </li>
    )
  if (!proposal)
    return (
      <li className="px-3 py-3 text-body text-muted-foreground">A draft someone else is writing</li>
    )
  return (
    <li className="relative flex min-h-control-touch items-center gap-3 px-3 py-2 hover:bg-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring">
      <KindIcon kind={proposal.draft.kind ?? 'note'} />
      <Link
        to="/proposals/$proposalId"
        params={{ proposalId: proposal.id }}
        className="min-w-0 flex-1 truncate text-body font-bold outline-none after:absolute after:inset-0"
      >
        {proposalTitle(proposal)}
      </Link>
      <ProposalStatusBadge state={proposal.state} size="sm" />
    </li>
  )
}

const noteSources: Record<
  NonNullable<GapDetail['notes']>[number]['source'],
  { icon: Icon; name: string }
> = {
  report_gap: { icon: BotIcon, name: "From an agent's report" },
  feedback: { icon: MessageCircleIcon, name: 'From feedback on an answer' },
  owner: { icon: UserRoundIcon, name: 'Owner note' },
  person: { icon: UsersIcon, name: "From a person's report" },
}

function NoteRow({ note }: { note: NonNullable<GapDetail['notes']>[number] }) {
  const source = noteSources[note.source]
  return (
    <li className="flex flex-col gap-1 rounded-lg border px-4 py-3">
      <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <source.icon aria-hidden="true" className="size-icon-sm" />
        <span>{source.name}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={note.createdHour} title={formatMoment(note.createdHour, 'long')}>
          {formatMoment(note.createdHour)}
        </time>
      </p>
      <p className="text-body whitespace-pre-line">{note.note}</p>
    </li>
  )
}

function NoteComposer({ gapId }: { gapId: string }) {
  const addNote = useApiWrite('addGapNote')
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const showSpinner = usePendingIndicator(addNote.isPending)
  const count = [...text].length

  const save = async () => {
    const note = text.trim()
    if (!note) return setProblem('Write a note first.')
    if ([...note].length > NOTE_MAX) return setProblem(`Keep it to ${NOTE_MAX} characters.`)
    setProblem(null)
    try {
      await addNote.mutateAsync({ id: gapId, note })
      setText('')
    } catch (error) {
      const failure = toApiError(error)
      setProblem(
        refusedTextMessage(failure.findings) ??
          (failure.kind === 'forbidden'
            ? 'Only the owners of this domain and admins can add notes.'
            : "We couldn't save the note. Try again."),
      )
    }
  }

  return (
    <form
      aria-label="Add a note"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <Field invalid={Boolean(problem)} disabled={addNote.isPending}>
        <FieldLabel>Add a note</FieldLabel>
        <FieldDescription>
          For the owners of this domain and admins. Leave out the question, names and personal data.
        </FieldDescription>
        <FieldControl
          value={text}
          onValueChange={(next) => {
            setText(String(next))
            if (problem) setProblem(null)
          }}
          render={<Textarea rows={3} className="resize-y text-body pointer-coarse:text-large" />}
        />
        <FieldFooter>
          <FieldError>{problem}</FieldError>
          <FieldCounter count={count} max={NOTE_MAX} />
        </FieldFooter>
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={addNote.isPending}>
          {showSpinner ? <LoaderCircleIcon className="animate-spin" /> : <NotebookPenIcon />}
          Add note
        </Button>
      </div>
    </form>
  )
}

/** The status changes an owner can make from each status (FR-609). */
export const statusMoves: Record<GapStatus, GapMove[]> = {
  open: ['resolved', 'wont_fix'],
  proposal_made: ['resolved', 'wont_fix'],
  wont_fix: ['open'],
  resolved: ['open'],
}

/** A status an owner sets by hand; a draft sets Draft started. */
export type GapMove = Exclude<GapStatus, 'proposal_made'>

export const statusMove: Record<
  GapMove,
  { label: string; icon: Icon; title: string; effect: string }
> = {
  resolved: {
    label: 'Mark resolved',
    icon: CircleCheckIcon,
    title: 'Mark this gap as resolved?',
    effect: 'It closes. If agents find nothing for this topic again after today, a new gap opens.',
  },
  wont_fix: {
    label: "Won't fix",
    icon: CircleSlashIcon,
    title: "Close this gap as won't fix?",
    effect:
      'It closes and never reopens by itself. Its counts keep growing, so you can look again later.',
  },
  open: {
    label: 'Reopen',
    icon: RotateCcwIcon,
    title: 'Reopen this gap?',
    effect: "It's open again and shows first in the list.",
  },
}

/**
 * Start a draft from the gap (FR-616): a draft filled with the topic's scope, opened in the Add
 * context form. A topic that spans domains asks first which domain reviews the draft.
 */
export function useStartDraft(gap: Gap) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const start = useApiWrite('startDraftFromGap')
  const [areaId, setAreaId] = useState<string | null>(null)
  const [areaProblem, setAreaProblem] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const starting = usePendingIndicator(start.isPending)
  const spansDomains = gap.topic.areaId === null

  const startDraft = async () => {
    if (spansDomains && !areaId) {
      setAreaProblem('Choose the domain that should review the draft.')
      return
    }
    setFailure(null)
    try {
      const draft = await start.mutateAsync({
        id: gap.id,
        ...(spansDomains && areaId ? { areaId } : {}),
      })
      // The service answers with the draft as it was before it linked it to the gap, one
      // revision behind; read it again, so the form's first autosave is not a conflict.
      await queryClient.fetchQuery({ ...proposalQuery(draft.id), staleTime: 0 })
      await navigate({
        to: '/library/new',
        search: { draft: draft.id, asked: gap.topic.month.slice(0, 7) },
      })
    } catch (error) {
      setFailure(error)
    }
  }

  return {
    spansDomains,
    areaId,
    areaProblem,
    chooseArea: (next: string | null) => {
      setAreaId(next)
      setAreaProblem(null)
    },
    startDraft,
    pending: start.isPending,
    starting,
    failure,
  }
}

type StartDraft = ReturnType<typeof useStartDraft>

/** The domain a draft from a topic that spans domains goes to, asked before it starts. */
export function DraftDomainField({ draft, areas }: { draft: StartDraft; areas: readonly Area[] }) {
  const chosen = draft.areaId ? areas.find((area) => area.id === draft.areaId) : undefined
  return (
    <Field invalid={Boolean(draft.areaProblem)}>
      <FieldLabel>Domain for the draft</FieldLabel>
      <FieldDescription>
        This topic spans domains. The owners of the one you choose review the draft.
      </FieldDescription>
      <Select value={draft.areaId} onValueChange={draft.chooseArea}>
        <SelectTrigger size="lg" aria-label="Domain for the draft" className="w-full">
          <SelectValue>
            {chosen ? (
              <DomainBadge name={chosen.name} label={chosen.label} />
            ) : (
              <span className="text-muted-foreground">Choose a domain</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {areas.map((area) => (
            <SelectItem key={area.id} value={area.id}>
              <SelectItemText>
                <DomainBadge name={area.name} label={area.label} />
              </SelectItemText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError>{draft.areaProblem}</FieldError>
    </Field>
  )
}

/** The Start a draft button. */
export function StartDraftButton({ draft, className }: { draft: StartDraft; className?: string }) {
  return (
    <Button className={className} onClick={() => void draft.startDraft()} disabled={draft.pending}>
      {draft.starting ? <LoaderCircleIcon className="animate-spin" /> : <FilePlusIcon />}
      Start a draft
    </Button>
  )
}

/** Why a draft did not start. */
export function StartDraftFailure({ draft }: { draft: StartDraft }) {
  const problem = draft.failure ? describeApiError(draft.failure) : null
  if (!problem) return null
  return (
    <Alert variant="danger" role="alert">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertContent>
        <AlertTitle>{problem.title}</AlertTitle>
        <AlertDescription>
          {toApiError(draft.failure).message || problem.description}
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}

/**
 * What a status change does to the gap's verification by test (FR-610), for its managers, who see
 * its tests: resolving starts it on the live edition, and leaving Resolved clears it.
 */
function verificationEffect(gap: Gap | GapDetail, move: GapMove): string {
  if (!('tests' in gap) || gap.tests === null) return ''
  const active = gap.tests.filter((test) => test.active).length
  if (move === 'resolved')
    return active
      ? ` It counts as checked once ${active === 1 ? 'its linked test passes' : `its ${active} linked tests pass`} on what agents get from today.`
      : ' Link a test to it, so a passing run can check it.'
  if (gap.status === 'resolved' && (gap.resolvedEdition || gap.verifiedAt))
    return gap.verifiedAt
      ? " It no longer counts as checked. Its tests must pass again once it's resolved again."
      : " Its tests must pass on what agents get once it's resolved again."
  return ''
}

/** A status change with its reason, kept in the history log (FR-609). */
export function GapStatusDialog({
  gap,
  move,
  onClose,
}: {
  gap: Gap
  move: GapMove
  onClose: () => void
}) {
  const setStatus = useApiWrite('setGapStatus')
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={statusMove[move].title}
      effect={`${statusMove[move].effect}${verificationEffect(gap, move)}`}
      action={statusMove[move].label}
      actionIcon={statusMove[move].icon}
      reason={{
        required: true,
        hint: 'Kept in the history log with the change. Leave out the question and personal data.',
      }}
      onConfirm={async ({ reason }) => {
        try {
          await setStatus.mutateAsync({ id: gap.id, status: move, reason })
        } catch (error) {
          const failed = toApiError(error)
          throw new Error(
            refusedTextMessage(failed.findings) ??
              (failed.kind === 'conflict' ? failed.message : describeApiError(failed).description),
            { cause: error },
          )
        }
      }}
    />
  )
}

/**
 * The gap's actions: Start a draft for everyone (FR-616), and the status changes with a reason
 * for an owner of the domain or an administrator (FR-609). A topic that spans domains asks which
 * domain reviews the draft first.
 */
export function GapActions({ gap, areas }: { gap: Gap; areas: readonly Area[] }) {
  const draft = useStartDraft(gap)
  const [move, setMove] = useState<GapMove | null>(null)
  return (
    <div className="flex flex-col gap-4">
      {draft.spansDomains ? <DraftDomainField draft={draft} areas={areas} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <StartDraftButton draft={draft} />
        {gap.canManage
          ? statusMoves[gap.status].map((next) => {
              const look = statusMove[next]
              return (
                <Button key={next} variant="outline" onClick={() => setMove(next)}>
                  <look.icon />
                  {look.label}
                </Button>
              )
            })
          : null}
      </div>
      <p className="text-caption text-muted-foreground">
        Start a draft opens a new fact with this topic filled in.
      </p>
      <StartDraftFailure draft={draft} />
      {move ? <GapStatusDialog gap={gap} move={move} onClose={() => setMove(null)} /> : null}
    </div>
  )
}
