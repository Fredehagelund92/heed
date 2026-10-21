import { describe, expect, it } from 'vitest'
import type { CatalogueTermDetail } from '@/api'
import { api } from '@/api'
import { buildRows, type LibraryRow } from '@/lib/library'
import { withMetric, formValues } from '@/lib/context-form'
import { validateContextSearch, validateTermSearch } from '@/lib/search-params'
import {
  activeIssueRows,
  domainSourceText,
  kindCountText,
  kindSegments,
  newestRows,
  readChip,
  shelfRows,
  shelfSentence,
  shortVersion,
  sourceStateText,
  ownerText,
  termListSearch,
  termNote,
  usedWith,
  valueTypeText,
  type TermOwner,
} from '@/lib/term-page'
import { areas, people, vocabulary } from '@/mocks/reference-data'

const shelf = (overrides: Partial<CatalogueTermDetail['shelf']> = {}) => ({
  items: 92,
  byKind: { event: 28, note: 27, guide: 23, example: 13, issue: 1 },
  needsALook: 3,
  activeIssues: 1,
  ended: 25,
  gaps: 0,
  mentionedBy: 10,
  lastUpdated: '2026-10-02T09:00:00.000Z',
  ...overrides,
})

function metric(overrides: Partial<CatalogueTermDetail> = {}): CatalogueTermDetail {
  const term: Omit<CatalogueTermDetail, 'definitions'> = {
    key: 'metric:orders',
    kind: 'metric',
    id: 'orders',
    name: 'Orders',
    aliases: [],
    group: { key: 'group:payments', name: 'Payments' },
    domain: { areaId: 'area_sales', source: 'source' },
    definition: {
      ref: 'cube:orders.orders',
      name: 'orders.orders',
      title: 'Orders Orders',
      descriptionCopy: 'Money customers paid into their accounts.',
      valueType: 'number',
      state: 'current',
      renamedTo: null,
      changedAt: null,
      readAt: '2026-10-07T05:00:00.000Z',
      sourceId: 'cube',
      tool: 'Cube',
    },
    status: 'active_issues',
    shelf: shelf(),
    values: [],
    source: {
      id: 'cube',
      name: 'Cube local model',
      tool: 'Cube',
      readAt: '2026-10-07T05:00:00.000Z',
      sourceVersion: 'a4e3fb873e0d2d1050ecdfa845f12e5d8ba150065393fb1b93cc27a0eeebe17a',
      failing: false,
    },
    modelFile: null,
    today: '2026-10-08',
    ...overrides,
  }
  // The definition the term names, unless a test names several.
  return {
    ...term,
    definitions: overrides.definitions ?? (term.definition ? [term.definition] : []),
  }
}

const commercial = areas.find((area) => area.id === 'area_sales') ?? null
const jon: TermOwner = {
  area: commercial,
  person: { name: 'Jon Abara', initials: 'JA' },
  others: [{ name: 'Sofia Brandt', initials: 'SB' }],
}

async function libraryRows(): Promise<LibraryRow[]> {
  const library = await api.listLibrary()
  return buildRows(library, { areas, people, vocabulary })
}

describe('the shelf', () => {
  it('draws the kinds in the shelf order and leaves the empty ones out', () => {
    expect(kindSegments({ event: 2, note: 0, guide: 1, example: 0, issue: 3 })).toEqual([
      { kind: 'event', count: 2 },
      { kind: 'guide', count: 1 },
      { kind: 'issue', count: 3 },
    ])
    expect(kindCountText('event', 1)).toBe('1 event')
    expect(kindCountText('example', 1_204)).toBe('1,204 examples')
  })

  it('says the newest change, what ended and what needs a look in one sentence', () => {
    expect(shelfSentence(shelf())).toBe(
      'Newest change 2 Oct 2026. 25 have ended, and agents still get them for their period. 3 need checking.',
    )
    expect(
      shelfSentence(shelf({ ended: 1, needsALook: 1, lastUpdated: '2026-09-27T00:00:00Z' })),
    ).toBe(
      'Newest change 27 Sept 2026. 1 has ended, and agents still get it for its period. 1 needs checking.',
    )
    expect(shelfSentence(shelf({ items: 0, ended: 0, needsALook: 0, lastUpdated: null }))).toBe(
      null,
    )
  })

  it('counts the same items as the catalogue and the library list it opens', async () => {
    const rows = await libraryRows()
    const term = await api.getCatalogueTerm('metric', 'orders')
    if (!term) throw new Error('Orders is in the fixtures')
    const onShelf = shelfRows(rows, term.key)
    expect(onShelf).toHaveLength(term.shelf.items)
    expect(activeIssueRows(rows, term.key)).toHaveLength(term.shelf.activeIssues)
    // The library list the page links to holds ended issues too, so it shows the same count.
    expect(termListSearch(term)).toEqual({ about: 'orders', ended: 'show' })
    const newest = newestRows(rows, term.key, 10)
    expect(newest).toHaveLength(10)
    expect(newest.map((row) => row.updatedAt)).toEqual(
      [...newest.map((row) => row.updatedAt)].sort().reverse(),
    )
  })

  it('lists the values used with a term, most items first, by their vocabulary names', async () => {
    const rows = await libraryRows()
    const values = usedWith(
      rows,
      'metric:orders',
      (id) => vocabulary.dimensions.find((dimension) => dimension.id === id)?.name ?? id,
    )
    expect(values.length).toBeGreaterThan(0)
    expect(values.length).toBeLessThanOrEqual(8)
    const counts = values.map((value) => value.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    const first = values[0]
    expect(first?.dimension).toBe('Market')
    expect(first?.about).toMatch(/^market:/)
    expect(first?.value).not.toMatch(/^[a-z_]+$/)
  })
})

describe('the header', () => {
  it('ends the badge row with the read chip, amber while the newest read failed', () => {
    const chip = readChip(metric())
    expect(chip).toMatchObject({
      label: 'Copy read 7 Oct 2026',
      failing: false,
      title: 'From Cube',
    })
    expect(chip?.line).toMatch(
      /^Heed shows a copy of Cube's description, refreshed at every read, and keeps no formula\. It was last read on .*model version a4e3fb873e0d\.$/,
    )
    const base = metric()
    const down = readChip(metric({ source: base.source && { ...base.source, failing: true } }))
    expect(down?.failing).toBe(true)
    expect(down?.line).toMatch(/^The newest read of Cube failed/)
    expect(readChip(metric({ definition: null }))).toBe(null)
  })

  it('writes one note line, most urgent first, naming who acts', () => {
    const issue = {
      id: 'itm_1',
      title: 'Payment provider delays order data',
      until: '2026-10-14',
    }
    const issues = [issue as unknown as LibraryRow]
    expect(termNote(metric(), { owner: jon, issues })).toEqual({
      kind: 'issue',
      issue: { id: 'itm_1', title: 'Payment provider delays order data' },
      count: 1,
      lead: 'Agents warn about ',
      tail: 'in answers that touch Orders, until 14 Oct 2026.',
    })
    const two = [...issues, { ...issue, id: 'itm_2' } as unknown as LibraryRow]
    expect(termNote(metric(), { owner: jon, issues: two })).toMatchObject({
      issue: null,
      lead: 'Agents warn about 2 active issues ',
    })

    const definition = metric().definition
    if (!definition) throw new Error('The fixture has a definition')
    const gone = metric({ definition: { ...definition, state: 'missing' }, status: 'gone' })
    expect(termNote(gone, { owner: jon, issues })).toEqual({
      kind: 'gone',
      text: 'Cube no longer lists orders.orders. Agents are told the 92 facts about Orders may be out of date until Jon Abara, who owns Sales, checks them.',
    })
    const changed = metric({
      definition: { ...definition, state: 'changed', changedAt: '2026-10-07T05:00:00Z' },
    })
    expect(termNote(changed, { owner: jon, issues })).toMatchObject({
      kind: 'changed',
      text: 'Cube changed orders.orders on 7 Oct 2026. Agents are told the facts written before the change may be out of date until Jon Abara, who owns Sales, checks them.',
    })
    const calm = metric({ status: 'in_sync', shelf: shelf({ activeIssues: 0 }) })
    expect(termNote(calm, { owner: jon, issues: [] })).toBe(null)
  })

  it('names the role when nobody is named, and says when nothing relies on a gone term', () => {
    expect(ownerText({ area: commercial, person: null, others: [] })).toBe('the owner of Sales')
    expect(ownerText({ area: null, person: null, others: [] })).toBe('an owner')
    const definition = metric().definition
    if (!definition) throw new Error('The fixture has a definition')
    const empty = metric({
      definition: { ...definition, state: 'missing', renamedTo: 'cube:payments.deposits_eur' },
      shelf: shelf({ items: 0, activeIssues: 0 }),
    })
    expect(termNote(empty, { owner: { ...jon, person: null }, issues: [] })).toEqual({
      kind: 'gone',
      text: 'Cube no longer lists orders.orders. Cube names cube:payments.deposits_eur instead. The owner of Sales decides what replaces it.',
    })
  })
})

describe('the Source tab', () => {
  it('says where the copy comes from and how old it is', () => {
    expect(sourceStateText(metric(), metric().source)).toBe(
      'Read from Cube on 7 Oct 2026, model version a4e3fb873e0d.',
    )
    expect(sourceStateText(metric({ definition: null }), null)).toMatch(/names no definition/)
    expect(shortVersion('v2026.10.06')).toBe('v2026.10.06')
    expect(valueTypeText('number')).toBe('Number')
    expect(valueTypeText(null)).toBe(null)
  })

  it('says where the domain comes from', () => {
    expect(domainSourceText(metric())).toMatch(/^Read from the domain its view names in Cube\./)
    expect(domainSourceText(metric({ domain: { areaId: 'x', source: 'vocabulary' } }))).toMatch(
      /domain map/,
    )
    expect(domainSourceText(metric({ domain: { areaId: null, source: 'none' } }))).toMatch(
      /gives no domain/,
    )
  })
})

describe('the address', () => {
  it('keeps a known tab and drops an unknown one', () => {
    expect(validateTermSearch({ tab: 'source' })).toEqual({ tab: 'source' })
    expect(validateTermSearch({ tab: 'values' })).toEqual({ tab: undefined })
  })

  it('starts Add a fact with the metric in its scope', () => {
    expect(validateContextSearch({ metric: 'orders' })).toEqual({ metric: 'orders' })
    expect(validateContextSearch({ metric: 'Orders!' })).toEqual({ metric: undefined })
    const values = withMetric(formValues(), 'orders')
    expect(values.scope.metrics).toEqual(['metric:orders'])
    expect(withMetric(values, 'orders')).toBe(values)
    expect(withMetric(values, undefined)).toBe(values)
  })
})
