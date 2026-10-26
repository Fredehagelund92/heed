import { createFileRoute } from '@tanstack/react-router'
import { DocsSite } from '@/pages/docs'
import { docsSearch } from '@/lib/search'

export const Route = createFileRoute('/docs/$slug')({
  validateSearch: docsSearch,
  component: DocsSite,
})
