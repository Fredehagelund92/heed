import { createFileRoute } from '@tanstack/react-router'
import { InboxPage } from '@/pages/inbox'
import { inboxSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/inbox/')({
  validateSearch: inboxSearch,
  component: InboxPage,
})
