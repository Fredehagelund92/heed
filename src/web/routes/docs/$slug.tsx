import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { docsSearch } from '@/lib/search'

export const Route = createFileRoute('/docs/$slug')({
  validateSearch: docsSearch,
  pendingComponent: () => <Loading shape="docs-page" />,
})
