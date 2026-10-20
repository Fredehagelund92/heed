import { describe, expect, it } from 'vitest'
import {
  addDays,
  compareColumnSpecs,
  compareEntries,
  compareGroupOrder,
  editionBeforeDay,
  fitCompareColumns,
  groupStartsClosed,
  isViewedList,
  presetFirstDay,
  toggledViewed,
  VIEWED_LIMIT,
  viewedKey,
  type ComparedItem,
  type CompareGroup,
} from '@/lib/edition-compare'
import { editionChangeKinds } from '@domain/editions'
import { editionCompareSearchSchema, validateEditionCompareSearch } from '@/lib/search-params'
import { commands } from '@/lib/commands'

/*
  What changed between two editions (Editions design, slice S2), as the page reads it: the groups
  and their rows, the viewed marks, the ranges a person picks without edition numbers, the grid's
  columns and the address.
*/

const item = (id: string, change: ComparedItem['change'] = 'changed'): ComparedItem => ({
  itemId: id,
  change,
  title: `Item ${id}`,
  areaId: 'area_commercial',
  kind: 'note',
  riskLevel: 'normal',
  from: change === 'added' ? null : { version: 1, versionId: `${id}-v1` },
  to: change === 'retired' ? null : { version: 2, versionId: `${id}-v2` },
  why: { proposal: null, proposerId: null, channel: null, editedBy: null, decisions: [] },
  fields: [],
})

describe('the groups of changed items', () => {
  it('reads real changes first and what only confirms last, every kind once', () => {
    expect([...compareGroupOrder].sort()).toEqual([...editionChangeKinds].sort())
    expect(compareGroupOrder.slice(0, 2)).toEqual(['changed', 'added'])
    expect(compareGroupOrder.at(-1)).toBe('resaved')
  })

  it('keeps "saved again, nothing different" closed until someone opens it', () => {
    expect(editionChangeKinds.filter(groupStartsClosed)).toEqual(['resaved'])
  })

  it('lists a header per group, its loaded rows and a placeholder for each row still to load', () => {
    const groups: CompareGroup[] = [
      { kind: 'changed', total: 3, items: [item('a'), item('b')], collapsed: false },
      { kind: 'added', total: 0, items: [], collapsed: false },
      { kind: 'retired', total: 2, items: [item('c', 'retired')], collapsed: true },
      { kind: 'checked', total: null, items: [], collapsed: false },
    ]
    expect(
      compareEntries(groups).map((entry) =>
        entry.type === 'group'
          ? `group ${entry.kind} ${entry.total}`
          : entry.type === 'item'
            ? `item ${entry.item.itemId}`
            : `pending ${entry.kind} ${entry.index}`,
      ),
    ).toEqual([
      'group changed 3',
      'item a',
      'item b',
      'pending changed 2',
      // An empty group has no header; a closed one is its header only.
      'group retired 2',
      // A group whose count is still loading shows a few rows to load into.
      'group checked null',
      'pending checked 0',
      'pending checked 1',
      'pending checked 2',
    ])
  })
})

describe('viewed marks', () => {
  it('belong to the item and the two versions, so a newer version reads as not viewed', () => {
    const first = item('a')
    const later = { ...first, to: { version: 3, versionId: 'a-v3' } }
    expect(viewedKey(first)).toBe('a:a-v1:a-v2')
    expect(viewedKey(later)).not.toBe(viewedKey(first))
    expect(viewedKey(item('n', 'added'))).toBe('n:-:n-v2')
    expect(viewedKey(item('r', 'retired'))).toBe('r:r-v1:-')
  })

  it('toggle on and off, and keep only the newest marks', () => {
    expect(toggledViewed([], 'a')).toEqual(['a'])
    expect(toggledViewed(['a', 'b'], 'a')).toEqual(['b'])
    const full = Array.from({ length: VIEWED_LIMIT }, (_, index) => `k${index}`)
    const next = toggledViewed(full, 'new')
    expect(next).toHaveLength(VIEWED_LIMIT)
    expect(next[0]).toBe('k1')
    expect(next.at(-1)).toBe('new')
  })

  it('read only a list of strings from storage', () => {
    expect(isViewedList(['a'])).toBe(true)
    expect(isViewedList([1])).toBe(false)
    expect(isViewedList('a')).toBe(false)
  })

  it('have their key in the command registry: v, on a list that keeps them', () => {
    const viewed = commands.find((command) => command.id === 'list.viewed')!
    expect(viewed.hotkey).toBe('v')
    const list = {
      move: () => undefined,
      moveTo: () => undefined,
      toggleSelected: () => undefined,
      clear: () => false,
      focusSearch: () => undefined,
      cursorItemId: () => null,
    }
    const base = {
      navigate: () => undefined,
      setAppearance: () => undefined,
      toggleSidebar: () => undefined,
    }
    expect(viewed.available?.({ ...base, list })).toBe(false)
    let toggled = 0
    const keeping = { ...list, toggleViewed: () => (toggled += 1) }
    expect(viewed.available?.({ ...base, list: keeping })).toBe(true)
    viewed.run({ ...base, list: keeping })
    expect(toggled).toBe(1)
  })
})

describe('ranges by day', () => {
  it('count today in: the last 7 days on 11 October start on 5 October', () => {
    expect(presetFirstDay('2026-10-11', 7)).toBe('2026-10-05')
    expect(presetFirstDay('2026-03-01', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
  })

  it('start at the edition that was live when the first day began', () => {
    const newestFirst = [
      { label: '2026-10-07.2' },
      { label: '2026-10-07.1' },
      { label: '2026-10-05.1' },
      { label: '2026-10-04.3' },
      { label: '2026-09-30.1' },
    ]
    expect(editionBeforeDay(newestFirst, '2026-10-05')).toEqual({ label: '2026-10-04.3' })
    expect(editionBeforeDay(newestFirst, '2026-10-08')).toEqual({ label: '2026-10-07.2' })
    expect(editionBeforeDay(newestFirst, '2026-09-01')).toBeUndefined()
  })
})

describe('the grid of changed items', () => {
  it('shows every column at 1440 and lets Risk go first, then who decided, then the domain', () => {
    expect(fitCompareColumns(1184, 24)).toEqual({
      columns: ['domain', 'risk', 'by', 'viewed'],
      narrow: false,
    })
    // Beside the docked panel at 1440: 1,440 less the rail (48) and the panel (480).
    expect(fitCompareColumns(940, 24).columns).toEqual(['domain', 'risk', 'by', 'viewed'])
    expect(fitCompareColumns(912, 24).columns).toEqual(['domain', 'by', 'viewed'])
    expect(fitCompareColumns(812, 24).columns).toEqual(['domain', 'by', 'viewed'])
    expect(fitCompareColumns(800, 24).columns).toEqual(['domain', 'viewed'])
    expect(fitCompareColumns(770, 24).columns).toEqual(['domain', 'viewed'])
    expect(fitCompareColumns(390, 16)).toMatchObject({ columns: ['viewed'], narrow: true })
  })

  it('names each column with a width token', () => {
    for (const spec of Object.values(compareColumnSpecs))
      expect(spec.widthClass).toMatch(/^w-column-/)
  })
})

describe('the address of a comparison', () => {
  it('holds the two editions, the view, the filters and the open item', () => {
    const search = {
      since: '2026-09-10.2',
      until: '2026-10-07.1',
      view: 'steps',
      change: 'resaved',
      area: 'area_commercial',
      kind: 'issue',
      risk: 'high',
      item: 'itm_q2upr28v',
      step: '2026-10-01.1',
      tab: 'steps',
    }
    expect(validateEditionCompareSearch(search)).toEqual(search)
    expect(Object.keys(editionCompareSearchSchema.shape).sort()).toEqual(Object.keys(search).sort())
  })

  it('drops what is not an edition number, a change or an item', () => {
    expect(
      validateEditionCompareSearch({
        since: 'yesterday',
        until: '2026-10-07.1',
        change: 'edited',
        item: '42',
        view: 'net',
      }),
    ).toEqual({
      since: undefined,
      until: '2026-10-07.1',
      change: undefined,
      item: undefined,
      view: undefined,
    })
  })
})
