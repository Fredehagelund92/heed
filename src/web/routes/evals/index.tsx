import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateEvalsSearch } from '@/lib/search-params'

/**
 * The retired Evals and releases screen (Quality design, section 0). An old link goes where its
 * tab went: Editions, and Areas and Test results to Health, which took over from Quality and
 * Areas.
 */
export const Route = createFileRoute('/evals/')({
  validateSearch: validateEvalsSearch,
  beforeLoad: ({ search: { tab, ...editions } }) => {
    if (tab === 'areas') throw redirect({ to: '/areas', replace: true })
    if (tab === 'evals') throw redirect({ to: '/health', replace: true })
    throw redirect({ to: '/editions', search: editions, replace: true })
  },
})
