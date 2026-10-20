import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateMcpSearch } from '@/lib/search-params'

/**
 * The retired MCP and gateway page (navigation decision, 12 October 2026): it is a section of
 * Administration now, so an old link lands there with its tab and the days its Activity counted.
 */
export const Route = createFileRoute('/mcp')({
  validateSearch: validateMcpSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/admin', search: { section: 'gateway', ...search }, replace: true })
  },
})
