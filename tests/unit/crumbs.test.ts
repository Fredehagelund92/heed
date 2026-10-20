import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { Permissions } from '@/api'
import {
  crumbDefinitions,
  type ExemptRouteId,
  listOnly,
  pageCrumb,
  pageOf,
  pathOf,
  trailOf,
  type Crumb,
} from '@/lib/crumbs'
import { navItems } from '@/lib/nav'
import { createAppRouter } from '@/router'

/** Every route id in the generated route tree, as a router built on it has them. */
function routeIds(): string[] {
  const router = createAppRouter(new QueryClient(), createMemoryHistory())
  return Object.keys(router.routesById)
    .filter((id) => id !== '__root__')
    .sort()
}

/** The routes exempt from the trail, by name: old addresses that redirect, and pages with no shell. */
const exempt = [
  '/workbench',
  '/quality',
  '/areas',
  '/mcp',
  '/connect',
  '/evals/',
  '/evals/editions/$label',
  '/signed-out',
  '/connect_/approve',
] as const satisfies readonly ExemptRouteId[]
// Every exempt route is listed above: a name left out here fails the type check.
const listed: Exclude<ExemptRouteId, (typeof exempt)[number]> extends never ? true : false = true

const admin = { roles: ['administrator'], areas: [] } as unknown as Permissions
const auditor = { roles: ['auditor'], areas: [] } as unknown as Permissions

const match = (routeId: string, extra: Partial<Parameters<typeof trailOf>[0][number]> = {}) => ({
  routeId,
  params: {},
  search: {},
  ...extra,
})

/** The trail as text: `[Link] › Page`. */
const words = (trail: Crumb[]) =>
  trail
    .map((crumb, index) => (index < trail.length - 1 ? `[${crumb.label}]` : crumb.label))
    .join(' › ')

describe('the crumb tree', () => {
  // The guard: a route added without a crumb definition fails the build (and this test).
  it('defines every route in the generated route tree, or names it as exempt', () => {
    expect(listed).toBe(true)
    expect([...Object.keys(crumbDefinitions), ...exempt].sort()).toEqual(routeIds())
  })

  it('gives every page a parent that is a page, up to a sidebar place, without a loop', () => {
    for (const [id, definition] of Object.entries(crumbDefinitions)) {
      if (typeof definition !== 'object') continue
      const seen = new Set([id])
      let parent = definition.parent
      while (parent) {
        expect(pageCrumb(parent), `${id} goes up to ${parent}, which is not a page`).toBeDefined()
        expect(seen.has(parent), `${id} loops at ${parent}`).toBe(false)
        seen.add(parent)
        parent = pageCrumb(parent)?.parent
      }
    }
  })

  it('names each sidebar place as nav.ts does', () => {
    for (const item of navItems.filter((entry) => !entry.search)) {
      const id = item.to === '/' ? '/' : (pageOf(item.to) ?? item.to)
      const definition = pageCrumb(id)
      expect(definition?.label, item.to).toBe(item.title)
      expect(definition?.parent, item.to).toBeUndefined()
    }
  })

  it('holds a layout only where it has an index page', () => {
    for (const [id, definition] of Object.entries(crumbDefinitions))
      if (definition === 'layout') expect(pageCrumb(`${id}/`), id).toBeDefined()
  })

  it('finds the address of a route', () => {
    expect(pathOf('/library/$itemId_/suggest')).toBe('/library/$itemId/suggest')
    expect(pathOf('/library/')).toBe('/library/')
  })
})

describe('the trail', () => {
  const none = () => undefined

  it('is the place alone on a place, and adds a section that has its own navigation', () => {
    expect(words(trailOf([match('/library'), match('/library/')], admin, none))).toBe('Library')
    expect(
      words(
        trailOf([match('/library'), match('/library/', { search: { view: 'mine' } })], admin, none),
      ),
    ).toBe('[Library] › Mine')
    expect(
      words(
        trailOf([match('/docs'), match('/docs/', { search: { section: 'guides' } })], admin, none),
      ),
    ).toBe('[Docs] › Guides')
    expect(words(trailOf([match('/docs'), match('/docs/')], admin, none))).toBe('Docs')
    expect(words(trailOf([match('/settings')], admin, none))).toBe(
      '[Settings] › Profile and appearance',
    )
    expect(words(trailOf([match('/admin', { search: { section: 'audit' } })], admin, none))).toBe(
      '[Administration] › History log',
    )
    // A source's page in Sources ends with its id; Sources opens the list of sources.
    const source = trailOf(
      [match('/admin', { search: { section: 'sources', source: 'cube', setting: 'x' } })],
      admin,
      none,
    )
    expect(words(source)).toBe('[Administration] › [Sources] › cube')
    expect(source[1]).toMatchObject({ to: '/admin', search: { section: 'sources' } })
    expect(source.at(-1)).toMatchObject({ record: true, mono: true })
    expect(
      words(
        trailOf(
          [match('/admin', { search: { section: 'sources', source: 'cube' } })],
          auditor,
          none,
        ),
      ),
    ).toBe('Administration')
    // An auditor has the history log alone: no section list, so no section crumb.
    expect(words(trailOf([match('/admin')], auditor, none))).toBe('Administration')
    expect(words(trailOf([match('/health', { search: { mode: 'compare' } })], admin, none))).toBe(
      '[Health] › Compare',
    )
  })

  it('ends a record page with the record short identity, never its title', () => {
    const edition = trailOf(
      [
        match('/editions'),
        match('/editions/$label', {
          params: { label: '2026-10-06.2' },
          loaderData: { crumb: '2026-10-06.2', crumbMono: true },
        }),
      ],
      admin,
      none,
    )
    expect(words(edition)).toBe('[Editions] › 2026-10-06.2')
    expect(edition.at(-1)).toMatchObject({ record: true, mono: true })
    expect(words(trailOf([match('/catalogue'), match('/catalogue/metric/$id')], admin, none))).toBe(
      '[Catalogue] › Metric',
    )
  })

  it('goes up through the item a suggestion changes', () => {
    const trail = trailOf(
      [
        match('/library'),
        match('/library/$itemId_/suggest', {
          params: { itemId: 'itm_1' },
          loaderData: { parentCrumb: 'Guide' },
        }),
      ],
      admin,
      none,
    )
    expect(words(trail)).toBe('[Library] › [Guide] › Suggest a change')
    expect(trail[1]).toMatchObject({ to: '/library/$itemId', params: { itemId: 'itm_1' } })
  })

  it('opens an ancestor list as the person left it, without its panel', () => {
    const remembered = (id: string) =>
      id === '/proposals/' ? listOnly({ view: 'mine', panel: 'p_1', tab: 'checks' }) : undefined
    const trail = trailOf(
      [match('/proposals'), match('/proposals/$proposalId', { loaderData: { crumb: '#1291' } })],
      admin,
      remembered,
    )
    expect(words(trail)).toBe('[Proposals] › #1291')
    expect(trail[0]!.search).toEqual({ view: 'mine' })
  })

  it('opens the list an item page carries, before the one remembered', () => {
    const trail = trailOf(
      [
        match('/library'),
        match('/library/$itemId', {
          search: { kind: 'guide', tab: 'source' },
          loaderData: { crumb: 'Guide', itemCrumbId: 'itm_1' },
        }),
      ],
      admin,
      () => ({ view: 'mine' }),
    )
    expect(trail[0]!.search).toEqual({ kind: 'guide' })
    expect(trail.at(-1)).toMatchObject({ label: 'Guide', itemId: 'itm_1', record: true })
  })

  it('says Not found under the place, or alone where no route matched', () => {
    expect(words(trailOf([match('__root__', { _notFound: true })], admin, none))).toBe(
      'Page not found',
    )
    expect(
      words(
        trailOf(
          [match('__root__', { _notFound: true }), match('/library'), match('/library/$itemId')],
          admin,
          none,
        ),
      ),
    ).toBe('[Library] › Page not found')
  })
})
