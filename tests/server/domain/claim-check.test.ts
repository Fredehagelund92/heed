import { describe, expect, it } from 'vitest'
import {
  claimCheck,
  claimsToCheck,
  CLAIMS_SHOWN,
  daysOf,
  stem,
} from '../../../src/domain/claim-check.ts'

/*
  The claim check (docs/product.md, section 4): each claim of a suggestion against the sentence
  its writer copied, never saying more than was compared. The cases are the mockup's
  (apps/mockup/src/data/review.ts: sug-agent and gap-spain).
*/

describe('the claim check against the copied sentence', () => {
  it("reads an agent's suggestion: the same date, a number in other units, words to check", () => {
    const rows = claimCheck(
      'Poland orders arrive up to two days late from the payment provider since 14 October 2026.',
      'Settlement files for Polish card payments are delivered within 48 hours from 14 October 2026.',
    )
    expect(rows).toEqual([
      // "Poland" is not "Polish": the check says to look, never that they mean the same.
      {
        claim: 'Poland orders arrive late from the payment provider',
        source: 'payments',
        verdict: 'check',
      },
      // Two days and 48 hours count different things, so nothing says they are the same.
      { claim: 'up to two days', source: null, verdict: 'check' },
      { claim: 'since 14 October 2026', source: 'from 14 October 2026', verdict: 'same' },
    ])
    expect(claimsToCheck(rows)).toBe(2)
  })

  it('reads a draft for a Not found card: the dates agree, the rest is to check', () => {
    const rows = claimCheck(
      'Card payments in Spain failed from 14 to 16 October 2026, so orders there fell.',
      'Card authorisations failed intermittently for Spanish cards between 14 and 16 October 2026.',
    )
    expect(rows).toEqual([
      {
        claim: 'Card payments in Spain failed',
        source: 'Card authorisations failed',
        verdict: 'check',
      },
      {
        claim: 'from 14 to 16 October 2026',
        source: 'between 14 and 16 October 2026',
        verdict: 'same',
      },
      { claim: 'orders there fell', source: null, verdict: 'check' },
    ])
  })

  it('says a different value only when it compared the same thing', () => {
    expect(
      claimCheck(
        'Units sold leaves out 340 test accounts from 1 October 2026.',
        'We leave out 312 test accounts from 2 October 2026.',
      ),
    ).toEqual([
      {
        claim: 'Units sold leaves out accounts',
        source: 'leave out 312 test accounts',
        verdict: 'check',
      },
      { claim: '340 test', source: '312 test', verdict: 'different' },
      { claim: 'from 1 October 2026', source: 'from 2 October 2026', verdict: 'different' },
    ])
  })

  it('reads every word of a clause in the sentence as the same, endings aside', () => {
    expect(
      claimCheck('The webshop stopped taking orders.', 'Orders: the webshop stops taking them.'),
    ).toEqual([
      {
        claim: 'The webshop stopped taking orders',
        source: 'Orders: the webshop stops taking',
        verdict: 'same',
      },
    ])
    expect(claimCheck('The webshop stopped taking orders.', 'The webshop takes orders.')).toEqual([
      {
        claim: 'The webshop stopped taking orders',
        source: 'webshop takes orders',
        verdict: 'check',
      },
    ])
    expect(
      claimCheck('The webshop stopped taking orders.', 'The webshop stopped taking new orders.'),
    ).toEqual([
      {
        claim: 'The webshop stopped taking orders',
        source: 'webshop stopped taking new orders',
        verdict: 'same',
      },
    ])
  })

  it('checks nothing without a copied sentence, and returns every claim of a long text', () => {
    expect(claimCheck('Orders fell in Spain.', '')).toEqual([])
    const long = Array.from({ length: 30 }, (_, i) => `Orders fell in market ${i + 1}.`).join(' ')
    const rows = claimCheck(long, 'Orders fell.')
    expect(rows).toHaveLength(30)
    expect(rows.slice(0, CLAIMS_SHOWN)).toHaveLength(CLAIMS_SHOWN)
  })

  it('counts a claim to check past the listed ones', () => {
    const text = `${Array.from({ length: CLAIMS_SHOWN }, () => 'Refunds are available.').join(' ')} Refunds are not available.`
    const rows = claimCheck(text, 'Refunds are available.')
    expect(rows.slice(0, CLAIMS_SHOWN).every((r) => r.verdict === 'same')).toBe(true)
    expect(claimsToCheck(rows)).toBe(1)
  })

  it('reads a flipped claim as one to check, in either direction', () => {
    expect(claimCheck('Refunds are not available.', 'Refunds are available.')[0]?.verdict).toBe(
      'check',
    )
    expect(claimCheck('Refunds are available.', 'Refunds are not available.')[0]?.verdict).toBe(
      'check',
    )
    expect(claimCheck('Refunds are never available.', 'Refunds are available.')[0]?.verdict).toBe(
      'check',
    )
    expect(claimCheck('Refunds are not available.', 'Refunds are not available.')[0]?.verdict).toBe(
      'same',
    )
  })

  it('gives the same rows every time', () => {
    const text = 'Card payments failed from 14 to 16 October 2026, and 3 stores closed.'
    const sentence = 'Card payments failed between 14 and 16 October 2026; 3 stores closed.'
    expect(claimCheck(text, sentence)).toEqual(claimCheck(text, sentence))
  })
})

describe('the parts it compares', () => {
  it('reads the days a date names, in any of the usual ways', () => {
    expect(daysOf('between 14 and 16 October 2026')).toEqual(['2026-10-14', '2026-10-16'])
    expect(daysOf('from 14 to 16 Oct 2026')).toEqual(['2026-10-14', '2026-10-16'])
    expect(daysOf('October 14, 2026')).toEqual(['2026-10-14'])
    expect(daysOf('2026-10-14')).toEqual(['2026-10-14'])
    expect(daysOf('October 2026')).toEqual(['2026-10-01'])
    // No year in the phrase: the sentence's year, else none.
    expect(daysOf('14 October', 2026)).toEqual(['2026-10-14'])
    expect(daysOf('14 October')).toEqual([])
  })

  it('stems a word the same way every time, and keeps different words apart', () => {
    expect(['failed', 'fails', 'failing'].map(stem)).toEqual(['fail', 'fail', 'fail'])
    expect(new Set(['stopped', 'stops', 'stop'].map(stem)).size).toBe(1)
    expect(new Set(['taking', 'takes', 'take'].map(stem)).size).toBe(1)
    expect(['payments', 'payment'].map(stem)).toEqual(['payment', 'payment'])
    expect(stem('stores')).toBe(stem('store'))
    expect(stem('Poland')).not.toBe(stem('Polish'))
  })
})
