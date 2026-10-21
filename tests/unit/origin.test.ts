import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { Permissions } from '@/api'
import { onTrail, originPage, showsOrigin, trailOf } from '@/lib/crumbs'
import { recordOrigins } from '@/lib/history'
import { createAppRouter } from '@/router'

/*
  Back to origin (contract 9.11): every entry says which page it was opened from, and the name
  of that page comes from the route table, never from the entry.
*/

const history = () => recordOrigins(createMemoryHistory({ initialEntries: ['/editions'] }))

describe('the history of a tab', () => {
  it('says an entry for another page was opened from the entry behind it', () => {
    const tab = history()
    expect(tab.location.state.from).toBeUndefined()
    tab.push('/editions?edition=2026-10-07.1')
    tab.push('/editions/compare?since=2026-10-03.1&until=2026-10-07.1')
    expect(tab.location.state.from).toEqual({ href: '/editions?edition=2026-10-07.1', index: 1 })
    expect(tab.location.state.__TSR_index).toBe(2)
  })

  it('keeps the origin of a page through its own entries, which leaves it further back', () => {
    const tab = history()
    tab.push('/editions/2026-10-07.1')
    tab.push('/editions/compare?since=2026-10-03.1&until=2026-10-07.1')
    tab.push('/editions/compare?since=2026-10-03.1&until=2026-10-07.1&change=added')
    expect(tab.location.state.from).toEqual({ href: '/editions/2026-10-07.1', index: 1 })
    expect(tab.location.state.__TSR_index).toBe(3)
  })

  it('keeps the origin when an entry is replaced, with the state it is given', () => {
    const tab = history()
    tab.push('/library/itm_a', { fromList: true })
    tab.replace('/library/itm_b')
    expect(tab.location.state.from).toEqual({ href: '/editions', index: 0 })
    tab.replace('/library/itm_c', { fromParent: true })
    expect(tab.location.state).toMatchObject({
      fromParent: true,
      from: { href: '/editions', index: 0 },
    })
  })

  it('goes back to an entry with the origin it had', () => {
    const tab = history()
    tab.push('/editions/compare?since=2026-10-03.1&until=2026-10-07.1')
    tab.push('/library/itm_a')
    tab.back()
    expect(tab.location.state.from).toEqual({ href: '/editions', index: 0 })
  })
})

describe('the page an origin opens', () => {
  const router = createAppRouter(new QueryClient(), createMemoryHistory())
  const admin = { roles: ['administrator'], areas: [] } as unknown as Permissions
  const page = (href: string) => {
    const [pathname = '/', search = ''] = href.split('?')
    return originPage(router.matchRoutes(pathname, router.options.parseSearch(search)), admin)
  }

  it('is named as its own final crumb, from the route table', () => {
    expect(page('/editions/compare?since=2026-10-03.1&until=2026-10-07.1')?.label).toBe(
      'What changed',
    )
    expect(page('/editions?edition=2026-10-07.1')?.label).toBe('Editions')
    expect(page('/editions/2026-10-06.2')?.label).toBe('2026-10-06.2')
    expect(page('/library/itm_jyfuvl07')?.label).toBe('Fact')
    expect(page('/settings?section=connect')?.label).toBe('Connect an agent')
    expect(page('/')?.label).toBe('Home')
  })

  it('is no page for an address no page answers to, or one that only redirects', () => {
    expect(page('/nope')).toBeUndefined()
    expect(page('/workbench')).toBeUndefined()
    expect(page('/signed-out?from=https://example.com')).toBeUndefined()
    // A form, once sent, is nothing to go back to.
    expect(page('/library/new')).toBeUndefined()
    expect(page('/library/itm_a/suggest')).toBeUndefined()
  })

  it('is not shown when it is on the trail already', () => {
    const trail = (href: string) => {
      const [pathname = '/', search = ''] = href.split('?')
      return trailOf(
        router.matchRoutes(pathname, router.options.parseSearch(search)),
        admin,
        () => undefined,
      )
    }
    const item = trail('/library/itm_b')
    expect(onTrail(item, page('/library?view=mine')!)).toBe(true)
    expect(onTrail(item, page('/editions/compare?since=a&until=b')!)).toBe(false)
    // Another item is not this one.
    expect(onTrail(item, page('/library/itm_a')!)).toBe(false)
    expect(onTrail(trail('/editions/compare'), page('/editions?edition=x')!)).toBe(true)
    expect(onTrail(trail('/editions/compare'), page('/editions/2026-10-06.2')!)).toBe(false)
  })

  it('is shown on record pages and What changed only', () => {
    expect(showsOrigin('/library/$itemId')).toBe(true)
    expect(showsOrigin('/proposals/$proposalId')).toBe(true)
    expect(showsOrigin('/catalogue/metric/$id')).toBe(true)
    expect(showsOrigin('/editions/$label')).toBe(true)
    expect(showsOrigin('/editions/compare')).toBe(true)
    expect(showsOrigin('/library/')).toBe(false)
    expect(showsOrigin('/library/new')).toBe(false)
    expect(showsOrigin(undefined)).toBe(false)
  })
})
