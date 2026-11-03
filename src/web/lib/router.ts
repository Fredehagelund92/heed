import * as React from 'react'
import { useRouterState, type AnyRouter, type ParsedLocation } from '@tanstack/react-router'

// The app's addresses are TanStack Router file routes (routes/), each with its search params
// validated (lib/search.ts). Pages read and change the address through this module: the path, its
// parts and the validated query, as one value.

export type Route = { path: string; parts: string[]; query: URLSearchParams }

let router: AnyRouter | undefined

/** The router every navigation goes through; main.tsx binds it once, before the first render. */
export function bindRouter(r: AnyRouter) {
  router = r
}

/** Observability's Summary, or one of its monthly digests. */
const SUMMARY = /^\/observability\/summary(\/[^/]*)?\/?$/
/** Observability's Overview by its old name: it is Observability's own address now. */
const OVERVIEW = /^\/observability\/overview\/?$/

/**
 * Old addresses keep working: a #/ link from the hash router, the Library that became Context and
 * Definitions, the Definitions tab that became the Cube integration, About our business that became
 * General, a peek's `fact` that became `context`, Observability's Summary and its monthly
 * digests, which went: they land on Overview, without the Summary's own `period`, Overview's own
 * old address (Overview is Observability's now), and the Conflicts list that became the Context
 * list filtered to what is in a conflict. Questions' old address stays: it opens Overview at the
 * topics. Returns where to go instead, or null.
 */
export function redirectFrom(
  location: Pick<ParsedLocation, 'pathname' | 'searchStr' | 'hash'>,
): string | null {
  const [fromPath, fromSearch] = location.hash.startsWith('/')
    ? (location.hash.split('?') as [string, string?])
    : [location.pathname, location.searchStr.replace(/^\?/, '')]
  const search = fromSearch ?? ''
  const summary = SUMMARY.test(fromPath)
  let path = fromPath
    .replace(/^\/library\/(definitions|metrics)(?=\/|$)/, '/definitions')
    .replace(/^\/library\/fact\/([^/]+)/, '/context/$1')
    .replace(/^\/library(?=\/|$)/, '/context')
    .replace(/^\/settings\/definitions(?=\/|$)/, '/settings/integrations/cube')
    .replace(/^\/settings\/about(?=\/|$)/, '/settings/general')
    .replace(SUMMARY, '/observability')
    .replace(OVERVIEW, '/observability')
  const kept = summary
    ? search
        .split('&')
        .filter((p) => p && !/^(period|snapshot)=/.test(p))
        .join('&')
    : search
  let query = kept.replace(/(^|&)dock=fact\./, '$1dock=context.')
  // The Conflicts list became a filter of the Context list; its Mine and All went with it.
  if (/^\/context\/conflicts\/?$/.test(path)) {
    const q = new URLSearchParams(query)
    q.delete('whose')
    q.set('show', 'conflicts')
    path = '/context'
    query = q.toString()
  }
  if (!location.hash.startsWith('/') && path === fromPath && query === search) return null
  return `${path}${query ? `?${query}` : ''}`
}

/** The validated search of the deepest match, as the query a page reads. */
function queryOf(search: Record<string, unknown>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) if (typeof v === 'string') q.set(k, v)
  return q.toString()
}

export function useRoute(): Route {
  const key = useRouterState({
    select: (s) => {
      const leaf = s.matches.at(-1)
      const path = (s.resolvedLocation ?? s.location).pathname
      return `${path}?${queryOf(leaf?.search ?? {})}`
    },
  })
  return React.useMemo(() => {
    const [path, search] = key.split('?') as [string, string]
    return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(search) }
  }, [key])
}

/** The address as it stands, outside React. */
function current(): Route {
  const s = router!.state
  const path = (s.resolvedLocation ?? s.location).pathname
  const query = new URLSearchParams(queryOf(s.matches.at(-1)?.search ?? {}))
  return { path, parts: path.split('/').filter(Boolean), query }
}

export function href(path: string, query?: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v)
  const s = q.toString()
  return `${path}${s ? `?${s}` : ''}`
}

export function navigate(path: string, query?: Record<string, string | undefined>) {
  void router!.navigate({ href: href(path, query) })
}

/** Go somewhere in place of the address now, as a redirect does: Back skips the address left. */
export function redirectTo(path: string) {
  void router!.navigate({ href: path, replace: true })
}

/** Change some query values on the current path, keeping the rest. */
export function setQuery(changes: Record<string, string | undefined>) {
  const { path, query } = current()
  const q = new URLSearchParams(query)
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v)
    else q.delete(k)
  }
  navigate(path, Object.fromEntries(q))
}

/**
 * A plain link (`<a href="/context">`) moves inside the app without loading the page again, as a
 * #/ link did: a click with no modifier key, on a link to this origin that opens in this tab. A
 * link to a place on the same page (#section) is left to the browser.
 */
export function useInAppLinks() {
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (
        !(a instanceof HTMLAnchorElement) ||
        (a.target && a.target !== '_self') ||
        a.hasAttribute('download')
      )
        return
      const url = new URL(a.href)
      if (url.origin !== window.location.origin) return
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      )
        return
      e.preventDefault()
      void router!.navigate({ href: `${url.pathname}${url.search}${url.hash}` })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}
