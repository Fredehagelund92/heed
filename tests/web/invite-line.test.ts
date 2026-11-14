// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { createQueryClient } from '@/api/query-client'
import { InviteLine } from '@/pages/signin'

// The invite line on the sign-in card says where the invite's read stands (#198): a link the
// service says is gone is called dead, but a read that failed is not, and Try again reads it again.

const bindings = vi.hoisted(() => ({ readInvite: vi.fn() }))
vi.mock('@/api', () => ({ api: bindings }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => {
  act(() => root?.unmount())
  bindings.readInvite.mockReset()
})

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
}

async function show() {
  root = createRoot(host)
  act(() => {
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: createQueryClient() },
        React.createElement(InviteLine, { token: 'inv_larch' }),
      ),
    )
  })
  await settle()
  return () => host.textContent ?? ''
}

describe('InviteLine', () => {
  it('names the invite once it is read', async () => {
    bindings.readInvite.mockResolvedValue({
      email: 'ines@larchwood.example',
      admin: false,
      domains: ['Sales'],
    })
    const text = await show()
    expect(text()).toBe(
      "You're invited as a Member, owning Sales. Sign in as ines@larchwood.example.",
    )
  })

  it('calls the link dead only when the service says so', async () => {
    bindings.readInvite.mockResolvedValue(null)
    const text = await show()
    expect(text()).toContain("This invite link doesn't work any more.")
  })

  it('says a failed read failed, and Try again reads it again', async () => {
    bindings.readInvite
      .mockRejectedValueOnce(new ApiError('failed', 'Bad gateway', { status: 502 }))
      .mockResolvedValue({ email: 'ines@larchwood.example', admin: true, domains: [] })
    const text = await show()
    expect(text()).toContain("Couldn't load this invite.")
    expect(text()).not.toContain("doesn't work any more")
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')
    act(() => retry!.click())
    await settle()
    expect(text()).toBe("You're invited as an Admin. Sign in as ines@larchwood.example.")
  })
})
