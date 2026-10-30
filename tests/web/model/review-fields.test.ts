import { describe, expect, it } from 'vitest'
import { fieldKeys, fieldRows } from '@/model/review-fields'
import type { FieldSide } from '@/model/review'
import { reviewFor } from '@/api/mock/data/review'

const side: FieldSide = {
  title: 'Units sold excludes test accounts',
  kind: 'Rule',
  domain: 'Sales',
  owner: 'Jon Abara',
  scope: ['Units sold', 'Norway'],
  validity: { from: '2026-05-29', ongoing: true },
  reviewDate: '2026-12-01',
  sources: [{ url: 'https://wiki.example/units-sold', quote: 'Test accounts are left out.' }],
  dontConclude: 'Fewer units are not fewer customers.',
}
const row = (rows: ReturnType<typeof fieldRows>, key: string) => rows.find((r) => r.key === key)!

describe('the Fields table of a review', () => {
  it('has every field but the text, in the editor’s order and words', () => {
    const rows = fieldRows(side, side)
    expect(rows.map((r) => r.key)).toEqual([...fieldKeys])
    expect(rows.map((r) => r.label)).toEqual([
      'Title',
      'Kind',
      'Domain',
      'Owner',
      'Applies to',
      'When',
      'Check date',
      'Source',
      "Don't conclude",
    ])
    expect(rows.some((r) => r.changed)).toBe(false)
  })

  it('shows a new owner and a new domain as changes, each with its value on both sides', () => {
    const rows = fieldRows(side, { ...side, owner: 'Sofia Brandt', domain: 'Finance' })
    expect(rows.filter((r) => r.changed).map((r) => r.key)).toEqual(['domain', 'owner'])
    expect(row(rows, 'owner')).toMatchObject({ before: 'Jon Abara', after: 'Sofia Brandt' })
  })

  it('compares dates as dates, in the words people read', () => {
    const rows = fieldRows(side, {
      ...side,
      validity: { from: '2026-05-29', until: '2026-10-31' },
      reviewDate: undefined,
    })
    expect(row(rows, 'validity')).toMatchObject({ changed: true, after: '29 May to 31 Oct 2026' })
    expect(row(rows, 'reviewDate')).toMatchObject({
      changed: true,
      before: '1 Dec 2026',
      after: 'Not set',
    })
  })

  it('compares what it applies to by name: added and removed, never by order', () => {
    const moved = fieldRows(side, { ...side, scope: ['Norway', 'Units sold'] })
    expect(row(moved, 'scope').changed).toBe(false)
    const rows = fieldRows(side, { ...side, scope: ['Units sold', 'Sweden'] })
    expect(row(rows, 'scope')).toMatchObject({
      changed: true,
      added: ['Sweden'],
      removed: ['Norway'],
    })
  })

  it('sees a source change by its address or its quote', () => {
    const url = fieldRows(side, {
      ...side,
      sources: [{ url: 'https://wiki.example/units-sold-october', quote: side.sources[0]!.quote }],
    })
    expect(row(url, 'sources').changed).toBe(true)
    const quote = fieldRows(side, { ...side, sources: [{ url: side.sources[0]!.url }] })
    expect(row(quote, 'sources').changed).toBe(true)
  })

  it('reads a new item as only what it sets, and an archive as only what it had', () => {
    const fresh = fieldRows(null, side)
    expect(fresh.every((r) => !r.changed && !('before' in r) && 'after' in r)).toBe(true)
    const gone = fieldRows(side, null)
    expect(gone.every((r) => !r.changed && 'before' in r && !('after' in r))).toBe(true)
  })

  it('gives each demo suggestion the field changes its own blocks say', () => {
    const changedIn = (id: string) => {
      const r = reviewFor(id)!
      return fieldRows(r.fields.before, r.fields.after)
        .filter((x) => x.changed)
        .map((x) => x.key)
    }
    expect(changedIn('sug-ines')).toEqual(['sources'])
    expect(changedIn('sug-ines-link')).toEqual(['sources'])
    expect(changedIn('sug-ines-dates')).toEqual(['validity'])
    expect(changedIn('sug-ines-format')).toEqual([])
    expect(reviewFor('gap-spain')!.fields.before).toBeNull()
    expect(reviewFor('sug-lars-retire')!.fields.after).toBeNull()
  })
})
