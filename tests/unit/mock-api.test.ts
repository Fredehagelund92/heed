import { describe, expect, it } from 'vitest'
import { api } from '@/api'
import { MOCK_SCENARIO_KEY } from '@/api/mock-scenario'
import { describeContextApi } from '../conformance/context-api.ts'
import { describeContextApiAgents } from '../conformance/context-api-agents.ts'

// The same suite runs against the real service in tests/integration/api-conformance.test.ts.
describeContextApi('mock binding', () => api, { personId: (id) => id })
describeContextApiAgents('mock binding', () => api)

describe('mock api', () => {
  it('keeps favourites in order and recent items newest first, without duplicates', async () => {
    expect(await api.listFavorites()).toEqual([])
    await api.setFavorite('itm_a', true)
    await api.setFavorite('itm_b', true)
    expect(await api.setFavorite('itm_a', false)).toEqual(['itm_b'])
    await api.recordVisit('itm_a')
    await api.recordVisit('itm_b')
    expect(await api.recordVisit('itm_a')).toEqual(['itm_a', 'itm_b'])
  })

  it('plays the first-run, nearly empty and failed scenarios', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'empty')
    expect((await api.listLibrary()).items).toEqual([])
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'few')
    expect((await api.listLibrary()).items).toHaveLength(6)
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'error')
    await expect(api.listLibrary()).rejects.toThrow('did not answer')
  })

  it('plays the quiet scenario: no issue, and nothing changed in the last months', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'quiet')
    const { items } = await api.listLibrary()
    expect(items.length).toBeGreaterThan(0)
    expect(items.some((item) => item.kind === 'issue')).toBe(false)
    expect(items.every((item) => item.updatedAt < '2026-09-01')).toBe(true)
    window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  })

  it('plays the catalogue scenarios: no terms, the source down and a failed load', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'no-terms')
    expect((await api.listCatalogue()).terms).toEqual([])
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'source-down')
    const down = await api.listCatalogue()
    expect(down.terms.length).toBeGreaterThan(0)
    expect(down.sources.every((source) => source.failing)).toBe(true)
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'error')
    await expect(api.listCatalogue()).rejects.toThrow('did not answer')
    window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  })

  it('plays the scenarios on one term: the source down, a failed read and a definition gone', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'source-down')
    expect((await api.getCatalogueTerm('metric', 'orders'))?.source?.failing).toBe(true)
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'error')
    await expect(api.getCatalogueTerm('metric', 'orders')).rejects.toThrow('did not answer')
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'definition-gone')
    const hold = await api.getCatalogueTerm('metric', 'gross_margin')
    expect(hold?.status).toBe('gone')
    expect(hold?.definition?.state).toBe('missing')
    // The copy is the one the read before kept, and the items relying on it are flagged.
    expect(hold?.definition?.readAt).toBe('2026-10-06T05:00:00.000Z')
    // Every item that has not ended now needs a look (an ended one shows as ended).
    expect((hold?.shelf.needsALook ?? 0) + (hold?.shelf.ended ?? 0)).toBe(hold?.shelf.items)
    expect((await api.getCatalogueTerm('metric', 'orders'))?.status).not.toBe('gone')
    window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  })
})
