import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The retired Connect your AI page (navigation decision, 12 October 2026): it is a section of
 * the person's own Settings now, so an old link lands there. The agent consent page keeps its
 * address (connect_.approve.tsx).
 */
export const Route = createFileRoute('/connect')({
  beforeLoad: () => {
    throw redirect({ to: '/settings', search: { section: 'connect' }, replace: true })
  },
})
