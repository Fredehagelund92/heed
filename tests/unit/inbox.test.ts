import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { InboxItem } from '@/api'
import { editInbox, setInboxUnread, type InboxPages } from '@/api/inbox'
import { queryKeys, type InboxUnread } from '@/api/queries'

/* What the notifications list shows before the service answers a read or an archive (W7). */

const item = (id: string, overrides: Partial<InboxItem> = {}): InboxItem => ({
  id,
  kind: 'proposal.claimed',
  at: '2026-10-07T08:40:00.000Z',
  areaId: 'area_commercial',
  subject: { type: 'proposal', id: 'p1' },
  state: 'in_review',
  title: 'Units sold lags by two days in the source tool',
  actor: { id: 'per_jon', name: 'Jon Abara' },
  note: null,
  readAt: null,
  archivedAt: null,
  ...overrides,
})

const pages = (...items: InboxItem[]): InboxPages => ({
  pages: [{ items, unread: items.filter((one) => !one.readAt).length, nextBefore: null }],
  pageParams: [null],
})

const at = '2026-10-07T12:00:00.000Z'
const shown = (data: InboxPages) =>
  data.pages.flatMap((page) => page.items.map((one) => [one.id, one.readAt]))

describe('editInbox', () => {
  it('reads the named notifications and leaves the others', () => {
    const data = pages(item('a'), item('b'), item('c', { readAt: '2026-10-06T00:00:00.000Z' }))
    expect(shown(editInbox(data, 'all', { action: 'read', ids: ['a'] }, at))).toEqual([
      ['a', at],
      ['b', null],
      ['c', '2026-10-06T00:00:00.000Z'],
    ])
  })

  it('reads everything in the inbox, but not what was archived', () => {
    const archived = item('b', { archivedAt: '2026-10-06T00:00:00.000Z' })
    expect(shown(editInbox(pages(item('a'), archived), 'all', { action: 'read-all' }, at))).toEqual(
      [
        ['a', at],
        ['b', null],
      ],
    )
  })

  it('takes an archived notification out of the inbox, and keeps it in the archive', () => {
    const data = pages(item('a'), item('b'))
    expect(shown(editInbox(data, 'all', { action: 'archive', ids: ['a'] }, at))).toEqual([
      ['b', null],
    ])
    expect(shown(editInbox(data, 'archived', { action: 'archive', ids: ['a'] }, at))).toEqual([
      ['a', at],
      ['b', null],
    ])
  })
})

describe('setInboxUnread', () => {
  it('sets the count on the bell and on every cached page', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<InboxUnread>(queryKeys.inboxUnread, {
      unread: 2,
      latest: item('a'),
    })
    queryClient.setQueryData(queryKeys.inboxPages('all'), pages(item('a'), item('b')))
    setInboxUnread(queryClient, 0)
    expect(queryClient.getQueryData(queryKeys.inboxUnread)).toEqual({ unread: 0, latest: null })
    expect(
      queryClient.getQueryData<InboxPages>(queryKeys.inboxPages('all'))?.pages[0]?.unread,
    ).toBe(0)
  })
})
