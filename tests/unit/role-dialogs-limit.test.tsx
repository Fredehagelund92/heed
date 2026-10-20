import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { api, type PersonRow } from '@/api'
import { RemoveFromPeopleDialog } from '@/components/settings/role-dialogs'
import { GRANT_BATCH_MAX } from '../../src/contract/auth.ts'

afterEach(() => vi.restoreAllMocks())

const holders = (count: number): PersonRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `per_${index}`,
    name: `Person ${index}`,
    initials: 'P',
    email: `person${index}@example.com`,
    status: 'active',
    lastSignedInAt: null,
    roles: [{ role: 'administrator', areaId: null }],
  }))

const open = (count: number) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const apply = vi.spyOn(api, 'applyGrants')
  render(
    <QueryClientProvider client={client}>
      <RemoveFromPeopleDialog open onOpenChange={() => {}} people={holders(count)} />
    </QueryClientProvider>,
  )
  return apply
}

it('refuses a step above the limit, says the count and the limit, and sends nothing', async () => {
  const apply = open(GRANT_BATCH_MAX + 1)
  expect(screen.getByRole('button', { name: /^Remove/ })).toBeDisabled()
  expect(screen.getByText(/201 changes/)).toHaveTextContent(/at most 200/)
  await userEvent.click(screen.getByRole('button', { name: /^Remove/ }), { pointerEventsCheck: 0 })
  expect(apply).not.toHaveBeenCalled()
})

it('offers a step at the limit', () => {
  open(GRANT_BATCH_MAX)
  expect(screen.getByRole('button', { name: /^Remove/ })).toBeEnabled()
  expect(screen.queryByText(/at most/)).not.toBeInTheDocument()
})
