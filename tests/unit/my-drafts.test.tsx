import type * as Router from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposalStates, type ProposalState } from '@domain/proposal-state'
import type { ProposalRecord } from '@/api'
import { areasQuery, proposalListQuery } from '@/api/queries'
import { HOME_DRAFTS_SHOWN, YourDrafts } from '@/components/home/your-drafts'
import {
  draftsLink,
  editedAgoWords,
  isUnsubmittedDraft,
  MINE,
  mineProposals,
  myDrafts,
} from '@/lib/my-drafts'
import { groupProposalRows, toProposalRow, visibleProposalRows } from '@/lib/proposals'
import { connectToasts, type ToastMessage } from '@/lib/toast'
import { areas } from '@/mocks/reference-data'

/*
  The person's unsubmitted drafts: one definition that Home's Your drafts, the Draft, not
  submitted group of Proposals > Mine and the Drafts entry under the Library all read, so
  they list the same drafts and say the same number.
*/

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: ComponentProps<'a'> & {
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
  }) => (
    <a
      href={
        Object.entries(params ?? {}).reduce(
          (href, [key, value]) => href.replace(`$${key}`, value),
          to,
        ) + (search ? `?${new URLSearchParams(search).toString()}` : '')
      }
      {...props}
    >
      {children}
    </a>
  ),
}))

const proposal = (
  number: number,
  state: ProposalState,
  updatedAt: string,
  extra: Partial<ProposalRecord> = {},
): ProposalRecord => ({
  subject: 'item',
  vocabularyVersionId: null,
  vocabulary: null,
  title: '',
  reason: null,
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  number,
  action: 'create',
  state,
  areaId: 'area_commercial',
  itemId: null,
  itemVersionId: null,
  proposerId: 'per_maria',
  channel: 'form',
  revision: 1,
  draft: { title: `Proposal ${number} about Norway`, kind: 'event' },
  provenance: null,
  findings: [],
  claimedBy: null,
  dueAt: null,
  createdAt: updatedAt,
  updatedAt,
  ...extra,
})

const records = [
  proposal(1, 'accepted', '2026-09-30T10:00:00Z'),
  proposal(2, 'draft', '2026-10-05T10:00:00Z', { channel: 'assistant' }),
  proposal(3, 'changes_requested', '2026-10-06T10:00:00Z'),
  proposal(4, 'draft', '2026-10-07T10:00:00Z', {
    action: 'change',
    itemId: 'itm_abcdefgh',
    areaId: 'area_marketing',
  }),
  proposal(5, 'submitted', '2026-10-07T11:00:00Z'),
  // A retirement is not in Mine, so its draft is not one of the person's drafts either.
  proposal(6, 'draft', '2026-10-08T10:00:00Z', { action: 'retire', itemId: 'itm_abcdefgh' }),
]

describe('my unsubmitted drafts', () => {
  it('is a draft that was never sent, and no other state', () => {
    expect(proposalStates.filter((state) => isUnsubmittedDraft({ state }))).toEqual(['draft'])
  })

  it('lists the drafts Mine lists, the one touched last first', () => {
    expect(myDrafts(records).map((record) => record.number)).toEqual([4, 2])
    expect(myDrafts([])).toEqual([])
  })

  it('agrees with the Draft, not submitted group of Proposals > Mine', () => {
    const rows = mineProposals(records).map((record) => toProposalRow(record, areas))
    const entries = groupProposalRows(visibleProposalRows(rows, {}))
    const group = entries.find((entry) => entry.type === 'group' && entry.stage === 'draft')
    expect(entries[0]).toBe(group)
    expect(group).toMatchObject({ count: myDrafts(records).length })
    const inGroup = entries
      .slice(1, 1 + myDrafts(records).length)
      .map((entry) => (entry.type === 'row' ? entry.row.id : null))
    expect(inGroup).toEqual(myDrafts(records).map((record) => record.id))
    // The same list, with the drafts only, is where every draft is listed.
    const onlyDrafts = visibleProposalRows(rows, draftsLink.search)
    expect(onlyDrafts.map((row) => row.id)).toEqual(myDrafts(records).map((record) => record.id))
  })
})

describe('how long ago a draft was edited', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  const ago = (iso: string) => editedAgoWords(iso, now)

  it('says it in words, then the day', () => {
    expect(ago('2026-10-18T12:00:30Z')).toBe('Just now')
    expect(ago('2026-10-18T11:59:30Z')).toBe('Just now')
    expect(ago('2026-10-18T11:59:00Z')).toBe('1 minute ago')
    expect(ago('2026-10-18T11:05:00Z')).toBe('55 minutes ago')
    expect(ago('2026-10-18T11:00:00Z')).toBe('1 hour ago')
    expect(ago('2026-10-17T13:00:00Z')).toBe('23 hours ago')
    expect(ago('2026-10-17T12:00:00Z')).toBe('Yesterday')
    expect(ago('2026-10-15T12:00:00Z')).toBe('3 days ago')
    expect(ago('2026-10-11T12:00:00Z')).toBe('1 week ago')
    expect(ago('2026-09-20T12:00:00Z')).toBe('4 weeks ago')
    expect(ago('2026-09-17T12:00:00Z')).toBe('17 Sept 2026')
  })
})

let disconnect: (() => void) | null = null
afterEach(() => {
  disconnect?.()
  disconnect = null
})

describe("Home's Your drafts", () => {
  function renderStrip(rows: ProposalRecord[]) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(proposalListQuery(MINE).queryKey, {
      rows,
      total: rows.length,
      limit: MINE.limit,
      offset: 0,
    })
    client.setQueryData(areasQuery().queryKey, areas)
    return render(
      <QueryClientProvider client={client}>
        <YourDrafts />
      </QueryClientProvider>,
    )
  }

  it('is not drawn while the person has no draft', () => {
    const { container } = renderStrip(records.filter((record) => record.state !== 'draft'))
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each draft with its title, domain, a Draft mark and its age, opening its form', () => {
    renderStrip(records)
    const strip = screen.getByRole('region', { name: /Your drafts/ })
    expect(within(strip).getByRole('heading', { level: 2 })).toHaveTextContent('Your drafts2')
    const list = within(strip).getByRole('list', { name: 'Your drafts, not sent yet' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/library/$itemId/suggest?draft=${records[3]!.id}`.replace('$itemId', 'itm_abcdefgh'),
      `/library/new?draft=${records[1]!.id}`,
    ])
    expect(links[0]).toHaveTextContent('Proposal 4 about Norway')
    expect(links[0]).toHaveTextContent('Marketing')
    expect(links[0]).toHaveTextContent('Draft')
    expect(within(links[0]!).getByText(/ago$|^Yesterday$|^\d+ \w+ \d{4}$/)).toHaveAttribute(
      'datetime',
      records[3]!.updatedAt,
    )
    expect(within(strip).getByRole('link', { name: /All drafts/ })).toHaveAttribute(
      'href',
      '/proposals?view=mine&state=draft',
    )
  })

  it('shows the newest five and counts every one', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      proposal(10 + index, 'draft', `2026-10-0${index + 1}T10:00:00Z`),
    )
    renderStrip(many)
    const list = screen.getByRole('list', { name: 'Your drafts, not sent yet' })
    expect(within(list).getAllByRole('link')).toHaveLength(HOME_DRAFTS_SHOWN)
    expect(within(list).getAllByRole('link')[0]).toHaveTextContent('Proposal 16')
    expect(screen.getByRole('link', { name: /All 7 drafts/ })).toBeVisible()
  })

  it('gives each row its menu: Continue editing, and Discard draft with its key', async () => {
    renderStrip(records)
    const list = screen.getByRole('list', { name: 'Your drafts, not sent yet' })
    await userEvent.click(
      within(list).getByRole('button', { name: 'Actions for Proposal 4 about Norway' }),
    )
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Continue editing' })).toHaveAttribute(
      'href',
      `/library/itm_abcdefgh/suggest?draft=${records[3]!.id}`,
    )
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Discard draft/ }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' })
    expect(dialog).toHaveTextContent('Proposal 4 about Norway')
    expect(dialog).toHaveTextContent("You can undo for a few seconds, then it's gone for good.")
  })

  it('discards the focused draft with Command or Control Backspace, held behind Undo', async () => {
    const shown: ToastMessage[] = []
    disconnect = connectToasts(
      (message) => shown.push(message),
      () => undefined,
    )
    renderStrip(records)
    const list = screen.getByRole('list', { name: 'Your drafts, not sent yet' })
    within(list).getAllByRole('link')[0]!.focus()
    await userEvent.keyboard('{Control>}{Backspace}{/Control}')
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }))
    // It leaves the list at once; the toast holds the step for Undo before anything is sent.
    expect(within(list).getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Your drafts1')
    const toast = shown.at(-1)
    expect(toast).toMatchObject({ title: 'Draft discarded', action: { label: 'Undo' } })
    // Undo brings it back once the query cache has told the screens (lib/discarding.ts).
    act(() => toast?.action?.onClick())
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(2), {
      timeout: 5000,
    })
  })

  it('moves between the rows with the arrow keys', async () => {
    renderStrip(records)
    const links = within(
      screen.getByRole('list', { name: 'Your drafts, not sent yet' }),
    ).getAllByRole('link')
    links[0]!.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(links[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(links[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(links[0]).toHaveFocus()
  })
})
