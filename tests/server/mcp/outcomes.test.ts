import { describe, expect, it } from 'vitest'
import { previewReplySchema } from '../../../src/contract/proposals.ts'
import { definitionChars, quoted } from '../../../src/server/mcp/outcomes.ts'
import {
  byteSize,
  createToolService,
  definitionInstruction,
} from '../../../src/server/mcp/service.ts'
import type { ServedToolName } from '../../../src/server/mcp/tools.ts'
import type { ServingBundle } from '../../../src/server/modules/editions/index.ts'
import type { WaitingTerms } from '../../../src/server/mcp/reads.ts'
import { bundle, fakeReads, memoryStore } from './fixtures.ts'

type Line = Record<string, unknown>
/** The fields of the outcome tools' replies these tests read. */
type Reply = {
  say: string
  next?: string
  status: string
  metrics: unknown
  items: Line[]
  item: Line
  definitions: (Line & { origin_words: string; source: { state: string } })[]
  why: string[]
  try: string[]
  note: string
  instructions: string
  sentence: string
  in_heed: string
  cut: boolean
  coverage: Line
  check_report: { statements: string[]; withheld: number }
}

/** The tool service over the fixture edition on 7 October 2026, with what sources have beyond it. */
function setup(change: (data: ServingBundle) => void = () => {}, waiting?: WaitingTerms) {
  const data = bundle()
  change(data)
  const memory = memoryStore(),
    reads = fakeReads(waiting)
  const execute = createToolService(
    {
      bundle: () => Promise.resolve(data),
      policy: () =>
        Promise.resolve({
          client: null,
          tools: [],
          limits: {},
          rates: { person: 30, client: 120 },
          about: '',
        }),
    },
    memory.store,
    () => new Date('2026-10-07T12:34:56Z'),
    reads,
  )
  const call = async (name: ServedToolName, input: unknown, canSelectEdition = false) => {
    const result = await execute(
      name,
      input,
      { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition },
      100000,
      () => {},
    )
    return { result, out: result.structuredContent as Reply }
  }
  return { data, call, reads, memory }
}

const norway = (data: ServingBundle) => data.items[0]!
const definitionQuestion = 'What does Orders mean in Norway in August 2026?'

describe('W3: what must not be concluded reaches agents (FR-104, FR-326)', () => {
  it("serves the contributor's own words, and the instructions say to respect them", async () => {
    const s = setup((data) => {
      norway(data).notToConclude = 'Do not read lower orders as fewer customers.'
    })
    const { out } = await s.call('get_facts', { question: 'Orders Norway August 2026' })
    expect(out.items[0]!.not_to_conclude).toBe('Do not read lower orders as fewer customers.')
    expect(out.instructions).toContain(
      'When an item has not_to_conclude, never conclude what it rules out.',
    )
    const read = await s.call('read_item', { id: 'itm_norway01' })
    expect(read.out.item.not_to_conclude).toBe('Do not read lower orders as fewer customers.')
  })

  it('leaves the default out: it says what the claim level already says', async () => {
    const { out } = await setup().call('get_facts', {
      question: 'Orders Norway August 2026',
    })
    expect(out.items[0]).not.toHaveProperty('not_to_conclude')
  })
})

describe('find_facts (FR-338)', () => {
  it('matches the names people use, other names included, and says what the source defines', async () => {
    const s = setup((data) => {
      data.terms[0]!.aliases = ['cash in']
    })
    const { out, result } = await s.call('find_facts', { query: 'cash in Norway' })
    expect(result.isError).not.toBe(true)
    expect(out).toMatchObject({
      status: 'matched',
      found_by: 'words',
      items: [{ id: 'itm_norway01', title: 'Norway closure', domain: 'Finance', match: 'all' }],
      definitions: [
        {
          term: 'Orders',
          named: 'exactly',
          other_names: ['cash in'],
          domain: 'Finance',
          definition: 'The value of paid orders, in euros.',
          origin: 'source',
          source: { tool: 'Cube', state: 'current' },
          heed_adds: 'AI agents get 1 checked fact about Orders with their data: 1 event.',
        },
      ],
    })
    expect(out.definitions[0]!.origin_words).toMatch(
      /^Cube defines it, read through Sources \(Cube local model, cube:finance\.orders\)\./,
    )
    // A finder: titles and summaries, the body stays for read_item; the default caveat is left out.
    expect(out.items[0]).not.toHaveProperty('body')
    expect(out.items[0]).not.toHaveProperty('not_to_conclude')
  })

  it('counts the items about a term as the catalogue does, and says how many agents get', async () => {
    // A high-risk item waiting for a check is about Orders, so the catalogue counts it, but
    // agents do not get it yet. A domain asked of the search does not narrow the term's counts.
    const s = setup((data) => {
      const item = data.items[0]!
      data.items.push(
        { ...item, id: 'itm_highrisk01', riskLevel: 'high', checkFlag: 'needs_check' },
        { ...item, id: 'itm_highrisk02', riskLevel: 'high', reviewDate: '2026-09-01' },
        { ...item, id: 'itm_groups0001', audience: { kind: 'groups', groups: ['vip'] } },
      )
    })
    for (const input of [{ query: 'Orders' }, { query: 'Orders', domain: 'Finance' }]) {
      const { out } = await s.call('find_facts', input)
      expect(out.definitions[0]!.heed_adds).toBe(
        'AI agents get 1 checked fact about Orders with their data: 1 event. The library holds 3 facts about Orders, the count its catalogue shows; AI agents get 1 of them, not the other 2 yet: they are high risk and wait for a check.',
      )
    }
  })

  it("quotes at most 500 characters of the source's words, and says it shortened them", async () => {
    const long = `${'The value of paid orders, in euros. '.repeat(16)}End.`
    const s = setup((data) => {
      data.terms[0]!.described!.description = long
    })
    const { out } = await s.call('find_facts', { query: 'Orders' })
    const words = out.definitions[0]!.definition as string
    expect([...words].length).toBeLessThanOrEqual(definitionChars)
    // Shortened at a word: what is left is the start of the words, then "...".
    expect(words.endsWith('...')).toBe(true)
    expect(long.startsWith(`${words.slice(0, -3)} `)).toBe(true)
    expect(out.definitions[0]!.origin_words).toContain('shortened to 500 characters')
    expect(quoted('Short words.')).toEqual({ text: 'Short words.', shortened: false })
  })

  it('reads a metric named by part of its name, but not by a word several names share', async () => {
    const s = setup((data) => {
      data.terms.push({ ...data.terms[0]!, key: 'metric:deposit_count', name: 'Order count' })
    })
    // "order" is in two names, so it names neither; "count" is in one.
    const shared = await s.call('find_facts', { query: 'what is a order' })
    expect(shared.out.definitions ?? []).toEqual([])
    const one = await s.call('find_facts', { query: 'how do we count' })
    expect(one.out.definitions).toMatchObject([{ key: 'metric:deposit_count', named: 'in part' }])
    expect(one.out.definitions[0]!.named_note).toMatch(/^The words name Order count only in part\./)
    const alone = await setup().call('find_facts', { query: 'what is a order' })
    expect(alone.out.definitions.map((d) => d.key)).toEqual(['metric:orders'])
  })

  it('names a definition the source changed, and one it no longer lists', async () => {
    const changed = setup((data) => {
      data.refMarks.itm_norway01 = { 'cube:finance.orders': '0' }
    })
    const first = (await changed.call('find_facts', { query: 'orders' })).out.definitions[0]!
    expect(first.source.state).toBe('changed')
    expect(first.origin_words).toContain('Cube changed this definition')
    const missing = setup((data) => {
      data.terms[0]!.definitions[0]!.missing = true
    })
    const gone = (await missing.call('find_facts', { query: 'orders' })).out.definitions[0]!
    expect(gone.source.state).toBe('missing')
    expect(gone.origin_words).toContain('Cube no longer lists this definition')
  })

  it("points to the library's notes when no source describes a term, and says when nothing does", async () => {
    const s = setup((data) => {
      data.items.push({
        ...norway(data),
        id: 'itm_marketnote1',
        kind: 'note',
        title: 'What a market is',
        summary: 'A market is a country where the brand holds a licence.',
        scope: { metrics: [], dimensions: ['dim:market'], dimensionValues: [] },
      })
    })
    const market = (await s.call('find_facts', { query: 'what is a market' })).out.definitions[0]!
    expect(market).toMatchObject({
      term: 'Market',
      kind: 'dimension',
      definition: null,
      origin: 'library',
      library: [{ id: 'itm_marketnote1', kind: 'note' }],
    })
    const none = setup()
    const bare = (await none.call('find_facts', { query: 'market' })).out.definitions[0]!
    expect(bare).toMatchObject({ origin: 'none', definition: null })
    expect(bare.origin_words).toBe('Neither a definition source nor the library describes Market.')
  })

  it('never answers with a bare absence: it says why and what to try', async () => {
    const { out } = await setup().call('find_facts', { query: 'ordres stock rumours' })
    expect(out.status).toBe('no_match')
    expect(out.items).toEqual([])
    expect(out.why[0]).toBe('The query was read as the words "ordres", "stock" and "rumours".')
    expect(out.try).toContain(`"ordres" isn't a name here. Did you mean Orders?`)
    expect(out.try.at(-1)).toMatch(/report it as a gap/)
    expect(out.check_report.statements).toEqual(['No match does not prove that no caveat exists.'])
  })

  it('counts what agents do not get, with the reason, and never shows it', async () => {
    const s = setup((data) => {
      data.stopped = { all: false, areas: ['finance'], items: [] }
    })
    const { out } = await s.call('find_facts', { query: 'Norway closure', domain: 'Finance' })
    expect(out.status).toBe('no_match')
    expect(out.why).toContain(
      "1 fact matches, but AI agents don't get it: 1 because sharing it with AI agents is paused for now.",
    )
    expect(JSON.stringify(out)).not.toMatch(/not live|starting/)
    expect(out.check_report.withheld).toBe(1)
    expect(JSON.stringify(out)).not.toContain('Online sales stopped on 4 August')
  })

  it('never lets words probe the text of an item agents do not get', async () => {
    const s = setup((data) => {
      data.stopped = { all: false, areas: ['finance'], items: [] }
      data.items.push({
        ...norway(data),
        id: 'itm_narrow0001',
        summary: 'Restructuring of the Norway team.',
        audience: { kind: 'groups', groups: ['leadership'] },
      })
    })
    // Words found only in hidden text: nothing counted, nothing said about them.
    const probe = await s.call('find_facts', { query: 'restructuring' })
    expect(probe.out.status).toBe('no_match')
    expect(probe.out.check_report.withheld).toBe(0)
    expect(JSON.stringify(probe.out)).not.toMatch(/agents do not get (it|them)/)
    // By name, only the item for everyone is counted; the one for a group counts as absent.
    const named = await s.call('find_facts', { query: 'Norway' })
    expect(named.out.check_report.withheld).toBe(1)
  })

  it('shows nothing of a definition its source limits to groups', async () => {
    const s = setup((data) => {
      data.terms[0]!.described = null
    })
    const { out } = await s.call('find_facts', { query: 'orders' })
    expect(out.definitions[0]).toMatchObject({ origin: 'none', definition: null })
    expect(out.definitions[0]).not.toHaveProperty('source')
  })

  it('falls back to the items that apply to the scope the words name, and says so', async () => {
    const s = setup((data) => {
      data.items[0] = {
        ...norway(data),
        id: 'itm_everything',
        title: 'Company-wide tracking outage',
        summary: 'Tracking stopped for every brand on 1 October.',
        body: 'Numbers for that day are low everywhere.',
        scope: { metrics: [], dimensions: [], dimensionValues: [] },
        validity: { start: '2026-10-01', end: '2026-10-02' },
      }
      data.refMarks = {}
      data.links = []
    })
    const { out } = await s.call('find_facts', {
      query: 'orders Norway',
      window: { from: '2026-10-01', to: '2026-10-01' },
    })
    expect(out).toMatchObject({
      status: 'matched',
      found_by: 'scope',
      items: [{ id: 'itm_everything', match: 'scope' }],
      scope_used: {
        metrics: ['metric:orders'],
        filters: { 'dim:market': ['val:market/norway'] },
      },
    })
    expect(out.note).toMatch(/^No fact's words matched, so these are the facts that apply/)
    expect(out).not.toHaveProperty('assumed_date')
    expect(out.instructions).not.toContain('assumed')
    // Without dates it reads today's, and says it assumed today.
    const today = await s.call('find_facts', { query: 'orders Norway' })
    expect(today.out).toMatchObject({
      status: 'no_match',
      found_by: 'scope',
      assumed_date: {
        date: '2026-10-07',
        time_zone: 'UTC',
        reason: 'no date given',
        sentence: 'I assumed today, 7 October 2026. Tell me if you meant a different period.',
      },
    })
    expect(today.out.note).toContain('today (2026-10-07)')
    expect(today.out.check_report.statements.at(-1)).toMatch(
      /^No dates were given, so today was assumed, 7 Oct 2026 \(UTC\)/,
    )
    expect(today.out.instructions).toContain(
      'Say so in your answer: "I assumed today, 7 October 2026. Tell me if you meant a different period."',
    )
    // Dates the words give are read as get_facts reads them, and said: never today.
    const week = await s.call('find_facts', { query: 'orders Norway this past week' })
    expect(week.out).toMatchObject({
      found_by: 'scope',
      scope_used: { window: { start: '2026-10-01', end: '2026-10-08' } },
      dates_read: {
        words: 'this past week',
        reads_as: '1-7 Oct 2026 (the 7 days to today; UTC)',
      },
    })
    expect(week.out).not.toHaveProperty('assumed_date')
    expect(week.out.say).toContain('Norway from 1 to 7 October 2026 (the 7 days to today)')
    const august = await s.call('find_facts', { query: 'orders Norway in August' })
    expect(august.out).toMatchObject({
      found_by: 'scope',
      scope_used: { window: { start: '2026-08-01', end: '2026-09-01' } },
      dates_read: { reads_as: '1-31 Aug 2026 (year not given, so 2026; UTC)' },
    })
    // Words Heed cannot read as dates are never read as today.
    const launch = await s.call('find_facts', { query: 'orders Norway since the launch' })
    expect(launch.out).toMatchObject({ status: 'no_match' })
    expect(launch.out).not.toHaveProperty('found_by', 'scope')
    expect(launch.out).not.toHaveProperty('assumed_date')
  })

  it('recovers from an unknown domain with the closest one and every valid choice', async () => {
    const { out, result } = await setup().call('find_facts', {
      query: 'orders',
      domain: 'Finanzen',
    })
    expect(result.isError).not.toBe(true)
    expect(out).toMatchObject({
      status: 'need_more_detail',
      message:
        "Unknown domain 'Finanzen'. Did you mean Finance (finance)? Name one of the domains listed.",
      options: [{ field: 'domain', input: 'Finanzen', options: ['Finance'] }],
      domains: [{ id: 'finance', name: 'Finance', summary: 'Orders and returns, by market.' }],
    })
  })

  it('fits the size limit by leaving out items, and records no demand', async () => {
    const s = setup((data) => {
      for (let n = 0; n < 30; n++)
        data.items.push({
          ...norway(data),
          id: `itm_norway${String(n).padStart(2, '0')}x`,
          summary: 'Online sales stopped on 4 August. '.repeat(8),
        })
    })
    const { result, out } = await s.call('find_facts', {
      query: 'Norway',
      limit: 30,
      max_bytes: 6000,
    })
    expect(byteSize(result)).toBeLessThanOrEqual(6000)
    expect(out.items.length).toBeGreaterThan(0)
    expect(out.items.length).toBeLessThan(30)
    expect(out.cut).toBe(true)
    expect(s.memory.gaps).toEqual([])
  })
})

describe('the size limit of an outcome tool', () => {
  it('shortens a long list to fit, keeping the first entries', async () => {
    const s = setup((data) => {
      for (let n = 0; n < 60; n++)
        data.items.push({
          ...norway(data),
          id: `itm_sample${String(n).padStart(4, '0')}`,
          title: `Sample note ${n} about Norway`,
        })
    })
    const whole = await s.call('find_facts', { query: 'Norway', limit: 50 })
    const { result, out } = await s.call('find_facts', {
      query: 'Norway',
      limit: 50,
      max_bytes: 8_000,
    })
    expect(byteSize(result)).toBeLessThanOrEqual(8_000)
    expect(out.cut).toBe(true)
    expect(out.items.length).toBeGreaterThan(0)
    expect(out.items.length).toBeLessThan(whole.out.items.length)
    expect(out.items.map((i) => i.id)).toEqual(
      whole.out.items.slice(0, out.items.length).map((i) => i.id),
    )
  })
})

describe('a domain with nothing yet, named by another spelling', () => {
  const typo = (data: ServingBundle) => {
    data.areas.push({
      id: 'stores_suppliers',
      name: 'Stores & Suplliers',
      team: null,
      summary: '',
      description: '',
    })
  }
  const member = (name: string, kind: 'metric' | 'dimension', proposed = false) => ({
    areaId: 'stores_suppliers',
    kind,
    name,
    source: 'cube',
    tool: 'Cube',
    proposed,
  })
  const waiting = (canPropose: boolean): WaitingTerms => ({
    members: [
      member('Purchase orders', 'metric'),
      member('Lead time days', 'metric'),
      member('Fill rate', 'metric'),
      member('Units on order', 'metric'),
      member('Supplier cost', 'metric'),
      member('Supplier tier', 'dimension'),
      member('Supplier', 'dimension'),
      { ...member('Refund fees', 'metric'), areaId: 'finance' },
    ],
    canPropose,
  })

  it('find_facts reads the domain in the words, and says what it has and lacks', async () => {
    const { out } = await setup(typo, waiting(true)).call('find_facts', {
      query: 'Stores & Suppliers metrics and dimensions',
    })
    expect(out).toMatchObject({
      status: 'no_match',
      domains: [
        {
          id: 'stores_suppliers',
          items: 0,
          vocabulary: { metrics: 0, dimensions: 0 },
          waiting_in_source: { metrics: 5, dimensions: 2 },
        },
      ],
      domain_read_as: [
        { wrote: 'Stores & Suppliers', domain: 'Stores & Suplliers', misspelt: true },
      ],
    })
    expect(out.why[0]).toMatch(
      /^Stores & Suplliers has no facts and no names of its own yet\. Cube has 5 metrics and 2 dimensions mapped to Stores & Suplliers/,
    )
    expect(out.instructions).toContain('at most two sentences')
    expect(out.instructions).toContain('Do not repeat either in later answers')
  })
})

describe('terms of a domain agents do not get (FR-333)', () => {
  const stopped = (data: ServingBundle) => {
    data.stopped = { all: false, areas: ['finance'], items: [] }
  }

  it('gives no definition or counts for a metric of a stopped domain', async () => {
    const hidden = setup(stopped)
    const found = await hidden.call('find_facts', { query: 'what is Orders' })
    expect(found.out.definitions ?? []).toEqual([])
    expect(JSON.stringify(found.out)).not.toContain('The value of paid orders')
    const asked = await hidden.call('get_facts', { question: definitionQuestion })
    expect(asked.out).not.toHaveProperty('definitions')
    expect(JSON.stringify(asked.out)).not.toContain('The value of paid orders')

    const live = setup()
    const shown = await live.call('find_facts', { query: 'what is Orders' })
    expect(shown.out.definitions[0]).toMatchObject({
      term: 'Orders',
      definition: 'The value of paid orders, in euros.',
    })
  })

  it('gives no definitions while all delivery is stopped', async () => {
    const s = setup((data) => {
      data.stopped = { all: true, areas: [], items: [] }
    })
    const found = await s.call('find_facts', { query: 'what is Orders' })
    expect(found.out.definitions ?? []).toEqual([])
  })
})

describe('get_facts for a definition question (FR-338)', () => {
  it('gives the definition first: the source words, where they come from and what Heed adds', async () => {
    const { out } = await setup().call('get_facts', { question: definitionQuestion })
    expect(out).toMatchObject({
      status: 'matched',
      definitions: [
        {
          term: 'Orders',
          key: 'metric:orders',
          definition: 'The value of paid orders, in euros.',
          origin: 'source',
          source: { tool: 'Cube', ref: 'cube:finance.orders', state: 'current' },
          heed_adds: 'AI agents get 1 checked fact about Orders with their data: 1 event.',
        },
      ],
      items: [{ id: 'itm_norway01' }],
    })
    const keys = Object.keys(out)
    expect(keys.indexOf('definitions')).toBeLessThan(keys.indexOf('items'))
    expect(out.instructions).toContain(definitionInstruction)
    // Try it and the preview pass the definitions on whole (the contract strips what it lacks).
    expect(previewReplySchema.parse(out).definitions).toEqual(out.definitions)
  })

  it('leaves the definitions out of a question about the data', async () => {
    const { out } = await setup().call('get_facts', {
      question: 'Orders in Norway in August 2026',
    })
    expect(out).not.toHaveProperty('definitions')
    expect(out.instructions).not.toContain(definitionInstruction)
  })

  it('gives the definitions of the metrics in a group asked for', async () => {
    const { out } = await setup((data) => {
      data.terms.push({
        key: 'group:payments',
        kind: 'metric_group',
        name: 'Payments',
        aliases: [],
        parentKey: null,
        areaId: 'finance',
        definitionRefs: [],
        definitions: [],
      })
      data.terms[0]!.parentKey = 'group:payments'
      data.groupsOfMetric = { 'metric:orders': ['group:payments'] }
    }).call('get_facts', {
      question: 'What do payments mean?',
      metrics: ['group:payments'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-08-04', to: '2026-08-31' },
    })
    expect(out.items.map((item) => item.id)).toEqual(['itm_norway01'])
    expect(out.definitions.map((d) => [d.key, d.origin])).toEqual([
      ['group:payments', 'none'],
      ['metric:orders', 'source'],
    ])
  })
})
