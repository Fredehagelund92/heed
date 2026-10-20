/** Values the contract states, in a module of their own so code that needs only these stays light. */

/** Paths in the contract are relative to this prefix. A breaking change needs a new version. */
export const API_PREFIX = '/api/v1'

/** The most rows one page of `items.list` returns. */
export const ITEMS_PAGE_MAX = 1000

/** The most incoming links `items.links` lists; `items.list` with `mentions` pages the rest. */
export const INCOMING_LINKS_MAX = 20

/**
 * The browser origins the service accepts changes from when CL_WEB_ORIGINS is not set: the Vite
 * dev and preview servers. The command-line tool presents the first when nothing else is given.
 */
export const DEFAULT_WEB_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'] as const
