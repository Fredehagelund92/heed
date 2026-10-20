import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { Comparison, TestQuestion } from '@/api'
import {
  evalRunsQuery,
  fixNextQuery,
  gapListQuery,
  topicCountsQuery,
  vocabularyQuery,
} from '@/api/queries'
import { useDockList } from '@/components/page/use-dock-list'
import { useLatestVerdicts, useNewestComparisons } from '@/components/quality/use-quality'
import type { WorkbenchSearch } from '@/lib/search-params'
import {
  groupWorkRows,
  searchWork,
  workCounts,
  workList,
  workTotals,
  workViewOf,
  type WorkInput,
} from '@/lib/workbench'
import { workbenchRecord, workbenchRecordTabs, workbenchTab } from '@/lib/workbench-address'

/** What the list needs of a read: whether it has its data, or failed. */
type Read = {
  data: unknown
  isError: boolean
  error: unknown
  fetchStatus?: 'fetching' | 'paused' | 'idle'
  refetch: () => unknown
}

/** Fix next's longest list: the work list ranks everything it may show. */
const FIX_LIMIT = 200
/** The Gaps page's own read, so the two share one cache. */
const GAPS_PAGE = { limit: 200 } as const
/** Quality's runs list: the newest runs. */
const RUNS_PAGE = 50

/**
 * The Workbench's work list (Workbench plan, slice W5): the reads behind it, its rows for the
 * view, search and filters in the address, and its keys through the docked lists' model
 * (`useDockList`): j and k move between the rows and, with a record open, open the row they land
 * on; Escape closes the record first; / searches. The record pane reads where the open record is
 * in the list, and the rows before and after it, from here.
 */
export function useWorkList({
  search,
  areas,
  area,
  isAdmin,
  ready,
  questions,
  questionsRead,
  comparison,
  comparing,
  focusMode,
  showTab,
}: {
  search: WorkbenchSearch
  /** The domains the person looks after (every domain for an administrator). */
  areas: readonly Area[]
  /** The domain chosen in the scope strip. */
  area: Area | undefined
  isAdmin: boolean
  /** Whether the person's domains are known. */
  ready: boolean
  questions: ReadonlyMap<string, TestQuestion>
  /** The read of the test questions. */
  questionsRead: Read
  /** The chosen domain's comparison, with the run the person chose to compare with. */
  comparison: Comparison | undefined
  /** Whether that comparison is still being read. */
  comparing: boolean
  /** The open record's compare focus, when it has one (a test question). */
  focusMode?: { on: boolean; toggle: () => void }
  /** Shows the open record's tab by its place, when it has tabs. */
  showTab?: (index: number) => void
}) {
  const navigate = useNavigate({ from: '/health' })
  const view = workViewOf(search.view)
  const scopeAreas = useMemo(() => (area ? [area] : areas), [area, areas])

  const fix = useQuery({
    ...fixNextQuery({ ...(area ? { area: area.id } : {}), limit: FIX_LIMIT }),
    enabled: ready,
  })
  const gaps = useQuery({ ...gapListQuery(GAPS_PAGE), enabled: ready })
  const counts = useQuery({ ...topicCountsQuery(), enabled: ready })
  const vocabulary = useQuery(vocabularyQuery())
  const runs = useQuery({ ...evalRunsQuery({ limit: RUNS_PAGE }), enabled: ready })
  const verdicts = useLatestVerdicts(scopeAreas, ready && view === 'questions')
  // Every domain's newest run against the run before; one domain uses the comparison it shows.
  const newest = useNewestComparisons(scopeAreas, ready && !area)
  const comparisons = useMemo(
    () =>
      area
        ? comparison
          ? [comparison]
          : []
        : newest.comparisons.flatMap((read) => (read.data ? [read.data] : [])),
    [area, comparison, newest.comparisons],
  )

  const input = useMemo<WorkInput>(
    () => ({
      fix: fix.data?.entries ?? null,
      comparisons,
      gaps: gaps.data ?? null,
      questions,
      verdicts,
      runs: runs.data ?? null,
      areas: scopeAreas,
      everyArea: isAdmin && !area,
      minimum: counts.data?.minimumCount ?? null,
      vocabulary: vocabulary.data,
    }),
    [
      fix.data,
      comparisons,
      gaps.data,
      questions,
      verdicts,
      runs.data,
      scopeAreas,
      isAdmin,
      area,
      counts.data,
      vocabulary.data,
    ],
  )

  // The reads each view needs before it can show its rows; what got worse waits for the
  // comparisons, so a row does not move to Got worse once they arrive.
  const comparisonReads: Read[] = area
    ? []
    : [newest.history, ...newest.comparisons.filter((read) => read.fetchStatus !== 'idle')]
  const reads: Read[] =
    view === 'questions'
      ? [questionsRead]
      : view === 'runs'
        ? [runs]
        : view === 'gaps'
          ? [gaps, counts]
          : [fix, gaps, counts, questionsRead, ...comparisonReads]
  const failed = reads.find((read) => read.isError && !read.data)
  const pending =
    !ready ||
    (area !== undefined && comparing && view !== 'gaps') ||
    reads.some((read) => read.data === undefined && !read.isError)
  const areaName = (id: string) => areas.find((candidate) => candidate.id === id)?.name

  const filters = { status: search.status, type: search.type, origin: search.origin }
  const all = useMemo(
    () => workList(input, view, view === 'gaps' ? filters : {}),
    // The filters are read only with the Gaps view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, view, search.status, search.type, search.origin],
  )
  const rows = useMemo(
    () => searchWork(all, search.q, areaName),
    // The domains' names change with the domains.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, search.q, areas],
  )
  const entries = useMemo(
    () =>
      groupWorkRows(rows, {
        since: area && comparison?.against ? comparison.against : null,
      }),
    [rows, area, comparison],
  )
  /** How many gaps the Gaps view would show with a filter changed, for the Filter menu. */
  const countGaps = (patch: Pick<WorkbenchSearch, 'status' | 'type' | 'origin'>) =>
    searchWork(workList(input, 'gaps', { ...filters, ...patch }), search.q, areaName).length
  const viewCounts = useMemo(() => (pending ? null : workCounts(input)), [input, pending])
  const totals = workTotals(input, rows.length, all.length)

  // ---- the record open beside the list, and the list's keys ----
  const [region, setRegion] = useState<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const ids = useMemo(() => rows.flatMap((row) => (row.open === null ? [] : [row.open])), [rows])
  const list: WorkbenchSearch = {
    ...search,
    open: undefined,
    tab: undefined,
    mode: undefined,
    cell: undefined,
  }
  /**
   * The address that opens a row. The tab stays when the row's kind of record has it, so
   * stepping through the questions keeps their Test result in view.
   */
  const openSearch = (open: string): WorkbenchSearch => {
    const kind = workbenchRecord(open)!.kind
    const keep = search.tab !== undefined && workbenchTab(kind, search.tab) === search.tab
    return {
      ...list,
      open,
      ...(keep && search.tab !== workbenchRecordTabs[kind][0] ? { tab: search.tab } : {}),
    }
  }
  const dock = useDockList({
    region,
    ids,
    panelId: search.open ?? null,
    open: (id) =>
      void navigate({
        to: '/health',
        search: openSearch(id),
        replace: true,
        state: true,
        resetScroll: false,
      }),
    close: () => void navigate({ to: '/health', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: !pending && failed === undefined,
    focusMode,
    showTab,
  })

  return {
    view,
    state: failed
      ? ({ state: 'failed', error: failed.error, retry: () => void failed.refetch() } as const)
      : pending
        ? ({ state: 'pending' } as const)
        : ({ state: 'ready' } as const),
    rows,
    entries,
    viewCounts,
    totals,
    /** The privacy minimum, for the note under the gaps. */
    minimum: input.minimum,
    countGaps,
    setRegion,
    searchRef,
    openSearch,
    dock,
  }
}

export type WorkListState = ReturnType<typeof useWorkList>
