import { describe, expect, it } from 'vitest'
import { shelfOf } from '../../../src/domain/catalogue.ts'
import type { ContextItem } from '../../../src/domain/item.ts'

// The count beside a definition is the one due rule (itemTrust): what Ask and Context call due.

const today = '2026-10-23'
const item = (over: Partial<ContextItem>) =>
  ({
    kind: 'note',
    status: 'accepted',
    validity: { start: '2026-01-01', end: null },
    reviewDate: null,
    checkFlag: null,
    scope: { metrics: ['orders'], dimensionValues: [] },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as ContextItem

describe('what a definition has to check', () => {
  it('counts an ended item whose check date has passed, as Ask and Context do', () => {
    const ended = item({
      validity: { start: '2026-01-01', end: '2026-06-01' },
      reviewDate: '2026-09-18',
    })
    const shelf = shelfOf([ended], () => true, today)
    expect(shelf.needsALook).toBe(1)
    expect(shelf.ended).toBe(1)
  })

  it('does not count an item that ended with no check date passed', () => {
    const ended = item({ validity: { start: '2026-01-01', end: '2026-06-01' } })
    expect(shelfOf([ended], () => true, today).needsALook).toBe(0)
  })
})
