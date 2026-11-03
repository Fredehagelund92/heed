import { describe, expect, it } from 'vitest'
import { href, redirectFrom } from '@/lib/router'
import { contextSearch, inboxSearch, rootSearch, settingsSearch, shellSearch } from '@/lib/search'

const at = (pathname: string, search = '', hash = '') => ({ pathname, searchStr: search, hash })

describe('old addresses', () => {
  it('take a #/ link from the hash router to its path, with its query', () => {
    expect(redirectFrom(at('/', '', '/inbox?demo=week&card=check-returns'))).toBe(
      '/inbox?demo=week&card=check-returns',
    )
    expect(redirectFrom(at('/context', '', '/help'))).toBe('/help')
  })

  it("follow the mockup's own renames", () => {
    expect(redirectFrom(at('/library'))).toBe('/context')
    expect(redirectFrom(at('/library/fact/itm_1'))).toBe('/context/itm_1')
    expect(redirectFrom(at('/library/metrics'))).toBe('/definitions')
    expect(redirectFrom(at('/settings/definitions'))).toBe('/settings/integrations/cube')
    expect(redirectFrom(at('/settings/about', '?setup=1'))).toBe('/settings/general?setup=1')
    expect(redirectFrom(at('/context', '?dock=fact.itm_1'))).toBe('/context?dock=context.itm_1')
    expect(redirectFrom(at('/', '', '/library?dock=fact.itm_1'))).toBe(
      '/context?dock=context.itm_1',
    )
  })

  it("take Observability's Summary and its digests to Overview, keeping the domain", () => {
    expect(redirectFrom(at('/observability/summary'))).toBe('/observability')
    expect(
      redirectFrom(at('/observability/summary', '?period=quarter&domain=area_marketing')),
    ).toBe('/observability?domain=area_marketing')
    expect(redirectFrom(at('/observability/summary/e37374a8-c76b-4356-8102-453f81531986'))).toBe(
      '/observability',
    )
    expect(redirectFrom(at('/', '', '/observability/summary?theme=dark'))).toBe(
      '/observability?theme=dark',
    )
  })

  it("take Overview's old address to Observability's own, keeping the view", () => {
    expect(redirectFrom(at('/observability/overview'))).toBe('/observability')
    expect(redirectFrom(at('/observability/overview/'))).toBe('/observability')
    expect(redirectFrom(at('/observability/overview', '?range=30&domain=area_sales'))).toBe(
      '/observability?range=30&domain=area_sales',
    )
    expect(redirectFrom(at('/', '', '/observability/overview?theme=dark'))).toBe(
      '/observability?theme=dark',
    )
    expect(redirectFrom(at('/observability', '?range=30'))).toBeNull()
  })

  it("leave Questions' old address where it is: it opens Overview at the topics", () => {
    expect(redirectFrom(at('/observability/questions'))).toBeNull()
    expect(redirectFrom(at('/observability/questions', '?answer=missing&group=none'))).toBeNull()
    expect(redirectFrom(at('/observability/questions', '?dock=topic.t1'))).toBeNull()
  })

  it('take the old Conflicts list to the Context list filtered to conflicts, keeping the rest', () => {
    expect(redirectFrom(at('/context/conflicts'))).toBe('/context?show=conflicts')
    expect(redirectFrom(at('/context/conflicts/'))).toBe('/context?show=conflicts')
    // Mine and All went with the list; a peek and the theme stay.
    expect(redirectFrom(at('/context/conflicts', '?whose=all'))).toBe('/context?show=conflicts')
    expect(redirectFrom(at('/context/conflicts', '?whose=all&dock=conflict.a.b&theme=dark'))).toBe(
      '/context?dock=conflict.a.b&theme=dark&show=conflicts',
    )
    expect(redirectFrom(at('/', '', '/context/conflicts?whose=all'))).toBe(
      '/context?show=conflicts',
    )
  })

  it("leave a conflict's own page where it is", () => {
    expect(redirectFrom(at('/context/conflicts/a.b'))).toBeNull()
    expect(redirectFrom(at('/context/conflicts/a.b', '?settle=not_conflict'))).toBeNull()
    expect(redirectFrom(at('/context', '?show=conflicts'))).toBeNull()
  })

  it('leave a current address and a link to a place on the page alone', () => {
    expect(redirectFrom(at('/inbox', '?tab=all'))).toBeNull()
    expect(redirectFrom(at('/docs/privacy', '', 'on-this-page'))).toBeNull()
  })
})

describe('addresses the app writes', () => {
  it('keep only the values that were given, as plain text', () => {
    expect(href('/ask', { example: 'missing', q: undefined })).toBe('/ask?example=missing')
    expect(href('/inbox')).toBe('/inbox')
  })
})

describe('search params', () => {
  it('drop a value a place does not know, and keep the rest', () => {
    expect(inboxSearch({ tab: 'all', card: 'x', decide: 'maybe' })).toEqual({
      tab: 'all',
      card: 'x',
      decide: undefined,
    })
    expect(settingsSearch({ step: '3' })).toEqual({ step: '3' })
    expect(settingsSearch({ step: 'three' })).toEqual({ step: undefined })
    expect(rootSearch({ theme: 'dark', demo: 'week', open: 'nothing' })).toEqual({
      theme: 'dark',
      demo: 'week',
      open: undefined,
    })
  })

  it("know the dock's kinds", () => {
    expect(shellSearch({ dock: 'context.itm_1' }).dock).toBe('context.itm_1')
    expect(shellSearch({ dock: 'ask' }).dock).toBe('ask')
    expect(shellSearch({ dock: 'sidebar.x' }).dock).toBeUndefined()
  })

  it('know the Context list filtered to conflicts, and drop any other view', () => {
    expect(contextSearch({ show: 'conflicts', domain: 'sales' })).toEqual({
      show: 'conflicts',
      domain: 'sales',
    })
    expect(contextSearch({ show: 'mine' })).toEqual({ show: undefined })
  })

  it("never touch another place's params", () => {
    expect(inboxSearch({ q: 'refunds' })).toEqual({})
  })
})
