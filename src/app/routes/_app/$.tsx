import { createFileRoute } from '@tanstack/react-router'
import { InboxPage } from '@/pages/inbox'

// An address the app does not know shows the Inbox, as the mockup did.
export const Route = createFileRoute('/_app/$')({ component: InboxPage })
