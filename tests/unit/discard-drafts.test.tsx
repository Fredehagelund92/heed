import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, type ProposalRecord } from '@/api'
import { useDiscardDrafts } from '@/components/proposals/discard-drafts'
import { connectToasts, type ToastMessage } from '@/lib/toast'

/*
  Discarding drafts from a list: one confirmation for many, a hold behind Undo, then the same
  discard the draft's page uses, one draft after another. What the service would not discard comes
  back, and the toast says which and why.
*/

const draft = (number: number, extra: Partial<ProposalRecord> = {}): ProposalRecord => ({
  subject: 'item',
  vocabularyVersionId: null,
  vocabulary: null,
  title: '',
  reason: null,
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  number,
  action: 'create',
  state: 'draft',
  areaId: 'area_commercial',
  itemId: null,
  itemVersionId: null,
  proposerId: 'per_maria',
  channel: 'form',
  revision: 3,
  draft: { title: `Draft ${number}`, kind: 'note' },
  provenance: null,
  findings: [],
  claimedBy: null,
  dueAt: null,
  createdAt: '2026-10-07T10:00:00Z',
  updatedAt: '2026-10-07T10:00:00Z',
  ...extra,
})

function Discard({ records }: { records: ProposalRecord[] }) {
  const discard = useDiscardDrafts()
  return (
    <>
      <button type="button" onClick={() => discard.ask(records)}>
        Discard them
      </button>
      {discard.dialog}
    </>
  )
}

let disconnect: (() => void) | null = null
afterEach(() => {
  disconnect?.()
  disconnect = null
  vi.restoreAllMocks()
})

/** A toast region that keeps what it was given, and closes a toast as the real one does. */
function toasts() {
  const shown: ToastMessage[] = []
  disconnect = connectToasts(
    (message) => shown.push(message),
    () => undefined,
  )
  return shown
}

function renderDiscard(records: ProposalRecord[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Discard records={records} />
    </QueryClientProvider>,
  )
}

describe('discarding drafts from a list', () => {
  it('asks once for many, naming the first three and how many more', async () => {
    renderDiscard([1, 2, 3, 4, 5].map((n) => draft(n)))
    await userEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard 5 drafts?' })
    const titles = within(dialog).getByRole('list', { name: 'Drafts to discard' })
    expect(
      within(titles)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Draft 1', 'Draft 2', 'Draft 3', 'And 2 more'])
    expect(within(dialog).getByRole('button', { name: 'Discard 5 drafts' })).toBeVisible()
    // A destructive confirmation starts on Cancel.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('leaves out what is not an unsubmitted draft', async () => {
    renderDiscard([draft(1), draft(2, { state: 'submitted' })])
    await userEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    expect(await screen.findByRole('alertdialog', { name: 'Discard this draft?' })).toBeVisible()
  })

  it('sends nothing until Undo has passed, then discards each and says which stayed and why', async () => {
    const shown = toasts()
    const records = [draft(1), draft(2), draft(3)]
    const discard = vi.spyOn(api, 'discardDraft').mockImplementation(({ id }) => {
      // Draft 2 was submitted meanwhile; Draft 3 is not the person's to discard.
      if (id === records[1]!.id)
        return Promise.reject(
          new ApiError(
            'conflict',
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          ),
        )
      if (id === records[2]!.id) return Promise.reject(new ApiError('forbidden', 'Forbidden'))
      return Promise.resolve({ id, discardedAt: '2026-10-18T12:00:00Z' })
    })
    vi.spyOn(api, 'getProposal').mockResolvedValue({ ...records[1]!, state: 'submitted' })
    renderDiscard(records)
    await userEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard 3 drafts?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard 3 drafts' }))
    const held = shown.at(-1)
    expect(held).toMatchObject({ title: '3 drafts discarded', action: { label: 'Undo' } })
    expect(discard).not.toHaveBeenCalled()

    // The toast closes: only now are the drafts sent, one after another, at their revision.
    held?.onClose?.()
    // Three writes one after another, each refreshing what it made stale: room on a busy machine.
    await waitFor(() => expect(shown.at(-1)?.title).toBe('1 of 3 drafts discarded'), {
      timeout: 5000,
    })
    expect(discard.mock.calls.map(([input]) => input)).toEqual(
      records.map(({ id, revision }) => ({ id, revision })),
    )
    expect(shown.at(-1)?.description).toBe(
      "Draft 2: It was sent for review in the meantime. Withdraw it from its page instead. And 1 more. They're still in your drafts.",
    )
  })

  it('takes a draft on its newest revision when an autosave moved it on meanwhile', async () => {
    const shown = toasts()
    const record = draft(1)
    const discard = vi
      .spyOn(api, 'discardDraft')
      .mockRejectedValueOnce(
        new ApiError(
          'conflict',
          'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          {
            current: { ...record, revision: 4 },
          },
        ),
      )
      .mockResolvedValueOnce({ id: record.id, discardedAt: '2026-10-18T12:00:00Z' })
    renderDiscard([record])
    await userEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }))
    shown.at(-1)?.onClose?.()
    await waitFor(() => expect(discard).toHaveBeenCalledTimes(2), { timeout: 5000 })
    expect(discard.mock.calls[1]?.[0]).toEqual({ id: record.id, revision: 4 })
    // Every draft went: the held toast said it, and nothing more is said.
    expect(shown.map((toast) => toast.title)).toEqual(['Draft discarded'])
  })
})
