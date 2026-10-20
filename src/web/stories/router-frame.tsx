import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { createQueryClient } from '@/api/query-client'

/**
 * A router around a single part, for stories of parts that hold links (an overlap, an item): the
 * links get their real addresses without the whole app around them. Use `StoryApp` for a screen.
 */
export function RouterFrame({ children }: { children: ReactNode }) {
  const [router] = useState(() =>
    createRouter({
      routeTree: createRootRoute({ component: () => children }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    }),
  )
  return <RouterProvider router={router} />
}

/**
 * A query client around a part that reads through the data layer, such as a served fact's review
 * stamp (the mock answers it in stories).
 */
export function QueryFrame({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
