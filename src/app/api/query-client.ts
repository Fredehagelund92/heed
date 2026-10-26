import { MutationCache, notifyManager, QueryCache, QueryClient } from '@tanstack/react-query'
import { isSignedOut, toApiError } from './errors'

export type QueryClientOptions = {
  /**
   * Called when any read or change answers that nobody is signed in (401), so the app can open
   * the sign-in page instead of showing an empty or failed screen.
   */
  onSignedOut?: () => void
}

/** Only a request that got no answer is tried again; a refusal or a failure would come back the same. */
export const retryUnanswered = (limit: number) => (failureCount: number, error: unknown) =>
  failureCount < limit && toApiError(error).retryable

// What a read brings is drawn before the browser paints again: an answer that arrives at once (the
// mock's, a cached one) never shows an empty frame first.
notifyManager.setScheduler(queueMicrotask)

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
      mutations: { retry: false },
    },
  })
}
