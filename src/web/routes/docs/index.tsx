import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { docsSearch } from '@/lib/search'

// The documentation is its own site, outside the app's shell, and needs nobody signed in.
export const Route = createFileRoute('/docs/')({
  validateSearch: docsSearch,
  pendingComponent: () => <Loading shape="docs-home" />,
})
