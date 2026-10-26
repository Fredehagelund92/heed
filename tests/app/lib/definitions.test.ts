import { describe, expect, it } from 'vitest'
import { createDefinitions } from '@/api/mock/definitions'
import { glossary, parseTags } from '@/lib/definitions'

// Synonyms are typed as tags: a comma, Enter or a paste makes them, each word once, the person's
// casing kept; a word that already means something else says who has it.

describe('synonym tags', () => {
  it('splits a paste on commas and new lines, trims, and keeps each word once in its own casing', () => {
    expect(parseTags('GMV, turnover, sales value')).toEqual(['GMV', 'turnover', 'sales value'])
    expect(parseTags('  Gross  takings ,\nGMV,gmv, ,')).toEqual(['Gross takings', 'GMV'])
    expect(parseTags('')).toEqual([])
  })

  it('adds a synonym once, and says who already has a word', () => {
    const definitions = createDefinitions()
    const g = () => glossary(definitions.list())
    const gross = g().find('Gross sales')!
    expect(g().checkSynonym(gross, 'gmv')).toMatchObject({ ok: false, why: 'here' })
    expect(g().checkSynonym(gross, 'turnover')).toMatchObject({
      ok: false,
      why: 'taken',
      holder: 'Net revenue',
      by: 'Sofia Brandt',
    })
    expect(g().checkSynonym(gross, 'Peak season')).toMatchObject({ ok: false, why: 'term' })
    expect(g().checkSynonym(gross, 'Orders')).toMatchObject({
      ok: false,
      why: 'source',
      holder: 'Orders',
    })
    expect(definitions.addSynonym(gross.name, '  Sales Value ', 'Jon Abara')).toEqual({
      ok: true,
      created: true,
    })
    expect(
      g()
        .synonymsOf('Gross sales')
        .map((s) => s.name),
    ).toContain('Sales Value')
    expect(g().checkSynonym(gross, 'sales value')).toMatchObject({ ok: false, why: 'here' })
    definitions.removeTerm('Sales Value')
    expect(
      g()
        .synonymsOf('Gross sales')
        .map((s) => s.name),
    ).not.toContain('Sales Value')
  })
})
