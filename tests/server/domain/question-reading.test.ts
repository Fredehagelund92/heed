import { describe, expect, it } from 'vitest'
import { questionReading } from '../../../src/domain/question-reading.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'
import { terms } from './fixtures.ts'

/*
  A question read for a person (the Ask composer's "Heed reads" line and Home's Try it): the
  reader get_context uses, with names, how the dates were read, undecided words and dates Heed
  cannot read.
*/

const today = '2026-10-14'
const withAlias: Term[] = terms.map((term) =>
  term.key === 'metric:revenue' || term.key === 'metric:orders'
    ? { ...term, aliases: [...term.aliases, 'money in'] }
    : term,
)

describe('a question read for a person', () => {
  it('names the terms with their kind and a value’s dimension, and the whole year for a bare year', () => {
    expect(questionReading('what were orders in Norway in 2026', terms, today)).toEqual({
      about: [
        { key: 'metric:orders', name: 'Orders', kind: 'metric', dimension: null },
        {
          key: 'val:market/norway',
          name: 'Norway',
          kind: 'dimension_value',
          dimension: 'Market',
        },
      ],
      from: '2026-01-01',
      to: '2026-12-31',
      dates: {
        words: '2026',
        reads_as: '1 Jan to 31 Dec 2026 (the whole year, including the days after today; UTC)',
        note: 'the whole year, including the days after today',
      },
      ambiguous: [],
      dates_problem: null,
      today,
      // Where each is in the words, so the composer can offer it as a chip in the sentence.
      spans: [
        { start: 10, end: 16, keys: ['metric:orders'], dates: false },
        { start: 20, end: 26, keys: ['val:market/norway'], dates: false },
        { start: 30, end: 34, keys: [], dates: true },
      ],
    })
  })

  it('reads a "this" period to today, and says so without the time zone', () => {
    const reading = questionReading('orders this year', terms, today)
    expect([reading.from, reading.to]).toEqual(['2026-01-01', '2026-10-14'])
    expect(reading.dates?.note).toBe('this year so far')
    // A day says nothing more than its days.
    expect(questionReading('orders on 2026-10-01', terms, today).dates?.note).toBeNull()
  })

  it('gives words that name more than one term with the terms they could be, choosing none', () => {
    const reading = questionReading('money in for Spain', withAlias, today)
    expect(reading.about.map((term) => term.key)).toEqual(['val:market/spain'])
    expect(reading.ambiguous).toEqual([
      {
        words: 'money in',
        options: [
          { key: 'metric:orders', name: 'Orders', kind: 'metric', dimension: null },
          { key: 'metric:revenue', name: 'Revenue', kind: 'metric', dimension: null },
        ],
      },
    ])
  })

  it('names words it cannot read as dates, and gives no period for them', () => {
    const reading = questionReading('orders since the launch', terms, today)
    expect(reading).toMatchObject({ from: null, to: null, dates: null })
    expect(reading.dates_problem?.words).toBe('since the launch')
    expect(reading.dates_problem?.message).toMatch(/^'since the launch' cannot be read as dates\./)
  })
})
