import { describe, expect, it } from 'vitest'
import type { Vocabulary } from '@/api/client'
import { holds, termLabel, termOfHit, termsOfNames, termWords, toggleTerm } from '@/lib/scope'
import type { ScopeTerm } from '@/model/items'

const orders: ScopeTerm = { key: 'metric:orders', kind: 'metric', name: 'Orders' }
const market: ScopeTerm = { key: 'dim:market', kind: 'dimension', name: 'Market' }
const norway: ScopeTerm = {
  key: 'val:market/norway',
  kind: 'value',
  name: 'Norway',
  dimension: 'Market',
}
const spain: ScopeTerm = {
  key: 'val:market/spain',
  kind: 'value',
  name: 'Spain',
  dimension: 'Market',
}
const email: ScopeTerm = {
  key: 'val:channel/email',
  kind: 'value',
  name: 'Email',
  dimension: 'Channel',
}

describe('"Applies to" terms', () => {
  it('reads a search hit as a term, a value with its dimension', () => {
    expect(
      termOfHit({
        key: 'val:market/norway',
        kind: 'dimension_value',
        name: 'Norway',
        dimension: { key: 'dim:market', name: 'Market' },
        alias: 'Norge',
        recent: false,
        uses: 3,
      }),
    ).toEqual(norway)
    expect(
      termOfHit({
        key: 'dim:market',
        kind: 'dimension',
        name: 'Market',
        dimension: null,
        alias: null,
        recent: true,
        uses: 0,
      }),
    ).toEqual(market)
  })

  it('names a dimension with any value as such, and a value with its dimension in full', () => {
    expect(termLabel(market)).toBe('Market: any value')
    expect(termLabel(email)).toBe('Email')
    expect(termWords(email)).toBe('Channel: Email')
    expect(termWords(orders)).toBe('Orders')
  })

  it('adds a term, and takes it out when it is there', () => {
    const added = toggleTerm([orders], norway)
    expect(added).toEqual({ terms: [orders, norway], removed: false, replaced: [] })
    expect(toggleTerm(added.terms, norway)).toEqual({
      terms: [orders],
      removed: true,
      replaced: [],
    })
  })

  it('never holds a dimension with any value and values of it together (FR-126)', () => {
    // "Any value" replaces the dimension's values, and only those.
    expect(toggleTerm([orders, norway, spain, email], market)).toEqual({
      terms: [orders, email, market],
      removed: false,
      replaced: [norway, spain],
    })
    // A value replaces its dimension's "any value".
    expect(toggleTerm([market, orders], norway)).toEqual({
      terms: [orders, norway],
      removed: false,
      replaced: [market],
    })
    expect(toggleTerm([market], email).replaced).toEqual([])
  })

  it('tells two values with the same name in two dimensions apart', () => {
    const sellingSpain: ScopeTerm = {
      key: 'val:selling_country/spain',
      kind: 'value',
      name: 'Spain',
      dimension: 'Selling country',
    }
    expect(holds([spain], sellingSpain)).toBe(false)
    expect(toggleTerm([spain], sellingSpain).terms).toEqual([spain, sellingSpain])
  })

  it('reads names as terms, by what the vocabulary holds', () => {
    const vocabulary: Vocabulary = {
      metrics: [{ name: 'Orders', group: 'Sales', facts: 0, definition: '' }],
      dimensions: [{ name: 'Market', values: '12 markets', definition: '' }],
      markets: ['Norway'],
    }
    expect(termsOfNames(['Orders', 'Market', 'Norway', 'Sales'], vocabulary)).toEqual([
      { key: '', kind: 'metric', name: 'Orders' },
      { key: '', kind: 'dimension', name: 'Market' },
      { key: '', kind: 'value', name: 'Norway', dimension: 'Market' },
      { key: '', kind: 'value', name: 'Sales' },
    ])
    // A term known by name is the same term as one with its name and kind.
    const byName: ScopeTerm = { key: '', kind: 'metric', name: 'Orders' }
    expect(toggleTerm([byName], { ...byName }).removed).toBe(true)
  })
})
