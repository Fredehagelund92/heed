import type { Verdict } from '@domain/golden-question'
import type { Area, Vocabulary } from '@domain/item'
import type { Comparison, EvalRun, Gap, TestQuestion } from '@/api'
import {
  countText,
  gapStageNames,
  gapStatusNames,
  gapTypeNames,
  monthText,
  toGapRow,
  visibleGapRows,
  type GapRow,
  type GapStage,
  type ShownCount,
} from './gaps'
import { formatDay, queryTerms } from './library'
import {
  checkName,
  questionStateWords,
  questionTitle,
  runStateWords,
  runTitle,
  verdictWords,
  visibleQuestions,
  type FixEntry,
} from './quality'
import type { WorkbenchSearch, WorkbenchView } from './search-params'

/*
  The Workbench's work list (Workbench plan, slice W5): one list of what needs the person, from
  the reads Quality and Gaps already make. Fix next gives the order and most of the rows; the
  domain's comparison of two runs says which questions got worse (and better), the same
  comparison the scope strip counts; the gap list gives every gap with its status and counts;
  the test questions and the runs are views of their own. A subject is one row however many
  reads name it, and a row's address is the record it opens (`question:…`, `gap:…`, `item:…`,
  `run:…`).

  Pure, so the order, the de-duplication, the views and the privacy rule are tested without a
  browser. Counts of calls and reports go through the privacy rule (FR-614): a count below the
  minimum reads "fewer than 5", and none is printed until the minimum is known.
*/

/** The list's views, All first: the address leaves All out. */
export const workViews = [
  { id: 'all', title: 'All' },
  { id: 'worse', title: 'Got worse' },
  { id: 'gaps', title: 'Gaps' },
  { id: 'upkeep', title: 'Upkeep' },
  { id: 'questions', title: 'Test questions' },
  { id: 'runs', title: 'Runs' },
] as const
export type WorkViewId = (typeof workViews)[number]['id']

export function workViewOf(view: WorkbenchView | undefined): WorkViewId {
  return view ?? 'all'
}

/** Why a row needs the person: the groups of the work views, in the order they show. */
export const workGroups = [
  'worse',
  'failing',
  'gaps',
  'review',
  'untested',
  'better',
  'gap_open',
  'gap_drafting',
  'gap_closed',
] as const
export type WorkGroup = (typeof workGroups)[number]

const gapGroups: Record<GapStage, WorkGroup> = {
  open: 'gap_open',
  drafting: 'gap_drafting',
  closed: 'gap_closed',
}

/** The tone of a row's status word; null for a quiet one. */
export type WorkTone = 'danger' | 'warning' | 'info' | 'success' | null

/** The glyph before a row's status word, so the status never relies on colour. */
export type WorkMark =
  | 'worse'
  | 'better'
  | 'fail'
  | 'no_answer'
  | 'pass'
  | 'not_run'
  | 'review'
  | 'untested'
  | 'run'
  | `gap_${Gap['status']}`

/** What a row's glyph shows: the kind of record it opens. */
export type WorkSubject = 'question' | 'gap' | 'item' | 'run'

export type WorkRow = {
  /** Unique in the list. */
  key: string
  /** The record the row opens (`question:…`); null for a row that opens nothing (held out). */
  open: string | null
  subject: WorkSubject
  /** Null in the views that are not grouped (Test questions, Runs). */
  group: WorkGroup | null
  title: string
  /** The reason line's first words, in their tone ("Got worse"). */
  status: { label: string; tone: WorkTone; mark: WorkMark }
  /** The rest of the reason line ("Failed: caveat kept"); empty when the status says it all. */
  reason: string
  area: string | null
  /** The row's place in Fix next (0 first); null for a row Fix next does not list. */
  rank: number | null
}

export type WorkInput = {
  /** Fix next's entries, in its order; null until read. */
  fix: readonly FixEntry[] | null
  /** The comparisons of the domains in scope, each its newest run against the run compared with. */
  comparisons: readonly Comparison[]
  /** The gaps the person may read; null until read. */
  gaps: readonly Gap[] | null
  /** The test questions the person may read, by id. */
  questions: ReadonlyMap<string, TestQuestion>
  /** Each question's verdict in its domain's newest weekly run. */
  verdicts: ReadonlyMap<string, { verdict: Verdict | null }>
  /** The runs the person may read, newest first; null until read. */
  runs: readonly EvalRun[] | null
  /** The domains in scope: the one chosen, or every one the person looks after. */
  areas: readonly Area[]
  /** Every domain, so gaps whose topic spans domains are in scope too (administrators). */
  everyArea: boolean
  /** The privacy minimum the counts were hidden by; null until known (every count but 0 hidden). */
  minimum: number | null
  vocabulary: Vocabulary | undefined
}

const fixGroups: Record<FixEntry['kind'], WorkGroup> = {
  regression: 'worse',
  failing_question: 'failing',
  gap: 'gaps',
  past_review: 'review',
  untested: 'untested',
}

const groupOrder = new Map(workGroups.map((group, index) => [group, index]))

/** A held-out question the reader may not see has no id of its own (`held-out`). */
const HELD_OUT = 'held-out'

const gapTones: Record<Gap['status'], WorkTone> = {
  open: 'warning',
  proposal_made: 'info',
  wont_fix: null,
  resolved: null,
}

/** A count of calls or reports through the privacy rule, as words; null when there is none. */
function countWords(count: ShownCount, one: string, many: string): string | null {
  if (count.kind === 'hidden') return null
  if (count.kind === 'value') {
    if (count.value === 0) return null
    return `${countText(count)} ${count.value === 1 ? one : many}`
  }
  return `${countText(count).toLowerCase()} ${many}`
}

/**
 * A gap's reason line: its month, as the Gaps page shows it, so two gaps about the same thing in
 * different months do not read as one (heed-ux A11); its type, the calls that found nothing and
 * the reports, never 1 to 4.
 */
function gapReason(row: GapRow): string {
  return [
    monthText(row.month, 'short'),
    gapTypeNames[row.type],
    countWords(row.noItemCalls, 'call found nothing', 'calls found nothing'),
    countWords(row.reports, 'report', 'reports'),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

function gapRowOf(row: GapRow, group: WorkGroup, rank: number | null): WorkRow {
  return {
    key: `gap:${row.id}`,
    open: `gap:${row.id}`,
    subject: 'gap',
    group,
    title: row.title,
    status: {
      label: gapStatusNames[row.status],
      tone: gapTones[row.status],
      mark: `gap_${row.status}`,
    },
    reason: gapReason(row),
    area: row.areaId,
    rank,
  }
}

const failedWords = (checks: readonly string[]) =>
  checks.length ? `Failed: ${checks.map(checkName).join(', ')}` : ''

/** A question's verdict in the run compared with and in the newest, in words. */
function changeWords(change: Comparison['worse'][number]) {
  return `${verdictWords[change.from]} before, ${verdictWords[change.to].toLowerCase()} now`
}

export function workList(
  input: WorkInput,
  view: WorkViewId,
  filters: Pick<WorkbenchSearch, 'status' | 'type' | 'origin'> = {},
): WorkRow[] {
  switch (view) {
    case 'all':
      return workRows(input)
    case 'worse':
      return workRows(input).filter((row) => row.group === 'worse')
    case 'upkeep':
      return workRows(input).filter((row) => row.group === 'review' || row.group === 'untested')
    case 'gaps':
      return gapRows(input, filters)
    case 'questions':
      return questionRows(input)
    case 'runs':
      return runRows(input)
  }
}

/** How many rows each view has, before the search. */
export function workCounts(input: WorkInput): Record<WorkViewId, number> {
  const rows = workRows(input)
  return {
    all: rows.length,
    worse: rows.filter((row) => row.group === 'worse').length,
    gaps: gapRows(input, {}).length,
    upkeep: rows.filter((row) => row.group === 'review' || row.group === 'untested').length,
    questions: questionRows(input).length,
    runs: runRows(input).length,
  }
}

const inScope = (input: WorkInput) => {
  const ids = new Set(input.areas.map((area) => area.id))
  return (area: string | null) => (area === null ? input.everyArea : ids.has(area))
}

/**
 * The gaps in scope as the Gaps page has them, so a count is hidden the same way. A gap whose topic
 * spans domains is in the scope of each of them.
 */
function scopedGapRows(input: WorkInput): GapRow[] {
  const scoped = inScope(input)
  return (input.gaps ?? [])
    .map((gap) =>
      toGapRow(gap, { areas: input.areas, vocabulary: input.vocabulary, minimum: input.minimum }),
    )
    .filter((row) =>
      row.areaId === null && row.areaIds.length ? row.areaIds.some(scoped) : scoped(row.areaId),
    )
}

/**
 * The work views' rows (All): Fix next in its order, each in the group of why it is there, with
 * the questions the comparison says got worse in Got worse whatever Fix next calls them, so the
 * group counts what the scope strip counts. A question the comparison names that Fix next does
 * not list comes after Fix next's rows of its group; one that got better and is not otherwise
 * listed shows last, under Got better.
 */
function workRows(input: WorkInput): WorkRow[] {
  const scoped = inScope(input)
  type Change = Comparison['worse'][number] & { area: string }
  const worse = new Map<string, Change>()
  const better = new Map<string, Change>()
  // Areas whose comparison is known: there the comparison alone says what got worse.
  const compared = new Set<string>()
  for (const comparison of input.comparisons) {
    if (!scoped(comparison.area) || comparison.against === null) continue
    compared.add(comparison.area)
    for (const change of comparison.worse)
      if (change.id !== HELD_OUT) worse.set(change.id, { ...change, area: comparison.area })
    for (const change of comparison.better)
      if (change.id !== HELD_OUT) better.set(change.id, { ...change, area: comparison.area })
  }
  const gaps = new Map(scopedGapRows(input).map((row) => [row.id, row]))

  const rows: WorkRow[] = []
  const seen = new Set<string>()
  ;(input.fix ?? []).forEach((entry, rank) => {
    const { subject } = entry
    if (!scoped(entry.area) && !(subject.type === 'gap' && gaps.has(subject.id))) return
    if (subject.type === 'question') {
      const heldOut = subject.id === HELD_OUT
      const key = heldOut ? `${HELD_OUT}:${rank}` : `question:${subject.id}`
      if (seen.has(key)) return
      seen.add(key)
      const change = worse.get(subject.id)
      const group: WorkGroup = change
        ? 'worse'
        : entry.kind === 'regression' && entry.area !== null && compared.has(entry.area)
          ? 'failing'
          : fixGroups[entry.kind]
      rows.push({
        key,
        open: heldOut ? null : `question:${subject.id}`,
        subject: 'question',
        group,
        title: questionTitle(input.questions.get(subject.id), subject.id),
        status: questionStatus(group, entry),
        reason: failedWords(change?.failedChecks ?? entry.checks),
        area: entry.area,
        rank,
      })
      return
    }
    const key = `${subject.type}:${subject.id}`
    if (seen.has(key)) return
    seen.add(key)
    if (subject.type === 'gap') {
      const gap = gaps.get(subject.id)
      rows.push(
        gap
          ? gapRowOf(gap, 'gaps', rank)
          : {
              key,
              open: key,
              subject: 'gap',
              group: 'gaps',
              title: `Gap ${subject.label ?? subject.id}`,
              status: { label: 'Open', tone: 'warning', mark: 'gap_open' },
              reason: '',
              area: entry.area,
              rank,
            },
      )
      return
    }
    rows.push(itemRow(entry, rank))
  })

  // What the comparison names that Fix next does not list.
  for (const [id, change] of worse) {
    if (seen.has(`question:${id}`)) continue
    seen.add(`question:${id}`)
    rows.push({
      key: `question:${id}`,
      open: `question:${id}`,
      subject: 'question',
      group: 'worse',
      title: questionTitle(input.questions.get(id), id),
      status: { label: 'Got worse', tone: 'danger', mark: 'worse' },
      reason: failedWords(change.failedChecks) || changeWords(change),
      area: change.area,
      rank: null,
    })
  }
  for (const [id, change] of better) {
    if (seen.has(`question:${id}`)) continue
    seen.add(`question:${id}`)
    rows.push({
      key: `question:${id}`,
      open: `question:${id}`,
      subject: 'question',
      group: 'better',
      title: questionTitle(input.questions.get(id), id),
      status: { label: 'Got better', tone: 'success', mark: 'better' },
      reason: changeWords(change),
      area: change.area,
      rank: null,
    })
  }

  // Grouped in the groups' order; inside a group Fix next's order, then the comparison's.
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) => groupOrder.get(a.row.group!)! - groupOrder.get(b.row.group!)! || a.index - b.index,
    )
    .map(({ row }) => row)
}

function questionStatus(group: WorkGroup, entry: FixEntry): WorkRow['status'] {
  if (group === 'worse') return { label: 'Got worse', tone: 'danger', mark: 'worse' }
  // The reasons say which check fails: the weekly answer test, or retrieval without a model.
  // eslint-disable-next-line heed/plain-words -- the start of the reason the service writes
  const noAnswer = entry.reasons.some((reason) => reason.startsWith('The model gave no answer'))
  return noAnswer
    ? { label: 'No answer', tone: 'warning', mark: 'no_answer' }
    : { label: 'Test fails', tone: 'danger', mark: 'fail' }
}

function itemRow(entry: FixEntry, rank: number): WorkRow {
  const key = `item:${entry.subject.id}`
  const untestedReason = entry.reasons.find((reason) => reason.startsWith('No test question'))
  if (entry.kind === 'past_review')
    return {
      key,
      open: key,
      subject: 'item',
      group: 'review',
      title: entry.subject.label ?? entry.subject.id,
      status: { label: 'Check date passed', tone: 'warning', mark: 'review' },
      reason: [
        entry.since ? `since ${formatDay(entry.since)}` : null,
        untestedReason ? 'no test question covers it' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      area: entry.area,
      rank,
    }
  return {
    key,
    open: key,
    subject: 'item',
    group: 'untested',
    title: entry.subject.label ?? entry.subject.id,
    status: { label: 'No test yet', tone: 'info', mark: 'untested' },
    reason: untestedReason ?? '',
    area: entry.area,
    rank,
  }
}

/** The Gaps view: every gap in scope, open first, with the Gaps page's status, type and origin filters. */
function gapRows(
  input: WorkInput,
  filters: Pick<WorkbenchSearch, 'status' | 'type' | 'origin'>,
): WorkRow[] {
  const shown = visibleGapRows(scopedGapRows(input), {
    status: filters.status,
    type: filters.type,
    origin: filters.origin,
  })
  const rank = new Map(
    (input.fix ?? []).flatMap((entry, index) =>
      entry.subject.type === 'gap' ? [[entry.subject.id, index] as const] : [],
    ),
  )
  return shown
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        groupOrder.get(gapGroups[a.row.stage])! - groupOrder.get(gapGroups[b.row.stage])! ||
        a.index - b.index,
    )
    .map(({ row }) => gapRowOf(row, gapGroups[row.stage], rank.get(row.id) ?? null))
}

const verdictMarks: Record<Verdict, WorkMark> = {
  pass: 'pass',
  fail: 'fail',
  no_answer: 'no_answer',
}
const verdictTones: Record<Verdict, WorkTone> = {
  pass: 'success',
  fail: 'danger',
  no_answer: 'warning',
}

/** The Test questions view: Quality's list, active first, each with its newest verdict. */
function questionRows(input: WorkInput): WorkRow[] {
  const ids = new Set(input.areas.map((area) => area.id))
  return visibleQuestions(
    [...input.questions.values()].filter((question) => ids.has(question.area)),
    {},
  ).map((question) => {
    const verdict = input.verdicts.get(question.id)?.verdict ?? null
    return {
      key: `question:${question.id}`,
      open: `question:${question.id}`,
      subject: 'question',
      group: null,
      title: questionTitle(question, question.id),
      status: verdict
        ? { label: verdictWords[verdict], tone: verdictTones[verdict], mark: verdictMarks[verdict] }
        : { label: 'Not run', tone: null, mark: 'not_run' },
      reason: questionStateWords(question),
      area: question.area,
      rank: null,
    }
  })
}

/** The Runs view: Quality's list, newest first. */
function runRows(input: WorkInput): WorkRow[] {
  const scoped = inScope(input)
  return (input.runs ?? [])
    .filter((run) => scoped(run.areaId))
    .map((run) => ({
      key: `run:${run.id}`,
      open: `run:${run.id}`,
      subject: 'run',
      group: null,
      title: runTitle(run),
      status: {
        label: runStateWords[run.state],
        tone:
          run.state === 'failed' ? 'danger' : run.state === 'awaiting_approval' ? 'warning' : null,
        mark: 'run',
      },
      reason: [run.edition, run.trigger ? 'started by a change' : null].filter(Boolean).join(' · '),
      area: run.areaId,
      rank: null,
    }))
}

/** The rows matching every word of the search, in the title, the reason or the domain's name. */
export function searchWork(
  rows: readonly WorkRow[],
  q: string | undefined,
  areaName: (id: string) => string | undefined,
): WorkRow[] {
  const terms = queryTerms(q)
  if (!terms.length) return [...rows]
  return rows.filter((row) => {
    const text = [
      row.title,
      row.status.label,
      row.reason,
      row.open ?? '',
      row.area ? (areaName(row.area) ?? '') : '',
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

export type WorkEntry =
  { type: 'group'; group: WorkGroup; title: string; count: number } | { type: 'row'; row: WorkRow }

/** The rows under their groups' headers; a view whose rows have no group has no headers. */
export function groupWorkRows(
  rows: readonly WorkRow[],
  {
    since,
  }: {
    /** The run the newest one is compared with, when one domain is in scope. */
    since?: { finishedAt: string } | null
  } = {},
): WorkEntry[] {
  const entries: WorkEntry[] = []
  let last: WorkGroup | null = null
  for (const row of rows) {
    if (row.group !== null && row.group !== last)
      entries.push({
        type: 'group',
        group: row.group,
        title: workGroupTitle(row.group, since ?? null),
        count: rows.filter((candidate) => candidate.group === row.group).length,
      })
    last = row.group
    entries.push({ type: 'row', row })
  }
  return entries
}

function workGroupTitle(group: WorkGroup, since: { finishedAt: string } | null): string {
  // The strip names the run compared with; the header gives its day.
  const run = since ? ` since ${formatDay(since.finishedAt)}` : ''
  switch (group) {
    case 'worse':
      return `Got worse${run}`
    case 'better':
      return `Got better${run}`
    case 'failing':
      return 'Failing tests'
    case 'gaps':
      return 'Open gaps'
    case 'review':
      return 'Check date passed'
    case 'untested':
      return 'No test question covers it'
    case 'gap_open':
      return gapStageNames.open
    case 'gap_drafting':
      return gapStageNames.drafting
    case 'gap_closed':
      return gapStageNames.closed
  }
}

/** The totals under the list: what shows, what got worse and the open gaps. */
export function workTotals(input: WorkInput, shown: number, total: number) {
  return {
    shown,
    total,
    worse: workRows(input).filter((row) => row.group === 'worse').length,
    openGaps: scopedGapRows(input).filter((row) => row.stage !== 'closed').length,
  }
}
