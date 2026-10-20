import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateQualitySearch } from '@/lib/search-params'

/**
 * The retired Quality page (Workbench plan, slice W8): Health (the Workbench then) took over its
 * views and its docked panel, so an old link lands on the matching Health state, with the
 * domain, the view and its search, and the open domain, question or run with its tab. Health's
 * own gate then tells anyone it is not for whose page it is. The mapping is loaded only when an old link
 * is followed, so the shell's first load does not carry it.
 */
export const Route = createFileRoute('/quality')({
  validateSearch: validateQualitySearch,
  beforeLoad: async ({ search }) => {
    const { workbenchFromQuality } = await import('@/lib/workbench-address')
    throw redirect({ to: '/health', search: workbenchFromQuality(search), replace: true })
  },
})
