import { createRootRoute, redirect } from '@tanstack/react-router'
import App from '@/App'
import { redirectFrom } from '@/lib/router'
import { AppErrorPage } from '@/pages/app-error'
import { rootSearch } from '@/lib/search'

export const Route = createRootRoute({
  validateSearch: rootSearch,
  // An old address, or a #/ link from before the router, lands where it lives now.
  beforeLoad: ({ location }) => {
    const to = redirectFrom(location)
    if (to) throw redirect({ href: to, replace: true })
  },
  component: App,
  // The app's own page when it cannot start; a page's own failure stays in its frame (App.tsx).
  errorComponent: AppErrorPage,
})
