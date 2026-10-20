import { describe, expect, it } from 'vitest'
import {
  findArea,
  rankItems,
  readQuery,
  stem,
  type SearchItem,
} from '../../../src/domain/context-search.ts'
import { terms } from './fixtures.ts'

const areas = [
  { id: 'finance', name: 'Finance' },
  { id: 'customer_value', name: 'Customer value' },
]
const item = (id: string, overrides: Partial<SearchItem> = {}): SearchItem => ({
  id,
  areaId: 'finance',
  title: '',
  summary: '',
  scope: { metrics: [], dimensions: [], dimensionValues: [] },
  ...overrides,
})
const ids = (query: string, items: SearchItem[]) =>
  rankItems(readQuery(query, terms, areas), items, terms).map((r) => [r.item.id, r.all])

describe('ranking items that match every word', () => {
  it('puts the item titled with just the words asked first, whatever its id', () => {
    const scoped = { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] }
    const items = [
      item('itm_aaaaaaaa', { title: 'Revenue excludes test accounts', scope: scoped }),
      item('itm_zzzzzzzz', { title: 'Orders excludes test accounts', scope: scoped }),
    ]
    expect(ids('Orders excludes test accounts', items)).toEqual([
      ['itm_zzzzzzzz', true],
      ['itm_aaaaaaaa', true],
    ])
    // Read with light stemming, as the words are.
    expect(ids('order exclude test account', items)[0]).toEqual(['itm_zzzzzzzz', true])
  })
})

describe('reading a search query', () => {
  it('recognises domains and terms by their names, other names, keys and ids', () => {
    expect(readQuery('Order amount in Norge', terms, areas).used).toEqual({
      domains: [],
      terms: ['metric:orders', 'val:market/norway'],
      words: [],
      ignored: ['in'],
      unknown_members: [],
    })
    expect(readQuery('What does the Customer value domain cover?', terms, areas).used).toEqual({
      domains: ['customer_value'],
      terms: [],
      words: ['cover'],
      ignored: ['does', 'domain', 'the', 'what'],
      unknown_members: [],
    })
    expect(readQuery('area:finance metric:revenue', terms, areas).used).toMatchObject({
      domains: ['finance'],
      terms: ['metric:revenue'],
    })
  })

  it('reads the member names a data tool queried as the terms that point at them (CON-517)', () => {
    expect(readQuery('payments.orders in Norway', terms, areas).used).toMatchObject({
      terms: ['metric:orders', 'val:market/norway'],
      words: [],
      unknown_members: [],
    })
    expect(readQuery('cube:payments.revenue', terms, areas).used.terms).toEqual(['metric:revenue'])
  })

  it('never reads an unknown member as the words in it, which would answer for another metric', () => {
    const read = readQuery('payments.deposit_total.', terms, areas)
    expect(read.used).toMatchObject({
      terms: [],
      words: [],
      unknown_members: ['payments.deposit_total'],
    })
    expect(rankItems(read, [item('itm_any00001', { title: 'Orders' })], terms)).toEqual([])
    // A link or an email address is not a member name.
    expect(
      readQuery('see https://status.example/payments.orders', terms, areas).used.unknown_members,
    ).toEqual([])
    expect(readQuery('e.g. orders', terms, areas).used).toMatchObject({
      terms: ['metric:orders'],
      unknown_members: [],
    })
  })

  it('keeps a dotted word outside every known view as words to search', () => {
    for (const query of ['is orders.also affected', 'what about shop24.com']) {
      const read = readQuery(query, terms, areas)
      expect(read.used.unknown_members).toEqual([])
      expect(read.concepts.length).toBeGreaterThan(0)
    }
    expect(readQuery('traffic.sessions', terms, areas).used.unknown_members).toEqual([
      'traffic.sessions',
    ])
    expect(readQuery(' Traffic.Sessions. ', terms, areas).used.unknown_members).toEqual([
      'traffic.sessions',
    ])
    const traffic = terms.map((term) =>
      term.key === 'metric:orders' ? { ...term, definitionRefs: ['cube:traffic.sessions'] } : term,
    )
    expect(readQuery('traffic.sessions', traffic, areas).used.terms).toEqual(['metric:orders'])
    expect(readQuery('traffic.visits', traffic, areas).used.unknown_members).toEqual([
      'traffic.visits',
    ])
  })

  it('stems plain English plurals, and nothing else', () => {
    expect(['accounts', 'orders', 'categories', 'class', 'status', "customer's"].map(stem)).toEqual(
      ['account', 'order', 'category', 'class', 'status', 'customer'],
    )
  })
})

describe('ranking items', () => {
  const closure = item('itm_closure01', {
    title: 'Norway closure',
    summary: 'Online sales stopped on 4 August.',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
  })
  const revenue = item('itm_revenue01', {
    title: 'Revenue excludes test accounts',
    summary: 'Test accounts are left out.',
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
  const other = item('itm_other0001', {
    areaId: 'customer_value',
    title: 'A note on orders',
    summary: 'It mentions orders only in words.',
    body: 'Norway is named in the body.',
  })

  it('puts items that match every part first, a named term before a plain word', () => {
    expect(ids('orders Norway closure', [other, revenue, closure])).toEqual([
      ['itm_closure01', true],
      ['itm_other0001', false],
    ])
    expect(ids('test account', [closure, revenue, other])).toEqual([['itm_revenue01', true]])
  })

  it('matches a metric group through the metrics in it, and a domain by the items in it', () => {
    expect(ids('Payments', [revenue, closure])).toEqual([['itm_closure01', true]])
    expect(ids('Customer value', [closure, revenue, other])).toEqual([['itm_other0001', true]])
  })

  it('keeps every item in id order for an empty query, and nothing for unknown words', () => {
    expect(ids('', [other, revenue, closure]).map(([id]) => id)).toEqual([
      'itm_closure01',
      'itm_other0001',
      'itm_revenue01',
    ])
    expect(ids('newest edition', [other, revenue, closure])).toEqual([])
    expect(ids('what is it', [other, revenue, closure])).toEqual([])
  })
})

it('finds a domain by its id, area:<id> or its name', () => {
  for (const input of ['finance', 'area:finance', 'Finance', 'the finance domain'])
    expect(findArea(input, areas)?.id, input).toBe('finance')
  expect(findArea('Marketing', areas)).toBeNull()
})
