/**
 * What the list of every person's AI apps sorts by. Last used, the newest first, is the default.
 * A connection ends a fixed number of days after it was made, so its end sorts as it connected.
 * Apart from connections.ts so the address's search schema, which the first load carries, does
 * not bring the rest of the connections' words with it.
 */
export const connectionSorts = ['person', 'app', 'connected', 'used'] as const
export type ConnectionSort = (typeof connectionSorts)[number]
export type SortDirection = 'asc' | 'desc'
