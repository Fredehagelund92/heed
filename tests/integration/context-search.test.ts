import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createToolService } from '../../src/server/mcp/service.ts'
import type { AnonymousRecord } from '../../src/server/mcp/records.ts'
import { loadLiveBundle, type ServingBundle } from '../../src/server/modules/editions/index.ts'
import { regression } from '../../db/seed/fixtures/items.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  What find_context finds in the demo library (the 1,500 fixture items, bulk seeded), for the
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
  context: { id: string; title: string; match?: 'all' | 'some' }[]
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
    'find_context',
    { response_format: 'full', ...input },
    { client: 'assistant', scopes: ['read'], caller: 'eval', canSelectEdition: false },
    100_000,
    (r) => records.push(r),
  )
  expect(reply.isError).not.toBe(true)
  return reply.structuredContent as Found
}
const areaOf = (id: string) => bundle.items.find((i) => i.id === id)?.areaId

describe('find_context on the demo library', () => {
  it('finds the net revenue items by the metric name', async () => {
    const found = await search({ query: 'net revenue' })
    expect(found.status).toBe('matched')
    expect(found.query_used.terms).toEqual(['metric:net_revenue'])
    expect(found.check_report.matched).toBeGreaterThan(20)
    expect(found.context.length).toBe(10)
    expect(found.context.every((i) => i.match === 'all')).toBe(true)
    // Every hit is about net revenue: in its scope or its words.
    for (const hit of found.context) {
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
    expect(found.context[0]).toMatchObject({
      title: 'Net revenue excludes test accounts',
      match: 'all',
    })
    expect(found.query_used.words).toEqual(['excludes', 'test', 'accounts'])
    const singular = await search({ query: 'net revenue exclude test account', limit: 5 })
    expect(singular.context[0]!.title).toBe('Net revenue excludes test accounts')
  })

  it('finds the regression note from the first question: net revenue in Spain, October 2026', async () => {
    // get_context rightly delivers nothing (the note ended on 30 September); search finds it.
    const found = await search({ query: 'How is net revenue in Spain doing in October 2026?' })
    expect(found.query_used.terms).toEqual(['metric:net_revenue', 'val:market/spain'])
    expect(found.query_used.ignored).toEqual(expect.arrayContaining(['how', 'in', 'is', 'doing']))
    expect(found.context.map((i) => i.id)).toContain(regression.item)
    const scoped = await search({ query: 'net revenue Spain' })
    expect(scoped.context.find((i) => i.id === regression.item)?.match).toBe('all')
  })

  it('reads a domain name as the domain, in the query or as the area filter', async () => {
    const found = await search({ query: 'Sales' })
    expect(found.query_used.domains).toEqual(['area_sales'])
    expect(found.domains).toEqual([
      expect.objectContaining({
        id: 'area_sales',
        name: 'Sales',
        summary: expect.stringMatching(/^Orders, revenue and the basket/) as string,
      }),
    ])
    expect(found.domains![0]!.items).toBeGreaterThan(100)
    expect(found.context.length).toBe(10)
    // A named domain matches its own facts and the facts that name it ("online sales stopped").
    const ofSalesOrNamingIt = ({ id }: { id: string }) => {
      const item = bundle.items.find((i) => i.id === id)
      return (
        item?.areaId === 'area_sales' ||
        /\bsales\b/i.test(`${item?.title} ${item?.summary} ${item?.body ?? ''}`)
      )
    }
    expect(found.context.every(ofSalesOrNamingIt)).toBe(true)
    expect(found.context.some((i) => areaOf(i.id) === 'area_sales')).toBe(true)

    const question = await search({ query: 'What does the Sales domain cover?' })
    expect(question.domains?.[0]?.id).toBe('area_sales')
    expect(question.query_used.ignored).toEqual(
      expect.arrayContaining(['what', 'does', 'the', 'domain']),
    )
    expect(question.context.slice(0, 10).every(ofSalesOrNamingIt)).toBe(true)

    const byName = await search({ query: 'orders', domain: 'Sales' })
    const byId = await search({ query: 'orders', domain: 'area_sales' })
    expect(byName.context).toEqual(byId.context)
    expect((await search({ query: 'orders', domain: 'the sales domain' })).context).toEqual(
      byId.context,
    )
  })

  it('names the domains when a domain is unknown, instead of finding nothing', async () => {
    const found = await search({ query: 'net revenue', domain: 'Finance' })
    expect(found.status).toBe('need_more_detail')
    expect(found.domains).toContainEqual(expect.objectContaining({ id: 'area_sales' }))
  })

  it('says it found nothing, and what to try, for words no item holds', async () => {
    const found = await search({ query: 'newest edition' })
    expect(found).toMatchObject({ status: 'no_match', context: [] })
  })

  it('says it found nothing for a query of only ignored words', async () => {
    const found = await search({ query: 'what is it' })
    expect(found).toMatchObject({ status: 'no_match', context: [] })
  })

  it('records nothing: the words live only in the call', () => {
    expect(records).toEqual([])
  })
})
