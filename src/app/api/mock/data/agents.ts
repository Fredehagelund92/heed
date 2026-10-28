import type { Connected } from '@/lib/connect'

/** The agents people connected as the demo starts, newest sign-in first. */
export const seedAgents: readonly Connected[] = [
  { agent: 'Claude Code', who: 'Kofi Mensah', since: '20 Oct 2026', used: 'Yesterday' },
  { agent: 'Claude', who: 'Maria Lindqvist', since: '2 Oct 2026', used: 'Today' },
  { agent: 'Claude', who: 'Ines Duarte', since: '1 Oct 2026', used: 'Today' },
  { agent: 'Cursor', who: 'Jon Abara', since: '12 Sep 2026', used: 'Yesterday' },
]
