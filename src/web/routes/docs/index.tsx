import { createFileRoute } from '@tanstack/react-router'
import { DocsRoute } from '@/pages/docs-route'
import { docsSearch } from '@/lib/search'

// The documentation is its own site, outside the app's shell, and needs nobody signed in.
export const Route = createFileRoute('/docs/')({ validateSearch: docsSearch, component: DocsRoute })
