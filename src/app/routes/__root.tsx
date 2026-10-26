import { createRootRoute, redirect } from '@tanstack/react-router'
import App from '@/App'
import { redirectFrom } from '@/lib/router'
import { rootSearch } from '@/lib/search'

export const Route = createRootRoute({
  validateSearch: rootSearch,
  // An old address, or a #/ link from before the router, lands where it lives now.
  beforeLoad: ({ location }) => {
    const to = redirectFrom(location)
    if (to) throw redirect({ href: to, replace: true })
  },
  component: App,
})
