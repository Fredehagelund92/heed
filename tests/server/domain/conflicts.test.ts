import { describe, expect, it } from 'vitest'
import {
  conflictPairs,
  maySettle,
  pairKey,
  pairOf,
  settleRights,
  stillKept,
  type Settler,
  type SettledItem,
} from '../../../src/domain/conflicts.ts'

const item = (id: string, conflicts: string[] = []) => ({ id, conflicts })

describe('conflict pairs', () => {
  it('are the links between live items, once each, holder first', () => {
    const pairs = conflictPairs([
      item('itm_store_credit', ['itm_card_only']),
      item('itm_card_only', ['itm_store_credit']),
      item('itm_spain_in', ['itm_spain_out']),
      item('itm_spain_out'),
      // A link to an item that is not live is no conflict: agents never get both.
      item('itm_france', ['itm_archived']),
    ])
    expect(pairs).toEqual([
      // Both name each other: the smaller id holds it, so the pair always reads the same way.
      { holderId: 'itm_card_only', otherId: 'itm_store_credit' },
      { holderId: 'itm_spain_in', otherId: 'itm_spain_out' },
    ])
  })

  it('find the pair two items form, or none', () => {
    expect(pairOf(item('itm_b', ['itm_a']), item('itm_a'))).toEqual({
      holderId: 'itm_b',
      otherId: 'itm_a',
    })
    expect(pairOf(item('itm_a'), item('itm_b'))).toBeNull()
    expect(pairOf(item('itm_a', ['itm_a']), item('itm_a', ['itm_a']))).toBeNull()
    expect(pairKey('itm_b', 'itm_a')).toBe(pairKey('itm_a', 'itm_b'))
  })
})

describe('who may settle a conflict', () => {
  const sales: SettledItem = { id: 'itm_sales', areaId: 'sales', owners: [] }
  const paid: SettledItem = { id: 'itm_paid', areaId: 'paid_media', owners: [] }
  const person = (id: string, owns: string[], admin = false): Settler => ({ id, owns, admin })

  it('checks each way against the item it changes', () => {
    // [who, keep sales (archives paid), keep paid (archives sales), edit sales, edit paid, keep both, not a conflict]
    const table: [Settler, boolean, boolean, boolean, boolean, boolean, boolean][] = [
      [person('admin', [], true), true, true, true, true, true, true],
      [person('sales owner', ['sales']), false, true, true, false, true, true],
      [person('paid owner', ['paid_media']), true, false, false, true, true, false],
      [person('suggester', []), false, false, false, false, false, false],
    ]
    for (const [who, keepHolder, keepOther, editHolder, editOther, keepBoth, notConflict] of table)
      expect(settleRights(who, sales, paid), who.id).toEqual({
        keepHolder,
        keepOther,
        editHolder,
        editOther,
        keepBoth,
        notConflict,
      })
  })

  it("counts an item's own owners, and needs both holders to remove a flag both hold", () => {
    const named = person('per_ines', [])
    const own: SettledItem = { ...paid, owners: ['per_ines'] }
    expect(settleRights(named, sales, own).keepHolder).toBe(true)
    expect(settleRights(person('sales owner', ['sales']), sales, paid, true).notConflict).toBe(
      false,
    )
    expect(
      settleRights(person('both', ['sales', 'paid_media']), sales, paid, true).notConflict,
    ).toBe(true)
  })

  it('asks for the right that matches the outcome', () => {
    const rights = settleRights(person('sales owner', ['sales']), sales, paid)
    expect(maySettle(rights, 'kept_one', 'holder')).toBe(false)
    expect(maySettle(rights, 'kept_one', 'other')).toBe(true)
    expect(maySettle(rights, 'kept_one', null)).toBe(false)
    expect(maySettle(rights, 'kept_both', null)).toBe(true)
    expect(maySettle(rights, 'not_conflict', null)).toBe(true)
  })
})

describe('a pair kept as both', () => {
  it('stays off the lists only while both items are as the decision saw them', () => {
    const decided = { holderVersion: 3, otherVersion: 5 }
    expect(stillKept(decided, { holderVersion: 3, otherVersion: 5 })).toBe(true)
    expect(stillKept(decided, { holderVersion: 4, otherVersion: 5 })).toBe(false)
    expect(stillKept(decided, { holderVersion: 3, otherVersion: 6 })).toBe(false)
  })
})
