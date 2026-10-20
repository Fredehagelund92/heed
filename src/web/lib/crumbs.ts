import type { Permissions } from '@/api'
import { libraryViews } from '@/lib/library-core'
import { navItems } from '@/lib/nav'
import { isAdmin } from '@/lib/permissions'
import { docSections } from '@/lib/docs-sections'
import { adminSectionTitles, settingsSectionTitles } from '@/lib/settings-sections'
import type { FileRoutesById } from '@/routeTree.gen'
import { builtInManifests } from '../../connectors/manifests.ts'

/*
  The crumb tree (contract 9.11, "Where am I and how to get back"): one definition per route,
  so every page has a trail and the header never guesses. TypeScript fails when a route is added
  without one, and tests/unit/crumbs.test.ts checks the tree against the generated routes.

  - The root crumb is the sidebar place, named from nav.ts, so a rename renames the crumb.
  - A view or section is a crumb only when it has its own navigation entry: the library's views
    in the sidebar, the docs' sections in their tree, and the Settings and Administration section
    lists. Chips, tabs and filters are not; neither is a record open in the docked panel.
  - A record page ends with the record's short identity (`Guide`, `#1291`, `2026-10-06.2`,
    `Metric`), never its title, which the page shows.
*/

export type RouteId = Exclude<keyof FileRoutesById, '__root__'>

type Search = Record<string, unknown>

/**
 * A connector as the trail names it: a built-in manifest's title, read without the network, or
 * its id said as a name (`cube` is Cube) for one written to interface 2.
 */
function connectorCrumb(id: string): string {
  const manifest = builtInManifests.find((candidate) => candidate.id === id)
  return manifest?.title ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ')
}

/** A page and the crumbs it adds to the trail. */
export type PageCrumb = {
  /** The page's own crumb; on a record page, what it ends with until the record names itself. */
  label: string
  /** The page above it on the trail; none for a sidebar place. */
  parent?: RouteId
  /** A record page: its loader's `crumb` names the record (`#1291`), in mono when `crumbMono`. */
  record?: true
  /** The record's short identity when its address holds it (an edition's number). */
  identity?: (params: Record<string, string>) => string
  /**
   * Reached from a page that is not on its trail, the page shows the way back there (Back to
   * origin, 9.11). Every record page does; this marks the other pages that do.
   */
  showsOrigin?: true
  /** A form: never a page to go back to, since once it is sent there is nothing to return to. */
  form?: true
  /** A section or mode of the page that is a crumb of its own, read from the address. */
  section?: (search: Search, permissions: Permissions | undefined) => string | undefined
  /**
   * A record of the section open as the section's own page, not in a panel (a source in
   * Administration's Sources): the trail ends with its short identity, and the section's crumb
   * opens the section (`section`, its address).
   */
  sectionRecord?: (search: Search) =>
    | {
        label: string
        section: Search
        /** Not a record's identity but a form's name: the crumb is not in mono. */
        form?: true
        /** A form on the record (its settings): the record's crumb opens it (`search`). */
        then?: { label: string; search: Search }
      }
    | undefined
  /** The list a record page carries in its address, which its parent crumb opens. */
  carriedList?: (search: Search) => Search
}

/**
 * The routes exempt from the trail: an old address that only redirects, and the pages with no
 * shell. The guard test lists them by name.
 */
export type ExemptRouteId =
  | '/workbench'
  | '/quality'
  | '/areas'
  | '/mcp'
  | '/connect'
  | '/evals/'
  | '/evals/editions/$label'
  | '/signed-out'
  | '/connect_/approve'

/** A route that holds pages: the pages carry the crumbs. */
type Layout = 'layout'

const place = (id: string) => navItems.find((item) => item.id === id)?.title ?? id

const crumbTree = {
  '/': { label: place('home') },
  '/assistant': { label: place('assistant') },
  '/try-it': { label: 'Try a question' },
  '/library': 'layout',
  '/library/': {
    label: place('library'),
    section: (search) => libraryViews.find((view) => view.id === search.view)?.title,
  },
  '/library/new': { label: 'Add a fact', parent: '/library/', form: true },
  '/library/bin': { label: 'Bin', parent: '/library/' },
  '/library/bin_/$itemId': { label: 'Fact', parent: '/library/bin', record: true },
  '/library/$itemId': {
    label: 'Fact',
    parent: '/library/',
    record: true,
    carriedList: ({ tab: _tab, ...list }) => list,
  },
  '/library/$itemId_/suggest': {
    label: 'Suggest a change',
    parent: '/library/$itemId',
    form: true,
  },
  '/catalogue': 'layout',
  '/catalogue/': { label: place('catalogue') },
  '/catalogue/metric/$id': { label: 'Metric', parent: '/catalogue/', record: true },
  '/catalogue/dimension/$id': { label: 'Dimension', parent: '/catalogue/', record: true },
  '/catalogue/suggest': { label: 'Suggest a name', parent: '/catalogue/', form: true },
  '/proposals': 'layout',
  '/proposals/': { label: place('proposals') },
  '/proposals/$proposalId': { label: 'Proposal', parent: '/proposals/', record: true },
  '/editions': 'layout',
  '/editions/': { label: place('editions') },
  '/editions/$label': {
    label: 'Edition',
    parent: '/editions/',
    record: true,
    identity: ({ label }) => label!,
  },
  '/editions/compare': { label: 'What changed', parent: '/editions/', showsOrigin: true },
  '/health': {
    label: place('health'),
    section: (search) => (search.mode === 'compare' ? 'Compare' : undefined),
  },
  '/gaps': { label: place('gaps') },
  '/admin': {
    label: place('admin'),
    // Only administrators have the section list; an auditor's one section is the page.
    section: (search, permissions) =>
      permissions && isAdmin(permissions)
        ? adminSectionTitles[(search.section as keyof typeof adminSectionTitles) ?? 'domains']
        : undefined,
    // A source's page in Sources ends with the source's id: Administration › Sources › cube;
    // its settings' form with Change settings after it; the list of connectors to add a source
    // of, then the chosen connector's form after it.
    sectionRecord: (search) =>
      search.section !== 'sources'
        ? undefined
        : typeof search.source === 'string'
          ? {
              label: search.source,
              section: { section: 'sources' },
              ...(search.edit === true
                ? {
                    then: {
                      label: 'Change settings',
                      search: { section: 'sources', source: search.source },
                    },
                  }
                : search.terms === true
                  ? {
                      then: {
                        label: search.values ? 'Add values' : 'Propose names',
                        search: { section: 'sources', source: search.source },
                      },
                    }
                  : {}),
            }
          : search.add === true
            ? typeof search.connector === 'string'
              ? {
                  label: 'Add a connector',
                  section: { section: 'sources' },
                  form: true,
                  then: {
                    label: connectorCrumb(search.connector),
                    search: { section: 'sources', add: true },
                  },
                }
              : { label: 'Add a connector', section: { section: 'sources' }, form: true }
            : undefined,
  },
  '/settings': {
    label: place('settings'),
    section: (search) =>
      settingsSectionTitles[(search.section as keyof typeof settingsSectionTitles) ?? 'profile'],
  },
  '/docs': 'layout',
  '/docs/': {
    label: place('docs'),
    section: (search) => docSections.find((section) => section.id === search.section)?.title,
  },
  // A help page ends with its section (Docs › Guides); the page has its title.
  '/docs/$slug': { label: 'Page', parent: '/docs/', record: true },
  '/design-preview': 'layout',
  '/design-preview/': { label: 'Design preview' },
  '/design-preview/$template': { label: 'Template', parent: '/design-preview/', record: true },
} as const satisfies Record<Exclude<RouteId, ExemptRouteId>, PageCrumb | Layout>

export const crumbDefinitions: Readonly<Record<string, PageCrumb | Layout | undefined>> = crumbTree

export function pageCrumb(id: string): PageCrumb | undefined {
  const definition = crumbDefinitions[id]
  return typeof definition === 'object' ? definition : undefined
}

/** A layout route's place is its index page (`/library` holds `/library/`). */
export function pageOf(id: string): string | undefined {
  if (pageCrumb(id)) return id
  return crumbDefinitions[id] === 'layout' ? `${id}/` : undefined
}

/** The address of a route: `/library/$itemId_/suggest` is at `/library/$itemId/suggest`. */
export const pathOf = (id: string) => id.replace(/_(?=\/|$)/g, '')

/**
 * What a page keeps in its address for a record or a mode over its list (the docked panel, its
 * tab, a focus mode), as against the list itself (its view, search, filters and sort). A crumb
 * back to a list and the scroll position leave these out.
 */
export const panelParams = new Set([
  'panel',
  'tab',
  'edition',
  'item',
  'step',
  'open',
  'gap',
  'setting',
  'entry',
  'cell',
  'mode',
])

export const listOnly = (search: Search): Search =>
  Object.fromEntries(
    Object.entries(search).filter(([key, value]) => !panelParams.has(key) && value !== undefined),
  )

export type Crumb = {
  /** The page's route. */
  id: string
  label: string
  /** The route and params the crumb leads to, and the search that reopens it as it was left. */
  to: string
  params: Record<string, string>
  search: Search
  /** The final crumb of a record page: the record's short identity. */
  record: boolean
  mono: boolean
  /** On an item page: the item, whose list position the crumb adds. */
  itemId?: string
}

type Match = {
  routeId: string
  params: Record<string, string>
  search: Search
  loaderData?: unknown
  status?: string
  /** The match whose not-found page shows (the router marks it; the root for any address). */
  _notFound?: boolean
}

type LoaderCrumb = {
  crumb?: string
  crumbMono?: boolean
  itemCrumbId?: string
  parentCrumb?: string
}

/**
 * The trail of the matched routes, from the sidebar place to the page (or its section). An
 * ancestor opens its list as the person last left it in this tab (`remembered`); a page that
 * was not found ends with Not found under its place.
 */
export function trailOf(
  matches: readonly Match[],
  permissions: Permissions | undefined,
  remembered: (id: string) => Search | undefined,
): Crumb[] {
  const notFound = matches.some((match) => match.status === 'notFound' || match._notFound)
  const leaf = matches.findLast((match) => pageOf(match.routeId))
  if (!leaf) return notFound ? [notFoundCrumb] : []
  const data = (leaf.loaderData ?? {}) as LoaderCrumb
  const crumbs: Crumb[] = []
  let id: string | undefined = pageOf(leaf.routeId)
  while (id) {
    const definition = pageCrumb(id)!
    const own = id === leaf.routeId
    const label = definition.record
      ? ((own ? (data.crumb ?? definition.identity?.(leaf.params)) : data.parentCrumb) ??
        definition.label)
      : definition.label
    crumbs.unshift({
      id,
      label,
      to: pathOf(id),
      params: leaf.params,
      // A list reopens as it was left; a record above the page opens as it is.
      search: own || definition.record ? {} : (remembered(id) ?? {}),
      record: own && definition.record === true,
      mono: own && data.crumbMono === true,
      ...(own && data.itemCrumbId ? { itemId: data.itemCrumbId } : {}),
    })
    id = definition.parent
  }
  if (notFound) return [{ ...crumbs[0]!, record: false, mono: false }, notFoundCrumb]
  // A record page that carries its list opens that list from its parent crumb.
  const carried = pageCrumb(leaf.routeId)?.carriedList?.(leaf.search)
  const parent = crumbs.at(-2)
  if (parent && carried && Object.keys(carried).length > 0) parent.search = carried
  const section = pageCrumb(leaf.routeId)?.section?.(leaf.search, permissions)
  if (section) {
    const record = pageCrumb(leaf.routeId)?.sectionRecord?.(leaf.search)
    crumbs.push({
      ...crumbs.at(-1)!,
      label: section,
      ...(record ? { search: record.section } : {}),
    })
    if (record)
      crumbs.push({ ...crumbs.at(-1)!, label: record.label, record: true, mono: !record.form })
    if (record?.then) {
      const page = crumbs.at(-1)!
      crumbs.push({ ...page, label: record.then.label, record: true, mono: false })
      // The record's crumb opens its page now; it is no longer the end of the trail.
      Object.assign(page, { search: record.then.search, record: false })
    }
  }
  return crumbs
}

/** Whether the page shows the way back to where it was opened from (9.11). */
export function showsOrigin(id: string | undefined) {
  const definition = id ? pageCrumb(id) : undefined
  return definition?.record === true || definition?.showsOrigin === true
}

/**
 * The page an origin's address opens, named as its own final crumb (`What changed`, `Editions`,
 * `2026-10-06.2`), from the routes it matches: only a page of the crumb tree that is found has a
 * name, so an address that is no page, or an old one that only redirects, leads nowhere. A form
 * is no origin: the page it led to after it was sent goes up instead.
 */
export function originPage(
  matches: readonly Match[],
  permissions: Permissions | undefined,
): Pick<Crumb, 'id' | 'label' | 'params'> | undefined {
  // Not the loaders' data: a record is named by its address, or by its kind.
  const trail = trailOf(
    matches.map(({ routeId, params, search, status, _notFound }) => ({
      routeId,
      params,
      search,
      status,
      _notFound,
    })),
    permissions,
    () => undefined,
  )
  const page = trail.at(-1)
  if (!page || page === notFoundCrumb || trail.includes(notFoundCrumb)) return undefined
  return pageCrumb(page.id)?.form ? undefined : page
}

/** Whether a page is on the trail already, so its crumb is the way back there. */
export const onTrail = (trail: readonly Crumb[], page: Pick<Crumb, 'id' | 'params'>) =>
  trail.some(
    (crumb) =>
      crumb.id === page.id &&
      Object.entries(page.params).every(([key, value]) => crumb.params[key] === value),
  )

const notFoundCrumb: Crumb = {
  id: '__root__',
  label: 'Page not found',
  to: '/',
  params: {},
  search: {},
  record: false,
  mono: false,
}
