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

/** The tool service over the fixture edition on 7 October 2026, with owners, gaps and editions. */
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
    const { out } = await s.call('get_context', { question: 'Orders Norway August 2026' })
    expect(out.items[0]!.not_to_conclude).toBe('Do not read lower orders as fewer customers.')
    expect(out.instructions).toContain(
      'When an item has not_to_conclude, never conclude what it rules out.',
    )
    const read = await s.call('read_item', { id: 'itm_norway01' })
    expect(read.out.item.not_to_conclude).toBe('Do not read lower orders as fewer customers.')
  })

  it('leaves the default out: it says what the claim level already says', async () => {
    const { out } = await setup().call('get_context', {
      question: 'Orders Norway August 2026',
    })
    expect(out.items[0]).not.toHaveProperty('not_to_conclude')
  })
})

describe('find_context (FR-338)', () => {
  it('matches the names people use, other names included, and says what the source defines', async () => {
    const s = setup((data) => {
      data.terms[0]!.aliases = ['cash in']
    })
    const { out, result } = await s.call('find_context', { query: 'cash in Norway' })
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
          heed_adds: 'AI apps get 1 checked fact about Orders with their data: 1 event.',
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
      const { out } = await s.call('find_context', input)
      expect(out.definitions[0]!.heed_adds).toBe(
        'AI apps get 1 checked fact about Orders with their data: 1 event. The library holds 3 facts about Orders, the count its catalogue shows; AI apps get 1 of them, not the other 2 yet: they are high risk and wait for a check.',
      )
    }
  })

  it("quotes at most 500 characters of the source's words, and says it shortened them", async () => {
    const long = `${'The value of paid orders, in euros. '.repeat(16)}End.`
    const s = setup((data) => {
      data.terms[0]!.described!.description = long
    })
    const { out } = await s.call('find_context', { query: 'Orders' })
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
    const shared = await s.call('find_context', { query: 'what is a order' })
    expect(shared.out.definitions ?? []).toEqual([])
    const one = await s.call('find_context', { query: 'how do we count' })
    expect(one.out.definitions).toMatchObject([{ key: 'metric:deposit_count', named: 'in part' }])
    expect(one.out.definitions[0]!.named_note).toMatch(/^The words name Order count only in part\./)
    const alone = await setup().call('find_context', { query: 'what is a order' })
    expect(alone.out.definitions.map((d) => d.key)).toEqual(['metric:orders'])
  })

  it('names a definition the source changed, and one it no longer lists', async () => {
    const changed = setup((data) => {
      data.refMarks.itm_norway01 = { 'cube:finance.orders': '0' }
    })
    const first = (await changed.call('find_context', { query: 'orders' })).out.definitions[0]!
    expect(first.source.state).toBe('changed')
    expect(first.origin_words).toContain('Cube changed this definition')
    const missing = setup((data) => {
      data.terms[0]!.definitions[0]!.missing = true
    })
    const gone = (await missing.call('find_context', { query: 'orders' })).out.definitions[0]!
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
    const market = (await s.call('find_context', { query: 'what is a market' })).out.definitions[0]!
    expect(market).toMatchObject({
      term: 'Market',
      kind: 'dimension',
      definition: null,
      origin: 'library',
      library: [{ id: 'itm_marketnote1', kind: 'note' }],
    })
    const none = setup()
    const bare = (await none.call('find_context', { query: 'market' })).out.definitions[0]!
    expect(bare).toMatchObject({ origin: 'none', definition: null })
    expect(bare.origin_words).toBe('Neither a definition source nor the library describes Market.')
  })

  it('never answers with a bare absence: it says why and what to try', async () => {
    const { out } = await setup().call('find_context', { query: 'ordres stock rumours' })
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
    const { out } = await s.call('find_context', { query: 'Norway closure', domain: 'Finance' })
    expect(out.status).toBe('no_match')
    expect(out.why).toContain(
      "1 fact matches, but AI apps don't get it: 1 because sharing it with AI apps is paused for now.",
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
    const probe = await s.call('find_context', { query: 'restructuring' })
    expect(probe.out.status).toBe('no_match')
    expect(probe.out.check_report.withheld).toBe(0)
    expect(JSON.stringify(probe.out)).not.toMatch(/agents do not get (it|them)/)
    // By name, only the item for everyone is counted; the one for a group counts as absent.
    const named = await s.call('find_context', { query: 'Norway' })
    expect(named.out.check_report.withheld).toBe(1)
    const overview = await s.call('domain_overview', { domain: 'Finance' })
    expect(overview.out.coverage).toMatchObject({ items: 0, withheld: 1 })
  })

  it('shows nothing of a definition its source limits to groups', async () => {
    const s = setup((data) => {
      data.terms[0]!.described = null
    })
    const { out } = await s.call('find_context', { query: 'orders' })
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
    const { out } = await s.call('find_context', {
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
    const today = await s.call('find_context', { query: 'orders Norway' })
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
    // Dates the words give are read as get_context reads them, and said: never today.
    const week = await s.call('find_context', { query: 'orders Norway this past week' })
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
    const august = await s.call('find_context', { query: 'orders Norway in August' })
    expect(august.out).toMatchObject({
      found_by: 'scope',
      scope_used: { window: { start: '2026-08-01', end: '2026-09-01' } },
      dates_read: { reads_as: '1-31 Aug 2026 (year not given, so 2026; UTC)' },
    })
    // Words Heed cannot read as dates are never read as today.
    const launch = await s.call('find_context', { query: 'orders Norway since the launch' })
    expect(launch.out).toMatchObject({ status: 'no_match' })
    expect(launch.out).not.toHaveProperty('found_by', 'scope')
    expect(launch.out).not.toHaveProperty('assumed_date')
  })

  it('recovers from an unknown domain with the closest one and every valid choice', async () => {
    const { out, result } = await setup().call('find_context', {
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
    const { result, out } = await s.call('find_context', {
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
  it('shortens a long list in a few renders, keeping the first entries', async () => {
    const s = setup((data) => {
      for (let n = 0; n < 2000; n++)
        data.terms.push({
          ...data.terms[0]!,
          key: `metric:m${n}`,
          name: `Sample metric ${n} with a long name`,
          definitionRefs: [],
          definitions: [],
          described: null,
        })
    })
    const started = performance.now()
    const { result, out } = await s.call('domain_overview', { max_bytes: 20_000 })
    expect(byteSize(result)).toBeLessThanOrEqual(20_000)
    expect(out.cut).toBe(true)
    const metrics = out.metrics as { name: string }[]
    expect(metrics.length).toBeGreaterThan(0)
    expect(metrics[0]!.name).toBe('Orders')
    // Popping one at a time renders the reply about 2,000 times; halving needs a dozen.
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('domain_overview (FR-339)', () => {
  it('lists every domain with its summary, owners, what needs a look and its open gaps', async () => {
    const s = setup((data) => {
      norway(data).reviewDate = '2026-09-01'
    })
    const { out } = await s.call('domain_overview', {})
    expect(out).toMatchObject({
      status: 'matched',
      edition: '2026-10-07.1',
      domains: [
        {
          id: 'finance',
          name: 'Finance',
          summary: 'Orders and returns, by market.',
          items: 1,
          holds: '1 item, mostly about Orders.',
          owners: { count: 2, reviewed_by: 'the owner of Finance' },
          needs_a_look: 1,
          open_gaps: 1,
        },
      ],
      metrics: [{ key: 'metric:orders', name: 'Orders' }],
    })
  })

  it('reads one domain by name: coverage, what needs a look and why, gaps and recent changes', async () => {
    const s = setup((data) => {
      norway(data).reviewDate = '2026-09-01'
    })
    const { out } = await s.call('domain_overview', { domain: 'Finance' })
    expect(out).toMatchObject({
      domain: {
        id: 'finance',
        name: 'Finance',
        summary: 'Orders and returns, by market.',
        description: 'Finance covers **orders** and returns, by market and payment provider.',
        team: 'Regulation',
      },
      coverage: { items: 1, kinds: '1 event', metrics: [{ name: 'Orders', items: 1 }] },
      needs_a_look: {
        count: 1,
        items: [{ id: 'itm_norway01', why: 'Its check date, 1 September 2026, has passed.' }],
      },
      open_gaps: {
        count: 1,
        gaps: [
          {
            id: 'gap_k2m4p6q8',
            topic: 'Orders, Norway, October 2026',
            agent_calls_that_found_nothing: 12,
          },
        ],
      },
      recent_changes: {
        since: '2026-10-06.1',
        changes: [
          { id: 'itm_norway01' },
          {
            id: 'itm_retired001',
            words: "Archived a note in Finance. AI apps no longer get it, so its text isn't shown.",
          },
        ],
      },
      in_heed: { needs_a_look: '/library?view=attention&area=finance' },
    })
    expect(s.reads.asked).toContainEqual({ openGaps: 'finance' })
  })

  it('counts the items of a stopped domain, without their text', async () => {
    const s = setup((data) => {
      data.stopped = { all: false, areas: ['finance'], items: [] }
    })
    const { out } = await s.call('domain_overview', { domain: 'finance' })
    expect(out.coverage).toMatchObject({
      items: 0,
      withheld: 1,
      withheld_note:
        '1 fact is not shared with AI apps: paused, or high risk and waiting for a check. People can read them in the library.',
    })
    expect(JSON.stringify(out)).not.toContain('Norway closure')
  })
})

/*
  A domain created as "Stores & Suplliers", with a typo in its stored name, and a Cube view
  mapped to it whose members were not proposed as terms yet. Asked for "Stores & Suppliers
  metrics and dimensions", the assistant said only that Heed holds nothing for it, listed every
  other domain's terms, and never said that Cube has the domain's metrics waiting.
*/
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

  it("reads the domain by the person's spelling, and says the source's members wait", async () => {
    const { out } = await setup(typo, waiting(true)).call('domain_overview', {
      domain: 'Stores & Suppliers',
    })
    expect(out).toMatchObject({
      status: 'matched',
      domain: { id: 'stores_suppliers', name: 'Stores & Suplliers' },
      domain_read_as: {
        wrote: 'Stores & Suppliers',
        domain: 'Stores & Suplliers',
        kind: 'close',
        misspelt: true,
      },
      vocabulary: { count: { metrics: 0, dimensions: 0 }, metrics: [], dimensions: [] },
      waiting_in_source: {
        metrics: 5,
        dimensions: 2,
        examples: ['Purchase orders', 'Lead time days', 'Fill rate', 'Units on order'],
        where: '/admin?section=sources&source=cube',
        words:
          "Cube has 5 metrics and 2 dimensions mapped to Stores & Suplliers that the library doesn't know by name yet, such as Purchase orders, Lead time days, Fill rate and Units on order. As an admin, you can see them all and propose them in Administration › Sources (/admin?section=sources&source=cube), with Propose names; you, another admin or an owner of the domain then accepts them.",
      },
    })
    // The person hears how the words were read and what the domain lacks; the next step for
    // the AI app points at what the source has waiting, which says who can add it.
    expect(out.say).toBe(
      '"Stores & Suppliers" is taken to mean Stores & Suplliers. Stores & Suplliers has no description yet. It has no facts and no metrics of its own yet.',
    )
    expect(out.next).toMatch(/^waiting_in_source says which names the data tool has/)
    // A short answer, said once, that never lists the other domains' terms.
    expect(out.instructions).toContain('at most two sentences')
    expect(out.instructions).toContain('never argue with how the person wrote it')
    expect(JSON.stringify(out)).not.toContain('Refund fees')
    expect(JSON.stringify(out.metrics ?? null)).not.toContain('Orders')
  })

  it('tells someone who is no administrator who can propose the terms, by role', async () => {
    const { out } = await setup(typo, waiting(false)).call('domain_overview', {
      domain: 'stores and suppliers',
    })
    expect(
      (out as unknown as { waiting_in_source: { words: string } }).waiting_in_source.words,
    ).toContain('An admin sees them all and proposes them in Administration › Sources.')
    // Served context names roles, never people (FR-326).
    expect(JSON.stringify(out)).not.toContain('Frederik Hagelund')
  })

  it('says which members are proposed and wait for review', async () => {
    const { out } = await setup(typo, {
      members: [member('Purchase orders', 'metric', true), member('Supplier tier', 'dimension')],
      canPropose: true,
    }).call('domain_overview', { domain: 'Stores & Suplliers' })
    expect(out).not.toHaveProperty('domain_read_as')
    expect(
      (out as unknown as { waiting_in_source: { words: string } }).waiting_in_source.words,
    ).toBe(
      "Cube has 1 metric and 1 dimension mapped to Stores & Suplliers that the library doesn't know by name yet, such as Purchase orders and Supplier tier. 1 of them is proposed as a name and waits for review in Proposals › To review (/proposals?view=review). As an admin, you can see them all and propose the rest in Administration › Sources (/admin?section=sources&source=cube), with Propose names; you, another admin or an owner of the domain then accepts them.",
    )
  })

  it("names each domain's own vocabulary and what waits, in the list of domains", async () => {
    const { out } = await setup(typo, waiting(true)).call('domain_overview', {})
    const domains = (out as unknown as { domains: Line[] }).domains
    expect(domains.find((d) => d.id === 'finance')).toMatchObject({
      vocabulary: { metrics: 1, dimensions: 0 },
      not_in_vocabulary_yet: { metrics: 1, dimensions: 0 },
    })
    expect(domains.find((d) => d.id === 'stores_suppliers')).toMatchObject({
      vocabulary: { metrics: 0, dimensions: 0 },
      not_in_vocabulary_yet: { metrics: 5, dimensions: 2 },
    })
  })

  it('find_context reads the domain in the words, and says what it has and lacks', async () => {
    const { out } = await setup(typo, waiting(true)).call('find_context', {
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
    const found = await hidden.call('find_context', { query: 'what is Orders' })
    expect(found.out.definitions ?? []).toEqual([])
    expect(JSON.stringify(found.out)).not.toContain('The value of paid orders')
    const overview = await hidden.call('domain_overview', {})
    expect(JSON.stringify(overview.out.metrics)).not.toContain('Orders')
    const asked = await hidden.call('get_context', { question: definitionQuestion })
    expect(asked.out).not.toHaveProperty('definitions')
    expect(JSON.stringify(asked.out)).not.toContain('The value of paid orders')

    const live = setup()
    const shown = await live.call('find_context', { query: 'what is Orders' })
    expect(shown.out.definitions[0]).toMatchObject({
      term: 'Orders',
      definition: 'The value of paid orders, in euros.',
    })
    const all = await live.call('domain_overview', {})
    expect(all.out.metrics).toEqual([{ key: 'metric:orders', name: 'Orders', domain: 'Finance' }])
  })

  it('gives no definitions while all delivery is stopped', async () => {
    const s = setup((data) => {
      data.stopped = { all: true, areas: [], items: [] }
    })
    const found = await s.call('find_context', { query: 'what is Orders' })
    expect(found.out.definitions ?? []).toEqual([])
    const overview = await s.call('domain_overview', {})
    expect(overview.out.metrics).toEqual([])
  })
})

describe('get_context for a definition question (FR-338)', () => {
  it('gives the definition first: the source words, where they come from and what Heed adds', async () => {
    const { out } = await setup().call('get_context', { question: definitionQuestion })
    expect(out).toMatchObject({
      status: 'matched',
      definitions: [
        {
          term: 'Orders',
          key: 'metric:orders',
          definition: 'The value of paid orders, in euros.',
          origin: 'source',
          source: { tool: 'Cube', ref: 'cube:finance.orders', state: 'current' },
          heed_adds: 'AI apps get 1 checked fact about Orders with their data: 1 event.',
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
    const { out } = await setup().call('get_context', {
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
    }).call('get_context', {
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

describe('what_changed (FR-340)', () => {
  it('filters to a domain by name and says what it did not show', async () => {
    const s = setup()
    const { out } = await s.call('what_changed', { domain: 'Finance' })
    expect(out).toMatchObject({
      domain: 'Finance',
      changes: [{ id: 'itm_norway01' }, { id: 'itm_retired001' }],
    })
    expect(out.sentence).toMatch(/^2 facts in Finance: 1 changed, 1 archived\. Across 1 edition\./)
    expect(out).not.toHaveProperty('not_shown')
    expect(out.in_heed).toBe('/editions/compare?since=2026-10-06.1&until=2026-10-07.1&area=finance')
  })

  it('compares named editions only with edition scope, as get_context selects one', async () => {
    const { result, out } = await setup().call('what_changed', { since: '2026-10-06.1' })
    expect(result.isError).toBe(true)
    expect(out.next).toBe(
      'Comparing named editions requires edition scope. Leave out edition and since for what the live edition changed.',
    )
  })

  it('recovers from a missing edition by what was asked, not by the words of the refusal', async () => {
    const { out } = await setup().call('what_changed', { since: '2026-01-01.9' }, true)
    expect(out).toMatchObject({
      status: 'need_more_detail',
      options: [{ field: 'edition', options: ['2026-10-07.1', '2026-10-06.1'] }],
    })
  })

  it('refuses an edition number that cannot be one, listing the recent ones', async () => {
    const { out } = await setup().call('what_changed', { edition: 'latest' }, true)
    expect(out).toMatchObject({
      status: 'need_more_detail',
      message:
        "Unknown edition 'latest'. Name one of the editions listed, or leave it out for the live edition.",
      options: [{ field: 'edition', options: ['2026-10-07.1', '2026-10-06.1'] }],
    })
  })
})
