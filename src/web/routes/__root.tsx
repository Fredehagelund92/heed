import { lazy, Suspense } from 'react'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell/app-shell'
import type { RouterContext } from '@/router'

// Devtools are opt in (VITE_DEVTOOLS=true npm run dev) and never part of a production build.
const Devtools =
  import.meta.env.DEV && import.meta.env.VITE_DEVTOOLS === 'true'
    ? lazy(() => import('@/components/devtools'))
    : () => null

// The not-found page is rare, so it is not part of the first load.
const NotFoundPage = lazy(() =>
  import('@/components/page/not-found-page').then((module) => ({ default: module.NotFoundPage })),
)

const standalonePaths = new Set(['/signed-out', '/connect/approve'])

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  // The signed-out page and the AI app consent page stand alone: the shell would ask for a
  // session, and the consent page signs a person in itself.
  const standalone = useRouterState({
    select: (state) => standalonePaths.has(state.location.pathname),
  })
  if (standalone) return <Outlet />
  return (
    <AppShell>
      <Outlet />
      <Suspense fallback={null}>
        <Devtools />
      </Suspense>
    </AppShell>
  )
}

function NotFound() {
  return (
    <Suspense fallback={null}>
      <NotFoundPage />
    </Suspense>
  )
}
