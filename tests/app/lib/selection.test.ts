import { describe, expect, it } from 'vitest'
import { all, between, countLine, extend, NONE, step, toggle } from './selection'

const order = ['a', 'b', 'c', 'd', 'e', 'f']

describe('between', () => {
  it('takes both ends and what lies between, whichever comes first', () => {
    expect(between(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(between(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(between(order, 'c', 'c')).toEqual(['c'])
  })
  it('is empty when an end is not in the list', () => {
    expect(between(order, 'x', 'b')).toEqual([])
  })
})

describe('a click and a Shift-click', () => {
  it('ticks the whole range between the anchor and the row', () => {
    const s = extend(toggle(NONE, 'a'), order, 'd')
    expect(s.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(s.anchor).toBe('a')
  })
  it('works upwards too', () => {
    expect(extend(toggle(NONE, 'e'), order, 'c').ids.sort()).toEqual(['c', 'd', 'e'])
  })
  it('re-draws the range from the same anchor on a second Shift-click', () => {
    const s = extend(extend(toggle(NONE, 'b'), order, 'f'), order, 'c')
    expect(s.ids.sort()).toEqual(['b', 'c'])
  })
  it('keeps what was ticked before the anchor', () => {
    const s = extend(toggle(toggle(NONE, 'f'), 'a'), order, 'b')
    expect(s.ids.sort()).toEqual(['a', 'b', 'f'])
  })
  it('unticks the range when the anchor was unticked', () => {
    const ticked = all(order)
    const s = extend(toggle(ticked, 'b'), order, 'd')
    expect(s.ids).toEqual(['a', 'e', 'f'])
  })
  it('follows the order the list shows now, not the order rows were ticked in', () => {
    const sorted = ['f', 'e', 'd', 'c', 'b', 'a']
    expect(extend(toggle(NONE, 'e'), sorted, 'c').ids.sort()).toEqual(['c', 'd', 'e'])
  })
  it('keeps its anchor through a filter, and ranges from it when the row is back', () => {
    const s = toggle(NONE, 'b')
    const filtered = ['a', 'c', 'e']
    // With the anchor hidden, a Shift-click ticks the one row and makes it the anchor.
    expect(extend(s, filtered, 'e').ids).toEqual(['b', 'e'])
    expect(extend(s, order, 'e').ids).toEqual(['b', 'c', 'd', 'e'])
  })
  it('ticks one row when there is no anchor yet', () => {
    expect(extend(NONE, order, 'c')).toMatchObject({ ids: ['c'], anchor: 'c' })
  })
})

describe('Shift and an arrow', () => {
  it("ticks the cursor's row and the next, then carries on", () => {
    let s = step(NONE, order, 'b', 'c')
    expect(s.ids).toEqual(['b', 'c'])
    s = step(s, order, 'c', 'd')
    expect(s.ids).toEqual(['b', 'c', 'd'])
  })
  it('shrinks the range when it turns back', () => {
    let s = step(step(NONE, order, 'b', 'c'), order, 'c', 'd')
    s = step(s, order, 'd', 'c')
    expect(s.ids.sort()).toEqual(['b', 'c'])
  })
  it('starts a new range where the cursor went, keeping what was ticked', () => {
    const s = step(toggle(NONE, 'a'), order, 'd', 'e')
    expect(s.ids.sort()).toEqual(['a', 'd', 'e'])
  })
  it('carries on from a click on a checkbox', () => {
    expect(step(toggle(NONE, 'c'), order, 'c', 'b').ids.sort()).toEqual(['b', 'c'])
  })
})

describe('select all and the count', () => {
  it('ticks every row shown', () => {
    expect(all(['c', 'd']).ids).toEqual(['c', 'd'])
  })
  it('says the count, and that it cleared', () => {
    expect(countLine(3)).toBe('3 selected')
    expect(countLine(0)).toBe('Selection cleared')
  })
})
