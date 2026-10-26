import { createFileRoute, redirect } from '@tanstack/react-router'

// The app opens on the Inbox.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/inbox', replace: true })
  },
})
