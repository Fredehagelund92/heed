/**
 * Reading and archiving notifications (slice W7): optimistic changes to the cached inbox, and the
 * unread count the bell, the list and the live stream share. Apart from `queries.ts` because only
 * the notifications list and the live stream use it, and neither is part of the first load.
 */
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { api, type InboxChange, type InboxPage } from '@/api'
import { queryKeys, type InboxFilter, type InboxUnread } from './queries'

export type InboxPages = { pages: InboxPage[]; pageParams: unknown[] }
export type InboxEdit =
  { action: 'read'; ids: string[] } | { action: 'read-all' } | { action: 'archive'; ids: string[] }

/**
 * What an inbox change looks like before the service answers: reading and archiving a
 * notification are optimistic (contract 9.3), so the bell and the list change at once.
 */
export function editInbox(pages: InboxPages, filter: InboxFilter, edit: InboxEdit, at: string) {
  const touches = (id: string) => edit.action === 'read-all' || edit.ids.includes(id)
  return {
    ...pages,
    pages: pages.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((item) => {
        if (!touches(item.id)) return [item]
        if (edit.action === 'archive' && filter !== 'archived') return []
        if (edit.action === 'read-all' && item.archivedAt) return [item]
        return [{ ...item, readAt: item.readAt ?? at }]
      }),
    })),
  }
}

/** Unread items an edit would read, from what the lists hold. */
function unreadTouched(queryClient: QueryClient, edit: InboxEdit): number | null {
  if (edit.action === 'read-all') return null
  const items = queryClient
    .getQueriesData<InboxPages>({ queryKey: [...queryKeys.inbox, 'pages'] })
    .flatMap(([, data]) => data?.pages.flatMap((page) => page.items) ?? [])
  const unread = new Set(
    items
      .filter((item) => !item.readAt && !item.archivedAt && edit.ids.includes(item.id))
      .map((item) => item.id),
  )
  return unread.size
}

/** Sets the unread count everywhere the inbox is cached, from a live event or an answer. */
export function setInboxUnread(queryClient: QueryClient, unread: number) {
  queryClient.setQueryData<InboxUnread>(queryKeys.inboxUnread, (data) =>
    data ? { ...data, unread, latest: unread ? data.latest : null } : data,
  )
  queryClient.setQueriesData<InboxPages>({ queryKey: [...queryKeys.inbox, 'pages'] }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, unread })) } : data,
  )
}

/**
 * Marks notifications read, all of them read, or archives them. Optimistic: the lists and the
 * count change at once, roll back if the service refuses, and take the service's count after.
 */
export function useInboxEdit({ onError }: { onError?: (error: Error) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation<InboxChange, Error, InboxEdit, { snapshot: [QueryKey, unknown][] }>({
    mutationKey: ['write', 'inbox'],
    mutationFn: (edit) =>
      edit.action === 'read-all'
        ? api.markAllInboxRead()
        : edit.action === 'read'
          ? api.markInboxRead({ ids: edit.ids })
          : api.archiveInbox({ ids: edit.ids }),
    onMutate: async (edit) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.inbox })
      const snapshot = queryClient.getQueriesData({ queryKey: queryKeys.inbox })
      const at = new Date().toISOString()
      const touched = unreadTouched(queryClient, edit)
      for (const filter of ['all', 'unread', 'archived'] as const)
        queryClient.setQueryData<InboxPages>(queryKeys.inboxPages(filter), (data) =>
          data ? editInbox(data, filter, edit, at) : data,
        )
      const unread = queryClient.getQueryData<InboxUnread>(queryKeys.inboxUnread)?.unread
      if (unread !== undefined)
        setInboxUnread(queryClient, touched === null ? 0 : Math.max(0, unread - touched))
      return { snapshot }
    },
    onError: (error, _edit, context) => {
      for (const [queryKey, data] of context?.snapshot ?? [])
        queryClient.setQueryData(queryKey, data)
      onError?.(error)
    },
    onSuccess: (change) => setInboxUnread(queryClient, change.unread),
    // An archived item moves to the Archived view, which only the service can page correctly.
    onSettled: (_change, _error, edit) =>
      edit.action === 'archive'
        ? queryClient.invalidateQueries({ queryKey: queryKeys.inboxPages('archived') })
        : undefined,
  })
}
