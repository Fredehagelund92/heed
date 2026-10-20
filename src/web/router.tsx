import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  createBrowserHistory,
  createRouter,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router'
import { IconProvider } from '@/components/icons'
import { listOnly } from '@/lib/crumbs'
import { recordOrigins } from '@/lib/history'
import { routeTree } from './routeTree.gen'

export type RouterContext = { queryClient: QueryClient }

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    // Every entry says which page it was opened from, for the way back there (lib/history.ts).
    history: recordOrigins(history ?? createBrowserHistory()),
    context: { queryClient },
    // Load a page's code and data when the pointer or focus signals intent, before the click.
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Positions are kept per list, so a list restores its position whether a person comes back
    // with Back, the breadcrumb or a link, and whether or not a record was open over it: the key
    // is the address without the docked panel's params (lib/crumbs.ts).
    scrollRestoration: true,
    getScrollRestorationKey: (location) =>
      location.pathname + JSON.stringify(listOnly(location.search)),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

/**
 * Opens the signed-out page, remembering where the person was, unless it is already open. The
 * AI app consent page asks a signed-out person to sign in on the page itself. The query client
 * calls it for any 401 (query-client.ts).
 */
export function showSignedOut(router: ReturnType<typeof createAppRouter>) {
  const { pathname, href } = router.state.location
  if (pathname === '/signed-out' || pathname === '/connect/approve') return
  void router.navigate({ to: '/signed-out', search: { from: href }, replace: true })
}

export function App({
  queryClient,
  router,
}: {
  queryClient: QueryClient
  router: ReturnType<typeof createAppRouter>
}) {
  return (
    <IconProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IconProvider>
  )
}
