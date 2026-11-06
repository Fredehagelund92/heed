import { expect, it } from 'vitest'
import { servedWords, type WrittenTerm } from '../../../src/domain/served-terms.ts'
import { createToolService, type ToolResult } from '../../../src/server/mcp/service.ts'
import type { ServedToolName } from '../../../src/server/mcp/tools.ts'
import type { EditionSource, ServingBundle } from '../../../src/server/modules/editions/index.ts'
import { bundle, memoryStore, withRevenue } from './fixtures.ts'

/*
  What get_context, find_context and read_context give of the terms and synonyms people write in
  Definitions (FR-138), on the tool service's own code: the words used, what they mean as a
  person wrote them, who wrote them as a role and when, and the page. The reply's state, items and
  sentences are those the same question gets without them; a synonym of a metric reads as that
  metric. A draft's preview, which reads get_facts, names none.
*/

const peak = '0190f3a2-0000-7000-8000-000000000001'
const words: WrittenTerm[] = [
  {
    id: peak,
    name: 'Peak season',
    meaning: 'The weeks from 1 November to 24 December, when **online sales** double.',
    sameAs: null,
    areaId: 'finance',
    writtenOn: '2026-10-20',
    writtenAs: 'owner',
    conflict: false,
  },
  {
    id: '0190f3a2-0000-7000-8000-000000000002',
    name: 'Busy season',
    meaning: null,
    sameAs: `term:${peak}`,
    areaId: 'finance',
    writtenOn: '2026-10-21',
    writtenAs: 'owner',
    conflict: false,
  },
  {
    id: '0190f3a2-0000-7000-8000-000000000003',
    name: 'Purchases',
    meaning: null,
    sameAs: 'metric:orders',
    areaId: 'finance',
    writtenOn: '2026-10-22',
    writtenAs: 'administrator',
    conflict: false,
  },
]

function withTerms(data: ServingBundle, written = words): ServingBundle {
  const served = servedWords(data.terms, written, data.stopped)
  return { ...data, terms: served.vocabulary, written: served.written }
}
function setup(data: ServingBundle) {
  const memory = memoryStore()
  const source: EditionSource = {
    bundle: () => Promise.resolve(data),
    policy: () =>
      Promise.resolve({
        client: null,
        tools: [],
        limits: {},
        rates: { person: 30, client: 120 },
        about: '',
      }),
  }
  const execute = createToolService(
    source,
    memory.store,
    () => new Date('2026-10-07T12:34:56Z'),
    undefined,
    'https://heed.example',
  )
  return (name: ServedToolName, input: unknown) =>
    execute(
      name,
      input,
      {
        client: 'claude-code',
        scopes: ['read', 'feedback'],
        caller: 'agent',
        canSelectEdition: false,
      },
      100000,
      () => {},
    )
}
const content = (result: ToolResult) => result.structuredContent
/** A reply without what changes from one call to the next, nor what the terms add. */
const same = (result: ToolResult) => {
  const { reply_id: _id, terms: _terms, next, ...rest } = content(result)
  const kept = typeof next === 'string' ? next.replace(/ ?terms says .*$/, '') : next
  return { ...rest, next: kept || undefined }
}

const peakEntry = {
  word: 'peak season',
  name: 'Peak season',
  kind: 'term',
  meaning: 'The weeks from 1 November to 24 December, when **online sales** double.',
  domain: 'Finance',
  written: { role: 'the owner of Finance', date: '2026-10-20' },
  url: 'https://heed.example/definitions/Peak%20season',
}

it('names the terms of the question, and answers as the same question does without them', async () => {
  const plain = setup(bundle())
  const call = setup(withTerms(bundle()))
  for (const response_format of ['concise', 'full'] as const) {
    const ask = { question: 'Orders in Norway in peak season 2026', response_format }
    const before = await plain('get_context', ask)
    const after = await call('get_context', ask)
    expect(same(after)).toEqual(same(before))
    expect(content(after).status).toBe(content(before).status)
    expect(content(after).terms).toEqual([peakEntry])
    expect(content(after).next).toMatch(/never give a term as a checked source\.$/)
    expect(Object.keys(content(after))).toEqual(
      expect.arrayContaining(['status', 'say', 'asked', 'context', 'terms', 'reply_id', 'edition']),
    )
    // The reply's text says where a person reads it, and who wrote it.
    expect(after.content.at(-1)!.text).toContain(
      'Open in Heed - Peak season: https://heed.example/definitions/Peak%20season - Written 20 Oct 2026 by the owner of Finance, in Definitions.',
    )
  }
})

it('reads a synonym of a metric as that metric, and a synonym of a term as the term', async () => {
  const call = setup(withTerms(bundle()))
  const bought = await call('get_context', {
    question: 'Why did purchases in Norway drop in busy season 2026?',
  })
  const orders = await call('get_context', {
    question: 'Why did orders in Norway drop in busy season 2026?',
  })
  expect(same(bought)).toEqual(same(orders))
  expect(content(bought).context).toEqual([expect.objectContaining({ id: 'itm_norway01' })])
  expect(content(bought).terms).toEqual([
    {
      word: 'purchases',
      name: 'Orders',
      kind: 'metric',
      synonym: true,
      domain: 'Finance',
      written: { role: 'an admin', date: '2026-10-22' },
      url: 'https://heed.example/definitions/Orders',
    },
    { ...peakEntry, word: 'busy season', synonym: true },
  ])
  // Without the synonym the word is no name: only Norway is read, and nothing applies to it.
  const plain = await setup(bundle())('get_context', {
    question: 'Why did purchases in Norway drop in 2026?',
  })
  expect(content(plain)).toMatchObject({ status: 'no_match', context: [] })
})

it('never makes a term on its own checked', async () => {
  const call = setup(withTerms(bundle()))
  const meaning = await call('get_context', { question: 'What does peak season mean?' })
  expect(content(meaning).status).toBe('need_more_detail')
  expect(content(meaning).context).toEqual([])
  expect(content(meaning).terms).toEqual([peakEntry])
  expect(same(meaning)).toEqual(
    same(await setup(bundle())('get_context', { question: 'What does peak season mean?' })),
  )
})

it('names the terms of a query and of an item, and none in a preview', async () => {
  const data = withTerms(bundle())
  data.items[0] = { ...data.items[0]!, body: 'Sales in Peak Season are at risk.' }
  const call = setup(data)
  const found = await call('find_context', { query: 'busy season' })
  expect(content(found).terms).toEqual([{ ...peakEntry, word: 'busy season', synonym: true }])
  expect(content(found).next).toContain('never give a term as a checked source')
  const read = await call('read_context', { id: 'itm_norway01' })
  expect(content(read).terms).toEqual([{ ...peakEntry, word: 'Peak Season' }])
  expect(content(read).next).toContain('never give a term as a checked source')
  // A synonym of a metric names it for find_context, as one of its other names.
  const bought = await call('find_context', { query: 'purchases' })
  expect(content(bought).definitions).toEqual([
    expect.objectContaining({ key: 'metric:orders', other_names: ['Purchases'] }),
  ])
  const preview = content(
    await call('get_facts', { question: 'Why did purchases in Norway drop in peak season 2026?' }),
  )
  expect(preview).not.toHaveProperty('terms')
  expect(JSON.stringify(preview)).not.toContain('never give a term')
  expect(content(await call('get_facts', { question: 'Purchases in Norway 2026' })).items).toEqual([
    expect.objectContaining({ id: 'itm_norway01' }),
  ])
})

it('serves no term of a stopped domain, and none in conflict', async () => {
  const stopped = bundle()
  stopped.stopped = { all: false, areas: ['finance'], items: [] }
  const call = setup(withTerms(stopped))
  const reply = content(await call('get_context', { question: 'Orders in peak season 2026' }))
  expect(reply).not.toHaveProperty('terms')
  const conflicted = setup(
    withTerms(
      bundle(),
      words.map((w) => ({ ...w, conflict: true })),
    ),
  )
  const asked = content(await conflicted('get_context', { question: 'Purchases in peak season' }))
  expect(asked).not.toHaveProperty('terms')
  expect(asked.status).toBe('need_more_detail')
})

/*
  A read gave a person's word to a second metric (FR-138): Sales was written for Net revenue, and
  then a source gave Sales to Gross sales. The reply never answers Checked about one of them.
*/
const sales: WrittenTerm = {
  id: '0190f3a2-0000-7000-8000-000000000004',
  name: 'Sales',
  meaning: null,
  sameAs: 'metric:net_revenue',
  areaId: 'finance',
  writtenOn: '2026-10-22',
  writtenAs: 'owner',
  conflict: true,
  alsoMeans: ['metric:gross_sales'],
}

it('asks which one a contested word means, and looks nothing up', async () => {
  const call = setup(withTerms(withRevenue(bundle()), [sales]))
  for (const response_format of ['concise', 'full'] as const) {
    const reply = content(
      await call('get_context', { question: 'sales last month', response_format }),
    )
    expect(reply.status).toBe('need_more_detail')
    expect(reply.say).toBe(
      'Nothing was looked up yet. Sales can mean Net revenue or Gross sales. Which do you mean?',
    )
    expect(reply.next).toBe(
      'Ask the person which one they mean, then call again with that metric in metrics (metric:net_revenue or metric:gross_sales). Never choose one yourself.',
    )
    expect(reply.options).toEqual([
      {
        field: 'scope',
        input: 'sales',
        options: ['metric:gross_sales', 'metric:net_revenue'],
        word: 'Sales',
        meanings: [
          { key: 'metric:net_revenue', name: 'Net revenue' },
          { key: 'metric:gross_sales', name: 'Gross sales' },
        ],
      },
    ])
    expect(reply.context).toEqual([])
  }
})

it('lets a metric a caller passes win over the word, as an agent that knows what it means', async () => {
  const call = setup(withTerms(withRevenue(bundle()), [sales]))
  const reply = content(
    await call('get_context', { question: 'sales last month', metrics: ['metric:gross_sales'] }),
  )
  expect(reply.status).not.toBe('need_more_detail')
  expect(reply.asked).toMatch(/^Gross sales/)
})

it('adds no sentence about other metrics when two sources share a name', async () => {
  const data = withRevenue(bundle())
  const shared = {
    ...data,
    terms: data.terms.map((term) =>
      term.key === 'metric:net_revenue' || term.key === 'metric:gross_sales'
        ? { ...term, aliases: [...term.aliases, 'Sales'] }
        : term,
    ),
  }
  const reply = content(await setup(shared)('get_context', { question: 'sales last month' }))
  expect(reply.say).toBe(
    'Nothing was looked up yet. Sales can mean Gross sales or Net revenue. Which do you mean?',
  )
})

it('reads a word that only reads as another, accents aside, as that word', async () => {
  const accent = { ...sales, id: '0190f3a2-0000-7000-8000-000000000005', conflict: false }
  const call = setup(
    withTerms(withRevenue(bundle()), [
      { ...accent, alsoMeans: [] },
      { ...accent, id: '0190f3a2-0000-7000-8000-000000000006', name: 'Salés', alsoMeans: [] },
    ]),
  )
  const reply = content(await call('get_context', { question: 'sales last month' }))
  expect(reply.asked).toMatch(/^Net revenue/)
})
