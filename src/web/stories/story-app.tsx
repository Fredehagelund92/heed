import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { createQueryClient } from '@/api/query-client'
import { MOCK_PERSON_KEY, MOCK_SCENARIO_KEY, type MockScenario } from '@/api/mock-scenario'
import { createAppRouter, showSignedOut } from '@/router'

/**
 * The real app on an in-memory history, at one address, optionally with a mock scenario
 * (first run, nearly empty, slow, failed, signed out) and a person. Stories use it to show screens in every state with
 * the real route tree, data layer and shell.
 */
export function StoryApp({
  path,
  scenario,
  person,
  preferences,
}: {
  path: string
  scenario?: MockScenario
  /** Who the mock signs in, by fixture id (`per_jon` is an owner); Maria by default. */
  person?: string
  /** Browser preferences to set first, such as `{ 'cl.library.density': 'comfortable' }`. */
  preferences?: Record<string, unknown>
}) {
  const [{ queryClient, router }] = useState(() => {
    try {
      if (scenario) window.localStorage.setItem(MOCK_SCENARIO_KEY, scenario)
      else window.localStorage.removeItem(MOCK_SCENARIO_KEY)
      if (person) window.localStorage.setItem(MOCK_PERSON_KEY, person)
      else window.localStorage.removeItem(MOCK_PERSON_KEY)
      for (const [key, value] of Object.entries(preferences ?? {}))
        window.localStorage.setItem(key, JSON.stringify(value))
      if (!preferences) {
        window.localStorage.removeItem('cl.library.density')
        window.localStorage.removeItem('cl.library.columns')
      }
    } catch {
      // Storage can be blocked; the story then shows the defaults.
    }
    const client = createQueryClient({ onSignedOut: () => showSignedOut(appRouter) })
    const appRouter = createAppRouter(client, createMemoryHistory({ initialEntries: [path] }))
    return { queryClient: client, router: appRouter }
  })
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
