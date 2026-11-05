import { describe, expect, it } from 'vitest'
import { createDefinitions } from '@/api/mock/definitions'
import { glossary, parseTags } from '@/lib/definitions'

// Synonyms are typed as tags: a comma, Enter or a paste makes them, each word once, the person's
// casing kept; a word that already means something else says who has it.

describe('a word as it is typed', () => {
  const g = () => glossary(createDefinitions().list())

  it("is taken, with the service's sentence, whatever its case, spaces and accents", () => {
    const net = g().find('Net revenue')
    for (const word of ['Turnover', ' TURNOVER ', 'Túrnover'])
      expect(g().checkWord(word, g().find('Gross sales'))).toMatchObject({
        ok: false,
        why: 'taken',
        reason: '“Turnover” is already another name for Net revenue, added by Sofia Brandt.',
      })
    expect(g().checkWord('Turnover', net)).toMatchObject({ ok: false, why: 'here' })
    expect(g().checkWord('Orders')).toMatchObject({
      ok: false,
      why: 'source',
      reason: expect.stringMatching(/name for Orders\.$/) as string,
    })
    expect(g().checkWord('Bookings', net)).toEqual({ ok: true })
  })

  it('never counts the term being edited as holding its own word', () => {
    expect(g().checkWord('PEAK SEASON', undefined, 'Peak season')).toEqual({ ok: true })
    const peak = g().find('Peak season')!
    expect(g().conflictOf({ ...peak, name: 'PEAK SEASON' }, 'Peak season')).toBeUndefined()
  })

  it('warns of a look-alike, never one that only shares letters or adds a word', () => {
    expect(g().lookAlikeOf('Turnovers')).toEqual({ name: 'Turnover', means: 'Net revenue' })
    expect(g().lookAlikeOf('Peek season')).toEqual({ name: 'Peak season', means: 'Peak season' })
    expect(g().lookAlikeOf('Bookings')).toBeUndefined()
    expect(g().lookAlikeOf('Turnover tax')).toBeUndefined()
    // What the word would mean anyway is no warning.
    expect(g().lookAlikeOf('Turnovers', undefined, 'Net revenue')).toBeUndefined()
  })

  it('shows two terms that read as one word, each meaning something else, as a conflict', () => {
    const all = [
      ...createDefinitions().list(),
      {
        name: 'Púrchases',
        type: 'term' as const,
        definition: '',
        sameAs: 'Net revenue',
        synced: false,
        sourceNames: [],
        updated: '23 Oct 2026',
      },
    ]
    expect(glossary(all).conflictOf(all.at(-1)!)).toMatchObject({
      kind: 'two-things',
      other: 'Orders',
    })
  })
})

describe('two terms that read as one word', () => {
  const own = (name: string) => ({
    name,
    type: 'term' as const,
    definition: `What ${name} means.`,
    sameAs: undefined,
    synced: false,
    sourceNames: [],
    updated: '23 Oct 2026',
  })

  it('opens each by its own name, and the folded one only when no term has that name', () => {
    const all = [own('Sales'), own('Salés')]
    expect(glossary(all).find('Salés')?.name).toBe('Salés')
    expect(glossary(all).find('Sales')?.name).toBe('Sales')
    expect(glossary(all).find('SALES')?.name).toBe('Sales')
    expect(glossary([own('Salés')]).find('sales')?.name).toBe('Salés')
  })

  it('say agents do not use the word when neither means a synced item', () => {
    const all = [own('Sales'), own('Salés')]
    expect(glossary(all).conflictOf(all[1]!)).toMatchObject({ kind: 'two-things', asks: false })
  })

  it('say agents ask which one when one of them means a synced item', () => {
    const all = [
      ...createDefinitions().list(),
      { ...own('Púrchases'), definition: '', sameAs: 'Net revenue' },
    ]
    expect(glossary(all).conflictOf(all.at(-1)!)).toMatchObject({ kind: 'two-things', asks: true })
  })

  it('say agents do not use a word that points nowhere', () => {
    const all = [{ ...own('Sales'), definition: '', sameAs: 'Gone' }]
    expect(glossary(all).conflictOf(all[0]!)).toMatchObject({ kind: 'missing', asks: false })
  })
})

describe('a term sent to the mock, as to the service', () => {
  it('is refused when its word is taken, and saved when only its meaning changes', () => {
    const definitions = createDefinitions()
    const sales = definitions.list().find((d) => d.name === 'Purchases')!
    expect(() =>
      definitions.saveTerm(undefined, { ...sales, name: 'púrchases', sameAs: 'Net revenue' }),
    ).toThrow('“Purchases” is already another name for Orders, added by Sofia Brandt.')
    expect(() => definitions.saveTerm('Purchases', { ...sales, domain: 'marketing' })).not.toThrow()
  })

  it('says a taken word is a refusal, as the service does', () => {
    const definitions = createDefinitions()
    const sales = definitions.list().find((d) => d.name === 'Purchases')!
    try {
      definitions.saveTerm(undefined, { ...sales, name: 'púrchases', sameAs: 'Net revenue' })
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ kind: 'conflict', status: 409, refusal: true })
    }
  })
})

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
