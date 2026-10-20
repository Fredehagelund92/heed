import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  assumedDate,
  asksDefinition,
  extractScope,
  readQuestion,
} from '../../../src/domain/scope.ts'
import { normalizeName, normalizeWithMap, resolveTerm } from '../../../src/domain/vocabulary.ts'
import { terms } from './fixtures.ts'

describe('scope extraction', () => {
  it.each([
    [
      'Orders Norge August 2026',
      '2026-08-01',
      '2026-09-01',
      'August 2026',
      '1-31 Aug 2026 (the whole month, including the days after today; UTC)',
    ],
    [
      'Orders Norway Q3 2026',
      '2026-07-01',
      '2026-10-01',
      'Q3 2026',
      '1 Jul to 30 Sep 2026 (the whole quarter, including the days after today; UTC)',
    ],
    ['Orders Norway 2026-08-04', '2026-08-04', '2026-08-05', '2026-08-04', '4 Aug 2026 (UTC)'],
    [
      'Orders Norway 2026-08-04 to 2026-08-10',
      '2026-08-04',
      '2026-08-11',
      '2026-08-04 to 2026-08-10',
      '4-10 Aug 2026 (UTC)',
    ],
    [
      'Orders Norway last 7 days',
      '2026-07-30',
      '2026-08-06',
      'last 7 days',
      '30 Jul to 5 Aug 2026 (the 7 days to today; UTC)',
    ],
    [
      'Orders Norway December 2026',
      '2026-12-01',
      '2027-01-01',
      'December 2026',
      '1-31 Dec 2026 (UTC)',
    ],
  ])('extracts %s deterministically', (text, start, end, words, reads_as) => {
    expect(extractScope(text, terms, '2026-08-05')).toEqual({
      status: 'resolved',
      scope: {
        metrics: ['metric:orders'],
        filters: { 'dim:market': ['val:market/norway'] },
        window: { start, end },
      },
      dates: { words, reads_as },
    })
  })
  it.each([
    ['Orders by market in August 2026', '2026-08-01', '2026-09-01'],
    ['Orders market last 7 days', '2026-07-30', '2026-08-06'],
    ['Orders market in Q3 2026', '2026-07-01', '2026-10-01'],
    ['Orders market for August 2026', '2026-08-01', '2026-09-01'],
    ['Orders market 2026-08-04', '2026-08-04', '2026-08-05'],
    ['Orders market from 2026-08-04 to 2026-08-10', '2026-08-04', '2026-08-11'],
    ['Orders market last quarter', '2026-04-01', '2026-07-01'],
    ['Orders market this year', '2026-01-01', '2026-08-06'],
  ])('does not read a date phrase as a dimension value: %s', (text, start, end) => {
    // The question names the market without a value: every market is in (FR-302).
    expect(extractScope(text, terms, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: {
        metrics: ['metric:orders'],
        filters: { 'dim:market': [] },
        window: { start, end },
      },
    })
  })
  it.each([
    'Orders market Xland August 2026',
    'Orders Norway August 2026 September 2026',
    'Orders Norway 2026-02-30',
    'Orders Norway 2026-08-10 to 2026-08-01',
    'Orders Norway last 0 days',
  ])('asks for detail instead of guessing: %s', (text) =>
    expect(extractScope(text, terms, '2026-08-05').status).toBe('need_more_detail'),
  )
  describe('a question without dates (round 4 of the real-model test)', () => {
    const today = { start: '2026-08-05', end: '2026-08-06' }
    const assumed = { date: '2026-08-05', time_zone: 'UTC', reason: 'no date given' }
    it.each([
      'Orders Norway',
      'Orders Norway sometime',
      'How may orders in Norway change?',
      'How much did customers put into Norway orders right now?',
    ])('is read at today, and says so: %s', (text) => {
      expect(extractScope(text, terms, '2026-08-05')).toEqual({
        status: 'resolved',
        scope: {
          metrics: ['metric:orders'],
          filters: { 'dim:market': ['val:market/norway'] },
          window: today,
        },
        assumed,
      })
    })
    it('reads the structured scope of an agent that passed no window at today', () => {
      expect(
        extractScope('How much did customers put into their accounts?', terms, '2026-08-05', {
          metrics: ['Orders'],
          filters: { Market: ['Norway'] },
        }),
      ).toMatchObject({ status: 'resolved', scope: { window: today }, assumed })
    })
    it('reads the dates the words of the round 4 question give, and assumes nothing', () => {
      // The agent of round 4 passed the names and no window; "this past week" is the 7 days to
      // today, as the golden case reads it, and "last week" is the last whole week.
      for (const [question, window, reads_as] of [
        [
          'How much did customers put into their accounts this past week?',
          { start: '2026-07-30', end: '2026-08-06' },
          '30 Jul to 5 Aug 2026 (the 7 days to today; UTC)',
        ],
        [
          'How were orders in Norway last week?',
          { start: '2026-07-27', end: '2026-08-03' },
          '27 Jul to 2 Aug 2026 (last week, Monday to Sunday; UTC)',
        ],
      ] as const) {
        const read = extractScope(question, terms, '2026-08-05', {
          metrics: ['Orders'],
          filters: { Market: ['Norway'] },
        })
        expect(read).toMatchObject({ status: 'resolved', scope: { window } })
        expect(read).toHaveProperty('dates.reads_as', reads_as)
        expect(read).not.toHaveProperty('assumed')
      }
    })
    it('never replaces dates the caller gave, read or not', () => {
      const window = { start: '2026-07-01', end: '2026-07-08' }
      expect(extractScope('Orders Norway this past week', terms, '2026-08-05', { window })).toEqual(
        {
          status: 'resolved',
          scope: {
            metrics: ['metric:orders'],
            filters: { 'dim:market': ['val:market/norway'] },
            window,
          },
        },
      )
      expect(extractScope('Orders Norway last 7 days', terms, '2026-08-05')).not.toHaveProperty(
        'assumed',
      )
      // Dates Heed cannot read are still dates: it asks for them, says which words it could
      // not read and what it reads, instead of reading today.
      for (const [text, input] of [
        ['Orders Norway 2026-02-30', '2026-02-30'],
        ['Orders Norway last 0 days', 'last 0 days'],
        ['Orders Norway since the launch', 'since the launch'],
        ['Orders Norway around the summer', 'around the summer'],
        ['Orders Norway in the first week of October', 'first week of October'],
        ['Orders Norway from early 2024', 'early 2024'],
        ['Orders Norway earlier this year', 'earlier this year'],
        ['Orders Norway August 2026 September 2026', 'August 2026, September 2026'],
      ] as const)
        expect(extractScope(text, terms, '2026-08-05')).toEqual({
          status: 'need_more_detail',
          issues: [
            {
              field: 'dates',
              input,
              options: [],
              message: expect.stringMatching(
                /^('.+' cannot be read as dates\. The dates that can be read: a day \(5 Aug 2026\), a range of days \(1-31 Jul 2026\), a month \(July 2026\), a quarter \(Q2 2026\), a year \(2026\), this, last or next week, month, quarter or year, year to date, and the last 30 days\. Ask with one of these, or pass window with from and to\.|The question names more than one period .+ Ask about one, or pass window with from and to for the days that cover them\.)$/,
              ) as string,
            },
          ],
        })
    })
    it('still asks for a metric or a market when the question names neither', () => {
      expect(extractScope('What happened this past week?', terms, '2026-08-05')).toEqual({
        status: 'need_more_detail',
        issues: [
          {
            field: 'scope',
            input: 'What happened this past week?',
            options: expect.any(Array) as string[],
          },
        ],
      })
    })
    it('asks for dates when they are required, to coach a question, and says what it reads', () => {
      expect(
        extractScope('Orders Norway', terms, '2026-08-05', {}, { datesRequired: true }),
      ).toEqual({
        status: 'need_more_detail',
        issues: [
          {
            field: 'dates',
            input: 'Orders Norway',
            options: [],
            message: expect.stringMatching(
              /^The question gives no dates\. The dates that can be read: a day/,
            ) as string,
          },
        ],
      })
      // Dates in the words are read for the coach as for get_context.
      expect(
        extractScope('Orders Norway this year', terms, '2026-08-05', {}, { datesRequired: true }),
      ).toMatchObject({ status: 'resolved', scope: { window: { start: '2026-01-01' } } })
    })
    it('says the day, its time zone and why, with a sentence to repeat', () => {
      expect(
        assumedDate({ date: '2026-10-14', time_zone: 'UTC', reason: 'no date given' }),
      ).toEqual({
        note: {
          date: '2026-10-14',
          time_zone: 'UTC',
          reason: 'no date given',
          sentence: 'I assumed today, 14 October 2026. Tell me if you meant a different period.',
        },
        instruction:
          'The question gave no dates, so today was assumed (assumed_date). Say so in your answer: "I assumed today, 14 October 2026. Tell me if you meant a different period."',
        statement:
          'No dates were given, so today was assumed, 14 Oct 2026 (UTC), with the items that apply on that day: an item that starts after it or ended before it is not given. For another period, call again with window.',
      })
    })
  })
  it('reads a named dimension as every value, and a question naming none as no filter', () => {
    expect(extractScope('Orders by market August 2026', terms, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:orders'], filters: { 'dim:market': [] } },
    })
    // A dimension alone is scope (FR-304): an item about any market applies to it.
    expect(extractScope('Which market August 2026', terms, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: { metrics: [], filters: { 'dim:market': [] } },
    })
    expect(extractScope('Total orders August 2026', terms, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:orders'], filters: {} },
    })
    // A value names its dimension too.
    expect(extractScope('Orders market Norway August 2026', terms, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: { filters: { 'dim:market': ['val:market/norway'] } },
    })
  })
  it('uses structured fields instead of conflicting text and preserves all-value filters', () => {
    expect(
      extractScope('Norway August 2026', terms, '2026-08-05', {
        metrics: ['Revenue'],
        filters: { Market: [] },
      }),
    ).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:revenue'], filters: { 'dim:market': [] } },
    })
  })
  it('asks about unknown structured values and alias collisions', () => {
    expect(
      extractScope('', terms, '2026-08-05', {
        metrics: ['Orders'],
        filters: { Market: ['Xland'] },
        window: { start: '2026-08-01', end: '2026-09-01' },
      }),
    ).toMatchObject({
      status: 'need_more_detail',
      issues: [
        {
          field: 'dim:market',
          input: 'Xland',
          options: ['val:market/norway', 'val:market/spain'],
        },
      ],
    })
    const ambiguous = terms.map((term) =>
      term.kind === 'dimension_value' ? { ...term, aliases: ['Same'] } : term,
    )
    expect(resolveTerm('Same', ambiguous, ['dimension_value'])).toMatchObject({
      status: 'need_more_detail',
      options: ['val:market/norway', 'val:market/spain'],
    })
  })
  describe('the member names a data tool queried (CON-517)', () => {
    const august = { start: '2026-08-01', end: '2026-09-01' }
    const market = { ...terms[3]!, definitionRefs: ['cube:segments.market'] }
    const vocabulary = terms.map((term) => (term.key === 'dim:market' ? market : term))

    it('resolves a member or its definition ref to the term that points at it', () => {
      for (const metric of ['payments.orders', 'cube:payments.orders', 'Payments.Orders'])
        expect(
          extractScope('', vocabulary, '2026-08-05', {
            metrics: [metric],
            filters: { 'segments.market': ['Norway'] },
            window: august,
          }),
        ).toEqual({
          status: 'resolved',
          scope: {
            metrics: ['metric:orders'],
            filters: { 'dim:market': ['val:market/norway'] },
            window: august,
          },
        })
      // In the question's words too, as a whole name before the names inside it.
      expect(
        extractScope('payments.revenue in Norway, August 2026', vocabulary, '2026-08-05'),
      ).toMatchObject({ status: 'resolved', scope: { metrics: ['metric:revenue'] } })
    })

    it('says plainly when no term points at a member, and which name is closest', () => {
      const asked = extractScope('', vocabulary, '2026-08-05', {
        metrics: ['payments.order_total'],
        window: august,
      })
      expect(asked).toMatchObject({
        status: 'need_more_detail',
        issues: [
          {
            field: 'metrics',
            input: 'payments.order_total',
            options: ['metric:orders'],
            message:
              'No metric or metric group has the member payments.order_total as its definition. Did you mean Orders (metric:orders)?',
          },
          // Nothing resolved, so the scope names no metric either.
          { field: 'scope', input: '' },
        ],
      })
      // In the words, an unknown member is never read as the name inside it ("orders").
      expect(
        extractScope('payments.order_total in Norway, August 2026', vocabulary, '2026-08-05'),
      ).toMatchObject({
        status: 'need_more_detail',
        issues: [
          {
            field: 'scope',
            input: 'payments.order_total',
            options: ['metric:orders'],
            message:
              'No metric or dimension has the member payments.order_total as its definition. Did you mean Orders (metric:orders)?',
          },
        ],
      })
    })

    it('reads a dotted word outside every known view as plain text, not as a member', () => {
      for (const question of ['is orders.also affected in August 2026', 'what about shop24.com']) {
        const result = extractScope(question, vocabulary, '2026-08-05')
        if (result.status === 'need_more_detail')
          expect(
            result.issues.some(
              (issue) => issue.field === 'scope' && issue.message?.includes('the member'),
            ),
          ).toBe(false)
      }
    })

    it('names a bare member of a view no term points at as unknown', () => {
      expect(extractScope('traffic.sessions', vocabulary, '2026-08-05')).toMatchObject({
        status: 'need_more_detail',
        issues: expect.arrayContaining([
          expect.objectContaining({
            field: 'scope',
            input: 'traffic.sessions',
            message: expect.stringContaining('has the member traffic.sessions') as string,
          }),
        ]) as unknown,
      })
    })

    it('suggests no metric that shares letters with a member by chance', () => {
      const operations = { ...terms[1]!, key: 'metric:operations', name: 'Operations' }
      const ask = (metric: string) =>
        extractScope('', [...vocabulary, operations], '2026-08-05', {
          metrics: [metric],
          window: august,
        })
      // A typo of a name may be near; a member's own name must be closer to be suggested.
      expect(ask('Sessions')).toMatchObject({
        issues: [{ message: expect.stringContaining('Did you mean Operations') as string }, {}],
      })
      expect(ask('traffic.sessions')).toMatchObject({
        issues: [
          {
            input: 'traffic.sessions',
            message: 'No metric or metric group has the member traffic.sessions as its definition.',
          },
          { field: 'scope' },
        ],
      })
    })

    it('names an unknown plain name with the closest one too', () => {
      expect(
        extractScope('', vocabulary, '2026-08-05', { metrics: ['Ordrs'], window: august }),
      ).toMatchObject({
        issues: [
          {
            message:
              "There is no metric or metric group named 'Ordrs'. Did you mean Orders (metric:orders)?",
          },
          { field: 'scope' },
        ],
      })
    })
  })

  it('matches longest phrases, whole words, accents and aliases', () => {
    const vocabulary = [
      ...terms,
      { ...terms[1]!, key: 'metric:net', name: 'Net Orders', aliases: ['Dépôts nets'] },
    ]
    expect(extractScope('DÉPÔTS NETS Norway August 2026', vocabulary, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:net'] },
    })
    expect(extractScope('Net Orders Norway August 2026', vocabulary, '2026-08-05')).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:net'] },
    })
    expect(extractScope('DepositsX August 2026', vocabulary, '2026-08-05').status).toBe(
      'need_more_detail',
    )
  })
  it('normalizes idempotently and re-extracts its own resolved scope unchanged', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(normalizeName(normalizeName(value))).toBe(normalizeName(value))
      }),
      { seed: 3, numRuns: 1000 },
    )
    // The places of a normalised text are places in the text as written, in order.
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (value) => {
        const { text, at } = normalizeWithMap(value)
        expect(text).toBe(normalizeName(value))
        expect(at).toHaveLength(text.length)
        expect(
          at.every((place, i) => place < value.length && (i === 0 || place >= at[i - 1]!)),
        ).toBe(true)
      }),
      { seed: 5, numRuns: 1000 },
    )
    expect(normalizeWithMap('  ÆBLE  Ø ßÉ ')).toEqual({
      text: 'aeble o sse',
      at: [2, 2, 3, 4, 5, 6, 8, 9, 10, 10, 11],
    })
    fc.assert(
      fc.property(
        fc.constantFrom('Norway', 'Spain', 'Norge'),
        fc.integer({ min: 1, max: 100 }),
        (market, days) => {
          const first = extractScope(`Orders ${market} last ${days} days`, terms, '2026-08-05')
          expect(first.status).toBe('resolved')
          // Given back as fields, the scope is the same; the words' dates are read no more.
          if (first.status === 'resolved')
            expect(extractScope('ignored', terms, '2026-08-05', first.scope)).toEqual({
              status: 'resolved',
              scope: first.scope,
            })
        },
      ),
      { seed: 4, numRuns: 500 },
    )
  })
})

describe('reading a question for Try it', () => {
  const keys = (question: string, today = '2026-10-13') =>
    readQuestion(question, terms, today).terms.map((term) => term.key)

  it('reads what the question names, as get_context does, and its dates', () => {
    expect(readQuestion('Orders Norway August 2026', terms, '2026-10-13')).toMatchObject({
      window: { start: '2026-08-01', end: '2026-09-01' },
    })
    expect(keys('Orders Norway August 2026')).toEqual(['metric:orders', 'val:market/norway'])
    expect(keys('orders by market')).toEqual(['metric:orders', 'dim:market'])
  })

  it('reads a month without a year as the latest one that has started', () => {
    expect(readQuestion('why did orders drop in august', terms, '2026-10-13').window).toEqual({
      start: '2026-08-01',
      end: '2026-09-01',
    })
    expect(readQuestion('orders in december', terms, '2026-10-13').window).toEqual({
      start: '2025-12-01',
      end: '2026-01-01',
    })
    expect(readQuestion('orders in october', terms, '2026-10-13').window).toEqual({
      start: '2026-10-01',
      end: '2026-11-01',
    })
    // "may" is also a word; two months name no one month.
    expect(readQuestion('how may orders change', terms, '2026-10-13').window).toBeNull()
    expect(readQuestion('orders august or september', terms, '2026-10-13').window).toBeNull()
  })

  it('gives the part of a scope a question names, and no dates where get_context reads today', () => {
    expect(extractScope('Orders in Norway', terms, '2026-10-13')).toMatchObject({
      status: 'resolved',
      assumed: { date: '2026-10-13' },
    })
    expect(readQuestion('Orders in Norway', terms, '2026-10-13')).toEqual({
      terms: [
        expect.objectContaining({ key: 'metric:orders' }),
        expect.objectContaining({ key: 'val:market/norway' }),
      ],
      window: null,
      dates: null,
      issues: [],
      spans: [
        { start: 0, end: 6, keys: ['metric:orders'] },
        { start: 10, end: 16, keys: ['val:market/norway'] },
      ],
    })
    expect(readQuestion('what is going on', terms, '2026-10-13')).toMatchObject({
      terms: [],
      window: null,
    })
  })

  it('reads the dates get_context reads, and says where each name and the dates are', () => {
    const question = 'What were  ÓRDERS in Norway this year?'
    const read = readQuestion(question, terms, '2026-10-13')
    expect(read).toMatchObject({
      window: { start: '2026-01-01', end: '2026-10-14' },
      dates: { words: 'this year', reads_as: '1 Jan to 13 Oct 2026 (this year so far; UTC)' },
      issues: [],
    })
    // The places are in the words as written, accents and double spaces too.
    expect(read.spans.map(({ start, end }) => question.slice(start, end))).toEqual([
      'ÓRDERS',
      'Norway',
      'this year',
    ])
    expect(read.spans.at(-1)).toMatchObject({ dates: true })
  })

  it('says a name that means several things, and dates it cannot read', () => {
    const vocabulary = terms.map((term) =>
      term.kind === 'dimension_value' ? { ...term, aliases: ['Same'] } : term,
    )
    expect(readQuestion('orders in same since the launch', vocabulary, '2026-10-13')).toMatchObject(
      {
        terms: [{ key: 'metric:orders' }],
        window: null,
        issues: [
          {
            field: 'scope',
            input: 'same',
            options: ['val:market/norway', 'val:market/spain'],
          },
          { field: 'dates', input: 'since the launch' },
        ],
      },
    )
  })
})

describe('a definition question', () => {
  it.each([
    'What does net revenue mean?',
    'How is the metric churn rate defined?',
    'Where does our definition of marketing spend come from?',
    'What counts as an active customer?',
    'What does GMV stand for in our reports?',
    'Has the way we calculate retention changed lately?',
    'What does verification pass rate measure in Germany?',
    "What's margin rate?",
    'What is return on ad spend, and what does Heed add to it for Spain?',
  ])('asks what a metric is: %s', (question) => expect(asksDefinition(question)).toBe(true))

  it.each([
    'How is revenue doing in Norway this month?',
    'Orders Norway August 2026',
    'Sorry, I meant Poland, not the Netherlands.',
    'Did anything happen to orders in the United Kingdom last week?',
  ])('asks about data only: %s', (question) => expect(asksDefinition(question)).toBe(false))
})
