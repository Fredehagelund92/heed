import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock'
import { SEARCH_GROUP_MAX } from '@/api/mock/search'

describe('search everywhere in the demo world', () => {
  it('finds context by its text, a title that starts with the words first, never a draft', async () => {
    const { api } = createMockApi()
    const { items } = await api.getLibrary()
    const found = await api.searchAll({ q: 'norway' })
    expect(found.items.length).toBeGreaterThan(0)
    expect(found.items.length).toBeLessThanOrEqual(SEARCH_GROUP_MAX)
    const drafts = new Set(items.filter((f) => f.status === 'Draft').map((f) => f.id))
    expect(found.items.some((hit) => drafts.has(hit.id))).toBe(false)
    const starts = found.items.map((hit) => hit.title.toLowerCase().startsWith('norway'))
    expect(starts).toEqual([...starts].sort((a, b) => Number(b) - Number(a)))
  })

  it('finds a definition by another name, and domains and people by name', async () => {
    const { api } = createMockApi()
    const definitions = await api.getDefinitions()
    const named = definitions.find((d) => d.sourceNames.length > 0)!
    const byOther = await api.searchAll({ q: named.sourceNames[0]! })
    expect(byOther.definitions.map((d) => d.name)).toContain(named.name)
    expect((await api.searchAll({ q: 'sales' })).domains.map((d) => d.name)).toContain('Sales')
    expect((await api.searchAll({ q: 'abara' })).people).toEqual([{ name: 'Jon Abara' }])
  })

  it('leaves out someone who is only invited', async () => {
    const { api } = createMockApi()
    await api.invite({ emails: ['new.person@example.test'], admin: false, owns: [] })
    expect((await api.searchAll({ q: 'new.person' })).people).toEqual([])
  })
})
