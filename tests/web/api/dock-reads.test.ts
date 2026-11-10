import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { Library } from '@/api/client'
import { invalidateAfter, queryKeys, sharedReadIn } from '@/api/queries'

// What opening a quick view reads: its own item, not the lists the shell already holds. A list
// older than staleTime was read again by every panel that mounted, a dozen requests ahead of the
// item's own, and marking the item opened read the whole library again.

const library: Library = { items: [], published: {}, viewed: { itm_a: true }, log: [] }

describe('the shared reads in the dock', () => {
  it('reads a stale list from the cache, where a page reads it again', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
    let reads = 0
    const options = {
      queryKey: queryKeys.library,
      queryFn: () => {
        reads++
        return Promise.resolve(library)
      },
    }
    // Filled by the shell long ago: older than staleTime.
    queryClient.setQueryData(queryKeys.library, library, { updatedAt: Date.now() - 60_000 })

    const inDock = new QueryObserver(queryClient, sharedReadIn(options, true))
    const stopDock = inDock.subscribe(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reads).toBe(0)
    stopDock()

    const onPage = new QueryObserver(queryClient, sharedReadIn(options, false))
    const stopPage = onPage.subscribe(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reads).toBe(1)
    stopPage()
  })

  it('marks an item opened in the library it holds, and reads nothing again', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(queryKeys.library, library)
    await invalidateAfter(queryClient, 'markViewed', { id: 'itm_b' }, undefined)
    expect(queryClient.getQueryData<Library>(queryKeys.library)?.viewed).toEqual({
      itm_a: true,
      itm_b: true,
    })
    expect(queryClient.getQueryState(queryKeys.library)?.isInvalidated).toBe(false)
  })
})
