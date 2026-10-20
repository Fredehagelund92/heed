import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  ClockIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GaugeIcon,
  HeedRecheckDueIcon,
  ListChecksIcon,
  SearchXIcon,
  type Icon,
} from '@/components/icons'
import { gapStatusLook } from '@/components/gaps/gap-marks'
import { workbenchRowClass, workbenchRowTitleClass } from '@/components/page/workbench'
import { TruncatedText } from '@/components/ui/truncated-text'
import { panelRowHistory } from '@/lib/history'
import type { WorkbenchSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import type { WorkMark, WorkRow as Row, WorkSubject } from '@/lib/workbench'

/*
  One row of the Workbench's work list (Workbench plan, 3.2): the kind of record as a quiet
  glyph, the title in 14/20 on one line, and under it the reason in 12/16: the status word in its
  tone with its own glyph, so it never relies on colour, then why. The whole row is the link that
  opens the record. Hover is the accent, the open row tinted with a 2 pixel ink edge as in every
  list beside a record (contract 8.12 rule 7), the keyboard's focus a ring. At least 40 high; on a
  phone 56, with the title on up to two lines.
*/

const subjectGlyphs: Record<WorkSubject, Icon> = {
  question: FlaskConicalIcon,
  gap: SearchXIcon,
  item: FileTextIcon,
  run: GaugeIcon,
}
const subjectWords: Record<WorkSubject, string> = {
  question: 'Test question',
  gap: 'Gap',
  item: 'Fact',
  run: 'Run',
}

const markGlyphs: Record<WorkMark, Icon> = {
  worse: ArrowDownIcon,
  better: ArrowUpIcon,
  fail: CircleXIcon,
  no_answer: CircleHelpIcon,
  pass: CircleCheckIcon,
  not_run: CircleDashedIcon,
  review: HeedRecheckDueIcon,
  untested: ListChecksIcon,
  run: ClockIcon,
  gap_open: gapStatusLook.open.glyph,
  gap_proposal_made: gapStatusLook.proposal_made.glyph,
  gap_wont_fix: gapStatusLook.wont_fix.glyph,
  gap_resolved: gapStatusLook.resolved.glyph,
}

/** The words of the row's reason line: its status, then why. */
function WorkReason({ row, areaName }: { row: Row; areaName?: string | null }) {
  const Glyph = markGlyphs[row.status.mark]
  const rest = [row.reason, areaName].filter(Boolean).join(' · ')
  return (
    <span className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
      <span
        data-slot="work-status"
        data-tone={row.status.tone ?? undefined}
        className={cn(
          'inline-flex shrink-0 items-center gap-1',
          row.status.tone && 'text-tone-ink',
        )}
      >
        <Glyph aria-hidden="true" className="size-3" />
        {row.status.label}
      </span>
      {rest ? <TruncatedText text={rest}>· {rest}</TruncatedText> : null}
    </span>
  )
}

export function WorkRow({
  row,
  areaName,
  search,
  open,
  replace,
}: {
  row: Row
  /** The domain's name, when the list spans more than one. */
  areaName?: string | null
  /** The address that opens the row. */
  search: WorkbenchSearch | null
  /** Whether the row's record is open. */
  open: boolean
  /** Whether a record is open already, so opening this one replaces it in the history. */
  replace: boolean
}) {
  const Glyph = subjectGlyphs[row.subject]
  const body: ReactNode = (
    <span className="flex min-w-0 flex-col">
      <span data-slot="work-title" className={workbenchRowTitleClass}>
        {row.title}
      </span>
      <WorkReason row={row} areaName={areaName} />
    </span>
  )
  return (
    <li
      data-row-id={row.open ?? row.key}
      data-group={row.group ?? undefined}
      data-open={open || undefined}
      className={workbenchRowClass}
    >
      {/* The glyph centres on the title's first line. */}
      <span className="flex h-5 shrink-0 items-center">
        <Glyph
          aria-label={subjectWords[row.subject]}
          role="img"
          className="size-4 text-muted-foreground"
        />
      </span>
      {search ? (
        <Link
          from="/health"
          to="/health"
          search={search}
          {...panelRowHistory(replace)}
          resetScroll={false}
          data-row-link
          aria-current={open ? 'true' : undefined}
          className="min-w-0 flex-1 outline-none after:absolute after:inset-0"
        >
          {body}
        </Link>
      ) : (
        <span className="min-w-0 flex-1">{body}</span>
      )}
    </li>
  )
}
