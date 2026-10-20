import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'
import { removedNotice } from '../../src/contract/assistant.ts'
import { createMockWorkflow } from '@/api/mock-workflow'
import { MOCK_DAILY_LIMIT, mockAssistantTurn, type MockAssistantMode } from '@/api/mock-assistant'
import {
  answerAsMarkdown,
  answerMarkup,
  checkedWords,
  dayWords,
  factDatesWords,
  factSentence,
  lastFullMonth,
  limitWords,
  rangeWords,
  readAnswer,
  readQuestion,
  REMOVED_TARGET,
  scopeLine,
  scopeOfUsed,
  starters,
  type AskMessage,
} from '@/lib/assistant'
import { toWire } from '@/lib/assistant-chat'
import { formatDay } from '@/lib/library'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import matched from '../fixtures/assistant/matched.json'
import noMatch from '../fixtures/assistant/no-match.json'

/*
  The Ask tab's reading of the assistant's stream. The fixtures are turns recorded from the
  service with the scripted model (MODELS=mock): what the browser really receives.
*/

/** The assistant's message as the browser's chat builds it from the chunks. */
async function assemble(chunks: readonly unknown[]): Promise<AskMessage> {
  let last: AskMessage | undefined
  for await (const message of readUIMessageStream<AskMessage>({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk as UIMessageChunk)
        controller.close()
      },
    }),
  }))
    last = message
  return last!
}

describe('an answer recorded from the service', () => {
  it('reads the steps, the facts and the checked row from the tool results and the report', async () => {
    const answer = readAnswer(await assemble(matched), {
      titleOf: (id) => (id === 'itm_00ae5tb0' ? 'Online share lags a day' : undefined),
      nameOf: (key) => ({ 'dim:market': 'Market', 'val:market/italy': 'Italy' })[key],
    })
    expect(answer.edition).toBe('2026-10-07.2')
    expect(answer.steps).toEqual([
      expect.objectContaining({
        words: 'Looked up facts',
        counts: '2 checked, 2 apply',
        running: false,
        failed: false,
      }),
    ])
    // Applies before applies in part; the library's title wins over the tool's.
    expect(answer.facts.map((fact) => [fact.id, fact.verdict])).toEqual([
      ['itm_is8x9bcp', 'applies'],
      ['itm_00ae5tb0', 'partial'],
    ])
    expect(answer.facts[1]!.title).toBe('Online share lags a day')
    expect(answer.report).toEqual({
      cited: ['itm_00ae5tb0', 'itm_is8x9bcp'],
      removed: [],
      quoted: 0,
    })
    expect(checkedWords(answer.report!).lead).toBe('All 2 facts above come from the library.')
    // Each cited id is a chip with the fact's title; the words stay as the model wrote them.
    expect(answer.markup).toContain('@[Online share lags a day](item:itm_00ae5tb0)')
    expect(answer.markup).not.toMatch(/\[itm_/)
    expect(answer.plain).toContain('[itm_00ae5tb0]')
    expect(answer.notFound).toBe(false)
    expect(answer.scopeUsed).toEqual({
      scope: {
        metrics: ['metric:online_share'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/italy' }],
      },
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })

  it('says nothing applies when get_context found nothing and the answer cites nothing', async () => {
    const answer = readAnswer(await assemble(noMatch))
    expect(answer.notFound).toBe(true)
    expect(answer.facts).toEqual([])
    expect(answer.steps[0]!.counts).toBe('0 checked, none apply')
    expect(checkedWords(answer.report!).lead).toBe('This answer names no fact.')
    // The scope to start a draft with: the last day is the day before the window's end.
    expect(answer.scopeUsed?.to).toBe('2023-01-31')
  })

  it('goes back to the service as the conversation, scope line and scope part included', async () => {
    const read = {
      metrics: ['metric:online_share'],
      dimension_filters: [],
      window_source: 'assumed' as const,
      carried: [],
      unresolved: [],
    }
    const question: AskMessage = {
      id: 'q1',
      role: 'user',
      parts: [{ type: 'text', text: 'Which facts apply?' }],
      metadata: {
        scope: { about: 'metric:online_share' },
        scopeText: 'The scope I picked.',
        read,
        assumedDay: '2026-10-07',
      },
    }
    const answer = await assemble(matched)
    const unfinished: AskMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'read_item',
          toolCallId: 'c1',
          state: 'input-available',
          input: {},
        },
      ],
    }
    const wire = toWire([question, { ...answer, id: 'a1' }, unfinished])
    expect(wire).toHaveLength(2)
    expect(wire[0]!.parts).toEqual([
      { type: 'text', text: 'Which facts apply?' },
      { type: 'text', text: 'The scope I picked.' },
      // The scope the person saw, as get_context's fields: the service binds the calls to it.
      { type: 'data-scope', data: read },
    ])
    expect(wire[1]!.parts.some((part) => part.type === 'data-citations')).toBe(true)
    expect(readQuestion(question)).toEqual({
      text: 'Which facts apply?',
      scope: {
        scope: { metrics: ['metric:online_share'], dimensions: [], dimensionValues: [] },
        from: null,
        to: null,
      },
      carried: [],
      assumedDay: '2026-10-07',
    })
  })
})

describe('the steps of a domain question', () => {
  it('names a domain the assistant gave by its name, and reads the overview as a step', () => {
    const tool = (toolName: string, input: unknown, output: unknown) => ({
      type: 'dynamic-tool' as const,
      toolName,
      toolCallId: `call_${toolName}`,
      state: 'output-available' as const,
      input,
      output,
    })
    const message: AskMessage = {
      id: 'answer',
      role: 'assistant',
      parts: [
        tool('domain_overview', {}, { edition: '2026-10-07.2', domains: [] }),
        tool(
          'domain_overview',
          { domain: 'Commercial' },
          {
            edition: '2026-10-07.2',
            domain: { id: 'area_commercial', name: 'Commercial' },
            needs_a_look: { count: 1, items: [{ id: 'itm_aaaaaaaa', title: 'Old note' }] },
          },
        ),
        tool(
          'find_context',
          { query: 'commercial' },
          {
            items: [],
            total: 347,
            query_used: { domains: ['area_commercial'], terms: [], words: [] },
            domains: [{ id: 'area_commercial', name: 'Commercial' }],
          },
        ),
        tool(
          'find_context',
          { query: 'what is Net sales' },
          {
            items: [{ id: 'itm_bbbbbbbb', title: 'Net sales note' }],
            total: 1,
            query_used: { domains: [], terms: ['metric:net_revenue'], words: [] },
            definitions: [{ term: 'Net revenue' }],
          },
        ),
        tool('what_changed', {}, { edition: '2026-10-07.2', changes: [{ id: 'itm_cccccccc' }] }),
      ],
    }
    const answer = readAnswer(message, { areas })
    expect(answer.steps).toEqual([
      expect.objectContaining({ words: 'Read the domains and their names', counts: null }),
      expect.objectContaining({
        words: 'Read the overview of',
        object: 'Commercial',
        counts: null,
        facts: ['itm_aaaaaaaa'],
      }),
      expect.objectContaining({ words: 'Read 347 facts in', object: 'Commercial', counts: null }),
      expect.objectContaining({
        words: 'Read the definition and searched facts',
        counts: '1 text match',
      }),
      expect.objectContaining({ words: 'Read what changed', object: null }),
    ])
    expect(answer.facts.map((fact) => fact.id)).toEqual([
      'itm_aaaaaaaa',
      'itm_bbbbbbbb',
      'itm_cccccccc',
    ])
  })
})

describe('the answer as people read it', () => {
  it('turns removed statements into notices and grouped or bare ids into chips', () => {
    const markup = answerMarkup(
      `It changed [itm_aaaaaaaa, itm_bbbbbbbb]. See itm_cccccccc. ${removedNotice.unknown_item}`,
      (id) => `Fact [${id.slice(-1)}]`,
    )
    expect(markup).toBe(
      `It changed @[Fact (a)](item:itm_aaaaaaaa) @[Fact (b)](item:itm_bbbbbbbb). See @[Fact (c)](item:itm_cccccccc). @[unknown_item](${REMOVED_TARGET}unknown-item)`,
    )
  })

  it('counts what the check removed, and why', () => {
    expect(
      checkedWords({
        cited: ['itm_aaaaaaaa'],
        removed: [
          { reason: 'unknown_item', ids: ['itm_zzzzzzzz'] },
          { reason: 'unverified_quote', ids: [] },
          { reason: 'unverified_quote', ids: [] },
        ],
        quoted: 1,
      }),
    ).toEqual({
      lead: 'The fact above comes from the library, and the quote matches its source word for word.',
      removed: [
        'Left out a sentence that named a fact I hadn’t read, marked above.',
        'Left out 2 quotes I couldn’t find in the facts I read, marked above.',
      ],
    })
  })

  it('says a fact cited from an earlier answer comes from the library too', () => {
    expect(
      checkedWords({ cited: ['itm_aaaaaaaa', 'itm_bbbbbbbb'], removed: [], earlier: 1 }),
    ).toEqual({ lead: 'All 2 facts above come from the library.', removed: [] })
    expect(checkedWords({ cited: [], removed: [], quoted: 2 })).toEqual({
      lead: 'This answer names no fact, and all 2 quotes match their sources word for word.',
      removed: [],
    })
  })

  it('says a confirmed draft is saved only once the service says so', () => {
    const read = (part: Record<string, unknown>) =>
      readAnswer({
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'create_draft',
            toolCallId: 'c1',
            input: { draft: { title: 'Late orders' } },
            ...part,
          } as AskMessage['parts'][number],
        ],
      })
    const draftStep = (part: Record<string, unknown>) => read(part).steps[0]
    const approval = { id: 'ap1', signature: 'c2lnbmVk' }
    expect(draftStep({ state: 'approval-requested', approval })).toMatchObject({
      words: 'Wrote a draft for you to check',
      running: false,
    })
    expect(read({ state: 'approval-requested', approval }).draft).toMatchObject({
      state: 'asking',
      approvalId: 'ap1',
      saved: null,
    })
    const confirmed = { state: 'approval-responded', approval: { ...approval, approved: true } }
    expect(draftStep(confirmed)).toMatchObject({ words: 'Saving the draft', running: true })
    // The card stays while it saves, with nothing to answer.
    expect(read(confirmed).draft).toMatchObject({ state: 'saving', approvalId: null, saved: null })
    const declined = { state: 'approval-responded', approval: { ...approval, approved: false } }
    expect(draftStep(declined)).toMatchObject({
      words: 'You didn’t create the draft',
      running: false,
    })
    expect(read(declined).draft).toBeNull()
    expect(read({ state: 'output-denied', approval }).draft).toBeNull()
    // A saved draft is linked, to open and finish: a new item's, or a change to an item.
    const saved = {
      state: 'output-available',
      approval: { ...approval, approved: true },
      output: { proposal_id: 'p1', number: 7 },
    }
    expect(draftStep(saved)).toMatchObject({
      words: 'Saved a draft',
      running: false,
      failed: false,
    })
    expect(read(saved).draft).toMatchObject({
      state: 'saved',
      saved: { id: 'p1', number: 7, itemId: null },
    })
    expect(
      read({
        ...saved,
        input: { draft: { title: 'Late orders' }, item_id: 'itm_1' },
        output: { proposal_id: 'p2', number: 8 },
      }).draft?.saved,
    ).toEqual({ id: 'p2', number: 8, itemId: 'itm_1' })
    const refused = { ...saved, output: { error: 'Choose an active domain.' } }
    expect(draftStep(refused)).toMatchObject({
      words: 'Tried to save the draft',
      failed: true,
    })
    expect(read(refused).draft).toMatchObject({ state: 'failed', saved: null })
    // Refused before the person was asked (a name Heed cannot match): nothing to confirm.
    expect(
      read({ state: 'output-error', errorText: 'No domain is called "Ops".' }).draft,
    ).toBeNull()
  })

  it('shows every field of a proposed draft by name, with where each came from', () => {
    const quote =
      'Consumers have 14 days to withdraw from an online purchase without giving any reason.'
    const page = 'https://consumer.example/eu/right-of-withdrawal'
    const names: Record<string, string> = {
      'metric:returns': 'Returns',
      'dim:market': 'Market',
      'val:market/norway': 'Norway',
      'dim:product': 'Product',
    }
    const answer = readAnswer(
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_source',
            toolCallId: 'r1',
            input: { url: page },
            state: 'output-available',
            output: { url: page, read_on: '2026-10-15', passages: [quote] },
          },
          {
            type: 'dynamic-tool',
            toolName: 'create_draft',
            toolCallId: 'c1',
            state: 'approval-requested',
            approval: { id: 'ap1' },
            input: {
              draft: {
                kind: 'event',
                title: 'Customers have 14 days to send back online orders',
                summaryMarkup:
                  'Customers in Norway can send back an online order within 14 days from 1 October 2026.',
                body: 'Retailers must refund a returned order.',
                notToConclude: 'This is not legal advice.',
                areaId: 'sales',
                scope: {
                  metrics: ['metric:returns'],
                  dimensions: ['dim:product'],
                  dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
                },
                // Stored with an exclusive end: it applies through 31 October.
                validity: { start: '2026-10-01', end: '2026-11-01' },
                reviewDate: '2027-01-15',
                evidence: [{ url: page, quote, date: '2026-10-15' }],
              },
              sources: {
                summaryMarkup: 'your_text',
                'validity.start': 'suggested',
                scope: 'item:itm_aaaaaaaa',
                areaId: 'gap:gap-1',
                notToConclude: 'default',
                evidence: 'suggested',
              },
              dates_uncertain: true,
            },
          },
        ] as AskMessage['parts'],
      },
      { areas: [{ id: 'sales', name: 'Sales' }], nameOf: (key) => names[key] },
    )
    expect(answer.draft?.card).toEqual({
      itemId: null,
      kind: 'event',
      title: 'Customers have 14 days to send back online orders',
      summary:
        'Customers in Norway can send back an online order within 14 days from 1 October 2026.',
      body: 'Retailers must refund a returned order.',
      notToConclude: 'This is not legal advice.',
      domain: 'Sales',
      where: ['Returns', 'Product: any value', 'Market: Norway'],
      dates: { from: '2026-10-01', to: '2026-10-31', uncertain: true },
      reviewDate: '2027-01-15',
      evidence: [
        {
          url: page,
          site: 'consumer.example',
          quote,
          readOn: '2026-10-15',
          fromPage: true,
        },
      ],
      sources: {
        summary: { kind: 'person' },
        validity: { kind: 'suggested' },
        scope: { kind: 'item', id: 'itm_aaaaaaaa' },
        areaId: { kind: 'gap' },
        notToConclude: { kind: 'default' },
        // The page Heed read in this answer, whatever the call called it.
        evidence: { kind: 'page', site: 'consumer.example' },
      },
    })
    expect(answer.draft?.webSites).toEqual(['consumer.example'])
  })

  it('says which web page it read and how many pages a search found, and marks web evidence', () => {
    const page = 'https://consumer.example/eu/right-of-withdrawal'
    const answer = readAnswer({
      id: 'a',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'search_web',
          toolCallId: 's1',
          input: { query: 'EU right of withdrawal 14 days' },
          state: 'output-available',
          output: { results: [{ url: page }, { url: 'https://news.example.com/x' }] },
        },
        {
          type: 'dynamic-tool',
          toolName: 'read_source',
          toolCallId: 'r1',
          input: { url: page },
          state: 'output-available',
          output: { url: page, read_on: '2026-10-15', passages: ['Art. 1º'] },
        },
        {
          type: 'dynamic-tool',
          toolName: 'read_source',
          toolCallId: 'r2',
          input: { url: 'https://10.0.0.1/x' },
          state: 'output-available',
          output: { error: 'Heed could not read the page.' },
        },
        {
          type: 'dynamic-tool',
          toolName: 'create_draft',
          toolCallId: 'c1',
          input: {
            draft: {
              title: 'Customers have 14 days to send back online orders',
              evidence: [
                { url: page, quote: 'Art. 1º', date: '2026-10-15' },
                { url: 'https://example.test/own', quote: 'Mine', date: '2026-10-15' },
              ],
            },
          },
          state: 'approval-requested',
          approval: { id: 'ap1' },
        },
      ] as AskMessage['parts'],
    })
    expect(answer.steps.slice(0, 3)).toMatchObject([
      { icon: 'web', words: 'Searched the web', counts: '2 pages found' },
      { icon: 'web', words: 'Read', object: 'consumer.example', failed: false },
      { icon: 'web', words: 'Tried to read', object: '10.0.0.1', failed: true },
    ])
    // Only the evidence from a page read in this answer is from the web.
    expect(answer.draft).toMatchObject({ approvalId: 'ap1', webSites: ['consumer.example'] })
  })

  it('says which help pages it read, the same pages as Docs, and when they had nothing', () => {
    const step = (output: Record<string, unknown>, state = 'output-available') =>
      readAnswer({
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'search_help',
            toolCallId: 'h1',
            input: { query: 'What is an MCP?' },
            state,
            output,
          },
        ] as AskMessage['parts'],
      }).steps[0]
    expect(
      step({
        status: 'matched',
        results: [
          { page: 'What is an MCP, and how it all connects', url: '/docs/mcp#in-one-minute' },
          { page: 'Glossary', url: '/docs/glossary#mcp' },
          { page: 'What is an MCP, and how it all connects', url: '/docs/mcp#what-it-is-not' },
        ],
      }),
    ).toMatchObject({
      icon: 'read',
      words: 'Read the help pages',
      counts: 'What is an MCP, and how it all connects, Glossary',
    })
    expect(step({ status: 'no_match', pages: [] })).toMatchObject({
      words: 'Found nothing in the help pages',
      counts: null,
    })
  })

  it('says which limit and when it resets, never an amount', () => {
    const long = (day: string) => formatDay(day, 'long')
    expect(limitWords(MOCK_DAILY_LIMIT, long)).toEqual({
      title: 'You’ve reached today’s limit for the assistant',
      when: 'It resets within 24 hours.',
    })
    const monthly = limitWords(
      { kind: 'feature', message: 'Assistant spending reached $250.00', resets: '2026-11-01' },
      long,
    )
    expect(monthly.title).toBe('The assistant has reached its limit for this month')
    expect(monthly.when).toMatch(/^It resets on 1 November 2026\.$/)
    expect(JSON.stringify(monthly)).not.toContain('$')
  })

  it('writes days as short as they stay clear', () => {
    expect(rangeWords('2026-06-01', '2026-06-30', formatDay)).toBe('1 to 30 Jun 2026')
    expect(rangeWords('2026-05-01', '2026-06-30', formatDay)).toBe('1 May to 30 Jun 2026')
    expect(rangeWords('2025-12-01', '2026-01-31', formatDay)).toBe('1 Dec 2025 to 31 Jan 2026')
    expect(rangeWords('2026-06-04', null, formatDay)).toBe('4 Jun 2026')
    expect(rangeWords(null, '2026-06-04', formatDay)).toBeNull()
  })

  it('copies the answer as Markdown with each fact a link, then what it was about, never the edition', async () => {
    const answer = readAnswer(await assemble(matched))
    const markdown = answerAsMarkdown(answer, {
      origin: 'https://heed.example',
      titleOf: () => 'A fact',
      scopeWords: 'Online share, Market Italy, 1 to 30 Jun 2026',
    })
    expect(markdown).toContain('[A fact](https://heed.example/library/itm_00ae5tb0)')
    expect(markdown).toMatch(/\n\nAbout: Online share, Market Italy, 1 to 30 Jun 2026\.$/)
    expect(markdown).not.toMatch(/Edition 2026-10-07\.2/)
  })

  it('copies each fact’s whole title, even a long one, so two facts never read the same', async () => {
    const title = `Payment provider switched in the Netherlands on 19 February 2025 ${'and so on '.repeat(16)}for [every] market | all`
    const markdown = answerAsMarkdown(readAnswer(await assemble(matched)), {
      origin: 'https://heed.example',
      titleOf: () => title,
      scopeWords: null,
    })
    expect(title.length).toBeGreaterThan(160)
    expect(markdown).toContain(
      `[${title.replace('[every]', '(every)').replace('|', '\\|')}](https://heed.example/library/itm_00ae5tb0)`,
    )
    expect(markdown).not.toContain('…')
  })

  it('tells the model the scope as get_context’s own fields, after a fixed prefix', () => {
    expect(
      scopeLine({
        scope: {
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/north' }],
        },
        from: '2026-06-01',
        to: '2026-06-30',
      }),
    ).toBe(
      'Scope picked for this question, as get_context fields: {"metrics":["metric:orders"],"dimension_filters":[{"dimension":"dim:market","values":["val:market/north"]}],"window":{"from":"2026-06-01","to":"2026-06-30"}}',
    )
    expect(scopeOfUsed(null)).toBeNull()
  })
})

describe('the day a question without dates was read at', () => {
  const long = (day: string) => formatDay(day, 'long')

  it('says plainly that a fixed day is the demo’s date, and a day that is the browser’s today', () => {
    const now = new Date(2026, 9, 20, 12, 0, 0)
    expect(dayWords('2026-10-07', long, now)).toBe('the demo’s date, 7 October 2026')
    expect(dayWords('2026-10-20', long, now)).toBe('today, 20 October 2026')
    // A time zone away is still today: the service and the browser may differ by a day.
    expect(dayWords('2026-10-19', long, now)).toBe('today, 19 October 2026')
    expect(dayWords('2026-10-21', long, now)).toBe('today, 21 October 2026')
    expect(dayWords('2026-10-22', long, now)).toBe('the demo’s date, 22 October 2026')
  })
})

describe('a fact as its block says it', () => {
  it('tells when it applies: from a day while it goes on, the days once it has ended', () => {
    expect(factDatesWords({ validity: { start: '2026-06-15' }, until: null })).toBe(
      'from 15 Jun 2026',
    )
    expect(factDatesWords({ validity: { start: '2026-06-01' }, until: '2026-06-30' })).toBe(
      '1 to 30 Jun 2026',
    )
    expect(factDatesWords({ validity: { start: '2026-06-12' }, until: '2026-06-12' })).toBe(
      '12 Jun 2026',
    )
  })

  it('says what it says in one sentence that is not its title again', () => {
    const title = 'Payment provider switched in the Netherlands on 19 February 2025'
    expect(
      factSentence(
        'Payment provider switched in the Netherlands on 19 February 2025. We switched the Netherlands to a new payment provider. More.',
        title,
      ),
    ).toBe('We switched the Netherlands to a new payment provider.')
    expect(factSentence(`${title}.`, title)).toBe('')
    expect(factSentence('', title)).toBe('')
  })
})

describe('suggested questions', () => {
  it('teach five things, filled from what Heed holds, with the scope a scope question needs', () => {
    const list = starters({
      fact: { title: 'Payment provider switched in the United Kingdom' },
      metric: { key: 'metric:average_order_value', name: 'Average order value' },
      market: { key: 'val:market/united_kingdom', name: 'United Kingdom' },
      area: { name: 'Commercial' },
      today: '2026-10-10',
    })
    expect(list.map((s) => s.label)).toEqual([
      'Explain a fact',
      'See what applies',
      'Summarise a domain',
      'Sharpen a question',
      'Write a fact',
    ])
    expect(list[1]).toEqual({
      label: 'See what applies',
      question: 'Which facts apply to Average order value in United Kingdom in September 2026?',
      scope: {
        scope: {
          metrics: ['metric:average_order_value'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/united_kingdom' }],
        },
        from: '2026-09-01',
        to: '2026-09-30',
      },
    })
    // With nothing in the library yet, the two that need no fact remain.
    expect(
      starters({ fact: null, metric: null, market: null, area: null, today: null }),
    ).toHaveLength(2)
    expect(lastFullMonth('2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
      words: 'December 2025',
    })
  })
})

describe('the scripted assistant of the mock binding', () => {
  const workflow = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    versionDays,
  })
  const reads = workflow.as('per_maria').assistantReads()
  // A served item with a metric and a market, and the month it starts in.
  const item = reads.items.find(
    (i) =>
      i.scope.metrics.length && i.scope.dimensionValues.some((v) => v.dimension === 'dim:market'),
  )!
  const market = item.scope.dimensionValues.find((v) => v.dimension === 'dim:market')!.value
  const turn = async (question: string, mode: MockAssistantMode = 'answer', about?: string) => {
    const chunks: UIMessageChunk[] = []
    const scope = about ? { about, from: item.validity.start, to: item.validity.start } : undefined
    for await (const chunk of mockAssistantTurn(
      reads,
      [{ id: 'q', role: 'user', parts: [{ type: 'text', text: question }], metadata: { scope } }],
      { pause: () => Promise.resolve(), mode },
    ))
      chunks.push(chunk)
    return chunks
  }

  it('answers in the service’s stream, citing only facts its tools read', async () => {
    const chunks = await turn('Which facts apply?', 'answer', `${item.scope.metrics[0]},${market}`)
    const answer = readAnswer(await assemble(chunks))
    expect(chunks[0]).toEqual({
      type: 'start',
      messageMetadata: { model: { name: 'scripted-demo', mock: true } },
    })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
    expect(answer.facts.some((fact) => fact.id === item.id)).toBe(true)
    const read = new Set(answer.facts.map((fact) => fact.id))
    expect(answer.report!.cited.length).toBeGreaterThan(0)
    for (const id of answer.report!.cited) expect(read.has(id)).toBe(true)
    expect(answer.report!.removed).toEqual([])
  })

  /*
    The captain, 20 October 2026: "what you mean?" after an answer carried the last question's
    scope, assumed a date, looked up eight facts and listed the ones that do not apply.
  */
  const converse = async (messages: AskMessage[]) => {
    const chunks: UIMessageChunk[] = []
    for await (const chunk of mockAssistantTurn(reads, messages, {
      pause: () => Promise.resolve(),
    }))
      chunks.push(chunk)
    return readAnswer(await assemble(chunks))
  }
  const asked = (
    text: string,
    scope?: { about: string; from?: string; to?: string },
  ): AskMessage => ({
    id: `q-${text}`,
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: { scope },
  })
  const said = (text: string): AskMessage => ({
    id: `a-${text}`,
    role: 'assistant',
    parts: [{ type: 'text', text }],
  })

  it.each([
    ['what you mean?', /^Let me put it another way\. The main point: /],
    ['say it simpler', /^Simply put: /],
    ['shorter', /^In short: /],
    ['why?', /^I said that because /],
  ])(
    'answers %j from the last reply: no lookup, no step, no fact, no date',
    async (text, start) => {
      const last = 'A clearer question names what, where and when. Name the metric and the dates.'
      const answer = await converse([
        asked('Make this clearer: why did it drop?'),
        said(last),
        asked(text),
      ])
      expect(answer.steps).toEqual([])
      expect(answer.facts).toEqual([])
      expect(answer.plain).toMatch(start)
      expect(answer.plain).toContain('A clearer question names what, where and when.')
      expect(answer.plain).not.toMatch(/which metric|demo.s date|today|apply/i)
    },
  )

  it('treats the same words before any answer as a question, and asks nothing about the scope', async () => {
    const answer = await converse([asked('what you mean?')])
    expect(answer.plain).toMatch(/^I haven't said anything to explain yet\./)
    expect(answer.steps).toEqual([])
  })

  it('says first what the facts cannot show when asked why a number changed, and lists only what applies', async () => {
    const answer = await converse([
      asked('Why did it drop?', {
        about: `${item.scope.metrics[0]},${market}`,
        from: item.validity.start,
        to: item.validity.start,
      }),
    ])
    expect(answer.plain.split('\n')[0]).toMatch(
      /^\*{0,2}The facts can't show whether .+ dropped, or why\.\*{0,2}$/,
    )
    expect(answer.plain).not.toMatch(/caused|because of/i)
    // A fact that does not apply is read and kept for the folded list, never listed in the words.
    for (const fact of answer.facts.filter((f) => f.verdict === 'not'))
      expect(answer.plain).not.toContain(fact.id)
    expect(answer.plain).not.toMatch(/doesn.t apply/i)
  })

  it("says the day it read at when no dates were given is the demo's date, never today", async () => {
    const answer = await converse([
      asked('Which facts apply?', { about: `${item.scope.metrics[0]},${market}` }),
    ])
    expect(answer.plain).toContain(`I used the demo's date, `)
    expect(answer.plain).toContain('because no dates were given.')
    expect(answer.plain).not.toMatch(/\btoday\b/i)
  })

  it('lists each fact it names as an item of its own, so the answer can draw it as a block', async () => {
    const answer = await converse([
      asked('Which facts apply?', {
        about: `${item.scope.metrics[0]},${market}`,
        from: item.validity.start,
        to: item.validity.start,
      }),
    ])
    const lines = answer.plain.split('\n').filter((line) => line.startsWith('- '))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/^- \[itm_[a-z0-9]{8,16}\]/)
    expect(answer.plain).not.toMatch(/\bapplies\.? /)
  })

  it('stops at a spending limit before any tool runs', async () => {
    const chunks = await turn('Which facts apply?', 'limit')
    const answer = readAnswer(await assemble(chunks))
    expect(answer.limit).toEqual(MOCK_DAILY_LIMIT)
    expect(answer.steps).toEqual([])
    expect(answer.plain).toBe('')
  })

  it('fails part way with the service’s error words, and refuses with a refusal part', async () => {
    const failed = await turn('Which facts apply?', 'fails', `${item.scope.metrics[0]},${market}`)
    expect(failed.at(-1)).toEqual({
      type: 'error',
      errorText: "The assistant couldn't finish. Try again in a moment.",
    })
    const refused = readAnswer(await assemble(await turn('Which facts apply?', 'refuses')))
    expect(refused.refused).toBe(true)
    expect(refused.plain).toBe('')
  })

  it('answers "What is this" about Product with any value from what was attached, without a tool', async () => {
    const chunks = await turn('What is this', 'answer', 'dim:product')
    const answer = readAnswer(await assemble(chunks))
    expect(answer.plain).not.toMatch(/which metric/i)
    expect(answer.plain).toContain('Product: every Product, not one in particular.')
    expect(answer.plain).toMatch(/Its definition: "The product/)
    expect(answer.steps).toEqual([])
  })

  it('looks up facts for "which facts apply to this", and never asks which metric, market and dates', async () => {
    const answer = readAnswer(
      await assemble(await turn('Which facts apply to this?', 'answer', 'dim:product')),
    )
    // Product and dates are attached: it looks the facts up and says what it found.
    expect(answer.steps.length).toBeGreaterThan(0)
    expect(answer.plain).not.toMatch(/which metric/i)
    // Nothing attached: the question back stays, as there is nothing to answer about.
    const bare = readAnswer(await assemble(await turn('What is this')))
    expect(bare.plain).toMatch(/which metric, market and dates/i)
  })

  it.each([
    'what can you do',
    'hi',
    'help',
    'how does this work?',
    'who are you?',
    'thanks!',
    'tell me a joke',
    'what can I ask you?',
    'what do you know about?',
    'how do I add something?',
  ])('answers %j at once, with no step and no question about the scope', async (question) => {
    // The captain, 14 October 2026: "what can you do" got "Which metric, market and dates".
    const answer = readAnswer(await assemble(await turn(question)))
    expect(answer.steps).toEqual([])
    expect(answer.plain).not.toMatch(/which metric|which market|which dates/i)
    expect(answer.report!.removed).toEqual([])
  })

  it.each([
    'Which weather jackets launched in the Netherlands?',
    'joke socks sold in the Netherlands',
  ])('never declines %j as outside Heed for a word in it', async (question) => {
    const answer = readAnswer(await assemble(await turn(question)))
    expect(answer.plain).not.toContain('outside what I help with')
  })

  it('says what it can do in three points and a question to try, and that it is the demo model', async () => {
    const answer = readAnswer(await assemble(await turn('what can you do')))
    expect(answer.plain).toMatch(
      /^I help you find, understand and write down facts about your numbers\./,
    )
    expect(answer.plain.match(/^- /gm)).toHaveLength(3)
    expect(answer.plain).toMatch(/Try: \*Which facts apply to .+ last week\?\*/)
    expect(answer.plain).not.toContain('Heed')
    const joke = readAnswer(await assemble(await turn('tell me a joke')))
    expect(joke.plain).toContain('This is a demo version of me')
    // Words it cannot place: the demo model says so, and asks nothing about the scope.
    const unplaced = readAnswer(await assemble(await turn('zebra crossing')))
    expect(unplaced.plain).toMatch(/^I couldn't match that to a metric, a market or a domain/)
    expect(unplaced.plain).not.toMatch(/which metric/i)
  })

  it.each([
    ['online sales to Norway stopped on 4 August 2026 after a new customs rule', 'event'],
    ['online sales to Norway fell to almost nothing on 4 August 2026', 'note'],
  ] as const)('drafts "%s" as %s', async (facts, kind) => {
    const chunks = await turn(`Draft this: ${facts}, so orders there fell.`)
    const proposed = chunks.find(
      (chunk) => chunk.type === 'tool-input-available' && chunk.toolName === 'create_draft',
    )
    expect(proposed).toMatchObject({ input: { draft: { kind } } })
  })

  it('summarises a domain and stops at its length limit when it holds many facts', async () => {
    const area = areas.find((a) => reads.items.filter((i) => i.areaId === a.id).length > 12)!
    const chunks = await turn(`What does the ${area.name} domain cover?`)
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'length' })
    const answer = readAnswer(await assemble(chunks), { areas })
    const total = reads.items.filter((i) => i.areaId === area.id).length
    expect(answer.steps[0]).toMatchObject({
      words: `Read ${total} facts in`,
      object: area.name,
      counts: null,
    })
    expect(answer.cut).toBe(false)
  })
})

describe('how each fact read was reviewed (FR-326)', () => {
  it('keeps the review a tool gave with the fact, whichever tool gave it', () => {
    const tool = (toolName: string, output: unknown) => ({
      type: 'dynamic-tool' as const,
      toolName,
      toolCallId: `call_${toolName}`,
      state: 'output-available' as const,
      input: {},
      output,
    })
    const reviewed = {
      accepted_on: '2026-08-04',
      accepted_by: 'the owner of Commercial',
      in_edition: '2026-08-04.2',
    }
    const message: AskMessage = {
      id: 'answer',
      role: 'assistant',
      parts: [
        tool('get_context', {
          edition: '2026-10-07.2',
          status: 'matched',
          items: [
            { id: 'itm_aaaaaaaa', title: 'Applies', kind: 'event', match: 'exact', reviewed },
            { id: 'itm_bbbbbbbb', title: 'No review said', kind: 'note', match: 'exact' },
          ],
        }),
        // A later read of the second fact gives its review; a weaker verdict keeps the stronger.
        tool('read_item', { item: { id: 'itm_bbbbbbbb', title: 'No review said', reviewed } }),
        tool('find_context', { items: [{ id: 'itm_cccccccc', title: 'Found', reviewed: 'odd' }] }),
      ],
    }
    const facts = readAnswer(message).facts
    expect(facts.map((fact) => [fact.id, fact.verdict, fact.reviewed])).toEqual([
      [
        'itm_aaaaaaaa',
        'applies',
        { acceptedOn: '2026-08-04', by: 'the owner of Commercial', edition: '2026-08-04.2' },
      ],
      [
        'itm_bbbbbbbb',
        'applies',
        { acceptedOn: '2026-08-04', by: 'the owner of Commercial', edition: '2026-08-04.2' },
      ],
      ['itm_cccccccc', 'read', null],
    ])
  })
})
