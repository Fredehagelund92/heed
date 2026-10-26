import { describe, expect, it } from 'vitest'
import {
  addSynonym,
  checkSynonym,
  findDefinition,
  parseTags,
  removeTerm,
  synonymsOf,
} from '@/lib/definitions'

// Synonyms are typed as tags: a comma, Enter or a paste makes them, each word once, the person's
// casing kept; a word that already means something else says who has it.

describe('synonym tags', () => {
  it('splits a paste on commas and new lines, trims, and keeps each word once in its own casing', () => {
    expect(parseTags('GMV, turnover, sales value')).toEqual(['GMV', 'turnover', 'sales value'])
    expect(parseTags('  Gross  takings ,\nGMV,gmv, ,')).toEqual(['Gross takings', 'GMV'])
    expect(parseTags('')).toEqual([])
  })

  it('adds a synonym once, and says who already has a word', () => {
    const gross = findDefinition('Gross sales')!
    expect(checkSynonym(gross, 'gmv')).toMatchObject({ ok: false, why: 'here' })
    expect(checkSynonym(gross, 'turnover')).toMatchObject({
      ok: false,
      why: 'taken',
      holder: 'Net revenue',
      by: 'Sofia Brandt',
    })
    expect(checkSynonym(gross, 'Peak season')).toMatchObject({ ok: false, why: 'term' })
    expect(checkSynonym(gross, 'Orders')).toMatchObject({
      ok: false,
      why: 'source',
      holder: 'Orders',
    })
    expect(addSynonym(gross, '  Sales Value ', 'Jon Abara')).toEqual({ ok: true, created: true })
    expect(synonymsOf('Gross sales').map((s) => s.name)).toContain('Sales Value')
    expect(checkSynonym(gross, 'sales value')).toMatchObject({ ok: false, why: 'here' })
    removeTerm('Sales Value')
    expect(synonymsOf('Gross sales').map((s) => s.name)).not.toContain('Sales Value')
  })
})
