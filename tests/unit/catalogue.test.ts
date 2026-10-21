import { describe, expect, it } from 'vitest'
import type { CatalogueTerm } from '@/api'
import { api } from '@/api'
import {
  catalogueColumnSpecs,
  fitCatalogueColumns,
  NAME_MIN_WIDTH,
} from '@/components/catalogue/columns'
import {
  catalogueEntries,
  catalogueFilterCount,
  catalogueChangeDetail,
  catalogueStatusName,
  catalogueTool,
  catalogueTotals,
  filterDomains,
  groupCountText,
  matchesQuery,
  rankTerms,
  searchedTerms,
  shelfTotals,
  termDomainInfo,
  termsText,
  viewCounts,
  visibleTerms,
  type CatalogueEntry,
} from '@/lib/catalogue'
import { buildRows } from '@/lib/library'
import { validateCatalogueSearch } from '@/lib/search-params'
import { mockCatalogue } from '@/mocks/catalogue'
import { areas, FIXTURE_TODAY, people, vocabulary } from '@/mocks/reference-data'
import { modelFileAddress } from '@domain/catalogue'

function term(
  overrides: Partial<CatalogueTerm> & Pick<CatalogueTerm, 'key' | 'name'>,
): CatalogueTerm {
  const kind = overrides.key.startsWith('metric:') ? 'metric' : 'dimension'
  return {
    kind,
    id: overrides.key.slice(overrides.key.indexOf(':') + 1),
    aliases: [],
    group: null,
    domain: { areaId: null, source: 'none' },
    definition: null,
    // The definition the term names, unless a test names several.
    definitions: overrides.definitions ?? (overrides.definition ? [overrides.definition] : []),
    status: 'in_sync',
    shelf: {
      items: 1,
      byKind: { note: 1, event: 0, guide: 0, example: 0, issue: 0 },
      needsALook: 0,
      activeIssues: 0,
      ended: 0,
      gaps: 0,
      mentionedBy: 0,
      lastUpdated: null,
    },
    ...overrides,
  }
}

const sales = { areaId: 'area_sales', source: 'source' as const }
const marketing = { areaId: 'area_marketing', source: 'source' as const }
const terms: CatalogueTerm[] = [
  term({
    key: 'metric:units_sold',
    name: 'Units sold',
    domain: sales,
    aliases: ['Volume'],
    definition: {
      ref: 'cube:revenue.units_sold',
      name: 'revenue.units_sold',
      title: 'Revenue Units sold',
      descriptionCopy: 'The number of units customers bought.',
      valueType: 'number',
      state: 'current',
      renamedTo: null,
      changedAt: null,
      readAt: '2026-10-07T05:00:00.000Z',
      sourceId: 'cube',
      tool: 'Cube',
    },
  }),
  term({ key: 'metric:orders', name: 'Orders', domain: sales, status: 'active_issues' }),
  term({
    key: 'metric:discount_cost',
    name: 'Discount cost',
    domain: marketing,
    status: 'changed',
  }),
  term({ key: 'metric:shipping_rate', name: 'On-time shipping rate' }),
  term({ key: 'dim:market', name: 'Market', status: 'active_issues' }),
  term({ key: 'dim:channel', name: 'Channel', status: 'no_context' }),
]

const names = (entries: CatalogueEntry[]) =>
  entries.map((entry) => (entry.type === 'group' ? `[${entry.name}]` : entry.term.name))

describe('catalogue search and views', () => {
  it('finds a term by its name, other names, Cube name and description, every word', () => {
    const unitsSold = terms[0]!
    expect(matchesQuery(unitsSold, 'unit')).toBe(true)
    expect(matchesQuery(unitsSold, 'volume')).toBe(true)
    expect(matchesQuery(unitsSold, 'revenue.units_sold')).toBe(true)
    expect(matchesQuery(unitsSold, 'customers bought')).toBe(true)
    expect(matchesQuery(unitsSold, 'customers returned')).toBe(false)
    expect(matchesQuery(unitsSold, '   ')).toBe(true)
  })

  it('ranks the palette results: the whole name, a name that starts so, a word, then the rest', () => {
    const ranked = (query: string, limit = 5) =>
      rankTerms(terms, query, limit).map(({ term, rank }) => `${term.name} ${rank}`)
    expect(ranked('units sold')).toEqual(['Units sold 0'])
    expect(ranked('Volume')).toEqual(['Units sold 0'])
    expect(ranked('un')).toEqual(['Units sold 1', 'Discount cost 3'])
    expect(ranked('shipping rate')).toEqual(['On-time shipping rate 2'])
    expect(ranked('bought')).toEqual(['Units sold 3'])
    expect(ranked('ma')).toEqual(['Market 1'])
    expect(ranked('  ')).toEqual([])
    expect(ranked('o', 2)).toHaveLength(2)
  })

  it('counts each view chip over what the search and filters leave', () => {
    expect(viewCounts(terms)).toEqual({ all: 6, metric: 4, dimension: 2 })
    expect(viewCounts(searchedTerms(terms, { status: 'active_issues' }))).toEqual({
      all: 2,
      metric: 1,
      dimension: 1,
    })
  })

  it('shows one view A to Z, with the filters on', () => {
    expect(visibleTerms(terms, { kind: 'dimension' }).map((t) => t.name)).toEqual([
      'Channel',
      'Market',
    ])
    expect(visibleTerms(terms, { area: 'area_sales' }).map((t) => t.name)).toEqual([
      'Orders',
      'Units sold',
    ])
    expect(visibleTerms(terms, { status: 'changed,no_context' }).map((t) => t.name)).toEqual([
      'Channel',
      'Discount cost',
    ])
  })

  it('takes No domain as the metrics with none: a dimension applies to every domain', () => {
    expect(visibleTerms(terms, { area: 'none' }).map((t) => t.name)).toEqual([
      'On-time shipping rate',
    ])
  })

  it('counts the filters on', () => {
    expect(catalogueFilterCount({})).toBe(0)
    expect(catalogueFilterCount({ status: 'gone,changed', area: 'none', q: 'x' })).toBe(2)
  })

  it('offers the domains that have a term, and No domain while a metric has none', () => {
    const choices = filterDomains(terms, areas, undefined)
    expect(choices.areas.map((area) => area.id)).toEqual(['area_sales', 'area_marketing'])
    expect(choices.noDomain).toBe(true)
    expect(filterDomains(terms.slice(0, 3), areas, 'area_sandbox').areas.map((a) => a.id)).toEqual([
      'area_sales',
      'area_marketing',
      'area_sandbox',
    ])
    expect(filterDomains(terms.slice(0, 3), areas, undefined).noDomain).toBe(false)
  })
})

describe('catalogue grouping (decision 4: grouped by domain, A to Z in Display)', () => {
  it('groups by domain name, then No domain, then All domains for the dimensions', () => {
    expect(names(catalogueEntries(terms, areas, { grouped: true }))).toEqual([
      '[Marketing]',
      'Discount cost',
      '[Sales]',
      'Orders',
      'Units sold',
      '[No domain]',
      'On-time shipping rate',
      '[All domains]',
      'Channel',
      'Market',
    ])
  })

  it('counts each group by kind, and keeps a collapsed group header', () => {
    const entries = catalogueEntries(terms, areas, {
      grouped: true,
      collapsed: new Set(['area_sales']),
    })
    expect(names(entries).slice(0, 4)).toEqual([
      '[Marketing]',
      'Discount cost',
      '[Sales]',
      '[No domain]',
    ])
    const header = entries[2]
    expect(header?.type === 'group' && groupCountText(header)).toBe('2 metrics')
    expect(groupCountText({ metrics: 2, dimensions: 1 })).toBe('2 metrics, 1 dimension')
    expect(groupCountText({ metrics: 0, dimensions: 4 })).toBe('4 dimensions')
  })

  it('puts metrics before dimensions in a domain', () => {
    const mixed = [
      term({ key: 'dim:product', name: 'Product', domain: sales }),
      term({ key: 'metric:units_sold', name: 'Units sold', domain: sales }),
    ]
    expect(names(catalogueEntries(mixed, areas, { grouped: true }))).toEqual([
      '[Sales]',
      'Units sold',
      'Product',
    ])
  })

  it('lists every term A to Z when not grouped', () => {
    expect(names(catalogueEntries(terms, areas, { grouped: false }))).toEqual([
      'Channel',
      'Discount cost',
      'Market',
      'On-time shipping rate',
      'Orders',
      'Units sold',
    ])
  })

  it('names a domain Cube gives that is not one of ours, rather than show an id', () => {
    const domain = termDomainInfo(
      { kind: 'metric', domain: { areaId: 'area_unknown', source: 'source' } },
      areas,
    )
    expect(domain).toEqual({ key: 'area_unknown', name: 'Unknown domain', label: null, none: null })
  })
})

describe('catalogue words', () => {
  it("names the tool the terms' definitions come from, not a source nothing comes from", () => {
    const source = (id: string, tool: string) => ({
      id,
      name: id,
      tool,
      readAt: null,
      sourceVersion: null,
      failing: false,
    })
    const both = [source('cube', 'Cube'), source('demo', 'Demo')]
    expect(catalogueTool({ sources: both, terms })).toBe('Cube')
    expect(catalogueTool({ sources: both, terms: [] })).toBe('the source')
    expect(catalogueTool({ sources: [source('cube', 'Cube')], terms: [] })).toBe('Cube')
    expect(catalogueTool(undefined)).toBe('the source')
  })

  it('names each status, the issue count with it', () => {
    expect(catalogueStatusName('gone', { tool: 'Cube' })).toBe('Gone from Cube')
    expect(catalogueStatusName('changed', { tool: 'Cube' })).toBe('Definition changed')
    expect(catalogueStatusName('changed')).toBe('Definition changed')
    expect(catalogueStatusName('active_issues', { activeIssues: 1 })).toBe('1 active issue')
    expect(catalogueStatusName('active_issues', { activeIssues: 3 })).toBe('3 active issues')
    expect(catalogueStatusName('no_context')).toBe('No context yet')
    expect(catalogueStatusName('in_sync')).toBe('In sync')
  })

  it('says where and when a definition changed in the detail line, not in the status', () => {
    expect(catalogueChangeDetail('Cube', '2026-10-07T05:00:00Z')).toBe(
      'Changed in Cube, 7 Oct 2026',
    )
    expect(catalogueChangeDetail('Cube', null)).toBe('Changed in Cube')
    expect(catalogueChangeDetail(undefined, '2026-10-07T05:00:00Z')).toBe(
      'Changed in the source, 7 Oct 2026',
    )
  })

  it('totals the terms and the domains they name', () => {
    const totals = catalogueTotals(terms)
    expect(totals).toEqual({ terms: 6, metrics: 4, dimensions: 2, domains: 2 })
    expect(termsText(totals)).toBe('6 terms: 4 metrics, 2 dimensions')
    expect(termsText(catalogueTotals(terms.slice(0, 1)))).toBe('1 term')
  })
})

describe('the catalogue over the mock binding (FR-136)', () => {
  it('counts the shelf of the shown terms once per item, as the library does', async () => {
    const catalogue = await api.listCatalogue()
    const library = await api.listLibrary()
    const rows = buildRows(library, { areas, people, vocabulary })
    const all = shelfTotals(rows, catalogue.terms, library.today)
    // Every accepted item names a market or a campaign, so all terms together hold exactly the
    // items of those two.
    const market = catalogue.terms.find((candidate) => candidate.key === 'dim:market')
    const both = catalogue.terms.filter((candidate) =>
      ['dim:market', 'dim:campaign'].includes(candidate.key),
    )
    expect(all.items).toBe(shelfTotals(rows, both, library.today).items)
    expect(all.items).toBe((market?.shelf.items ?? 0) + 1)
    // One issue can be about a metric and a market: added up per term it would count twice.
    const perTerm = catalogue.terms.reduce(
      (sum, candidate) => sum + candidate.shelf.activeIssues,
      0,
    )
    expect(all.activeIssues).toBeLessThan(perTerm)
    expect(all.activeIssues).toBe(market?.shelf.activeIssues)
    const orders = catalogue.terms.filter((candidate) => candidate.key === 'metric:orders')
    expect(shelfTotals(rows, orders, library.today).items).toBe(orders[0]?.shelf.items)
  })
})

describe('catalogue column budget', () => {
  const name = (container: number, gutter: number, grouped: boolean) => {
    const fit = fitCatalogueColumns(container, gutter, { grouped })
    return (
      container -
      gutter * 2 -
      fit.columns.reduce((sum, id) => sum + catalogueColumnSpecs[id].width, 0)
    )
  }

  it('shows Context, Status and Definition changed grouped at 1440 and 1280', () => {
    expect(fitCatalogueColumns(1184, 24, { grouped: true }).columns).toEqual([
      'context',
      'status',
      'changed',
    ])
    expect(fitCatalogueColumns(1024, 24, { grouped: true }).columns).toEqual([
      'context',
      'status',
      'changed',
    ])
  })

  it('adds Domain A to Z: every column from a 1,216 container, Changed leaves first', () => {
    expect(fitCatalogueColumns(1216, 24, { grouped: false }).columns).toEqual([
      'domain',
      'context',
      'status',
      'changed',
    ])
    expect(fitCatalogueColumns(1184, 24, { grouped: false }).columns).toEqual([
      'domain',
      'context',
      'status',
    ])
  })

  it('drops Definition changed on a rail page (1024 wide)', () => {
    expect(fitCatalogueColumns(976, 24, { grouped: true }).columns).toEqual(['context', 'status'])
    expect(fitCatalogueColumns(976, 24, { grouped: false }).columns).toEqual([
      'domain',
      'context',
      'status',
    ])
  })

  it('never lets Name go below its minimum, and becomes the narrow row instead', () => {
    for (const container of [1184, 1024, 976, 900, 800, 760]) {
      for (const grouped of [true, false]) {
        const fit = fitCatalogueColumns(container, 24, { grouped })
        if (!fit.narrow) expect(name(container, 24, grouped)).toBeGreaterThanOrEqual(NAME_MIN_WIDTH)
      }
    }
    expect(fitCatalogueColumns(700, 24, { grouped: false }).narrow).toBe(true)
  })
})

describe('catalogue address', () => {
  it('keeps known values and drops the rest', () => {
    expect(
      validateCatalogueSearch({
        kind: 'metric',
        q: 'dep',
        status: 'gone,in_sync',
        area: 'area_sales',
        order: 'az',
      }),
    ).toEqual({
      kind: 'metric',
      q: 'dep',
      status: 'gone,in_sync',
      area: 'area_sales',
      order: 'az',
    })
    expect(validateCatalogueSearch({ kind: 'dataset', status: 'broken', order: 'za' })).toEqual({
      kind: undefined,
      status: undefined,
      order: undefined,
    })
  })
})

describe('the model file address', () => {
  it('is built only when the folder address and the file are both known', () => {
    const folder = 'https://github.com/acme/analytics/blob/main/model'
    expect(modelFileAddress(folder, 'orders.yml')).toEqual({
      path: 'orders.yml',
      url: `${folder}/orders.yml`,
    })
    // Each segment is encoded; the folder's trailing slash adds no second one.
    expect(modelFileAddress(`${folder}/`, 'views/money in #1.yml')?.url).toBe(
      `${folder}/views/money%20in%20%231.yml`,
    )
    expect(modelFileAddress(null, 'orders.yml')).toEqual({ path: 'orders.yml', url: null })
    expect(modelFileAddress(folder, null)).toBeNull()
  })

  it('is off in the mock when the setting is off', () => {
    const catalogue = mockCatalogue([], { vocabulary, today: FIXTURE_TODAY, modelUrl: null })
    expect(catalogue.get('metric', 'orders')?.modelFile).toEqual({
      path: 'orders.yml',
      url: null,
    })
  })
})
