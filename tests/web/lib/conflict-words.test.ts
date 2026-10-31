import { describe, expect, it } from 'vitest'
import { comparePair, sharedRuns, sharedWords } from '@/lib/differing-words'

// The words of a conflict, side by side (the conflict view): shared stretches greyed when the two are
// written apart, Differs marks on near copies, and plain text when neither helps. No model, no
// search for meaningful words.

const A =
  'Orders in Norway include orders paid with store credit and gift cards, in euros at the daily rate.'
const B =
  'Orders in Norway count only card and cash payments. Store credit and gift cards are left out.'
const text = (runs: { text: string }[]) => runs.map((r) => r.text).join('')

describe('the words of a conflict', () => {
  it('greys the stretches both statements share, and keeps the text whole', () => {
    const a = sharedRuns(A, B)!
    expect(text(a)).toBe(A)
    expect(a.filter((r) => r.shared).map((r) => r.text)).toEqual([
      'Orders in Norway',
      'store credit and gift cards',
    ])
    expect(
      sharedRuns(B, A)!
        .filter((r) => r.shared)
        .map((r) => r.text),
    ).toEqual(['Orders in Norway', 'Store credit and gift cards'])
  })

  it('never greys one shared word alone, and leaves identical texts unmarked', () => {
    expect(sharedRuns('Count orders and returns.', 'Leave out cash and cards.')).toBeNull()
    expect(sharedRuns(A, A)).toBeNull()
  })

  it('reads both sides the same way, or says plainly that nothing is marked', () => {
    const [a, b] = comparePair(A, B)
    expect([a.how, b.how]).toEqual(['shared', 'shared'])
    expect(a.inBoth).toEqual(['Orders in Norway', 'store credit and gift cards'])
    const [x, y] = comparePair(
      'Net revenue in Spain includes VAT.',
      'Net revenue in Spain excludes VAT.',
    )
    expect([x.how, y.how]).toEqual(['differs', 'differs'])
    expect(x.runs.find((r) => r.differs)?.text).toBe('includes')
    expect(text(x.runs)).toBe('Net revenue in Spain includes VAT.')
    const [p, q] = comparePair('Refunds wait for the bank.', 'Store returns count on booking.')
    expect([p.how, q.how]).toEqual(['plain', 'plain'])
  })

  it('counts the shared words, to order overlaps by', () => {
    expect(sharedWords(A, B)).toBe(8)
    expect(sharedWords('Refunds wait for the bank.', 'Store returns count on booking.')).toBe(0)
  })
})
