import * as React from 'react'

// A tiny hash router, so the static build works from any folder: #/path?query.

export type Route = { path: string; parts: string[]; query: URLSearchParams }

/**
 * Old addresses keep working: the Library became Context and Definitions, the Definitions tab
 * became the Cube integration, About our business became General, and a peek's `fact` became `context`. The address bar is corrected in place.
 */
function redirect(path: string, search: string): [string, string] {
  const p = path
    .replace(/^\/library\/(definitions|metrics)(?=\/|$)/, '/definitions')
    .replace(/^\/library\/fact\/([^/]+)/, '/context/$1')
    .replace(/^\/library(?=\/|$)/, '/context')
    .replace(/^\/settings\/definitions(?=\/|$)/, '/settings/integrations/cube')
    .replace(/^\/settings\/about(?=\/|$)/, '/settings/general')
  return [p, search.replace(/(^|&)dock=fact\./, '$1dock=context.')]
}

function read(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/inbox'
  const [from, fromSearch = ''] = raw.split('?')
  const [path, search] = redirect(from, fromSearch)
  if (path !== from || search !== fromSearch)
    window.history.replaceState(null, '', `#${path}${search ? `?${search}` : ''}`)
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(search) }
}

const listeners = new Set<() => void>()
let current = read()
window.addEventListener('hashchange', () => {
  current = read()
  listeners.forEach((l) => l())
})

export function useRoute() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export function href(path: string, query?: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v)
  const s = q.toString()
  return `#${path}${s ? `?${s}` : ''}`
}

export function navigate(path: string, query?: Record<string, string | undefined>) {
  window.location.hash = href(path, query)
}

/** Change some query values on the current path, keeping the rest. */
export function setQuery(changes: Record<string, string | undefined>) {
  const q = new URLSearchParams(current.query)
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v)
    else q.delete(k)
  }
  navigate(current.path, Object.fromEntries(q))
}
