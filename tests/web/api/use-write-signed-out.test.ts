// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { createQueryClient } from '@/api/query-client'
import { useWrite } from '@/api/queries'

// A decision on a suggestion is a plain write, not a mutation, so the mutation cache's handler
// never saw its 401: the review page said "Couldn't publish" for as long as the tab kept focus.
// A write started through `useWrite` now opens sign-in the same way.

const bindings = vi.hoisted(() => ({ publishReview: vi.fn() }))
vi.mock('@/api', () => ({ api: bindings }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Runs `publishReview` through `useWrite` under a real client; resolves to how it ended. */
async function publish(error: unknown) {
  bindings.publishReview.mockRejectedValueOnce(error)
  const onSignedOut = vi.fn()
  const client = createQueryClient({ onSignedOut })
  let write: ReturnType<typeof useWrite> = null as never
  function Probe() {
    write = useWrite()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)))
  })
  const outcome = await write('publishReview', { id: 'sug-ines' }).then(
    () => 'sent',
    (e: unknown) => e,
  )
  act(() => root.unmount())
  return { onSignedOut, outcome }
}

describe('useWrite', () => {
  it('opens sign-in when the service says nobody is signed in, and still throws', async () => {
    const error = new ApiError('signed-out', 'Sign in to continue.', { status: 401 })
    const { onSignedOut, outcome } = await publish(error)
    expect(onSignedOut).toHaveBeenCalledTimes(1)
    expect(outcome).toBe(error)
  })

  it('leaves every other failure to the screen', async () => {
    for (const kind of ['forbidden', 'conflict', 'failed', 'unanswered'] as const) {
      const { onSignedOut } = await publish(new ApiError(kind, 'No.'))
      expect(onSignedOut).not.toHaveBeenCalled()
    }
  })
})
