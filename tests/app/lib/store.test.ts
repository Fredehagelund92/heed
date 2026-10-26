import { describe, expect, it } from 'vitest'
import { reduce, start, type Sent } from '@/lib/store'

// The demo's state. A scenario in the address is a fresh start, so a link lands the same way
// whatever was clicked before; a decision can be undone exactly.

const sent: Sent = {
  id: 'sent_1',
  factId: 'itm_s90n5xps',
  title: 'Units sold',
  by: 'Ines Duarte',
  to: 'Jon Abara',
  domain: 'sales',
  at: 'just now',
}

describe("the demo's state", () => {
  it('starts a scenario afresh, whatever happened before', () => {
    let s = reduce(start, { type: 'send', sent })
    s = reduce(s, { type: 'complete', card: 'sug-ines', outcome: 'Published' })
    s = reduce(s, { type: 'demo', mode: 'setup' })
    expect(s.fresh).toBe(true)
    expect(s.sent).toEqual([])

    const week = reduce(s, { type: 'demo', mode: 'week' })
    expect(week).toEqual({ ...start, user: s.user })

    const done = reduce(week, { type: 'demo', mode: 'done' })
    expect(Object.keys(done.done).length).toBeGreaterThan(5)
    expect(done.fresh).toBe(false)
  })

  it('keeps a sent suggestion until it is withdrawn', () => {
    const s = reduce(start, { type: 'send', sent })
    expect(s.sent).toEqual([sent])
    expect(reduce(s, { type: 'withdraw', id: sent.id }).sent).toEqual([])
  })

  it('counts a suggestion as read only when it was reviewed, not when it was opened', () => {
    const opened = reduce(start, { type: 'opened', card: 'sug-ines' })
    expect(opened.reviewed['sug-ines']).toBeUndefined()
    const read = reduce(opened, { type: 'reviewed', card: 'sug-ines' })
    expect(read.reviewed['sug-ines']).toBe(true)
    expect(reduce(read, { type: 'reviewed', card: 'sug-ines' })).toBe(read)
  })

  it('undoes a bulk publish exactly', () => {
    const before = reduce(reduce(start, { type: 'reviewed', card: 'sug-ines' }), {
      type: 'reviewed',
      card: 'sug-ines-link',
    })
    let s = before
    for (const id of ['sug-ines', 'sug-ines-link'])
      s = reduce(s, { type: 'complete', card: id, outcome: 'Published' })
    expect(Object.keys(s.done)).toHaveLength(2)
    expect(reduce(s, { type: 'restore', state: before }).done).toEqual({})
  })

  it('reverts exactly the published ones, keeping whatever happened since', () => {
    const before = start
    let s = reduce(before, { type: 'complete', card: 'sug-ines', outcome: 'Published' })
    s = reduce(s, { type: 'editFact', id: 'itm_s90n5xps', patch: { checkedOn: '23 Oct 2026' } })
    s = reduce(s, { type: 'published', id: 'itm_s90n5xps' })
    // Since then: another decision, and a suggestion read.
    s = reduce(s, { type: 'complete', card: 'sug-ines-link', outcome: 'Published' })
    s = reduce(s, { type: 'reviewed', card: 'sug-ines-order' })
    const back = reduce(s, { type: 'revert', before, cards: ['sug-ines'], facts: ['itm_s90n5xps'] })
    expect(back.done['sug-ines']).toBeUndefined()
    expect(back.edits['itm_s90n5xps']).toBeUndefined()
    expect(back.published['itm_s90n5xps']).toBeUndefined()
    expect(back.done['sug-ines-link']).toBeDefined()
    expect(back.reviewed['sug-ines-order']).toBe(true)
  })

  it('undoes a decision exactly', () => {
    const before = reduce(start, { type: 'opened', card: 'sug-ines' })
    let s = reduce(before, { type: 'complete', card: 'sug-ines', outcome: 'Published' })
    s = reduce(s, { type: 'published', id: 'itm_s90n5xps' })
    expect(reduce(s, { type: 'restore', state: before })).toBe(before)
  })
})
