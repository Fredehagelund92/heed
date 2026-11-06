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
 * Definitions, the Definitions tab that became Integrations, About our business that became
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
    .replace(/^\/settings\/definitions(?=\/|$)/, '/settings/integrations')
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

/**
 * The part of the app the person is going to. It changes with the click, where `useRoute` waits for
 * the page, so what says where they are answers at once however long the page's code takes.
 */
export const useDestination = () =>
  useRouterState({ select: (s) => s.location.pathname.split('/')[1] || 'inbox' })

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
  void changeQuery(changes)
}

/**
 * The same, settling once the new address is drawn: for a view transition to wait on. With
 * `replace` it takes the place of the address now, so Back skips it.
 */
export function changeQuery(
  changes: Record<string, string | undefined>,
  opts?: { replace?: boolean },
) {
  const { path, query } = current()
  const q = new URLSearchParams(query)
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v)
    else q.delete(k)
  }
  return router!.navigate({ href: href(path, Object.fromEntries(q)), replace: opts?.replace })
}

/** Where the plain link around `target` goes, if it is one to this origin that opens in this tab. */
export function inAppLink(target: EventTarget | null) {
  const a = (target as Element | null)?.closest?.('a[href]')
  if (
    !(a instanceof HTMLAnchorElement) ||
    (a.target && a.target !== '_self') ||
    a.hasAttribute('download')
  )
    return null
  const url = new URL(a.href)
  return url.origin === window.location.origin ? url : null
}

/**
 * A plain link (`<a href="/context">`) moves inside the app without loading the page again, as a
 * #/ link did: a click with no modifier key, on a link to this origin that opens in this tab. A
 * link to a place on the same page (#section) is left to the browser. Pointing at one, focusing it
 * or touching it fetches the page's code before the click. The router's own preloading only
 * watches its <Link>, which the app does not use.
 */
export function useInAppLinks() {
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const url = inAppLink(e.target)
      if (!url) return
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      )
        return
      e.preventDefault()
      void router!.navigate({ href: `${url.pathname}${url.search}${url.hash}` })
    }
    // Moving across a link's icon and label is one intent.
    let intended = ''
    const onIntent = (e: Event) => {
      const url = inAppLink(e.target)
      const to = url ? `${url.pathname}${url.search}` : ''
      if (url && to !== intended)
        void router!.preloadRoute({
          to: url.pathname,
          search: Object.fromEntries(url.searchParams),
        })
      intended = to
    }
    const intents = ['pointerover', 'focusin', 'touchstart']
    document.addEventListener('click', onClick)
    for (const intent of intents) document.addEventListener(intent, onIntent, { passive: true })
    return () => {
      document.removeEventListener('click', onClick)
      for (const intent of intents) document.removeEventListener(intent, onIntent)
    }
  }, [])
}
