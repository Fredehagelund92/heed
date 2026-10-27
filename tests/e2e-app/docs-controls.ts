/*
  The bold controls the docs name (docs/help/README.md, "The docs check"): each with the page that
  names it, the screen it is on, and the way it is drawn there. Plain data, so the docs test (Vitest)
  and the browser check (docs-controls.spec.ts) read the same table. A new bold control in a page
  needs a row here before the docs test passes.
*/

/** How the control is drawn on its screen: a button, a link, a menu or list option, or the words of a row. */
export type Drawn = 'button' | 'link' | 'option' | 'text'

export type DocControl = {
  /** The bold words, as the page writes them. */
  phrase: string
  /** The page that names it, in docs/help. */
  page: string
  /** The app address it is on. */
  at: string
  drawn: Drawn
  /** A button to press first, by its name, when the control is in what it opens. */
  open?: string
}

export const docControls: DocControl[] = [
  { phrase: 'Settings', page: 'connect-an-agent', at: '/inbox', drawn: 'link' },
  { phrase: 'Agents and access', page: 'connect-an-agent', at: '/settings/general', drawn: 'link' },
  { phrase: 'Copy prompt', page: 'connect-an-agent', at: '/settings/agents', drawn: 'button' },
  {
    phrase: 'Say what the business is about',
    page: 'get-started',
    at: '/inbox?demo=setup',
    drawn: 'text',
  },
  {
    phrase: 'Write your first context item',
    page: 'get-started',
    at: '/inbox?demo=setup',
    drawn: 'text',
  },
  {
    phrase: 'Ask a question about it',
    page: 'get-started',
    at: '/inbox?demo=setup',
    drawn: 'text',
  },
  { phrase: 'Connect your agent', page: 'get-started', at: '/inbox?demo=setup', drawn: 'text' },
  {
    phrase: 'Connect your definitions',
    page: 'get-started',
    at: '/inbox?demo=setup',
    drawn: 'text',
  },
  { phrase: 'Invite people', page: 'domains-and-owners', at: '/settings/people', drawn: 'button' },
  { phrase: 'Event', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  { phrase: 'Warning', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  { phrase: 'Rule', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  { phrase: 'Guide', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
]
