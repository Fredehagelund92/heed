import { describe, expect, it } from 'vitest'
import type { CatalogueTerm, LibraryItem } from '@contract/index'
import { definitionsOf, factsOf, hitsOf, statusOf, validityOf, type Names } from '@/api/http-map'

const row = (patch: Partial<LibraryItem> = {}): LibraryItem => ({
  id: 'itm_norway01',
  kind: 'event',
  areaId: 'area_sales',
  status: 'accepted',
  version: 2,
  title: 'Norway stopped taking orders',
  summary: 'From 4 August.',
  scope: {
    metrics: ['orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'market', value: 'norway' }],
  },
  validity: { start: '2026-08-04', end: null },
  reviewDate: '2027-01-01',
  reviewQuestion: 'still_correct',
  checkFlag: null,
  ownerId: 'per_jon',
  proposerId: 'per_maria',
  updatedAt: '2026-10-01T09:00:00Z',
  lastChecked: { on: '2026-10-03', personId: 'per_jon' },
  trust: 'current',
  chips: ['Orders', 'Norway'],
  ...patch,
})

const names: Names = {
  person: (id) => ({ per_jon: 'Jon Abara', per_maria: 'Maria Lindqvist' })[id] ?? 'Someone',
  domainOwners: (areaId) => (areaId === 'area_sales' ? ['Jon Abara'] : []),
}

describe('reading the library index', () => {
  it('says the status in the app’s words, from the status and the trust', () => {
    expect(statusOf(row())).toBe('Live')
    expect(statusOf(row({ trust: 'needs_check' }))).toBe('Needs checking')
    expect(statusOf(row({ trust: 'ended' }))).toBe('Live')
    expect(statusOf(row({ status: 'retired', trust: 'ended' }))).toBe('Archived')
  })

  it('keeps the dates, and an issue that is still going on', () => {
    expect(validityOf(row())).toEqual({ from: '2026-08-04' })
    expect(validityOf(row({ validity: { start: '2026-08-04', end: '2026-09-01' } }))).toEqual({
      from: '2026-08-04',
      until: '2026-09-01',
    })
    expect(validityOf(row({ reviewQuestion: 'still_going_on' }))).toEqual({
      from: '2026-08-04',
      ongoing: true,
    })
  })

  it('reads a row as a context item: its scope by name, who checked it and when', () => {
    expect(factsOf([row()], names)).toEqual([
      {
        id: 'itm_norway01',
        title: 'Norway stopped taking orders',
        summary: 'From 4 August.',
        domain: 'area_sales',
        kind: 'event',
        where: ['Orders', 'Norway'],
        valid: { from: '2026-08-04' },
        when: 'From 4 Aug 2026',
        status: 'Live',
        checkedBy: 'Jon Abara',
        checkedOn: '3 Oct 2026',
        source: '',
        quote: '',
        dontConclude: '',
      },
    ])
  })

  it('names the owner only when they are not one of the domain’s owners', () => {
    const [fact] = factsOf([row({ ownerId: 'per_maria' })], names)
    expect(fact!.owners).toEqual(['Maria Lindqvist'])
  })

  it('leaves out the kind the app does not offer, and says nothing for an item never checked', () => {
    const facts = factsOf(
      [row({ kind: 'example' }), row({ id: 'itm_b', lastChecked: null })],
      names,
    )
    expect(facts.map((f) => f.id)).toEqual(['itm_b'])
    expect(facts[0]).toMatchObject({ checkedBy: '', checkedOn: '' })
  })
})

describe('reading the catalogue', () => {
  const term = (patch: Partial<CatalogueTerm> = {}): CatalogueTerm =>
    ({
      key: 'metric:net_revenue',
      kind: 'metric',
      id: 'net_revenue',
      name: 'Net revenue',
      aliases: ['Turnover', 'Turnover'],
      group: { key: 'group:revenue', name: 'Revenue' },
      domain: { areaId: 'area_sales', source: 'vocabulary' },
      definition: {
        ref: 'cube:revenue.net_revenue',
        name: 'revenue.net_revenue',
        title: 'Net revenue',
        descriptionCopy: 'Revenue after returns and discounts.',
        valueType: 'number',
        state: 'current',
        renamedTo: null,
        changedAt: '2026-10-02T06:00:00Z',
        readAt: '2026-10-07T06:00:00Z',
        sourceId: 'cube',
        tool: 'Cube',
      },
      definitions: [],
      status: 'current',
      shelf: {
        items: 3,
        byKind: { note: 3, event: 0, guide: 0, example: 0, issue: 0 },
        needsALook: 0,
        activeIssues: 0,
        ended: 0,
        gaps: 0,
        mentionedBy: 1,
        lastUpdated: '2026-09-18T10:00:00Z',
      },
      ...patch,
    }) as CatalogueTerm

  it('reads a term as a synced definition, its other names once each', () => {
    expect(definitionsOf([term()])).toEqual([
      {
        name: 'Net revenue',
        type: 'metric',
        definition: 'Revenue after returns and discounts.',
        synced: true,
        tool: 'Cube',
        sourceNames: ['Turnover'],
        domain: 'area_sales',
        group: 'Revenue',
        changed: '2 Oct 2026',
        updated: '18 Sep 2026',
      },
    ])
  })

  it('says nothing of a definition the source never listed', () => {
    const [d] = definitionsOf([
      term({ definition: null, group: null, domain: { areaId: null, source: 'none' } }),
    ])
    expect(d).toMatchObject({ definition: '', synced: true })
    expect(d).not.toHaveProperty('tool')
    expect(d).not.toHaveProperty('domain')
    expect(d).not.toHaveProperty('changed')
  })
})

describe('reading search everywhere', () => {
  it('keeps the groups, without the kind the app does not offer', () => {
    expect(
      hitsOf({
        items: [
          {
            id: 'itm_a',
            kind: 'note',
            areaId: 'area_sales',
            status: 'accepted',
            title: 'A',
            summary: '',
          },
          {
            id: 'itm_b',
            kind: 'example',
            areaId: 'area_sales',
            status: 'accepted',
            title: 'B',
            summary: '',
          },
        ],
        definitions: [{ key: 'dim:market', kind: 'dimension', name: 'Market', aliases: [] }],
        domains: [{ id: 'area_sales', name: 'Sales' }],
        people: [{ id: 'p1', name: 'Jon Abara' }],
      }),
    ).toEqual({
      items: [{ id: 'itm_a', title: 'A', kind: 'note', domain: 'area_sales' }],
      definitions: [{ name: 'Market', type: 'dimension', sourceNames: [] }],
      domains: [{ id: 'area_sales', name: 'Sales' }],
      people: [{ name: 'Jon Abara' }],
    })
  })
})
