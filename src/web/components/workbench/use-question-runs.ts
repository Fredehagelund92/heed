import { useQuery } from '@tanstack/react-query'
import type { TestQuestion } from '@/api'
import { questionComparisonQuery, questionHistoryQuery } from '@/api/queries'
import type { WorkbenchSearch } from '@/lib/search-params'

/**
 * The two runs a test question's record reads it across (Workbench plan, W6b and W7): the run in
 * the address, else the newest weekly run that has finished; and the run the scope strip compares
 * with, when it is a run of the question's domain, else the weekly run before. The record and its
 * compare focus share these reads, so the two always show the same pair.
 */
export function useQuestionRuns({
  id,
  question,
  search,
}: {
  id: string
  question: TestQuestion | undefined
  search: WorkbenchSearch
}) {
  const history = useQuery({ ...questionHistoryQuery({ question: id }), enabled: !!question })
  const run =
    search.run ?? history.data?.runs.find((entry) => entry.kind === 'scheduled')?.run ?? undefined
  const against = question && search.area === question.area ? search.against : undefined
  const comparison = useQuery({
    ...questionComparisonQuery({
      question: id,
      run: run ?? '',
      ...(against ? { against } : {}),
    }),
    enabled: !!question && run !== undefined,
  })
  return {
    history,
    comparison,
    /** No weekly run has tested the question yet. */
    noRun: history.data !== undefined && run === undefined,
  }
}
