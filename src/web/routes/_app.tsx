import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/App'
import { shellSearch } from '@/lib/search'

// Every page inside the app: the sidebar, the page and the dock.
export const Route = createFileRoute('/_app')({ validateSearch: shellSearch, component: AppShell })
