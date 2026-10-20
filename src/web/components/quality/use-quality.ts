import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { Verdict } from '@domain/golden-question'
import type { Area } from '@domain/item'
import type { EvalRunDetail, HistoryPoint, TestQuestion } from '@/api'
import {
  areasQuery,
  evalRunQuery,
  gapListQuery,
  qualityHistoryQuery,
  retrievalTrendQuery,
  runComparisonQuery,
  testQuestionsQuery,
  untestedQuery,
  upkeepQuery,
} from '@/api/queries'
import {
  domainHealth,
  openGapsByArea,
  pastReviewByArea,
  qualityAreas,
  verdictOfResult,
  type DomainHealth,
} from '@/lib/quality'
import { usePermissions } from '@/lib/use-session'

/** Weekly runs per domain the grid reads: the newest and the one before carry its changes. */
export const HISTORY_RUNS = 12
/** Retrieval passes per domain: enough to reach the edition before the live one. */
const RETRIEVAL_POINTS = 30
/** The Gaps page's own read, so the two pages share one cache. */
const GAPS_PAGE = { limit: 200 } as const

/**
 * The domains the person sees on Quality, and who may change what: every domain for an
 * administrator (the data platform team in the first release), the ones they owner for anyone
 * else. The service narrows every read the same way and its answer wins.
 */
export function useQualityScope() {
  const { permissions, isAdmin, ready } = usePermissions()
  const areas = useQuery(areasQuery())
  const maintained = useMemo(
    () =>
      permissions.assignments
        .filter((assignment) => assignment.role === 'owner')
        .map((assignment) => assignment.areaId)
        .filter((id): id is string => id !== null),
    [permissions],
  )
  const shown = useMemo(
    () => qualityAreas(areas.data ?? [], { admin: isAdmin, maintained }),
    [areas.data, isAdmin, maintained],
  )
  return {
    ready: ready && areas.data !== undefined,
    areasFailed: areas.isError && !areas.data,
    retryAreas: () => void areas.refetch(),
    allAreas: areas.data ?? [],
    areas: shown,
    isAdmin,
    /** Whether the person writes test questions and starts runs in a domain. */
    maintains: (areaId: string) => isAdmin || maintained.includes(areaId),
    areaOf: (areaId: string | null) =>
      areaId === null ? undefined : (areas.data ?? []).find((area) => area.id === areaId),
  }
}

/** The test questions the person may read, in the domains they see on Quality, by id. */
export function useQualityQuestions(areas: readonly Area[]) {
  const query = useQuery(testQuestionsQuery())
  const ids = useMemo(() => new Set(areas.map((area) => area.id)), [areas])
  const questions = useMemo(
    () => (query.data ?? []).filter((question) => ids.has(question.area)),
    [query.data, ids],
  )
  const byId = useMemo(
    () => new Map<string, TestQuestion>(questions.map((question) => [question.id, question])),
    [questions],
  )
  return { query, questions, byId }
}

export type HealthState =
  | { state: 'pending' }
  | { state: 'failed'; retry: () => void }
  | { state: 'ready'; rows: DomainHealth[] }

/**
 * One health row per domain, from the reads the service has: the weekly runs (history), each
 * domain's retrieval passes and its newest run against the one before, the untested items, the
 * items past review and the open gaps. The grid waits for the reads every row needs; a domain's
 * own comparison or retrieval fills its cell when it arrives, and a cell whose read failed says
 * so instead of showing a number.
 */
export function useDomainHealth(
  areas: readonly Area[],
  questions: readonly TestQuestion[],
  enabled: boolean,
): HealthState {
  const { history, byArea, comparisons } = useNewestComparisons(areas, enabled)
  const untested = useQuery({ ...untestedQuery(), enabled })
  const upkeep = useQuery({ ...upkeepQuery({ weeks: 1 }), enabled })
  const gaps = useQuery({ ...gapListQuery(GAPS_PAGE), enabled })
  const retrieval = useQueries({
    queries: areas.map((area) => ({
      ...retrievalTrendQuery({ area: area.id, limit: RETRIEVAL_POINTS }),
      enabled,
    })),
  })

  const reads = [history, untested, upkeep, gaps]
  if (reads.some((read) => read.isError && !read.data))
    return {
      state: 'failed',
      retry: () => {
        for (const read of reads) if (read.isError) void read.refetch()
      },
    }
  if (reads.some((read) => read.data === undefined)) return { state: 'pending' }

  const gapCounts = openGapsByArea(gaps.data ?? [])
  const pastReview = pastReviewByArea(upkeep.data)
  return {
    state: 'ready',
    rows: areas.map((area, index) =>
      domainHealth({
        area,
        questions: questions.filter((question) => question.area === area.id),
        history: byArea.get(area.id) ?? [],
        retrieval: retrieval[index]?.data,
        comparison: comparisons[index]?.data,
        untested: untested.data,
        openGaps: gapCounts.get(area.id) ?? 0,
        pastReview: pastReview.get(area.id) ?? null,
      }),
    ),
  }
}

/**
 * Each domain's newest weekly run against the run before (`comparisons`, one per domain in
 * order; a domain with fewer than two runs reads nothing), from the weekly runs (`history`),
 * newest first per domain (`byArea`). The health grid and the Workbench's work list read the
 * same comparisons, so they count the same changes.
 */
export function useNewestComparisons(areas: readonly Area[], enabled: boolean) {
  const history = useQuery({ ...qualityHistoryQuery({ limit: HISTORY_RUNS }), enabled })
  const byArea = useMemo(() => {
    const grouped = new Map<string, HistoryPoint[]>()
    for (const point of history.data ?? [])
      grouped.set(point.area, [...(grouped.get(point.area) ?? []), point])
    for (const points of grouped.values())
      points.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
    return grouped
  }, [history.data])
  const comparisons = useQueries({
    queries: areas.map((area) => {
      const [latest, before] = byArea.get(area.id) ?? []
      return {
        // A domain without a run reads nothing; its own key keeps the queries apart.
        ...runComparisonQuery({ id: latest?.run ?? `none:${area.id}` }),
        enabled: enabled && Boolean(latest && before),
      }
    }),
  })
  return { history, byArea, comparisons }
}

/**
 * Each question's verdict in its domain's newest weekly run, by question id: the run's results
 * read once per domain. A question its domain's run did not test has none.
 */
export function useLatestVerdicts(areas: readonly Area[], enabled: boolean) {
  const history = useQuery({ ...qualityHistoryQuery({ limit: HISTORY_RUNS }), enabled })
  const latest = useMemo(() => {
    const newest = new Map<string, string>()
    for (const point of [...(history.data ?? [])].sort((a, b) =>
      b.finishedAt.localeCompare(a.finishedAt),
    ))
      if (!newest.has(point.area)) newest.set(point.area, point.run)
    return areas.flatMap((area) => {
      const run = newest.get(area.id)
      return run ? [run] : []
    })
  }, [history.data, areas])
  return useQueries({
    queries: latest.map((id) => ({ ...evalRunQuery(id), enabled, staleTime: Infinity })),
    combine: verdictsOf,
  })
}

/** Each result of the runs, by question id. */
function verdictsOf(runs: readonly { data: EvalRunDetail | null | undefined }[]) {
  const verdicts = new Map<string, { verdict: Verdict | null; run: string }>()
  for (const run of runs)
    for (const result of run.data?.results ?? [])
      verdicts.set(result.id, { verdict: verdictOfResult(result), run: run.data!.run.id })
  return verdicts
}
