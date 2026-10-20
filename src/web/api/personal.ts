/**
 * Favourites and recently opened items, kept in this browser. Both API bindings use it: the
 * service records who writes and decides, never what a person reads (requirements, section 6),
 * so these lists stay with the person's browser.
 */
import type { PersonalLists } from './client'

const RECENT_LIMIT = 20

/** Lists kept in `localStorage` under `<prefix>favorites` and `<prefix>recent`. */
export function browserPersonalLists(prefix: string): PersonalLists {
  const favoritesKey = `${prefix}favorites`
  const recentKey = `${prefix}recent`

  const read = (key: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : []
    } catch {
      return []
    }
  }

  const write = (key: string, ids: string[]): string[] => {
    try {
      window.localStorage.setItem(key, JSON.stringify(ids))
    } catch {
      // Storage can be blocked. The change still applies until the page reloads.
    }
    return ids
  }

  return {
    listFavorites: () => read(favoritesKey),
    setFavorite(id, favorite) {
      const current = read(favoritesKey).filter((existing) => existing !== id)
      return write(favoritesKey, favorite ? [...current, id] : current)
    },
    listRecent: () => read(recentKey),
    recordVisit(id) {
      const next = [id, ...read(recentKey).filter((existing) => existing !== id)]
      return write(recentKey, next.slice(0, RECENT_LIMIT))
    },
  }
}
