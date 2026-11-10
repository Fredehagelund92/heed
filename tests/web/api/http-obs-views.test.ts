import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { obsViewSaveInputSchema, type ObsView } from '@contract/observability'
import { savedViewOf } from '@/api/http-obs'
import { chipsFrom, chipsTo, type Chip, type DimKey, type Filters } from '@/lib/obs-views'

// Overview's saved views on the http binding: a view's chips go to the service as they are, by
// keys, and come back the same, through the address too. An old Value chip the service flagged
// (migration 0046) still reads as it was, for the bar to say why it was not moved.

const viewOf = (filters: ObsView['filters']): ObsView => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'A view',
  filters,
  by: 'Jon Abara',
  mine: true,
})

/** The chips saved as the binding sends them, checked by the service's own schema, then read back. */
function roundTrip(chips: Filters) {
  const sent = obsViewSaveInputSchema.parse({ name: 'A view', filters: { chips } })
  return savedViewOf(viewOf(sent.filters)).filters
}

/** The same chips into the address and out, as choosing the view puts them there. */
function throughAddress(chips: Filters) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(chipsTo(chips))) if (v) q.set(k, v)
  return chipsFrom(new URLSearchParams(q.toString()))
}

describe('a saved view by keys', () => {
  it('round-trips dimensions by keys, any value and is not, beside the fields, in order', () => {
    const chips: Filters = [
      { key: 'dim:store', not: true, values: ['val:store/alder_row', 'val:store/birch_quay'] },
      { key: 'answer', values: ['missing'] },
      { key: 'dim:channel', values: ['*'] },
      { key: 'topic', values: ['orders'] },
    ]
    expect(roundTrip(chips)).toEqual(chips)
    expect(throughAddress(roundTrip(chips))).toEqual(chips)
  })

  it('round-trips any dimension chips, up to 20, through the service and the address', () => {
    const id = fc.stringMatching(/^[a-z0-9_]{1,8}$/)
    const chip = (dim: string): fc.Arbitrary<Chip> =>
      fc
        .tuple(
          fc.oneof(
            fc.constant<string[]>(['*']),
            fc
              .uniqueArray(id, { minLength: 1, maxLength: 5 })
              .map((ids) => ids.map((v) => `val:${dim}/${v}`)),
          ),
          fc.boolean(),
        )
        .map(([values, not]) => ({
          key: `dim:${dim}` satisfies DimKey,
          ...(not ? { not } : {}),
          values,
        }))
    const chips = fc
      .uniqueArray(id, { minLength: 1, maxLength: 20 })
      .chain((dims) => fc.tuple(...dims.map(chip)))
    fc.assert(
      fc.property(chips, (c) => {
        expect(roundTrip(c)).toEqual(c)
        expect(throughAddress(roundTrip(c))).toEqual(c)
      }),
    )
  })

  it('refuses what a view cannot keep: a 21st chip, a value of another dimension', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ key: `dim:d${i}`, values: ['*'] }))
    expect(obsViewSaveInputSchema.safeParse({ name: 'x', filters: { chips: many } }).success).toBe(
      false,
    )
    const foreign = [{ key: 'dim:store', values: ['val:channel/webshop'] }]
    expect(
      obsViewSaveInputSchema.safeParse({ name: 'x', filters: { chips: foreign } }).success,
    ).toBe(false)
  })

  it('reads an old Value chip the move flagged as it was, and a view from before chips as chips', () => {
    expect(
      savedViewOf(viewOf({ chips: [{ key: 'market', values: ['Alder'], flag: 'shared' }] }))
        .filters,
    ).toEqual([{ key: 'market', values: ['Alder'] }])
    expect(savedViewOf(viewOf({ answer: ['missing'], domain: 'finance' })).filters).toEqual([
      { key: 'answer', values: ['missing'] },
      { key: 'domain', values: ['finance'] },
    ])
  })
})
