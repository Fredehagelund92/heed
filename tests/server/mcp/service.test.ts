import { describe, expect, it } from 'vitest'
import { createToolService, byteSize, groupInstruction } from '../../../src/server/mcp/service.ts'
import { outgoing } from '../../../src/domain/links.ts'
import { createAnonymousQueue, type AnonymousRecord } from '../../../src/server/mcp/records.ts'
import type { EditionSource, ServingItem } from '../../../src/server/modules/editions/index.ts'
import { toolSchemaDigest, type ServedToolName } from '../../../src/server/mcp/tools.ts'
import { bundle, fakeReads, memoryStore, withRevenue } from './fixtures.ts'

function setup() {
  const data = bundle(),
    memory = memoryStore(),
    records: AnonymousRecord[] = []
  const editions: (string | undefined)[] = []
  const source: EditionSource = {
    bundle(edition) {
      editions.push(edition)
      return Promise.resolve(data)
    },
    policy() {
      return Promise.resolve({
        client: null,
        tools: [],
        limits: {},
        rates: { person: 30, client: 120 },
        about: '',
      })
    },
  }
  const execute = createToolService(source, memory.store, () => new Date('2026-10-07T12:34:56Z'))
  const call = (name: ServedToolName, input: unknown, privileged = false) =>
    execute(
      name,
      input,
      {
        client: 'claude-code',
        scopes: ['read', 'feedback'],
        caller: 'agent',
        canSelectEdition: privileged,
      },
      100000,
      (r) => records.push(r),
    )
  return { ...memory, data, records, editions, call }
}
const question = 'Orders Norway August 2026'
/** How the fixture's item was reviewed, in the reply's words (FR-326). */
const reviewedSentence = 'Accepted 4 Aug 2026 by the owner of Finance, in edition 2026-08-04.1.'

it('cuts links before items, respects multibyte budgets and never mutates the cached edition', async () => {
  const s = setup()
  for (let n = 0; n < 8; n++) {
    const id = `metric:m${n}`
    s.data.terms.push({
      ...s.data.terms[0]!,
      key: id,
      name: 'Very long descriptive label '.repeat(20),
    })
    s.data.links.push({
      from_item: s.data.items[0]!.id,
      rel: 'mentions',
      to_kind: 'metric',
      to_id: id,
      label: 'label',
    })
  }
  const saved = JSON.stringify(s.data)
  // Room for the item without its links, its sentence (FR-344), how the dates were read, how it
  // was reviewed (FR-326) and its domain's summary line, but not for one more link.
  const reply = await s.call('get_facts', { question, max_bytes: 5000 })
  expect(reply.isError).not.toBe(true)
  expect(byteSize(reply)).toBeLessThanOrEqual(5000)
  expect(reply.structuredContent).toMatchObject({
    items: [{ id: 'itm_norway01', links: [] }],
    check_report: { cut: true, cut_ids: [] },
  })
  // The domain's description went first; its summary line stays.
  expect(reply.structuredContent.domains).toEqual([
    { id: 'finance', name: 'Finance', summary: 'Orders and returns, by market.' },
  ])
  expect(JSON.stringify(s.data)).toBe(saved)
  // With room, the full reply gives the domain's description too.
  expect((await s.call('get_facts', { question })).structuredContent.domains).toEqual([
    {
      id: 'finance',
      name: 'Finance',
      summary: 'Orders and returns, by market.',
      description: 'Finance covers **orders** and returns, by market and payment provider.',
    },
  ])
  const tiny = await s.call('get_facts', { question, max_bytes: 1000 })
  expect(byteSize(tiny)).toBeLessThanOrEqual(1000)
  expect(tiny.structuredContent.status).toBe('check_failed')
})

it('cuts the items past max_items before links, and keeps the link that names the source last', async () => {
  const s = setup(),
    item = s.data.items[0]!
  // Eight items about Orders, each with seven long links besides the one to Orders.
  for (let n = 0; n < 7; n++) {
    const id = `metric:m${n}`
    s.data.terms.push({ ...s.data.terms[0]!, key: id, name: 'Long label '.repeat(20) })
  }
  for (let i = 1; i < 8; i++) {
    s.data.items.push({ ...item, id: `itm_norway0${i + 1}` })
    s.data.links.push({ ...s.data.links[0]!, from_item: `itm_norway0${i + 1}` })
  }
  for (const { id: from } of s.data.items)
    for (let n = 0; n < 7; n++)
      s.data.links.push({
        from_item: from,
        rel: 'applies_to',
        to_kind: 'metric',
        to_id: `metric:m${n}`,
        label: null,
      })
  const links = (reply: Awaited<ReturnType<typeof s.call>>) =>
    (reply.structuredContent.items as { links: { rel: string; target: { id: string } }[] }[]).map(
      (i) => i.links.map((l) => `${l.rel} ${l.target.id}`),
    )
  const all = await s.call('get_facts', { question })
  const two = await s.call('get_facts', { question, max_items: 2 })
  // The two delivered items fit with all their links: the six cut first cost them none.
  const fits = byteSize(two)
  expect(byteSize(all)).toBeGreaterThan(fits)
  const tight = await s.call('get_facts', { question, max_items: 2, max_bytes: fits })
  expect(links(tight)).toEqual(links(two))
  expect(links(two)[0]).toHaveLength(8)
  expect(tight.structuredContent.check_report).toMatchObject({
    cut: true,
    cut_ids: ['itm_norway08', 'itm_norway07', 'itm_norway06'].concat([
      'itm_norway05',
      'itm_norway04',
      'itm_norway03',
    ]),
  })
  // One byte shorter: the domain's description goes first, and every link stays.
  const brief = await s.call('get_facts', { question, max_items: 2, max_bytes: fits - 1 })
  expect(links(brief)).toEqual(links(two))
  expect(brief.structuredContent.domains).toEqual([
    { id: 'finance', name: 'Finance', summary: 'Orders and returns, by market.' },
  ])
  // Shorter still: the link that names where Orders is defined is the one left.
  const five = await s.call('get_facts', {
    question,
    max_items: 2,
    max_bytes: byteSize(brief) - 1,
  })
  expect(links(five).map((l) => [l.length, l.at(-1)])).toEqual([
    [5, 'mentions metric:orders'],
    [5, 'mentions metric:orders'],
  ])
  const shorter = byteSize(five) - 1
  const origin = await s.call('get_facts', { question, max_items: 2, max_bytes: shorter })
  expect(links(origin)).toEqual([['mentions metric:orders'], ['mentions metric:orders']])
  expect(byteSize(origin)).toBeLessThanOrEqual(shorter)
})

it('lists removed items in resolver order and labels partial matches', async () => {
  const s = setup(),
    item = s.data.items[0]!
  s.data.items.push({ ...item, id: 'itm_partial001', riskLevel: 'high' })
  s.data.items[0] = {
    ...item,
    scope: { metrics: item.scope.metrics, dimensions: [], dimensionValues: [] },
  }
  const reply = await s.call('get_facts', { question: 'Orders August 2026', max_items: 1 })
  expect(reply.structuredContent).toMatchObject({
    items: [{ id: item.id, match: 'exact' }],
    check_report: { cut_ids: ['itm_partial001'] },
  })
  const full = await s.call('get_facts', { question: 'Orders August 2026' })
  const partial = (
    full.structuredContent.items as { id: string; match: string; applies_note?: string }[]
  ).find((i) => i.id === 'itm_partial001')
  expect(partial?.match).toBe('partial')
  expect(partial?.applies_note).toContain('norway')
})

it('links never pull unrelated items into the delivery and hidden targets reveal no metadata', async () => {
  const s = setup(),
    item = s.data.items[0]!
  const hidden: ServingItem = {
    ...item,
    id: 'itm_hidden0001',
    title: 'PRIVATE target',
    audience: { kind: 'groups' as const, groups: ['secret'] },
  }
  s.data.items.push(hidden)
  s.data.links.push({
    from_item: item.id,
    rel: 'mentions',
    to_kind: 'item',
    to_id: hidden.id,
    label: 'Authored label',
  })
  const reply = await s.call('get_facts', { question })
  expect(JSON.stringify(reply)).not.toContain('PRIVATE')
  expect(JSON.stringify(reply)).not.toContain(hidden.id)
  expect(reply.structuredContent).toMatchObject({ check_report: { links_withheld: 1 } })
  expect((await s.call('read_item', { id: hidden.id })).structuredContent).toMatchObject({
    message: 'Not found',
  })
  const search = await s.call('search_facts', { mentions: hidden.id })
  expect(search.structuredContent.items).toEqual([])
  hidden.audience = { kind: 'everyone' }
  hidden.scope = { metrics: ['metric:other'], dimensions: [], dimensionValues: [] }
  expect((await s.call('get_facts', { question })).structuredContent.items).toHaveLength(1)
})

it('hides stopped, inactive, overdue high-risk and out-of-window targets; preserves safe tombstones', () => {
  const data = bundle(),
    item = data.items[0]!
  const target = { ...item, id: 'itm_target0001' }
  data.items.push(target)
  data.links = [
    {
      from_item: item.id,
      rel: 'mentions',
      to_kind: 'item',
      to_id: target.id,
      label: 'Author wording',
    },
  ]
  const inspect = () =>
    outgoing(data, item, '2026-10-07', { start: '2026-08-01', end: '2026-09-01' })
  data.stopped.items = [target.id]
  expect(inspect().withheld).toBe(1)
  data.stopped.items = []
  target.reviewDate = '2025-01-01'
  target.riskLevel = 'high'
  expect(inspect().withheld).toBe(1)
  target.riskLevel = 'normal'
  target.validity = { start: '2026-10-01', end: null }
  expect(inspect().withheld).toBe(1)
  data.items.pop()
  data.retired.push({
    id: target.id,
    areaId: 'finance',
    audience: null,
    validity: item.validity,
    replacedBy: null,
  })
  expect(inspect().links).toContainEqual({
    rel: 'mentions',
    target: { type: 'item', id: target.id, label: 'Author wording', status: 'retired' },
  })
  data.stopped = { all: false, areas: ['finance'], items: [] }
  expect(inspect().links).toEqual([])
})

it('describes changed and missing source definitions without copying calculations or content', () => {
  const data = bundle(),
    item = data.items[0]!
  const definition = data.terms[0]!.definitions[0]!
  definition.changeMark = '2'
  expect(outgoing(data, item, '2026-10-07').links[0]).toMatchObject({
    target: { label: 'Orders', status: 'source_changed' },
  })
  definition.missing = true
  definition.renamedTo = 'cube:finance.net_orders'
  expect(outgoing(data, item, '2026-10-07').links[0]).toMatchObject({
    target: { status: 'source_missing', renamed_to: 'cube:finance.net_orders' },
  })
})

it('compares a mention with the mark it recorded, not with the references of the item', () => {
  const data = bundle(),
    item = data.items[0]!
  // The item references nothing, so only the mention's own mark can tell it changed.
  data.refMarks = {}
  data.terms[0]!.definitions[0]!.changeMark = '2'
  expect(outgoing(data, item, '2026-10-07').links[0]).toMatchObject({
    target: { status: 'source_changed' },
  })
  // An owner repaired a rename by pointing the term at another definition: current again.
  data.terms[0] = {
    ...data.terms[0]!,
    definitionRefs: ['cube:finance.net_orders'],
    definitions: [
      {
        ref: 'cube:finance.net_orders',
        missing: false,
        renamedTo: null,
        changeMark: '9',
      },
    ],
  }
  expect(outgoing(data, item, '2026-10-07').links[0]).toMatchObject({
    target: { status: 'current', source_ref: 'cube:finance.net_orders' },
  })
})

it('pages searches and backlinks and rejects a cursor after the overlay changes', async () => {
  const s = setup(),
    item = s.data.items[0]!
  for (let n = 0; n < 25; n++) {
    const id = `itm_backlink${String(n).padStart(2, '0')}`
    s.data.items.push({ ...item, id })
    s.data.links.push({
      from_item: id,
      rel: 'mentions',
      to_kind: 'item',
      to_id: item.id,
      label: item.title,
    })
  }
  const first = await s.call('search_facts', { limit: 10 })
  expect(first.structuredContent.items).toHaveLength(10)
  const second = await s.call('search_facts', {
    limit: 10,
    cursor: first.structuredContent.next_cursor,
  })
  expect(second.structuredContent.items).toHaveLength(10)
  expect(second.structuredContent.items).not.toEqual(first.structuredContent.items)
  const read = await s.call('read_item', { id: item.id })
  expect(read.structuredContent.backlinks).toMatchObject({ count: 25 })
  expect((read.structuredContent.backlinks as { items: unknown[] }).items).toHaveLength(20)
  const next = await s.call('read_item', {
    id: item.id,
    cursor: read.structuredContent.next_cursor,
  })
  expect((next.structuredContent.backlinks as { items: unknown[] }).items).toHaveLength(5)
  s.data.overlay = '2'
  expect(
    (await s.call('search_facts', { cursor: first.structuredContent.next_cursor })).isError,
  ).toBe(true)
})

it('restricts historical edition selection and rejects sensitive notes before storing them', async () => {
  const s = setup()
  expect((await s.call('get_facts', { question, edition: s.data.edition })).isError).toBe(true)
  expect(s.editions).toEqual([])
  expect((await s.call('get_facts', { question, edition: s.data.edition }, true)).isError).not.toBe(
    true,
  )
  expect(s.editions).toEqual([s.data.edition])
  expect(
    (await s.call('report_gap', { question, note: 'Contact person@example.test' })).isError,
  ).toBe(true)
  expect(s.gaps).toEqual([])
  expect(
    (await s.call('report_gap', { question, note: 'Missing market comparison.' })).isError,
  ).not.toBe(true)
  expect(s.gaps).toHaveLength(1)
  // FR-602: the question is never stored, so a note may not repeat it; FR-117's check applies too.
  for (const note of [`Asked: ${question.toUpperCase()}!`, 'password: hunter2'])
    expect((await s.call('report_gap', { question, note })).isError, note).toBe(true)
  expect(s.gaps).toHaveLength(1)
})

it('records failed queue writes and bounded overflow without failing delivery', async () => {
  const s = setup(),
    failures: number[] = []
  const queue = createAnonymousQueue(
    { ...s.store, write: () => Promise.reject(new Error('private DB text')) },
    (count) => failures.push(count),
    1,
  )
  await s.call('get_facts', { question })
  queue.enqueue(s.records[0]!)
  queue.enqueue(s.records[0]!)
  await queue.flush()
  expect(failures).toEqual([1, 1])
})

describe('get_related', () => {
  function graph(n: number) {
    const s = setup(),
      item = s.data.items[0]!
    for (let i = 0; i < n; i++) {
      const id = `itm_mention${String(i).padStart(3, '0')}`
      s.data.items.push({ ...item, id, title: `Mentioning item ${i}` })
      s.data.links.push({
        from_item: id,
        rel: 'mentions',
        to_kind: 'metric',
        to_id: 'metric:orders',
        label: 'Orders',
        definition_ref: 'cube:finance.orders',
        change_mark: '1',
      })
    }
    return s
  }

  it('pages neighbours in a fixed order, at most 50 a page, with counts over all of them', async () => {
    const s = graph(60)
    const first = await s.call('get_related', { id: 'metric:orders', max_nodes: 50 })
    expect(first.isError).not.toBe(true)
    const out = first.structuredContent as {
      nodes: { id: string; type: string }[]
      edges: { from: string; to: string; rel: string }[]
      counts: Record<string, number>
      next_cursor: string | null
      check_report: { statements: string[]; links_withheld: number }
      instructions: string
    }
    expect(out.nodes).toHaveLength(50)
    expect(out.counts).toEqual({ mentioned_by: 61 })
    expect(out.check_report.statements[0]).toMatch(/does not mean the item applies/)
    expect(out.instructions).toContain('read_context')
    const second = await s.call('get_related', {
      id: 'metric:orders',
      max_nodes: 50,
      cursor: out.next_cursor,
    })
    const rest = second.structuredContent as typeof out
    expect(rest.nodes).toHaveLength(11)
    expect(rest.next_cursor).toBeNull()
    const ids = [...out.nodes, ...rest.nodes].map((n) => n.id)
    expect(new Set(ids).size).toBe(61)
    // Every edge appears once, on the page that lists its later end.
    const edges = [...out.edges, ...rest.edges].map((e) => `${e.from}>${e.rel}>${e.to}`)
    expect(new Set(edges).size).toBe(edges.length)
    expect(edges).toHaveLength(61)
    // The same input and edition give the same reply (FR-327).
    const again = await s.call('get_related', { id: 'metric:orders', max_nodes: 50 })
    expect(again.structuredContent).toEqual(first.structuredContent)
    expect(
      (await s.call('get_related', { id: 'metric:orders', max_nodes: 51 })).structuredContent,
    ).toMatchObject({ status: 'check_failed' })
    expect(
      (await s.call('get_related', { id: 'metric:orders', depth: 3 })).structuredContent,
    ).toMatchObject({ status: 'check_failed' })
  })

  it('moves what does not fit the byte limit to the next page instead of cutting it', async () => {
    const s = graph(20)
    const reply = await s.call('get_related', { id: 'metric:orders', max_bytes: 8000 })
    expect(byteSize(reply)).toBeLessThanOrEqual(8000)
    const out = reply.structuredContent as { nodes: unknown[]; next_cursor: string | null }
    expect(out.nodes.length).toBeGreaterThan(0)
    expect(out.nodes.length).toBeLessThan(20)
    expect(out.next_cursor).not.toBeNull()
    // Not even one neighbour fits: say so, never return an empty page that repeats its cursor.
    expect((await s.call('get_related', { id: 'metric:orders', max_bytes: 3000 })).isError).toBe(
      true,
    )
  })

  it('answers a hidden start like a missing one, and rejects a cursor from another edition', async () => {
    const s = graph(25)
    const hidden: ServingItem = {
      ...s.data.items[0]!,
      id: 'itm_hidden0001',
      title: 'PRIVATE target',
      audience: { kind: 'groups' as const, groups: ['secret'] },
    }
    s.data.items.push(hidden)
    const missing = await s.call('get_related', { id: 'itm_missing001' })
    const secret = await s.call('get_related', { id: hidden.id })
    expect(secret.structuredContent).toEqual(missing.structuredContent)
    expect(secret.structuredContent).toMatchObject({ status: 'no_match', message: 'Not found' })
    const first = await s.call('get_related', { id: 'metric:orders', max_nodes: 10 })
    s.data.overlay = '2'
    expect(
      (
        await s.call('get_related', {
          id: 'metric:orders',
          max_nodes: 10,
          cursor: first.structuredContent.next_cursor,
        })
      ).isError,
    ).toBe(true)
  })

  it('filters neighbours by dates and relation and pins historical editions to edition scope', async () => {
    const s = graph(2)
    s.data.items[1]!.validity = { start: '2026-09-15', end: null }
    const august = await s.call('get_related', {
      id: 'metric:orders',
      relations: ['mentioned_by'],
      window: { from: '2026-08-01', to: '2026-08-31' },
    })
    expect((august.structuredContent.nodes as { id: string }[]).map((n) => n.id)).toEqual([
      'itm_mention001',
      'itm_norway01',
    ])
    expect(august.structuredContent).toMatchObject({ check_report: { links_withheld: 1 } })
    expect(
      (await s.call('get_related', { id: 'metric:orders', edition: s.data.edition })).isError,
    ).toBe(true)
    expect(
      (await s.call('get_related', { id: 'metric:orders', edition: s.data.edition }, true)).isError,
    ).not.toBe(true)
    // A neighbour list is not a delivery: nothing is recorded (FR-603).
    expect(s.records).toEqual([])
  })
})

describe('an item about any market (FR-126, FR-316)', () => {
  const anyMarket = (s: ReturnType<typeof setup>) => {
    s.data.items[0] = {
      ...s.data.items[0]!,
      scope: { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] },
    }
  }
  const ids = (reply: Awaited<ReturnType<ReturnType<typeof setup>['call']>>) =>
    (reply.structuredContent.items as { id: string; match: string }[]).map((i) => [i.id, i.match])

  it('answers a question about a market, or one that names the market without a value', async () => {
    const s = setup()
    anyMarket(s)
    expect(ids(await s.call('get_facts', { question }))).toEqual([['itm_norway01', 'exact']])
    const byMarket = await s.call('get_facts', {
      question: '',
      metrics: ['Orders'],
      dimension_filters: [{ dimension: 'market', values: [] }],
      window: { from: '2026-08-05', to: '2026-08-05' },
    })
    expect(ids(byMarket)).toEqual([['itm_norway01', 'exact']])
    expect(byMarket.structuredContent.scope_used).toMatchObject({ filters: { 'dim:market': [] } })
  })

  it('stays silent for a question that names no market, and counts the topic as such', async () => {
    const s = setup()
    anyMarket(s)
    const reply = await s.call('get_facts', { question: 'Orders August 2026' })
    expect(reply.structuredContent).toMatchObject({ status: 'no_match', items: [] })
    await s.call('get_facts', { question: 'Orders by market August 2026' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const topics = s.records.flatMap((record) =>
      record.kind === 'delivery' && record.value.topic ? [record.value.topic] : [],
    )
    expect(topics.map((topic) => topic.dimensions)).toContainEqual(['dim:market'])
    expect(topics.map((topic) => topic.dimensions)).toContainEqual([])
  })
})

describe('what a model reads (FR-346)', () => {
  const machine = ['tool_schema_digest', 'overlay', 'ttlMs', 'cacheScope']
  it('keeps what serves a cache or an audit in _meta, out of the text and the structured result', async () => {
    const s = setup()
    // domain_overview and what_changed read owners, gaps and editions beside the edition.
    const execute = createToolService(
      { bundle: () => Promise.resolve(s.data), policy: () => Promise.reject(new Error('unused')) },
      s.store,
      () => new Date('2026-10-07T12:34:56Z'),
      fakeReads(),
    )
    const principal = {
      client: 'claude-code',
      scopes: ['read'],
      caller: 'agent',
      canSelectEdition: false,
    } as const
    const calls: [ServedToolName, object, string[]][] = [
      ['get_facts', { question }, ['tool_schema_digest', 'overlay']],
      ['get_facts', { question, response_format: 'concise' }, ['tool_schema_digest', 'overlay']],
      ['find_facts', { query: 'orders' }, ['tool_schema_digest', 'overlay']],
      ['search_facts', { query: 'Norway' }, machine],
      ['read_item', { id: 'itm_norway01' }, machine],
      ['get_related', { id: 'metric:orders' }, machine],
      ['improve_question', { question }, ['tool_schema_digest', 'overlay']],
      ['domain_overview', { domain: 'Finance' }, ['tool_schema_digest', 'overlay']],
      ['what_changed', {}, ['tool_schema_digest', 'overlay']],
    ]
    for (const [name, input, inMeta] of calls) {
      const reply = await execute(name, input, principal, 100000, (r) => s.records.push(r))
      expect(reply.isError, name).not.toBe(true)
      const text = JSON.parse(reply.content[0]!.text) as Record<string, unknown>
      for (const field of machine) {
        expect(reply.structuredContent, `${name} ${field}`).not.toHaveProperty(field)
        expect(text, `${name} ${field}`).not.toHaveProperty(field)
      }
      // The text carries the sentence first, and everything else the structured result has.
      expect(Object.keys(text)[0]).toBe('say')
      expect(text).toEqual(reply.structuredContent)
      expect(Object.keys(reply._meta ?? {}).sort(), name).toEqual([...inMeta].sort())
      expect(reply._meta).toMatchObject({ tool_schema_digest: toolSchemaDigest, overlay: '0' })
    }
    // The audit still has them: a delivery records its overlay and the tools' digest.
    expect(s.records.find((r) => r.kind === 'delivery')?.value).toMatchObject({
      overlay: '0',
      digest: toolSchemaDigest,
    })
  })
})

describe('the page of each delivered item in Heed (FR-347)', () => {
  const web = 'https://heed.example.test'
  function linked(address: string | null) {
    const s = setup()
    // An item for the board only: an agent never gets it, so no link may name it.
    s.data.items.push({
      ...s.data.items[0]!,
      id: 'itm_boardonly01',
      title: 'Board only',
      audience: { kind: 'groups', groups: ['board'] },
    })
    const execute = createToolService(
      { bundle: () => Promise.resolve(s.data), policy: () => Promise.reject(new Error('unused')) },
      s.store,
      () => new Date('2026-10-07T12:34:56Z'),
      undefined,
      address,
    )
    const principal = {
      client: 'claude-code',
      scopes: ['read'],
      caller: 'agent',
      canSelectEdition: false,
    } as const
    return (name: ServedToolName, input: object) =>
      execute(name, input, principal, 100000, () => {})
  }
  const delivered = (reply: { structuredContent: Record<string, unknown> }) =>
    [
      ...((reply.structuredContent.items as Record<string, unknown>[] | undefined) ?? []),
      ...(reply.structuredContent.item ? [reply.structuredContent.item] : []),
    ] as { id: string; title: string; url: string }[]

  it('gives every delivered item a well-formed link and a line that says where to open it', async () => {
    const call = linked(web)
    for (const [name, input] of [
      ['get_facts', { question }],
      ['get_facts', { question, response_format: 'concise' }],
      ['find_facts', { query: 'Norway' }],
      ['search_facts', { query: 'Norway' }],
      ['read_item', { id: 'itm_norway01' }],
    ] as const) {
      const reply = await call(name, input)
      const items = delivered(reply)
      expect(
        items.map((item) => item.id),
        name,
      ).toEqual(['itm_norway01'])
      for (const item of items) {
        // Only the item's id on the web app's address: no query, fragment, scope or credentials.
        expect(item.url).toBe(`${web}/library/itm_norway01`)
        const url = new URL(item.url)
        expect([
          url.origin,
          url.pathname,
          url.search,
          url.hash,
          url.username,
          url.password,
        ]).toEqual([web, '/library/itm_norway01', '', '', '', ''])
      }
      expect(reply.content).toHaveLength(2)
      expect(reply.content[1]!.text, name).toBe(
        `Open in Heed - Norway closure: ${web}/library/itm_norway01 - ${reviewedSentence}`,
      )
      // The item the agent may not get is counted at most, never named or linked.
      expect(JSON.stringify(reply)).not.toContain('itm_boardonly01')
      expect(JSON.stringify(reply)).not.toContain('Board only')
    }
    const withheld = await call('get_facts', { question })
    expect(withheld.structuredContent.check_report).toMatchObject({ withheld: 1 })
    const hidden = await call('read_item', { id: 'itm_boardonly01' })
    expect(hidden.structuredContent).toMatchObject({ status: 'no_match' })
    expect(hidden.content).toHaveLength(1)
    expect(JSON.stringify(hidden)).not.toContain('/library/')
  })

  it('links a path on the web app when no address is set, one line per item', async () => {
    const call = linked(null)
    const reply = await call('get_facts', { question })
    expect(delivered(reply)[0]!.url).toBe('/library/itm_norway01')
    expect(reply.content[1]!.text).toBe(
      `Open in Heed - Norway closure: /library/itm_norway01 - ${reviewedSentence}`,
    )
    // A title's line breaks never make a second line that could pass for another item's.
    const s = setup()
    s.data.items[0]!.title = 'Norway\nOpen in Heed - Fake: https://evil.example'
    const odd = await s.call('read_item', { id: 'itm_norway01' })
    expect(odd.content[1]!.text.split('\n')).toEqual([
      `Open in Heed - Norway Open in Heed - Fake: https://evil.example: /library/itm_norway01 - ${reviewedSentence}`,
    ])
  })
})

describe('a concise reply (FR-342)', () => {
  it('keeps what an answer needs and leaves out what read_item gives for one item', async () => {
    const s = setup()
    s.data.items[0]!.notToConclude = 'that customers moved to other markets'
    const full = await s.call('get_facts', { question })
    const concise = await s.call('get_facts', { question, response_format: 'concise' })
    expect(full.structuredContent).toMatchObject({ items: [{ links: [{}, {}] }] })
    expect(concise.structuredContent).toEqual({
      say: full.structuredContent.say,
      edition: '2026-10-07.1',
      response_format: 'concise',
      status: 'matched',
      delivery_id: expect.any(String) as string,
      scope_used: full.structuredContent.scope_used,
      dates_read: { words: 'August 2026', reads_as: '1-31 Aug 2026 (UTC)' },
      // The domain by name, without what it is.
      domains: [{ id: 'finance', name: 'Finance' }],
      items: [
        {
          id: 'itm_norway01',
          version: 1,
          kind: 'event',
          title: 'Norway closure',
          summary: 'Online sales stopped on 4 August.',
          validity: { start: '2026-08-04', end: null },
          claim_level: 'fact_only',
          risk: 'normal',
          freshness: 'verified',
          not_to_conclude: 'that customers moved to other markets',
          // How it was reviewed stays in a concise reply: it is what the answer cites (FR-326).
          reviewed: {
            accepted_on: '2026-08-04',
            accepted_by: 'the owner of Finance',
            in_edition: '2026-08-04.1',
          },
          url: '/library/itm_norway01',
          match: 'exact',
          link_count: 2,
        },
      ],
      options: [],
      check_report: full.structuredContent.check_report,
      instructions: expect.stringContaining('This reply is concise') as string,
    })
    expect(byteSize(concise)).toBeLessThan(byteSize(full))
    // A delivery all the same, recorded like the full one.
    expect(s.records.filter((r) => r.kind === 'delivery')).toHaveLength(2)
  })

  it('is full unless asked for: the source details of FR-326 stay the default', async () => {
    const s = setup()
    const reply = await s.call('get_facts', { question })
    expect((reply.structuredContent.items as object[])[0]).toMatchObject({
      body: 'Compare with an unaffected market.',
      evidence: [{ url: 'https://example.test/law' }],
      owner: { team: 'Regulation', role: 'the owner of Finance' },
    })
  })

  it('says how every delivered item was reviewed, by role, never by name (FR-326)', async () => {
    const s = setup()
    const reviewed = {
      accepted_on: '2026-08-04',
      accepted_by: 'the owner of Finance',
      in_edition: '2026-08-04.1',
    }
    const sentence = reviewedSentence
    for (const response_format of ['full', 'concise'] as const) {
      const reply = await s.call('get_facts', { question, response_format })
      expect((reply.structuredContent.items as object[])[0]).toMatchObject({ reviewed })
      // The text beside the item's page says it in one sentence, for a client that reads text.
      expect(reply.content.at(-1)!.text).toBe(
        `Open in Heed - Norway closure: /library/itm_norway01 - ${sentence}`,
      )
    }
    for (const [tool, args] of [
      ['read_item', { id: 'itm_norway01' }],
      ['search_facts', { query: 'Norway' }],
      ['find_facts', { query: 'Norway closure' }],
    ] as const) {
      const reply = await s.call(tool, args)
      expect(JSON.stringify(reply.structuredContent)).toContain(JSON.stringify(reviewed))
      expect(reply.content.at(-1)!.text).toContain(sentence)
    }
    // Nobody's name is in what an agent receives: the fixture's owner is Jon Abara.
    const all = await s.call('get_facts', { question })
    expect(JSON.stringify(all)).not.toMatch(/Jon|Abara/)
  })

  it('leaves the review out for a version with no acceptance on record', async () => {
    const s = setup()
    for (const item of s.data.items) item.review = null
    const reply = await s.call('get_facts', { question })
    expect((reply.structuredContent.items as object[])[0]).not.toHaveProperty('reviewed')
    expect(reply.content.at(-1)!.text).toBe('Open in Heed - Norway closure: /library/itm_norway01')
  })

  it('gives find_facts without the source details its definitions say in words', async () => {
    const s = setup()
    const full = await s.call('find_facts', { query: 'what is orders' })
    const concise = await s.call('find_facts', {
      query: 'what is orders',
      response_format: 'concise',
    })
    expect(full.structuredContent).toMatchObject({
      definitions: [{ source: { ref: 'cube:finance.orders' } }],
    })
    expect(concise._meta).toEqual(full._meta)
    const [definition] = concise.structuredContent.definitions as Record<string, unknown>[]
    expect(definition).not.toHaveProperty('source')
    expect(definition!.origin_words).toContain('cube:finance.orders')
  })
})

describe('a reply about more than one metric', () => {
  const ids = (items: unknown) =>
    (items as { id: string; about?: string[] }[]).map(({ id, about }) => ({ id, about }))

  it('names the metrics each item is about when a metric group is asked for', async () => {
    const s = setup()
    withRevenue(s.data)
    const revenue = 'How is revenue doing in Norway in August 2026?'
    const full = await s.call('get_facts', { question: revenue })
    expect(ids(full.structuredContent.items)).toEqual([
      { id: 'itm_gmv0001', about: ['Gross sales'] },
      { id: 'itm_net0001', about: ['Net revenue'] },
      // An item about the whole group is about each of its metrics.
      { id: 'itm_revenue01', about: ['Gross sales', 'Net revenue', 'Units sold'] },
    ])
    expect(full.structuredContent.instructions).toContain(groupInstruction)
    // A concise reply, as the assistant asks for, keeps them and the sentence.
    const concise = await s.call('get_facts', { question: revenue, response_format: 'concise' })
    expect(ids(concise.structuredContent.items)).toEqual(ids(full.structuredContent.items))
    expect(concise.structuredContent.say).toBe(full.structuredContent.say)
    expect(concise.structuredContent.instructions).toContain(groupInstruction)
  })

  it('names them when several metrics are asked for, and not for one metric', async () => {
    const s = setup()
    withRevenue(s.data)
    const two = await s.call('get_facts', {
      question: 'Orders and net revenue in Norway in August 2026',
    })
    expect(ids(two.structuredContent.items)).toEqual([
      { id: 'itm_net0001', about: ['Net revenue'] },
      { id: 'itm_norway01', about: ['Orders'] },
      { id: 'itm_revenue01', about: ['Net revenue'] },
    ])
    // Not a group: no sentence about one, and no instruction.
    expect(two.structuredContent.say).not.toContain('is a group of')
    expect(two.structuredContent.instructions).not.toContain(groupInstruction)
    // One metric, even one of the group, leaves the reply as it was: the same bytes as before.
    const one = await s.call('get_facts', { question })
    expect(ids(one.structuredContent.items)).toEqual([{ id: 'itm_norway01', about: undefined }])
    expect(byteSize(one)).toBe(byteSize(await setup().call('get_facts', { question })))
    const net = await s.call('get_facts', {
      question: 'Net revenue in Norway in August 2026',
    })
    expect(ids(net.structuredContent.items).every((item) => item.about === undefined)).toBe(true)
    expect(net.structuredContent.instructions).not.toContain(groupInstruction)
  })
})

describe('the member names a data tool queried (CON-517)', () => {
  it('gives the context of the metric that points at the member, as for its name', async () => {
    const s = setup()
    const window = { from: '2026-08-01', to: '2026-08-31' }
    const named = await s.call('get_facts', {
      question: '',
      metrics: ['Orders'],
      dimension_filters: [{ dimension: 'Market', values: ['Norway'] }],
      window,
    })
    for (const metric of ['finance.orders', 'cube:finance.orders']) {
      const reply = await s.call('get_facts', {
        question: '',
        metrics: [metric],
        dimension_filters: [{ dimension: 'Market', values: ['Norway'] }],
        window,
      })
      expect(reply.structuredContent).toMatchObject({
        status: 'matched',
        scope_used: named.structuredContent.scope_used,
        items: [{ id: 'itm_norway01' }],
      })
    }
  })

  it('says when no metric points at the member, and which one is closest', async () => {
    const s = setup()
    const reply = await s.call('get_facts', {
      question: '',
      metrics: ['finance.order_count'],
      window: { from: '2026-08-01', to: '2026-08-31' },
    })
    expect(reply.structuredContent).toMatchObject({
      status: 'need_more_detail',
      items: [],
      options: [
        {
          field: 'metrics',
          input: 'finance.order_count',
          options: ['metric:orders'],
          message:
            'No metric or metric group has the member finance.order_count as its definition. Did you mean Orders (metric:orders)?',
        },
        { field: 'scope' },
      ],
    })
  })

  it('finds what Heed holds about a member, and recovers from one it does not know', async () => {
    const s = setup()
    const known = await s.call('find_facts', { query: 'finance.orders' })
    expect(known.structuredContent).toMatchObject({
      status: 'matched',
      members: [{ member: 'finance.orders', term: 'Orders', key: 'metric:orders' }],
      items: [{ id: 'itm_norway01' }],
      definitions: [{ key: 'metric:orders', named: 'exactly' }],
    })
    const unknown = await s.call('find_facts', { query: 'traffic.order_count' })
    expect(unknown.structuredContent).toMatchObject({
      status: 'no_match',
      items: [],
      members: [
        {
          member: 'traffic.order_count',
          term: null,
          options: [{ key: 'metric:orders', name: 'Orders' }],
        },
      ],
      why: [
        'No metric or dimension has the member traffic.order_count as its definition. Did you mean Orders (metric:orders)?',
      ],
    })
    expect(unknown.structuredContent).not.toHaveProperty('definitions')
    expect((unknown.structuredContent.try as string[])[0]).toBe(
      'For traffic.order_count, call again with the name it has here: Orders, if that is what was queried.',
    )
  })
})

/*
  Round 4 of the real-model test: an agent asked about "this past week" without dates, got
  need_more_detail with no items, and gave up although the items exist. The captain's decision
  (14 October 2026): a question without dates is read at today, and the reply always says so. Since
  stage 0 of the composer (option B, 14 October 2026), "this past week" is read as the dates it
  gives, the 7 days to today, and the reply says how it read them.
*/
describe('a question without dates', () => {
  type Dated = {
    status: string
    say: string
    next?: string
    items: { id: string }[]
    scope_used: { window: { start: string; end: string | null } }
    assumed_date?: Record<string, string>
    dates_read?: Record<string, string>
    options: { field: string; message?: string }[]
    check_report: { statements: string[] }
    instructions: string
  }
  const ask = async (s: ReturnType<typeof setup>, input: object) =>
    (await s.call('get_facts', input)).structuredContent as Dated
  const assumed = {
    date: '2026-10-07',
    time_zone: 'UTC',
    reason: 'no date given',
    sentence: 'I assumed today, 7 October 2026. Tell me if you meant a different period.',
  }
  const statement =
    'No dates were given, so today was assumed, 7 Oct 2026 (UTC), with the items that apply on that day: an item that starts after it or ended before it is not given. For another period, call again with window.'

  it('gives the items that apply today, and says it assumed today', async () => {
    const s = setup()
    for (const input of [
      { question: 'Anything about orders in Norway?' },
      // As an agent may call it: the names, and no window or dates in the words.
      {
        question: 'How much did customers spend?',
        metrics: ['Orders'],
        dimension_filters: [{ dimension: 'Market', values: ['Norway'] }],
      },
    ]) {
      const reply = await ask(s, input)
      expect(reply).toMatchObject({
        status: 'matched',
        items: [{ id: 'itm_norway01' }],
        scope_used: { window: { start: '2026-10-07', end: '2026-10-08' } },
        assumed_date: assumed,
        options: [],
      })
      expect(reply).not.toHaveProperty('dates_read')
      expect(reply.check_report.statements).toEqual([
        'No match does not prove that no caveat exists.',
        statement,
      ])
      expect(reply.instructions).toContain(
        `Say so in your answer: "I assumed today, 7 October 2026. Tell me if you meant a different period."`,
      )
    }
    // The concise reply keeps the note, and the delivery is recorded for today.
    expect(await ask(s, { question: 'Orders Norway', response_format: 'concise' })).toMatchObject({
      assumed_date: assumed,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      s.records.flatMap((r) => (r.kind === 'delivery' ? [r.value.scope?.window] : [])),
    ).toEqual(Array(3).fill({ start: '2026-10-07', end: '2026-10-08' }))
  })

  it('reads the dates the words of the round 4 question give, and says how', async () => {
    const s = setup()
    for (const input of [
      { question: 'Anything about orders in Norway this past week?' },
      // As the agent of round 4 called it: the names, and no window.
      {
        question: 'How much did customers spend this past week?',
        metrics: ['Orders'],
        dimension_filters: [{ dimension: 'Market', values: ['Norway'] }],
      },
    ]) {
      const reply = await ask(s, input)
      expect(reply).toMatchObject({
        status: 'matched',
        items: [{ id: 'itm_norway01' }],
        scope_used: { window: { start: '2026-10-01', end: '2026-10-08' } },
        dates_read: {
          words: 'this past week',
          reads_as: '1-7 Oct 2026 (the 7 days to today; UTC)',
        },
        options: [],
      })
      expect(reply).not.toHaveProperty('assumed_date')
      expect(reply.say).toBe(
        '1 fact applies to Orders in Norway from 1 to 7 October 2026 (the 7 days to today). Only that was checked.',
      )
      expect(reply.check_report.statements).not.toContain(statement)
    }
    // The periods the scout found read as today (F5) are read as the periods they name.
    for (const [asked, words, start, end] of [
      ['this year', 'this year', '2026-01-01', '2026-10-08'],
      ['last quarter', 'last quarter', '2026-07-01', '2026-10-01'],
      ['in 2026', '2026', '2026-01-01', '2027-01-01'],
      ['from 1 Jan to 30 Sep', 'from 1 Jan to 30 Sep', '2026-01-01', '2026-10-01'],
    ])
      expect(await ask(s, { question: `Orders in Norway ${asked}` })).toMatchObject({
        status: 'matched',
        scope_used: { window: { start, end } },
        dates_read: { words },
      })
  })

  it('evaluates items at today: one that starts later or ended before is not given', async () => {
    const s = setup()
    const item = s.data.items[0]!
    s.data.items.push(
      { ...item, id: 'itm_later00001', validity: { start: '2026-10-10', end: null } },
      { ...item, id: 'itm_ended00001', validity: { start: '2026-09-01', end: '2026-10-07' } },
      { ...item, id: 'itm_ending0001', validity: { start: '2026-09-01', end: '2026-10-08' } },
    )
    const today = await ask(s, { question: 'Orders Norway' })
    expect(today.items.map((i) => i.id).sort()).toEqual(['itm_ending0001', 'itm_norway01'])
    expect(today.check_report.statements).toContain(statement)
    // Asked with dates, the same items are matched on those dates, and nothing is assumed.
    const dated = await ask(s, {
      question: 'Orders Norway this past week',
      window: { from: '2026-10-01', to: '2026-10-14' },
    })
    expect(dated.items.map((i) => i.id).sort()).toEqual([
      'itm_ended00001',
      'itm_ending0001',
      'itm_later00001',
      'itm_norway01',
    ])
    expect(dated).not.toHaveProperty('assumed_date')
    expect(dated.check_report.statements).not.toContain(statement)
    expect(dated.instructions).not.toContain('assumed')
  })

  it('never replaces dates the caller gave, and still asks for a metric or a market', async () => {
    const s = setup()
    const unread = await ask(s, { question: 'Orders Norway since the launch' })
    expect(unread).toMatchObject({
      status: 'need_more_detail',
      options: [
        {
          field: 'dates',
          message: expect.stringContaining('The dates that can be read: a day') as string,
        },
      ],
    })
    expect(unread).not.toHaveProperty('assumed_date')
    // The sentence says which words it could not read, and what it reads.
    expect(unread.say).toBe(
      'Nothing was looked up yet. "since the launch" can\'t be read as dates.',
    )
    expect(unread.next).toMatch(
      /^Fix it from options and call again\. 'since the launch' cannot be read as dates\. The dates that can be read: a day \(7 Oct 2026\), /,
    )
    const read = await ask(s, { question })
    expect(read.scope_used.window).toEqual({ start: '2026-08-01', end: '2026-09-01' })
    expect(read).not.toHaveProperty('assumed_date')
    const unscoped = await ask(s, { question: 'Anything written down this past week?' })
    expect(unscoped).toMatchObject({ status: 'need_more_detail', options: [{ field: 'scope' }] })
    expect(unscoped).not.toHaveProperty('assumed_date')
  })

  it('reports a gap for today, and still coaches a question to name its dates', async () => {
    const s = setup()
    const gap = await s.call('report_gap', { question: 'Orders Spain' })
    expect(gap.structuredContent).toMatchObject({ recorded: true, assumed_date: assumed })
    expect(s.gaps).toHaveLength(1)
    const coached = await s.call('improve_question', { question: 'Orders Norway' })
    expect(coached.structuredContent).toMatchObject({
      status: 'need_more_detail',
      options: [{ field: 'dates' }],
    })
    expect(coached.structuredContent).not.toHaveProperty('assumed_date')
  })
})

/*
  get_context, the agent contract (docs/product.md, section 10): the short reply by default, its
  status carrying the answer state (FR-349), and the overlap notice (FR-350). get_facts, its
  deprecated id, keeps the reply it had.
*/
describe('get_context', () => {
  /** A second item about Orders in Norway, which applies to the same question. */
  const second = (s: ReturnType<typeof setup>, extra: Partial<ServingItem> = {}): ServingItem => {
    const item: ServingItem = {
      ...s.data.items[0]!,
      id: 'itm_norway02',
      title: 'Webshop moved',
      summary: 'Orders moved to the new webshop on 4 August.',
      evidence: [],
      review: null,
      ...extra,
    }
    s.data.items.push(item)
    return item
  }
  const keys = (out: object) => Object.keys(out).sort()

  it('gives the short reply by default, with the answer line first in say', async () => {
    const s = setup()
    const reply = await s.call('get_context', { question })
    const out = reply.structuredContent
    expect(keys(out)).toEqual(['asked', 'context', 'edition', 'reply_id', 'say', 'status'])
    expect(out).toMatchObject({
      status: 'matched',
      say: 'Checked. 1 fact applies to Orders in Norway in August 2026. Only that was checked.',
      asked: 'Orders in Norway in August 2026',
    })
    // The reply id is the delivery's id, which report takes.
    expect(s.records[0]).toMatchObject({ kind: 'delivery', value: { id: out.reply_id } })
    expect(reply._meta).toMatchObject({ tool_schema_digest: toolSchemaDigest, overlay: '0' })
  })

  it('is Partial when the question gave no dates, and get_facts keeps Checked', async () => {
    const s = setup()
    const dateless = 'Anything about orders in Norway?'
    const out = (await s.call('get_context', { question: dateless })).structuredContent as {
      status: string
      say: string
    }
    expect(out.status).toBe('partial')
    expect(out.say.startsWith('Partial. Only part of this is written down.')).toBe(true)
    expect(out.say).toContain('I assumed today, 7 October 2026.')
    const old = (await s.call('get_facts', { question: dateless })).structuredContent as {
      status: string
    }
    expect(old.status).toBe('matched')
  })

  it('says Outdated for an item whose check date passed, and marks the item', async () => {
    const s = setup()
    s.data.items[0]!.reviewDate = '2026-09-01'
    const out = (await s.call('get_context', { question })).structuredContent as {
      status: string
      say: string
      context: { may_be_out_of_date?: boolean }[]
    }
    expect(out.status).toBe('stale')
    expect(out.say).toMatch(/^Outdated\. Some of this may be old\. 1 fact applies /)
    expect(out.context[0]!.may_be_out_of_date).toBe(true)
    // get_facts keeps the resolver's status and its own words.
    const legacy = (await s.call('get_facts', { question })).structuredContent as {
      status: string
      say: string
    }
    expect(legacy.status).toBe('matched')
    expect(legacy.say).toMatch(/^1 fact applies /)
  })

  it('says Partial only when no item covers the whole question', async () => {
    const s = setup()
    s.data.terms.push({
      ...s.data.terms[2]!,
      key: 'val:market/sweden',
      name: 'Sweden',
    })
    const both = {
      question: 'Orders in Norway and Sweden in August 2026',
      metrics: ['Orders'],
      dimension_filters: [{ dimension: 'Market', values: ['Norway', 'Sweden'] }],
      window: { from: '2026-08-01', to: '2026-08-31' },
    }
    const partial = (await s.call('get_context', both)).structuredContent as {
      status: string
      say: string
      context: { applies: string }[]
    }
    expect(partial.status).toBe('partial')
    expect(partial.say).toMatch(/^Partial\. Only part of this is written down\. /)
    expect(partial.context[0]!.applies).toBe('Orders in Norway.')
    // An item for every market covers the question, so the answer is Checked beside it.
    second(s, {
      scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
    })
    const checked = (await s.call('get_context', both)).structuredContent as { status: string }
    expect(checked.status).toBe('matched')
  })

  it('says Conflict and names the item each one disagrees with (FR-350)', async () => {
    const s = setup()
    s.data.items[0]!.conflicts = ['itm_norway02']
    second(s, { conflicts: ['itm_norway01'] })
    const out = (await s.call('get_context', { question })).structuredContent as {
      status: string
      say: string
      next: string
      context: { id: string; disagrees_with?: string[] }[]
    }
    expect(out.status).toBe('conflict')
    expect(out.say).toMatch(/^Conflict\. Two items say different things\. 2 facts apply /)
    expect(out.next).toBe('Give both sides of disagrees_with and say they disagree.')
    expect(out.context.map((item) => [item.id, item.disagrees_with])).toEqual([
      ['itm_norway01', ['itm_norway02']],
      ['itm_norway02', ['itm_norway01']],
    ])
    // An item with no review or source says so by leaving the field out.
    const bare = out.context.find((item) => item.id === 'itm_norway02')!
    expect(bare).not.toHaveProperty('checked')
    expect(bare).not.toHaveProperty('source')
  })

  it('says Not found, Not checked or that the question needs more, by the same status names', async () => {
    const s = setup()
    const none = (await s.call('get_context', { question: 'Orders Norway July 2026' }))
      .structuredContent as { status: string; say: string; next: string; context: unknown[] }
    expect(none).toMatchObject({ status: 'no_match', context: [] })
    expect(none.say).toMatch(/^Not found\. Nothing is written about this yet\. Nothing is written/)
    expect(none.next).toMatch(/call find_context/)
    expect(none.next).toMatch(/if the person agrees, call report with kind missing\.$/)
    const unread = (await s.call('get_context', { question: 'What happened?' }))
      .structuredContent as { status: string; say: string; asked: unknown }
    expect(unread).toMatchObject({ status: 'need_more_detail', asked: null })
    expect(unread.say).toMatch(/^Nothing was looked up yet\./)
    s.data.items.push({ ...s.data.items[0]! })
    const failed = (await s.call('get_context', { question })).structuredContent as {
      status: string
      say: string
    }
    expect(failed.status).toBe('check_failed')
    expect(failed.say).toMatch(/^Not checked\. The check did not run\./)
  })

  it('keeps the full reply, with every detail of the item and how the question was read', async () => {
    const s = setup()
    const out = (await s.call('get_context', { question, response_format: 'full' }))
      .structuredContent as Record<string, unknown> & { context: Record<string, unknown>[] }
    expect(out).toMatchObject({
      status: 'matched',
      response_format: 'full',
      scope_used: { metrics: ['metric:orders'] },
      check_report: { matched: 1 },
    })
    expect(out.instructions).toMatch(/call read_context with the item id/)
    // The entry's own fields first, then what get_facts gives beside them.
    expect(Object.keys(out.context[0]!).slice(0, 4)).toEqual(['id', 'title', 'summary', 'kind'])
    expect(out.context[0]).toMatchObject({
      kind: 'event',
      version: 1,
      body: 'Compare with an unaffected market.',
      claim_level: 'fact_only',
      reviewed: { accepted_by: 'the owner of Finance' },
      links: [{ rel: 'mentions' }, { rel: 'in_area' }],
    })
    expect(out.context[0]).not.toHaveProperty('conflicts_with')
  })

  it('cuts items from the end of the short reply to fit, and says how many', async () => {
    const s = setup()
    s.data.items[0]!.summary = 'x'.repeat(900)
    second(s, { summary: 'y'.repeat(900) })
    const out = (await s.call('get_context', { question, max_bytes: 4500 })).structuredContent as {
      say: string
      next: string
      context: unknown[]
    }
    expect(out.context).toHaveLength(1)
    expect(out.say).toContain("1 more fact applies but didn't fit in this reply.")
    expect(out.next).toContain('Call again with a higher max_bytes to get them.')
  })
})

describe('read_context and find_context', () => {
  it('read_context gives the whole item as the agent contract does, by its label', async () => {
    const s = setup()
    const out = (await s.call('read_context', { id: 'itm_norway01' })).structuredContent as {
      say: string
      context: Record<string, unknown>
    }
    expect(out.say).toBe('This is the full event, version 1.')
    expect(out.context).toMatchObject({
      id: 'itm_norway01',
      kind: 'event',
      when: 'From 4 August 2026 on',
      checked: { role: 'the owner of Finance', date: '2026-08-04' },
      body: 'Compare with an unaffected market.',
      not_to_conclude: 'cause not proven',
    })
    const missing = (await s.call('read_context', { id: 'itm_missing001' })).structuredContent
    expect(missing).toMatchObject({
      status: 'no_match',
      say: "There's no fact by that id that you can read.",
      next: 'That says nothing about what else is written down: find facts with find_context or get_context.',
    })
  })

  it('find_context names a kind as agents read it, and reads the stored kind', async () => {
    const s = setup()
    s.data.items[0]!.kind = 'issue'
    const out = (await s.call('find_context', { query: 'Norway', kind: 'warning' }))
      .structuredContent as { context: { id: string; kind: string }[] }
    expect(out.context).toEqual([expect.objectContaining({ id: 'itm_norway01', kind: 'warning' })])
    const events = (await s.call('find_context', { query: 'Norway', kind: 'event' }))
      .structuredContent as { status: string }
    expect(events.status).toBe('no_match')
  })
})
