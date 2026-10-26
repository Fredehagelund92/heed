import { describe, expect, it } from 'vitest'
import { href, redirectFrom } from '@/lib/router'
import { inboxSearch, rootSearch, settingsSearch, shellSearch } from '@/lib/search'

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

  it("never touch another place's params", () => {
    expect(inboxSearch({ q: 'refunds' })).toEqual({})
  })
})
