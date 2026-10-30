import { createFileRoute } from '@tanstack/react-router'
import { DocsRoute } from '@/pages/docs-route'
import { docsSearch } from '@/lib/search'

export const Route = createFileRoute('/docs/$slug')({
  validateSearch: docsSearch,
  component: DocsRoute,
})
