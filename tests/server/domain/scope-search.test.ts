import { describe, expect, it } from 'vitest'
import { describeScope, searchScope, type ScopeUsage } from '../../../src/domain/scope-search.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'
import { terms as base } from './fixtures.ts'

const term = (key: string, kind: Term['kind'], name: string, parentKey: string | null = null) => ({
  key,
  kind,
  name,
  aliases: [],
  parentKey,
  areaId: null,
  definitionRefs: [],
})
/** The fixture vocabulary and a campaign dimension with 3,000 values, as an organisation has. */
const campaigns = Array.from({ length: 3000 }, (_, i) =>
  term(
    `val:campaign/c${String(i).padStart(4, '0')}`,
    'dimension_value',
    `${i % 2 ? 'Spring' : 'Autumn'} push ${String(i).padStart(4, '0')}`,
    'dim:campaign',
  ),
)
const terms: Term[] = [...base, term('dim:campaign', 'dimension', 'Campaign'), ...campaigns]
const none: ScopeUsage = { recent: [], uses: {} }

describe('the scope picker search (FR-107)', () => {
  it('finds nothing for no words, except inside one dimension', () => {
    expect(searchScope(terms, none, { query: '  ' })).toEqual({
      metrics: [],
      groups: [],
      nextCursor: null,
    })
    const inside = searchScope(terms, none, { query: '', dimension: 'dim:campaign' })
    expect(inside.groups[0]).toMatchObject({ named: true, count: 3000 })
    expect(inside.groups[0]!.values).toHaveLength(20)
    expect(inside.nextCursor).toBe('20')
  })

  it('groups values by dimension with how many match, never listing them all', () => {
    const page = searchScope(terms, none, { query: 'spring' })
    expect(page.metrics).toEqual([])
    expect(page.groups).toHaveLength(1)
    expect(page.groups[0]).toMatchObject({
      dimension: { key: 'dim:campaign', kind: 'dimension', name: 'Campaign' },
      named: false,
      count: 1500,
    })
    expect(page.groups[0]!.values.length).toBeLessThanOrEqual(5)
    expect(page.groups[0]!.values.every((hit) => hit.name.startsWith('Spring'))).toBe(true)
  })

  it('offers the dimension itself when the words name it, with all of its values counted', () => {
    const page = searchScope(terms, none, { query: 'market' })
    expect(page.groups[0]).toMatchObject({
      dimension: { key: 'dim:market', name: 'Market' },
      named: true,
      count: 2,
    })
    expect(page.groups[0]!.values.map((hit) => hit.key)).toEqual([
      'val:market/norway',
      'val:market/spain',
    ])
  })

  it('finds a value by another name and says which', () => {
    const page = searchScope(terms, none, { query: 'norge' })
    expect(page.groups[0]!.values[0]).toMatchObject({
      key: 'val:market/norway',
      name: 'Norway',
      alias: 'Norge',
      dimension: { key: 'dim:market', name: 'Market' },
    })
  })

  it('puts an exact name first, then recent, then often used', () => {
    const usage: ScopeUsage = {
      recent: ['val:campaign/c0003'],
      uses: { 'val:campaign/c0005': 9, 'val:campaign/c0007': 4 },
    }
    const values = searchScope(terms, usage, { query: 'spring push', dimension: 'dim:campaign' })
      .groups[0]!.values
    expect(values.slice(0, 3).map((hit) => [hit.key, hit.recent, hit.uses])).toEqual([
      ['val:campaign/c0003', true, 0],
      ['val:campaign/c0005', false, 9],
      ['val:campaign/c0007', false, 4],
    ])
    const exact = searchScope(terms, usage, {
      query: 'spring push 0009',
      dimension: 'dim:campaign',
    }).groups[0]!.values
    expect(exact[0]!.key).toBe('val:campaign/c0009')
  })

  it('pages through the values of one dimension in a fixed order', () => {
    const first = searchScope(terms, none, { query: 'autumn', dimension: 'dim:campaign' })
    const second = searchScope(terms, none, {
      query: 'autumn',
      dimension: 'dim:campaign',
      cursor: first.nextCursor!,
    })
    expect(first.groups[0]!.count).toBe(1500)
    expect(second.groups[0]!.values[0]!.key).not.toBe(first.groups[0]!.values[0]!.key)
    const last = searchScope(terms, none, {
      query: 'autumn',
      dimension: 'dim:campaign',
      cursor: '1480',
    })
    expect(last.groups[0]!.values).toHaveLength(20)
    expect(last.nextCursor).toBeNull()
    expect(searchScope(terms, none, { query: 'x', dimension: 'dim:unknown' }).groups).toEqual([])
  })

  it('keeps a page near twenty rows across metrics and dimensions', () => {
    const page = searchScope(terms, none, { query: 'p' })
    const rows =
      page.metrics.length + page.groups.reduce((sum, group) => sum + 1 + group.values.length, 0)
    expect(rows).toBeLessThanOrEqual(25)
  })
})

describe('the chips of a scope', () => {
  it('names each key the vocabulary holds, in order, and leaves out the rest', () => {
    expect(
      describeScope(terms, none, ['dim:market', 'metric:gone', 'val:campaign/c0002']).map((hit) => [
        hit.key,
        hit.kind,
        hit.name,
        hit.dimension?.name ?? null,
      ]),
    ).toEqual([
      ['dim:market', 'dimension', 'Market', null],
      ['val:campaign/c0002', 'dimension_value', 'Autumn push 0002', 'Campaign'],
    ])
  })
})
