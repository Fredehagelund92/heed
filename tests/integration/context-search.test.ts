import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createToolService, searchHint } from '../../src/server/mcp/service.ts'
import type { AnonymousRecord } from '../../src/server/mcp/records.ts'
import { editionDomains } from '../../src/server/mcp/outcomes.ts'
import { loadLiveBundle, type ServingBundle } from '../../src/server/modules/editions/index.ts'
import { regression } from '../../db/seed/fixtures/items.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  What search_facts finds in the demo library (the 1,500 fixture items, bulk seeded), for the
  words people and models actually use: the questions of the first real-model test, which found
  nothing for "net revenue", "Sales" and the Sales domain although the library holds
  them. Deterministic: no model, and nothing recorded.
*/

const { url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
let bundle: ServingBundle
const records: AnonymousRecord[] = []

beforeAll(async () => {
  bundle = (await database.transaction(null, loadLiveBundle))!
}, 300_000)
afterAll(() => database.close())

type Found = {
  status: string
  items: { id: string; title: string; match?: 'all' | 'some' }[]
  query_used: { domains: string[]; terms: string[]; words: string[]; ignored: string[] }
  domains?: { id: string; name: string; summary?: string; items: number }[]
  options?: { field: string; input: string; options: string[] }[]
  check_report: { matched: number; statements: string[] }
}
async function search(input: Record<string, unknown>): Promise<Found> {
  const execute = createToolService(
    {
      bundle: () => Promise.resolve(bundle),
      policy: () =>
        Promise.resolve({
          client: null,
          tools: [],
          limits: {},
          rates: { person: 30, client: 120 },
          about: '',
        }),
    },
    {
      write: () => Promise.reject(new Error('no demand')),
      reportGap: () => Promise.reject(new Error('no demand')),
      feedback: () => Promise.reject(new Error('no demand')),
    },
    () => new Date('2026-10-12T12:00:00Z'),
  )
  const reply = await execute(
    'search_facts',
    input,
    { client: 'assistant', scopes: ['read'], caller: 'eval', canSelectEdition: false },
    100_000,
    (r) => records.push(r),
  )
  expect(reply.isError).not.toBe(true)
  return reply.structuredContent as Found
}
const areaOf = (id: string) => bundle.items.find((i) => i.id === id)?.areaId

describe('search_facts on the demo library', () => {
  it('finds the net revenue items by the metric name', async () => {
    const found = await search({ query: 'net revenue' })
    expect(found.status).toBe('matched')
    expect(found.query_used.terms).toEqual(['metric:net_revenue'])
    expect(found.check_report.matched).toBeGreaterThan(20)
    expect(found.items.length).toBe(20)
    expect(found.items.every((i) => i.match === 'all')).toBe(true)
    // Every hit is about net revenue: in its scope or its words.
    for (const hit of found.items) {
      const item = bundle.items.find((i) => i.id === hit.id)!
      expect(
        item.scope.metrics.includes('metric:net_revenue') ||
          `${item.title} ${item.summary}`.toLowerCase().includes('net revenue'),
        hit.id,
      ).toBe(true)
    }
  })

  it('puts the exact title first and reads words with light stemming', async () => {
    const found = await search({ query: 'Net revenue excludes test accounts', limit: 5 })
    expect(found.items[0]).toMatchObject({
      title: 'Net revenue excludes test accounts',
      match: 'all',
    })
    expect(found.query_used.words).toEqual(['excludes', 'test', 'accounts'])
    const singular = await search({ query: 'net revenue exclude test account', limit: 5 })
    expect(singular.items[0]!.title).toBe('Net revenue excludes test accounts')
  })

  it('finds the regression note from the first question: net revenue in Spain, October 2026', async () => {
    // get_facts rightly delivers nothing (the note ended on 30 September); search finds it.
    const found = await search({ query: 'How is net revenue in Spain doing in October 2026?' })
    expect(found.query_used.terms).toEqual(['metric:net_revenue', 'val:market/spain'])
    expect(found.query_used.ignored).toEqual(expect.arrayContaining(['how', 'in', 'is', 'doing']))
    expect(found.items.map((i) => i.id)).toContain(regression.item)
    const scoped = await search({ query: 'net revenue Spain' })
    expect(scoped.items.find((i) => i.id === regression.item)?.match).toBe('all')
  })

  it('reads a domain name as the domain, in the query or as the area filter', async () => {
    const found = await search({ query: 'Sales' })
    expect(found.query_used.domains).toEqual(['area_sales'])
    expect(found.domains).toEqual([
      {
        id: 'area_sales',
        name: 'Sales',
        summary: expect.stringMatching(/^Orders, revenue and the basket/) as string,
        items: expect.any(Number) as number,
      },
    ])
    expect(found.domains![0]!.items).toBeGreaterThan(100)
    expect(found.items.length).toBe(20)
    // A named domain matches its own facts and the facts that name it ("online sales stopped").
    const ofSalesOrNamingIt = ({ id }: { id: string }) => {
      const item = bundle.items.find((i) => i.id === id)
      return (
        item?.areaId === 'area_sales' ||
        /\bsales\b/i.test(`${item?.title} ${item?.summary} ${item?.body ?? ''}`)
      )
    }
    expect(found.items.every(ofSalesOrNamingIt)).toBe(true)
    expect(found.items.some((i) => areaOf(i.id) === 'area_sales')).toBe(true)

    const question = await search({ query: 'What does the Sales domain cover?' })
    expect(question.domains?.[0]?.id).toBe('area_sales')
    expect(question.query_used.ignored).toEqual(
      expect.arrayContaining(['what', 'does', 'the', 'domain']),
    )
    expect(question.items.slice(0, 10).every(ofSalesOrNamingIt)).toBe(true)

    const byName = await search({ query: '', area: 'Sales' })
    const byId = await search({ query: '', area: 'area_sales' })
    expect(byName.items).toEqual(byId.items)
    expect(byName.check_report.matched).toBe(found.domains![0]!.items)
    expect((await search({ query: '', area: 'the sales domain' })).items).toEqual(byId.items)
  })

  it('names the domains when an area is unknown, instead of finding nothing', async () => {
    const found = await search({ query: 'net revenue', area: 'Finance' })
    expect(found.status).toBe('need_more_detail')
    expect(found.options).toHaveLength(1)
    expect(found.options![0]).toMatchObject({ field: 'area', input: 'Finance' })
    expect(found.options![0]!.options).toContain('area_sales')
    expect(found.domains).toContainEqual({ id: 'area_sales', name: 'Sales' })
  })

  it('says it found nothing, and what to try, for words no item holds', async () => {
    const found = await search({ query: 'newest edition' })
    expect(found).toMatchObject({ status: 'no_match', items: [] })
    expect(found.check_report.statements).toContain(searchHint)
  })

  it('says it found nothing for a query of only ignored words, but lists for an empty one', async () => {
    const found = await search({ query: 'what is it' })
    expect(found).toMatchObject({ status: 'no_match', items: [] })
    expect(found.check_report.statements).toContain(searchHint)
    expect((await search({ query: '', area: 'Sales' })).status).toBe('matched')
  })

  it('records nothing: the words live only in the call', () => {
    expect(records).toEqual([])
  })
})

describe('the domain list the assistant reads', () => {
  it('lists each domain with a line on it, and the metric and dimension names', async () => {
    const overview = editionDomains(bundle, '2026-10-12')
    expect(overview.domains.map((d) => d.name)).toEqual([
      'Customer value',
      'Marketing',
      'Paid media',
      'Sales',
      'Sandbox',
    ])
    const commercial = overview.domains.find((d) => d.id === 'area_sales')!
    expect(commercial.summary).toMatch(/^Orders, revenue and the basket/)
    expect(commercial.holds).toMatch(/^\d+ items, mostly about /)
    const commercialSearch = await search({ query: 'Sales' })
    expect(commercial.items).toBe(commercialSearch.domains![0]!.items)
    // Every domain is served: nothing says whether one is live.
    expect(JSON.stringify(overview.domains)).not.toMatch(/live|not started|starting/)
    // Each metric names its domain, so its domain's metrics are never mistaken for everyone's.
    expect(overview.metrics).toContainEqual({
      key: 'metric:net_revenue',
      name: 'Net revenue',
      domain: 'Sales',
      group: 'Revenue',
    })
    const market = overview.dimensions.find((d) => d.key === 'dim:market')!
    expect('values' in market && market.values).toContain('Spain')
    const campaign = overview.dimensions.find((d) => d.key === 'dim:campaign')!
    expect(campaign).toMatchObject({ value_count: 2400 })
    expect(campaign).not.toHaveProperty('values')
    // Small enough to read whole in one tool result.
    expect(JSON.stringify(overview).length).toBeLessThan(12_000)
  })
})
