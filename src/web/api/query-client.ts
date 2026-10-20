import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isSignedOut, toApiError } from './errors'

export type QueryClientOptions = {
  /**
   * Called when any read or change answers that nobody is signed in (401), so the app can open
   * the signed-out page instead of showing an empty or failed screen.
   */
  onSignedOut?: () => void
}

/** Only a request that got no answer is tried again; a refusal would be refused again. */
export const retryUnanswered = (limit: number) => (failureCount: number, error: unknown) =>
  failureCount < limit && toApiError(error).retryable

export function createQueryClient({ onSignedOut }: QueryClientOptions = {}) {
  const signedOut = (error: unknown) => {
    if (isSignedOut(error)) onSignedOut?.()
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError: signedOut }),
    mutationCache: new MutationCache({ onError: signedOut }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: retryUnanswered(1),
        refetchOnWindowFocus: false,
      },
      mutations: {
        // A change is tried again with the same retry key (http-api.ts), so it is applied once.
        retry: retryUnanswered(2),
      },
    },
  })
}
