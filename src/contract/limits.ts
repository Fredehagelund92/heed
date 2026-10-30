/** Values the contract states, in a module of their own so code that needs only these stays light. */

/** Paths in the contract are relative to this prefix. A breaking change needs a new version. */
export const API_PREFIX = '/api/v1'

/**
 * The browser origins the service accepts changes from when CL_WEB_ORIGINS is not set: the Vite
 * dev and preview servers. The command-line tool presents the first when nothing else is given.
 */
export const DEFAULT_WEB_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'] as const
