import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSession } from '@/api/queries'
import { useNeedsYou } from '@/lib/inbox-rows'

// The app opens on the Inbox for someone with something to decide, and on Ask for someone with
// nothing: the Inbox stays in the sidebar with its count. A new install opens on its setup, in
// the Inbox. Signed out, the app moves to the sign-in page (App.tsx).
export const Route = createFileRoute('/')({ component: Start })

function Start() {
  const { user } = useSession()
  return user ? <Opening /> : null
}

function Opening() {
  const { install } = useSession()
  const count = useNeedsYou()
  return <Navigate to={count || install === 'new' ? '/inbox' : '/ask'} replace />
}
