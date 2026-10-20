import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateWorkbenchSearch } from '@/lib/search-params'

/**
 * The Workbench's old address (navigation decision, 12 October 2026): the page is Health now, at
 * the same state, so an old link keeps its domain, view, open record and tab.
 */
export const Route = createFileRoute('/workbench')({
  validateSearch: validateWorkbenchSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/health', search, replace: true })
  },
})
