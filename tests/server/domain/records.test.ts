import { describe, expect, it } from 'vitest'
import { readQuestion } from '../../../src/domain/scope.ts'
import {
  answerRecords,
  readRecordsPeriod,
  recogniseRecords,
  recordsAnswerSchema,
  refusedAnswer,
  type RecordsAsk,
  type RecordsIntent,
  type RecordsItem,
  type RecordsWorld,
} from '../../../src/domain/records.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'

/*
  Records answers: the closed list of seven questions about the context's own records, read by
  fixed patterns, each answered by a fixed read and a template. The phrasings below are the set the
  design was measured on, with the context questions that must stay context questions; a miss
  leaves a question to the answer engine.
*/

const metric = (id: string, name: string, areaId: string | null, aliases: string[] = []): Term => ({
  key: `metric:${id}`,
  kind: 'metric',
  name,
  aliases,
  parentKey: null,
  areaId,
  definitionRefs: [],
})
const market = (id: string, name: string): Term => ({
  key: `val:market/${id}`,
  kind: 'dimension_value',
  name,
  aliases: [],
  parentKey: 'dim:market',
  areaId: null,
  definitionRefs: [],
})
const terms: Term[] = [
  metric('orders', 'Orders', 'sales'),
  metric('net_revenue', 'Net revenue', 'sales', ['sales', 'turnover']),
  metric('returns', 'Returns', 'sales'),
  metric('discount_cost', 'Discount cost', 'marketing'),
  metric('churn_rate', 'Churn rate', 'customer_value'),
  metric('conversion_rate', 'Conversion rate', 'marketing'),
  metric('units_sold', 'Units sold', 'sales'),
  metric('gross_sales', 'Gross sales', 'sales'),
  metric('new_customers', 'New customers', 'customer_value'),
  metric('orphan', 'Orphan metric', null),
  {
    key: 'dim:market',
    kind: 'dimension',
    name: 'Market',
    aliases: ['Country'],
    parentKey: null,
    areaId: null,
    definitionRefs: [],
  },
  {
    key: 'dim:channel',
    kind: 'dimension',
    name: 'Channel',
    aliases: [],
    parentKey: null,
    areaId: 'marketing',
    definitionRefs: [],
  },
  {
    key: 'val:channel/email',
    kind: 'dimension_value',
    name: 'Email',
    aliases: ['Newsletter'],
    parentKey: 'dim:channel',
    areaId: null,
    definitionRefs: [],
  },
  ...[
    ['norway', 'Norway'],
    ['spain', 'Spain'],
    ['germany', 'Germany'],
    ['france', 'France'],
    ['poland', 'Poland'],
    ['sweden', 'Sweden'],
    ['italy', 'Italy'],
    ['united_kingdom', 'United Kingdom'],
  ].map(([id, name]) => market(id!, name!)),
]
const domains = [
  { id: 'sales', name: 'Sales' },
  { id: 'marketing', name: 'Marketing' },
  { id: 'paid_media', name: 'Paid media' },
  { id: 'customer_value', name: 'Customer value' },
  { id: 'sandbox', name: 'Sandbox' },
]
// Friday 30 October 2026, 15:30 UTC.
const now = '2026-10-30T15:30:00.000Z'
const today = now.slice(0, 10)

/** A question read as the service reads it: the engine's reader first, then the patterns. */
function recognise(question: string) {
  const read = readQuestion(question, terms, today)
  return recogniseRecords(question, { spans: read.spans, terms, domains, now })
}
const intentOf = (question: string): RecordsIntent | 'refused' | null => {
  const r = recognise(question)
  return r ? (r.type === 'refused' ? 'refused' : r.ask.intent) : null
}

describe('reading a records question', () => {
  // [question, the intent it is]: the design's phrasing set, and more.
  const positives: [string, RecordsIntent][] = [
    ['give me context created in last 24 hours?', 'created'],
    ['what was created recently?', 'created'],
    ['whats new since Monday', 'created'],
    ["what's new this week", 'created'],
    ['show me the newest context items', 'created'],
    ['which context items were added yesterday', 'created'],
    ['anything new in Sales this week?', 'created'],
    ['anything I should know about that was added lately', 'created'],
    ['did anyone add anything today', 'created'],
    ['show me what has been published since yesterday', 'created'],
    ['What context was added in the past 3 days?', 'created'],
    ['which guides were created this month', 'created'],
    ['what changed this week?', 'changed'],
    ['what was updated in the last 7 days', 'changed'],
    ['what has changed in Marketing since Monday', 'changed'],
    ['which items were edited today', 'changed'],
    ['what changed last week', 'changed'],
    ['who owns Orders?', 'owner'],
    ['who owns the Sales domain?', 'owner'],
    ['who is responsible for Paid media', 'owner'],
    ['who looks after Customer value?', 'owner'],
    ['who are the owners of Marketing', 'owner'],
    ['which items have no owner?', 'owner'],
    ['are there domains without an owner', 'owner'],
    ['what is due for a check?', 'due'],
    ['show me everything that is overdue', 'due'],
    ['which context items are out of date in Sales?', 'due'],
    ['what needs a review', 'due'],
    ['what is stale', 'due'],
    ['which items need rechecking', 'due'],
    ['what is due for a check in Sales?', 'due'],
    ['what is archived?', 'archived'],
    ['show archived items in Marketing', 'archived'],
    ['which rules were retired', 'archived'],
    ['how many definitions are in Sales?', 'count'],
    ['how many context items does Sales have?', 'count'],
    ['how many guides do we have', 'count'],
    ['number of warnings in Paid media', 'count'],
    ['how many context items are there in total', 'count'],
    ['what did agents ask that found nothing?', 'asked_nothing'],
    ['what questions did agents not find an answer to', 'asked_nothing'],
    ['what is missing from the context?', 'asked_nothing'],
    ['which questions went unanswered this week', 'asked_nothing'],
    ['list 10 dimensions', 'terms'],
    ['list dimensions', 'terms'],
    ['what dimensions are there', 'terms'],
    ['how many dimensions', 'terms'],
    ['how many metrics', 'terms'],
    ['list metrics', 'terms'],
    ['metrics in Sales', 'terms'],
    ['list 10 metrics in Sales', 'terms'],
    ['which metrics does Sales have?', 'terms'],
    ['list definitions', 'terms'],
    ['what definitions are there', 'terms'],
    ['show me all the metrics', 'terms'],
    ['what markets are there', 'values'],
    ['markets', 'values'],
    ['how many markets are there?', 'values'],
    ['which countries do we sell in', 'values'],
    ['list the channels', 'values'],
    ['what are the values of Market?', 'values'],
    ['What values does Channel have?', 'values'],
  ]
  it.each(positives)('reads "%s" as %s', (question, intent) => {
    expect(intentOf(question)).toBe(intent)
  })

  // Questions about the business: they stay with the answer engine, records nouns or not.
  const negatives = [
    'Why did orders in Norway drop in August?',
    'What should I know about Orders in Norway?',
    'What changed in returns in the United Kingdom this week?',
    'What is missing from our revenue figures in the United Kingdom?',
    'Do Norway orders include gift-card money?',
    'How did orders in Spain change in October 2026?',
    'What was net revenue in Germany last week?',
    'What is new customers?',
    'How many new customers did we get in Sweden?',
    'What changed in Orders this week?',
    'What is the latest on orders in Norway?',
    'Which market had the most returns last quarter?',
    'Why did turnover in Poland rise?',
    'Is online share in Spain affected by the new rule?',
    'Which events hit orders in Norway this week?',
    'How many items did we sell in Norway last week?',
    'hello',
    'tell me a joke',
    'what is a context item?',
    'list orders in Norway',
    'what changed in returns this week',
    'list 10 orders in Norway',
    'what is Churn rate',
    'what does churn rate mean',
    'what market',
    'Orders by market',
    'which metrics are missing in Norway',
    'which products sold best last month',
    'why did campaigns drop in October?',
    'which channels performed worst',
  ]
  it.each(negatives)('leaves "%s" to the answer engine', (question) => {
    expect(intentOf(question)).toBeNull()
  })

  // Questions about one person's work: refused, never looked up.
  const people = [
    'what did Maria write this week?',
    'what has Jon Abara checked lately',
    'which items were created by Sofia?',
    'who changed the Orders context?',
    "show me Maria's changes",
    'what did I write this week',
  ]
  it.each(people)('refuses "%s", a question about one person', (question) => {
    expect(intentOf(question)).toBe('refused')
  })

  it('reads the domain by its name, before a synonym of a metric that shares the word', () => {
    // "sales" is also a synonym of Net revenue here: the domain wins.
    const r = recognise('how many definitions are in Sales?')
    expect(r).toMatchObject({
      type: 'records',
      ask: { intent: 'count', domain: 'sales', kind: 'definition' },
    })
  })

  it('reads what of the vocabulary is asked, how many, and the domain before a synonym', () => {
    expect(recognise('list 10 dimensions')).toMatchObject({
      ask: {
        intent: 'terms',
        domain: null,
        catalogue: { of: 'dimension', dimension: null, limit: 10, count: false },
      },
    })
    expect(recognise('how many metrics')).toMatchObject({
      ask: { catalogue: { of: 'metric', limit: null, count: true } },
    })
    // "Sales" is a domain and a synonym of Net revenue: with a catalogue noun it is the domain.
    expect(recognise('list 10 metrics in Sales')).toMatchObject({
      ask: { intent: 'terms', domain: 'sales', catalogue: { of: 'metric', limit: 10 } },
    })
    expect(recognise('list definitions')).toMatchObject({
      ask: { catalogue: { of: 'definition' } },
    })
    // A dimension's values, by its name or another name in the plural, or with "values".
    expect(recognise('what markets are there')).toMatchObject({
      ask: { intent: 'values', domain: null, catalogue: { of: 'value', dimension: 'dim:market' } },
    })
    expect(recognise('which countries do we have')).toMatchObject({
      ask: { catalogue: { dimension: 'dim:market' } },
    })
    expect(recognise('how many markets are there')).toMatchObject({
      ask: { catalogue: { dimension: 'dim:market', count: true } },
    })
    expect(recognise('markets?')).toMatchObject({ ask: { catalogue: { dimension: 'dim:market' } } })
    expect(recognise('what values does Market have')).toMatchObject({
      ask: { catalogue: { dimension: 'dim:market' } },
    })
    expect(recognise('list three channels')).toMatchObject({
      ask: { catalogue: { dimension: 'dim:channel', limit: 3 } },
    })
    expect(recognise('what are the values of Market?')).toMatchObject({
      ask: { catalogue: { dimension: 'dim:market', count: false } },
    })
    // "How many definitions" stays the count of definitions it was.
    expect(recognise('how many definitions are there?')).toMatchObject({
      ask: { intent: 'count', kind: 'definition' },
    })
  })

  it.each([
    'which products sold last week',
    'what campaigns ran',
    'which channels drove traffic',
  ])('leaves "%s", a question about the business, to the answer engine', (question) => {
    expect(recognise(question)).toBeNull()
  })

  it('takes the metric a question asks the owner of', () => {
    expect(recognise('who owns Orders?')).toMatchObject({
      ask: { intent: 'owner', metric: 'metric:orders', domain: null, noOwner: false },
    })
    expect(recognise('which items have no owner?')).toMatchObject({ ask: { noOwner: true } })
  })

  it('takes the kind of context item a question names', () => {
    expect(recognise('how many guides do we have')).toMatchObject({ ask: { kind: 'guide' } })
    expect(recognise('which rules were retired')).toMatchObject({ ask: { kind: 'note' } })
    expect(recognise('number of warnings in Paid media')).toMatchObject({
      ask: { kind: 'issue', domain: 'paid_media' },
    })
  })

  it('reads the owner’s question with its period: the 24 hours to now, in UTC', () => {
    expect(recognise('give me context created in last 24 hours?')).toMatchObject({
      ask: {
        intent: 'created',
        period: {
          start: '2026-10-29T15:30:00.000Z',
          end: now,
          words: 'in the last 24 hours',
          label: '29 Oct 15:30 to 30 Oct 15:30, UTC',
          assumed: false,
        },
      },
    })
  })

  it('takes the last 7 days when a question about changes names no period, and says so', () => {
    expect(recognise('what was created recently?')).toMatchObject({
      ask: {
        period: { start: '2026-10-23T15:30:00.000Z', words: 'in the last 7 days', assumed: true },
      },
    })
  })
})

describe('the period a question names', () => {
  const read = (words: string, at = now) => readRecordsPeriod(words, at)
  it('reads hours and days back from now', () => {
    expect(read('in the last 24 hours')).toMatchObject({
      start: '2026-10-29T15:30:00.000Z',
      end: now,
    })
    expect(read('over the past 3 days')).toMatchObject({
      start: '2026-10-27T15:30:00.000Z',
      words: 'in the last 3 days',
    })
    expect(read('in the last two weeks')).toMatchObject({ start: '2026-10-16T15:30:00.000Z' })
    expect(read('the last hour')).toMatchObject({ start: '2026-10-30T14:30:00.000Z' })
  })
  it('reads whole UTC days from midnight, a week from Monday', () => {
    expect(read('today')).toMatchObject({ start: '2026-10-30T00:00:00.000Z', end: now })
    expect(read('yesterday')).toMatchObject({
      start: '2026-10-29T00:00:00.000Z',
      end: '2026-10-30T00:00:00.000Z',
      label: '29 Oct 00:00 to 30 Oct 00:00, UTC',
    })
    expect(read('this week')).toMatchObject({ start: '2026-10-26T00:00:00.000Z', end: now })
    expect(read('last week')).toMatchObject({
      start: '2026-10-19T00:00:00.000Z',
      end: '2026-10-26T00:00:00.000Z',
    })
    expect(read('since Monday')).toMatchObject({
      start: '2026-10-26T00:00:00.000Z',
      words: 'since Monday',
    })
    // A weekday later in the week than today is last week's.
    expect(read('since Saturday')).toMatchObject({ start: '2026-10-24T00:00:00.000Z' })
    expect(read('since Friday')).toMatchObject({ start: '2026-10-30T00:00:00.000Z' })
    expect(read('this month')).toMatchObject({ start: '2026-10-01T00:00:00.000Z' })
    expect(read('last month')).toMatchObject({
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-10-01T00:00:00.000Z',
    })
  })
  it('crosses midnight, a month and a year in UTC', () => {
    expect(read('last 24 hours', '2026-01-01T00:10:00.000Z')).toMatchObject({
      start: '2025-12-31T00:10:00.000Z',
      label: '31 Dec 2025 00:10 to 1 Jan 00:10, UTC',
    })
    expect(read('this week', '2026-11-01T09:00:00.000Z')).toMatchObject({
      start: '2026-10-26T00:00:00.000Z',
    })
  })
  it('names no period when the words name none', () => {
    expect(read('what is new')).toBeNull()
  })
})

/* ---------- answers ---------- */

const at = (day: string, time = '09:00') => `${day}T${time}:00.000Z`
const item = (over: Partial<RecordsItem> & Pick<RecordsItem, 'id'>): RecordsItem => ({
  kind: 'note',
  areaId: 'sales',
  title: `Item ${over.id}`,
  status: 'live',
  reviewDate: '2027-01-01',
  checkFlag: null,
  publishedAt: at('2026-10-02'),
  changedAt: at('2026-10-02'),
  checkedAt: at('2026-10-02'),
  archivedAt: null,
  owners: [],
  ...over,
})
const world = (items: RecordsItem[], extra: Partial<RecordsWorld> = {}): RecordsWorld => ({
  items,
  areas: [
    { id: 'sales', name: 'Sales', ownerIds: ['p-jon', 'p-sofia'] },
    { id: 'marketing', name: 'Marketing', ownerIds: ['p-lars'] },
    { id: 'sandbox', name: 'Sandbox', ownerIds: [] },
  ],
  people: { 'p-jon': 'Jon Abara', 'p-sofia': 'Sofia Brandt', 'p-lars': 'Lars Holm' },
  terms,
  asked: null,
  ...extra,
})
const ask = (over: Partial<RecordsAsk> & Pick<RecordsAsk, 'intent'>): RecordsAsk => ({
  domain: null,
  kind: null,
  metric: null,
  period: null,
  noOwner: false,
  ...over,
})
const answer = (a: RecordsAsk, w: RecordsWorld) => {
  const found = answerRecords(a, w, now)
  // Every answer fits the shape the service sends.
  expect(recordsAnswerSchema.safeParse(found).success).toBe(true)
  return found
}
const last24 = readRecordsPeriod('last 24 hours', now)!

describe('a records answer', () => {
  it('says nothing was created, and when the latest was, against the period it read', () => {
    const a = answer(
      ask({ intent: 'created', period: last24 }),
      world([item({ id: 'a' }), item({ id: 'b', publishedAt: at('2026-09-01') })]),
    )
    expect(a.sentence).toBe('Nothing was created in the last 24 hours.')
    expect(a.detail).toBe('The latest context item was created on 2 Oct 2026:')
    expect(a.detailItem).toEqual({ id: 'a', title: 'Item a' })
    expect(a.understood).toBe('Context created, last 24 hours')
    expect(a.period?.label).toBe('29 Oct 15:30 to 30 Oct 15:30, UTC')
    expect(a.rows).toEqual([])
    expect(a.read).toBe('Read 2 context items')
  })

  it('lists what was created, newest first, five at most, and counts them all', () => {
    const fresh = Array.from({ length: 7 }, (_, n) =>
      item({ id: `n${n}`, publishedAt: at('2026-10-30', `0${n}:00`) }),
    )
    const a = answer(
      ask({ intent: 'created', period: last24 }),
      world([...fresh, item({ id: 'old' })]),
    )
    expect(a.sentence).toBe('7 context items were created in the last 24 hours.')
    expect(a.total).toBe(7)
    expect(a.rows.map((r) => (r.type === 'item' ? r.id : ''))).toEqual([
      'n6',
      'n5',
      'n4',
      'n3',
      'n2',
    ])
    expect(a.shown).toBe('Showing the 5 newest')
    expect(a.note).toBe('Created means first published, when agents could first get it.')
  })

  it('counts each change once, for the last thing that happened to it', () => {
    const week = readRecordsPeriod('this week', now)!
    const a = answer(
      ask({ intent: 'changed', period: week }),
      world([
        item({ id: 'added', publishedAt: at('2026-10-27'), changedAt: at('2026-10-27') }),
        item({ id: 'changed', changedAt: at('2026-10-28') }),
        item({ id: 'checked', checkedAt: at('2026-10-29') }),
        item({ id: 'gone', status: 'archived', archivedAt: at('2026-10-30', '08:00') }),
        item({ id: 'still' }),
      ]),
    )
    expect(a.sentence).toBe(
      '4 context items changed this week: 1 added, 1 changed, 1 checked and 1 archived.',
    )
    expect(a.rows.map((r) => r.cells[0])).toEqual(['Archived', 'Checked', 'Changed', 'Added'])
  })

  it('lists what is due for a check, oldest first, with who owns the domain', () => {
    const a = answer(
      ask({ intent: 'due', domain: 'sales' }),
      world([
        item({ id: 'late', status: 'due', reviewDate: '2026-08-09' }),
        item({ id: 'later', status: 'due', reviewDate: '2026-09-03' }),
        item({ id: 'flag', status: 'due', checkFlag: 'source_missing', reviewDate: null }),
        item({ id: 'fine' }),
        item({ id: 'elsewhere', areaId: 'marketing', status: 'due' }),
      ]),
    )
    expect(a.sentence).toBe('3 context items in Sales are due for a check.')
    expect(a.detail).toBe('Sales is owned by Jon Abara and Sofia Brandt.')
    expect(a.rows.map((r) => r.cells[0])).toEqual(['9 Aug 2026', '3 Sep 2026', 'Source missing'])
    expect(a.more).toEqual({
      label: 'Show all 3 in Context',
      to: 'context',
      domain: 'sales',
      status: 'due',
    })
  })

  it('says when nothing is due or archived: a real answer, never Not found', () => {
    expect(
      answer(ask({ intent: 'due', domain: 'marketing' }), world([item({ id: 'a' })])).sentence,
    ).toBe('Nothing in Marketing is due for a check.')
    expect(
      answer(ask({ intent: 'archived', domain: 'sales' }), world([item({ id: 'a' })])).sentence,
    ).toBe('Nothing is archived in Sales.')
    const one = answer(
      ask({ intent: 'archived' }),
      world([item({ id: 'a', status: 'archived', archivedAt: at('2026-10-01') })]),
    )
    // An item count is exact, small or not: Context shows it to everyone who may read it.
    expect(one.sentence).toBe('1 context item is archived.')
  })

  it('counts the context items in a domain by kind and status', () => {
    const a = answer(
      ask({ intent: 'count', domain: 'sales' }),
      world([
        item({ id: 'r1' }),
        item({ id: 'r2', status: 'due' }),
        item({ id: 'g1', kind: 'guide', status: 'archived' }),
        item({ id: 'm1', areaId: 'marketing' }),
      ]),
    )
    expect(a.sentence).toBe('Sales has 3 context items: 1 live, 1 due for a check and 1 archived.')
    expect(a.columns).toEqual(['Kind', 'Live', 'Due for a check', 'Archived'])
    expect(a.rows.map((r) => (r.type === 'kind' ? [r.label, ...r.cells] : []))).toEqual([
      ['Event', '0', '0', '0'],
      ['Warning', '0', '0', '0'],
      ['Rule', '1', '1', '0'],
      ['Guide', '0', '0', '1'],
      ['All', '1', '1', '1'],
    ])
  })

  it('counts the definitions of a domain from the vocabulary', () => {
    const a = answer(ask({ intent: 'count', domain: 'sales', kind: 'definition' }), world([]))
    expect(a.sentence).toBe('Sales has 5 definitions: 5 metrics and 0 dimensions.')
  })

  it('names the owners of a domain, of a metric’s domain, and the domains with none', () => {
    expect(
      answer(ask({ intent: 'owner', domain: 'sales' }), world([item({ id: 'a' })])).sentence,
    ).toBe('Jon Abara and Sofia Brandt own Sales.')
    const orders = answer(ask({ intent: 'owner', metric: 'metric:orders' }), world([]))
    expect(orders.sentence).toBe('Jon Abara and Sofia Brandt own Orders.')
    expect(orders.detail).toBe(
      'Orders is a definition in Sales. A domain has owners, not a single metric.',
    )
    expect(answer(ask({ intent: 'owner', metric: 'metric:orphan' }), world([])).sentence).toBe(
      'Orphan metric is in no domain, so nobody owns it.',
    )
    const none = answer(
      ask({ intent: 'owner', noOwner: true }),
      world([
        item({ id: 's1', areaId: 'sandbox' }),
        item({ id: 's2', areaId: 'sandbox', owners: ['p-jon'] }),
      ]),
    )
    expect(none.sentence).toBe('Sandbox has no owner, so 1 context item has nobody to check it.')
  })

  it('shows what agents asked that found nothing only from topics asked at least the minimum', () => {
    const asked: RecordsWorld['asked'] = {
      minimum: 5,
      rows: [
        {
          title: 'Orders in Spain',
          count: 9,
          atLeast: 9,
          state: 'missing',
          gap: { card: 'gap:1', draft: null },
        },
        { title: 'Returns in France', count: null, atLeast: 13, state: 'missing', gap: null },
        { title: 'Orders in Norway', count: 31, atLeast: 31, state: 'grounded', gap: null },
      ],
    }
    const a = answer(ask({ intent: 'asked_nothing' }), world([], { asked }))
    expect(a.sentence).toBe('Agents found nothing written for 2 topics this week.')
    expect(a.rows.map((r) => r.cells[0])).toEqual(['9', '13+'])
    const none = answer(
      ask({ intent: 'asked_nothing' }),
      world([], { asked: { minimum: 5, rows: [] } }),
    )
    expect(none.sentence).toBe(
      'No topic agents asked about 5 times or more this week found nothing.',
    )
  })

  it('refuses a question about one person with what Ask can say instead', () => {
    expect(refusedAnswer(world([]))).toMatchObject({
      refused: true,
      sentence: "Ask does not answer questions about one person's work.",
      offers: ['What changed this week?', 'Who owns Sales?'],
    })
  })

  it('offers questions instead only when it refuses, each one it reads as a records question', () => {
    const w = world([item({ id: 'a' })])
    expect(answer(ask({ intent: 'changed' }), w)).not.toHaveProperty('offers')
    const refused = refusedAnswer(w)
    expect(refused.refused).toBe(true)
    for (const offer of refused.refused ? refused.offers : [])
      expect(intentOf(offer), offer).not.toBeNull()
  })

  it('writes plain sentences: no dash for a pause, short enough to read at once', () => {
    const w = world([item({ id: 'a', status: 'due', reviewDate: '2026-01-01' })], {
      asked: { minimum: 5, rows: [] },
    })
    const intents = [
      'created',
      'changed',
      'due',
      'archived',
      'owner',
      'count',
      'asked_nothing',
    ] as const
    for (const intent of intents) {
      const a = answer(ask({ intent, domain: 'sales' }), w)
      for (const text of [a.sentence, a.detail ?? '', a.note ?? '', a.understood]) {
        expect(text).not.toMatch(/[\u2013\u2014]/)
        expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(25)
      }
    }
  })
})

describe('a catalogue answer', () => {
  const dims = ['Campaign', 'Channel', 'Market', 'Platform', 'Product'].map((name): Term => ({
    key: `dim:${name.toLowerCase()}`,
    kind: 'dimension',
    name,
    aliases: [],
    parentKey: null,
    areaId: null,
    definitionRefs: [],
  }))
  const vocabulary = [...terms.filter((t) => t.kind !== 'dimension'), ...dims]
  const catalogue = (
    question: string,
    over: Partial<RecordsWorld> = {
      terms: [...vocabulary, ...terms.filter((t) => t.key === 'dim:channel')],
    },
  ) => {
    const r = recogniseRecords(question, {
      spans: readQuestion(question, vocabulary, today).spans,
      terms: vocabulary,
      domains,
      now,
    })
    if (r?.type !== 'records') throw new Error(`"${question}" is no records question`)
    return answer(r.ask, world([], over))
  }

  it('lists the dimensions there are, and says when fewer than asked for', () => {
    const a = catalogue('list 10 dimensions', { terms: vocabulary })
    expect(a.sentence).toBe(
      'The workspace has 5 dimensions: Campaign, Channel, Market, Platform and Product.',
    )
    expect(a.detail).toBe('You asked for 10; there are 5.')
    expect(a.understood).toBe('Dimensions, 10 asked for')
    expect(a.read).toBe('Read 5 dimensions in Definitions')
    expect(a.rows.map((r) => (r.type === 'term' ? r.name : ''))).toEqual([
      'Campaign',
      'Channel',
      'Market',
      'Platform',
      'Product',
    ])
    expect(a.columns).toEqual(['Dimension', 'Values'])
    expect(a.shown).toBeNull()
    expect(a.more).toEqual({
      label: 'Open Definitions',
      to: 'definitions',
      domain: null,
      status: null,
    })
  })

  it('counts metrics exactly, five rows at most, and Definitions lists the rest', () => {
    const a = catalogue('how many metrics', {
      terms: vocabulary,
      areas: [{ id: 'customer_value', name: 'Customer value', ownerIds: [] }],
    })
    expect(a.sentence).toBe('The workspace has 10 metrics.')
    expect(a.understood).toBe('Count of metrics')
    expect(a.total).toBe(10)
    expect(a.rows).toHaveLength(5)
    expect(a.rows[0]).toEqual({
      type: 'term',
      key: 'metric:churn_rate',
      kind: 'metric',
      name: 'Churn rate',
      page: 'Churn rate',
      cells: ['Customer value'],
    })
    expect(a.shown).toBe('Showing 5 of 10, by name')
    expect(a.more?.label).toBe('Show all 10 in Definitions')
  })

  it('reads the domain, not the synonym, and names a few metrics', () => {
    const a = catalogue('list 10 metrics in Sales', { terms: vocabulary })
    expect(a.sentence).toBe(
      'Sales has 5 metrics: Gross sales, Net revenue, Orders, Returns and Units sold.',
    )
    expect(a.detail).toBe('You asked for 10; there are 5.')
    expect(a.domain).toEqual({ id: 'sales', name: 'Sales' })
    expect(a.more).toMatchObject({ label: 'Open Sales in Definitions', domain: 'sales' })
  })

  it('says when more were asked for than an answer lists', () => {
    const a = catalogue('list 7 metrics', { terms: vocabulary })
    expect(a.detail).toBe('You asked for 7; an answer lists 5, and Definitions lists all 10.')
    expect(a.rows).toHaveLength(5)
    expect(catalogue('list 2 metrics', { terms: vocabulary }).rows).toHaveLength(2)
    // Fewer asked for than there are: the sentence counts them, and the rows are those asked for.
    const three = catalogue('list 3 dimensions', { terms: vocabulary })
    expect(three.sentence).toBe('The workspace has 5 dimensions.')
    expect(three.detail).toBeNull()
    expect(three.shown).toBe('Showing 3 of 5, by name')
    // As many asked for as the sentence names: nothing more to say.
    expect(catalogue('list 5 dimensions', { terms: vocabulary }).detail).toBeNull()
  })

  it('counts both kinds of definition together', () => {
    const a = catalogue('list definitions', { terms: vocabulary })
    expect(a.sentence).toBe('The workspace has 15 definitions: 10 metrics and 5 dimensions.')
    expect(a.columns).toEqual(['Definition', 'Kind'])
  })

  it('lists the values of a dimension, with their other names, and links to its page', () => {
    const market = catalogue('what markets are there', { terms })
    expect(market.sentence).toBe(
      'Market has 8 values: France, Germany, Italy, Norway, Poland, Spain, Sweden and United Kingdom.',
    )
    expect(market.understood).toBe('Values of Market')
    expect(market.read).toBe('Read Market and its 8 values in Definitions')
    expect(market.more).toEqual({
      label: 'Show all 8 in Definitions',
      to: 'definitions',
      domain: null,
      status: null,
      page: 'Market',
    })
    const channel = catalogue('how many channels are there?', { terms })
    expect(channel.sentence).toBe('Channel has 1 value.')
    expect(channel.rows).toEqual([
      {
        type: 'term',
        key: 'val:channel/email',
        kind: 'value',
        name: 'Email',
        page: 'Channel',
        cells: ['Newsletter'],
      },
    ])
  })

  it('counts only what Definitions shows the person: a term left out is not there', () => {
    const shown = vocabulary.filter((t) => t.key !== 'dim:campaign')
    expect(catalogue('how many dimensions', { terms: shown }).sentence).toBe(
      'The workspace has 4 dimensions.',
    )
    expect(catalogue('metrics in Sandbox', { terms: vocabulary }).sentence).toBe(
      'Sandbox has no metrics.',
    )
  })
})
