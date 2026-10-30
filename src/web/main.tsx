import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRouter, RouterProvider, type AnyRoute } from '@tanstack/react-router'
import './styles/index.css'
import { bindRouter } from '@/lib/router'
import { mockControls, startApi } from '@/api'
import { routeTree } from './routeTree.gen'

// The binding first. The mock reads the review flags of the address it starts at (?demo=setup is
// a new install from the first paint).
startApi()
mockControls?.setAddress({
  path: window.location.pathname,
  query: Object.fromEntries(new URLSearchParams(window.location.search)),
})

const router = createRouter({
  routeTree,
  // Search params are plain text, read and written as the mockup did (?step=3 is the text "3").
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(search)) if (v !== undefined) q.set(k, String(v))
    const s = q.toString()
    return s ? `?${s}` : ''
  },
  // Load a page's code when the pointer or focus signals intent, before the click.
  defaultPreload: 'intent',
  // A page's own loading state starts at once and waits its 150ms (lib/loading.ts).
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

bindRouter(router)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// After the first paint the app is ready: from then on a dock or a row that arrives moves in; what is
// on screen at load is simply there (docs/design/motion.md: no page-enter transition).
const ready = router.subscribe('onResolved', () => {
  ready()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.setAttribute('data-ready', '')),
  )
  // The pages that are not on the first load (routes/**/*.lazy.tsx: the review, the editors,
  // Observability, Settings, Help and the documentation) are fetched once the browser is idle
  // after the first page, so opening one rarely waits; hovering a link fetches it sooner.
  const idle = (fn: () => void) =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(fn, { timeout: 3000 })
      : setTimeout(fn, 1500)
  idle(() => {
    for (const route of Object.values(router.routesById) as AnyRoute[])
      if (route.lazyFn) void router.loadRouteChunk(route)
  })
})
