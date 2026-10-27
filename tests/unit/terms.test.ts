import { describe, expect, it } from 'vitest'
import {
  parseTermRef,
  termName,
  termNamePattern,
  termRefOf,
  termRefPattern,
  termsSummary,
  termWord,
  wordRefusal,
  type WordHolder,
} from '../../src/domain/terms.ts'

// FR-138: one word, one meaning. What a refused word says, in the order the synonym box says it.

const grossSales = { ref: 'metric:gross_sales', name: 'Gross sales' }
const cube = (name: string, ref: string): WordHolder => ({
  origin: 'source',
  ref,
  name,
  tool: 'Cube',
})
const synonym = (
  name: string,
  of: { ref: string; name: string },
  by = 'Sofia Brandt',
): WordHolder => ({
  origin: 'term',
  id: '00000000-0000-4000-8000-000000000001',
  name,
  sameAs: of,
  by,
})

describe('a word', () => {
  it('is compared trimmed, its spaces folded and case aside, and kept as written', () => {
    expect(termWord('  Peak   Season ')).toBe('peak season')
    expect(termName('  Peak   Season ')).toBe('Peak Season')
    expect(termNamePattern.test('GMV, turnover')).toBe(false)
    expect(termNamePattern.test('Peak season')).toBe(true)
  })

  it('names what a synonym means by a key or a term id', () => {
    expect(termRefPattern.test('metric:gross_sales')).toBe(true)
    expect(termRefPattern.test('dim:market')).toBe(true)
    expect(termRefPattern.test('val:market/norway')).toBe(false)
    expect(parseTermRef('term:00000000-0000-4000-8000-000000000001')).toEqual({
      term: '00000000-0000-4000-8000-000000000001',
    })
    expect(parseTermRef('dim:market')).toEqual({ key: 'dim:market' })
    expect(termRefOf({ sameAsKey: null, sameAsTerm: 'x' })).toBe('term:x')
    expect(termRefOf({ sameAsKey: null, sameAsTerm: null })).toBeNull()
  })
})

describe('wordRefusal', () => {
  it('lets a word nothing has through', () => {
    expect(wordRefusal('Basket size', [], grossSales)).toBeNull()
  })

  it('says a word the definition already has is said already', () => {
    expect(wordRefusal('sales', [cube('Gross sales', grossSales.ref)], grossSales)).toEqual({
      code: 'here',
      message: 'Gross sales is already called “sales”.',
      holder: 'Gross sales',
      by: 'Cube',
    })
    expect(wordRefusal('GMV', [synonym('GMV', grossSales, 'Jon Abara')], grossSales)).toMatchObject(
      {
        code: 'here',
        by: 'Jon Abara',
      },
    )
  })

  it("names the tool whose name it is, before any term's", () => {
    const holders = [
      synonym('Sales', { ref: 'metric:net', name: 'Net revenue' }),
      cube('Gross sales', grossSales.ref),
    ]
    expect(wordRefusal('Sales', holders, { ref: 'metric:orders', name: 'Orders' })).toEqual({
      code: 'source',
      message: "“Sales” is Cube's name for Gross sales.",
      holder: 'Gross sales',
      by: 'Cube',
    })
    expect(
      wordRefusal(
        'Order count',
        [{ origin: 'vocabulary', ref: 'metric:orders', name: 'Orders' }],
        null,
      ),
    ).toMatchObject({
      code: 'source',
      message: '“Order count” is already a name for Orders.',
      by: null,
    })
  })

  it('names who added a synonym, and who wrote a term with its own meaning', () => {
    expect(
      wordRefusal(
        'turnover',
        [synonym('Turnover', { ref: 'metric:net', name: 'Net revenue' })],
        grossSales,
      ),
    ).toEqual({
      code: 'taken',
      message: '“Turnover” is already another name for Net revenue, added by Sofia Brandt.',
      holder: 'Net revenue',
      by: 'Sofia Brandt',
    })
    const own: WordHolder = {
      origin: 'term',
      id: 'x',
      name: 'Webshop',
      sameAs: null,
      by: 'Jon Abara',
    }
    expect(wordRefusal('webshop', [own], null)).toEqual({
      code: 'term',
      message: '“Webshop” is a term with its own meaning, written by Jon Abara.',
      holder: 'Webshop',
      by: 'Jon Abara',
    })
  })
})

describe('termsSummary', () => {
  it('names the first and counts the rest', () => {
    expect(termsSummary('Deleted', ['Peak season'])).toBe('Deleted “Peak season”.')
    expect(termsSummary('Deleted', ['Peak season', 'GMV', 'Webshop'])).toBe(
      'Deleted “Peak season” and 2 more.',
    )
  })
})
