import { useEffect, useMemo, type MouseEvent } from 'react'
import {
  useMatches,
  useRouter,
  useRouterState,
  type RegisteredRouter,
} from '@tanstack/react-router'
import {
  listOnly,
  onTrail,
  originPage,
  pageCrumb,
  showsOrigin,
  trailOf,
  type Crumb,
} from '@/lib/crumbs'
import { fromParentHere } from '@/lib/history'
import { usePermissions } from '@/lib/use-session'

/*
  What the person last left each list as, in this tab (contract 9.11): an ancestor crumb opens
  its list with the view, search, filters and sort, without the open panel. Kept for the tab's
  session, so a reload keeps it and another tab starts afresh.
*/
const KEY = 'heed:lists'
let lists: Record<string, Record<string, unknown>> | null = null

function readLists() {
  if (lists) return lists
  try {
    lists = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as typeof lists
  } catch {
    lists = {}
  }
  return (lists ??= {})
}

export function rememberedList(id: string) {
  return readLists()[id]
}

function rememberList(id: string, search: Record<string, unknown>) {
  const all = readLists()
  all[id] = listOnly(search)
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage blocked: the lists are remembered until the page reloads.
  }
}

/** The trail of the page on screen, worked out once by the shell for the header and the page. */
export function useTrailOfPage(): Crumb[] {
  const matches = useMatches()
  const { permissions } = usePermissions()
  const leaf = matches.at(-1)
  const id = leaf?.routeId
  const search = leaf?.search
  useEffect(() => {
    const crumb = id ? pageCrumb(id) : undefined
    if (id && search && crumb && !crumb.record) rememberList(id, search)
  }, [id, search])
  return trailOf(matches, permissions, rememberedList)
}

/**
 * Up one level, to the parent crumb (Escape on a record page, the phone's way back): back when
 * the entry behind is that parent, so its panel, filters and scroll return exactly; otherwise a
 * new entry to the parent as the person last left it.
 */
export function goUp(router: RegisteredRouter, parent: Crumb) {
  if (fromParentHere(router.history.location.state)) router.history.back()
  else void router.navigate({ to: parent.to, params: parent.params, search: parent.search })
}

/** Where a page was opened from, when that is not on its trail (Back to origin, 9.11). */
export type OriginBack = {
  /** The origin page's own final crumb: `What changed`, `Editions`, `2026-10-06.2`. */
  label: string
  /** Its address, path and search only. */
  href: string
  /** The origin is the entry directly behind this one, so going back restores it exactly. */
  behind: boolean
}

/**
 * The way back to the page this one was opened from (contract 9.11): on a record page, or What
 * changed, opened from a page that is not on its trail. The origin is in the entry's history
 * state (lib/history.ts); its name comes from matching its address against the route table.
 * A deep link, a new tab and a page whose origin is on its trail have none: the trail is the
 * way back.
 */
export function useOriginOfPage(trail: readonly Crumb[]): OriginBack | undefined {
  const router = useRouter()
  const { permissions } = usePermissions()
  const page = useRouterState({ select: (state) => state.matches.at(-1)?.routeId })
  const from = useRouterState({ select: (state) => state.location.state.from })
  const index = useRouterState({ select: (state) => state.location.state.__TSR_index })
  const shown = showsOrigin(page) && from !== undefined
  const origin = useMemo(() => {
    if (!shown) return undefined
    const query = from.href.indexOf('?')
    const pathname = query < 0 ? from.href : from.href.slice(0, query)
    const search = query < 0 ? '' : from.href.slice(query)
    const matches = router.matchRoutes(pathname, router.options.parseSearch(search))
    return originPage(matches, permissions)
  }, [router, shown, from, permissions])
  if (!origin || !from || onTrail(trail, origin)) return undefined
  return { label: origin.label, href: from.href, behind: from.index === index - 1 }
}

/**
 * Back to where the page was opened from: back when that is the entry behind, so its panel,
 * filters and scroll return exactly; otherwise a new entry to it.
 */
export function goToOrigin(router: RegisteredRouter, origin: OriginBack) {
  if (origin.behind) router.history.back()
  else void router.navigate({ href: origin.href })
}

/** A plain click: a modified one opens the link as links do (a new tab, a new window). */
export const plainClick = (event: MouseEvent) =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
