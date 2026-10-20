import { describe, expect, it } from 'vitest'
import { findArea, rankItems, readQuery } from '../../../src/domain/context-search.ts'
import {
  domainReadAs,
  domainsInText,
  editDistance,
  knownWords,
  matchDomain,
  misspeltAgainstId,
  misspeltWords,
  storedNameNote,
} from '../../../src/domain/domain-match.ts'
import { terms } from './fixtures.ts'

/*
  A domain created as "Stores & Suplliers", with a typo in its stored name, and asked for as
  "Stores & Suppliers", then "stores and suppliers". A domain is read by the words people use for
  it, and Heed says once how it read them, noting a stored name that looks misspelt.
*/

const areas = [
  { id: 'stores_suppliers', name: 'Stores & Suplliers' },
  { id: 'finance', name: 'Finance' },
  { id: 'payments', name: 'Payments' },
  { id: 'practice', name: 'Practice (invented)' },
]

describe('matching a domain by the words people use', () => {
  it('reads its id and its stored name, apart from case, as exact', () => {
    expect(matchDomain('stores_suppliers', areas)).toMatchObject({ kind: 'exact' })
    expect(matchDomain('area:stores_suppliers', areas)).toMatchObject({ kind: 'exact' })
    expect(matchDomain('the stores & SUPLLIERS domain', areas)).toMatchObject({ kind: 'exact' })
  })

  it('reads "and" for "&" and leaves out punctuation', () => {
    expect(matchDomain('Stores and Suplliers', areas)).toMatchObject({
      area: { id: 'stores_suppliers' },
      kind: 'loose',
    })
    expect(matchDomain('stores suppliers', areas)?.area.id).toBe('stores_suppliers')
    expect(matchDomain('Practice invented', areas)?.area.id).toBe('practice')
  })

  it('reads a spelling a letter or two apart as the one closest domain', () => {
    for (const words of ['Stores & Suppliers', 'stores and suppliers', 'Stors & Suppliers'])
      expect(matchDomain(words, areas)).toMatchObject({
        area: { id: 'stores_suppliers' },
        kind: 'close',
      })
    expect(matchDomain('Finanse', areas)).toMatchObject({ area: { id: 'finance' }, kind: 'close' })
    expect(findArea('Stores & Suppliers', areas)?.id).toBe('stores_suppliers')
  })

  it('names no domain for words too far from every name, or as close to two', () => {
    expect(matchDomain('Finanzen', areas)).toBeNull()
    expect(matchDomain('suppliers', areas)).toBeNull()
    expect(
      matchDomain('Ads', [
        { id: 'ads', name: 'Ads' },
        { id: 'abs', name: 'Abs' },
      ]),
    ).toMatchObject({ kind: 'exact' })
    expect(
      matchDomain('Paid cots', [
        { id: 'paid_cost', name: 'Paid cost' },
        { id: 'paid_cots', name: 'Paid cats' },
      ])?.area.id,
    ).toBe('paid_cots')
    expect(
      matchDomain('Paid coxt', [
        { id: 'a', name: 'Paid cost' },
        { id: 'b', name: 'Paid coat' },
      ]),
    ).toBeNull()
  })

  it('counts a swap of two letters as one edit', () => {
    expect(editDistance('parnters', 'partners')).toBe(1)
    expect(editDistance('stores', 'stores')).toBe(0)
    expect(editDistance('', 'abc')).toBe(3)
  })
})

describe('domains in running text', () => {
  it('finds a domain of two or more words by another spelling, with where it is', () => {
    const text = 'show me stores & suppliers metrics and dimensions'
    expect(domainsInText(text, areas)).toEqual([
      { area: areas[0], kind: 'close', start: 8, end: 26 },
    ])
    expect(domainsInText('i ment stores and suppliers', areas)).toMatchObject([
      { area: { id: 'stores_suppliers' }, kind: 'close' },
    ])
  })

  it('never makes a single word a domain by a spelling apart', () => {
    expect(domainsInText('orders by payment provider', areas)).toEqual([])
    expect(domainsInText('finanse in norway', areas)).toEqual([])
  })

  it('reads the query of a search as the domain, and says how it read it', () => {
    const read = readQuery('Stores & Suppliers metrics and dimensions', terms, areas)
    expect(read.used.domains).toEqual(['stores_suppliers'])
    expect(read.spelled).toEqual([
      { area: 'stores_suppliers', wrote: 'Stores & Suppliers', kind: 'close' },
    ])
    // The domain's items match it as they match its stored name.
    const item = {
      id: 'itm_aaaaaaaa',
      areaId: 'stores_suppliers',
      title: 'Supplier feed paused',
      summary: '',
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
    }
    expect(rankItems(readQuery('stores and suppliers', terms, areas), [item], terms)).toHaveLength(
      1,
    )
    // A stored name as written is no other spelling.
    expect(readQuery('Stores & Suplliers', terms, areas).spelled).toEqual([])
  })
})

describe('saying how a domain was read', () => {
  const known = knownWords(['stores_suppliers', 'Finance', 'Payments', 'Net revenue'])

  it('says nothing for the stored name', () => {
    expect(domainReadAs(areas[0]!, 'stores & suplliers', 'exact', known)).toBeNull()
  })

  it('names the domain read, and a stored word that looks misspelt, without blame', () => {
    const note = domainReadAs(areas[0]!, 'Stores & Suppliers', 'close', known)
    expect(note).toEqual({
      wrote: 'Stores & Suppliers',
      domain: 'Stores & Suplliers',
      kind: 'close',
      misspelt: true,
      note: '"Stores & Suppliers" was read as the domain Stores & Suplliers (stores_suppliers), the domain whose name is closest. The domain\'s stored name looks misspelt: "Suplliers" for "Suppliers". Administrators rename domains in Administration › Domains (/admin?section=domains); the id stays the same.',
    })
    expect(note!.note).not.toMatch(/you|your|typo by/i)
  })

  it('assumes neither spelling wrong when Heed knows neither word from elsewhere', () => {
    expect(
      misspeltWords('Stores & Suplliers', 'Stores & Suppliers', knownWords(['finance'])),
    ).toEqual([])
    const note = domainReadAs(areas[0]!, 'Stores & Suppliers', 'close', knownWords(['finance']))
    expect(note).not.toHaveProperty('misspelt')
    expect(note!.note).toBe(
      '"Stores & Suppliers" was read as the domain Stores & Suplliers (stores_suppliers), the domain whose name is closest.',
    )
  })

  it('says "and" for "&" plainly', () => {
    expect(domainReadAs(areas[0]!, 'Stores and Suplliers', 'loose', known)?.note).toBe(
      '"Stores and Suplliers" was read as the domain Stores & Suplliers (stores_suppliers).',
    )
  })
})

describe('a stored name beside its id', () => {
  it('notes a word that looks misspelt beside the id, which never changes', () => {
    expect(misspeltAgainstId('Stores & Suplliers', 'stores_suppliers')).toEqual([
      { stored: 'suplliers', wrote: 'suppliers' },
    ])
    expect(storedNameNote(areas[0]!)).toBe(
      'The domain\'s stored name looks misspelt: "Suplliers" for "Suppliers", as its id stores_suppliers reads. Administrators rename domains in Administration › Domains (/admin?section=domains); the id stays the same.',
    )
  })

  it('says nothing of a name its id agrees with, or one renamed to other words', () => {
    expect(storedNameNote({ id: 'paid_cost', name: 'Paid cost' })).toBeNull()
    expect(storedNameNote({ id: 'area_sales', name: 'Sales' })).toBeNull()
    expect(storedNameNote({ id: 'stores_suppliers', name: 'Shops and suppliers' })).toBeNull()
    expect(storedNameNote({ id: 'practice', name: 'Practice (invented)' })).toBeNull()
  })
})
