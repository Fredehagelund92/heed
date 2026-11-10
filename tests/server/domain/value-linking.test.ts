import { describe, expect, it } from 'vitest'
import { heldOf } from '../../../src/domain/ask-held.ts'
import { chatOf, routeQuestion } from '../../../src/domain/ask-route.ts'
import type { ChatTurn } from '../../../src/domain/ask-chat.ts'
import { contestedAlso, contestedQuestion } from '../../../src/domain/say.ts'
import { extractScope, readQuestion, type ScopeResult } from '../../../src/domain/scope.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'
import { scopeOf } from '../../../src/server/mcp/service.ts'
import type { ServingBundle } from '../../../src/server/modules/editions/index.ts'
import { PLAN_NOW, PLAN_TODAY, planBundle } from '../../../src/server/modules/answer/plan-world.ts'

/*
  Golden questions for value linking, slice V1: how the scope reader reads value words, by fixed
  rules and with no model. Each is a question and the reading it must give: a value read, a word
  with several meanings asked about, or a word where a value goes that Heed has no value for ("no
  such value": the answer is Not found, and nothing about another value applies). The lines marked
  "was:" are the probe of the value-linking study (10 Nov 2026) that read wrong before V1: they are
  the regression tests. Invented names; the last part runs PR 180's checks on the Larchwood names.
  DEMO DATA ONLY.
*/

const term = (
  key: string,
  kind: Term['kind'],
  name: string,
  aliases: string[] = [],
  refs: string[] = [],
): Term => ({
  key,
  kind,
  name,
  aliases,
  parentKey: kind === 'dimension_value' ? `dim:${key.slice(4).split('/')[0]}` : null,
  areaId: null,
  definitionRefs: refs,
})

/**
 * Orders and Net revenue are in the orders view, Ad spend in the marketing view, Tickets in the
 * help desk's. Alder is a value of Aisle and Brand (orders) and of Audience (marketing); Alder Row
 * is a store. NO, IT and BF are short codes their owners wrote in capitals.
 */
const terms: Term[] = [
  term('metric:orders', 'metric', 'Orders', [], ['cube:orders.count']),
  term('metric:net_revenue', 'metric', 'Net revenue', ['Sales'], ['cube:orders.net_revenue']),
  term('metric:ad_spend', 'metric', 'Ad spend', [], ['cube:marketing.spend']),
  term('metric:tickets', 'metric', 'Tickets', [], ['cube:support.tickets']),
  term(
    'dim:country',
    'dimension',
    'Country',
    ['Market'],
    ['cube:orders.country', 'cube:marketing.country'],
  ),
  term(
    'dim:campaign',
    'dimension',
    'Campaign',
    [],
    ['cube:marketing.campaign', 'cube:orders.campaign'],
  ),
  term('dim:aisle', 'dimension', 'Aisle', [], ['cube:orders.aisle']),
  term('dim:brand', 'dimension', 'Brand', [], ['cube:orders.brand']),
  term('dim:audience', 'dimension', 'Audience', [], ['cube:marketing.audience']),
  term('dim:store', 'dimension', 'Store', [], ['cube:orders.store']),
  term('dim:team', 'dimension', 'Team', [], ['cube:support.team']),
  term('val:country/norway', 'dimension_value', 'Norway', ['Norge', 'NO']),
  term('val:country/sweden', 'dimension_value', 'Sweden'),
  term('val:country/italy', 'dimension_value', 'Italy', ['IT']),
  term('val:campaign/black_friday', 'dimension_value', 'Black Friday', ['BF']),
  term('val:aisle/alder', 'dimension_value', 'Alder'),
  term('val:brand/alder', 'dimension_value', 'Alder'),
  term('val:audience/alder', 'dimension_value', 'Alder'),
  term('val:store/alder_row', 'dimension_value', 'Alder Row'),
  term('val:team/mobile', 'dimension_value', 'Mobile'),
]
const today = '2026-11-10'

/** What a reading must be, in short. */
type Reading =
  | { reads: Record<string, string[]>; metrics?: string[] }
  | { asks: string[] }
  | { none: string; of: string[]; near?: string }

const ask = (question: string) => extractScope(question, terms, today, { loose: true })
function short(read: ScopeResult): Reading | { other: unknown } {
  if (read.status === 'resolved') return { reads: read.scope.filters, metrics: read.scope.metrics }
  const [issue, ...more] = read.issues
  if (!issue || more.length) return { other: read.issues }
  if (issue.meanings) return { asks: issue.meanings.map((m) => m.key) }
  const named = issue.message?.match(
    /^There is no value of (.+) named '(.+)'\.(?: Did you mean (.+)\?)?$/,
  )
  if (!named) return { other: read.issues }
  return {
    none: named[2]!,
    of: named[1]!.split(/, | or /),
    ...(named[3] ? { near: named[3] } : {}),
  }
}

/** A reading as the case says it: its metrics only when the case names them. */
const as = (read: ReturnType<typeof short>, reading: Reading) =>
  'reads' in read && 'reads' in reading && !reading.metrics ? { reads: read.reads } : read

describe('golden questions: value words', () => {
  it.each<[string, Reading]>([
    // A value, by its name or another name.
    ['orders in norway', { reads: { 'dim:country': ['val:country/norway'] } }],
    ['orders in norge', { reads: { 'dim:country': ['val:country/norway'] } }],
    [
      'orders in norway or sweden',
      { reads: { 'dim:country': ['val:country/norway', 'val:country/sweden'] } },
    ],
    ['orders in norway last week', { reads: { 'dim:country': ['val:country/norway'] } }],
    // A value named like a date is the value: names are read before dates.
    ['orders on black friday', { reads: { 'dim:campaign': ['val:campaign/black_friday'] } }],
    [
      'orders for the black friday campaign',
      { reads: { 'dim:campaign': ['val:campaign/black_friday'] } },
    ],
    [
      'black friday orders in norway',
      {
        reads: {
          'dim:campaign': ['val:campaign/black_friday'],
          'dim:country': ['val:country/norway'],
        },
      },
    ],
    // The longest name wins: Alder Row is the store, not the shared word Alder.
    ['orders in alder row', { reads: { 'dim:store': ['val:store/alder_row'] } }],
    // A dimension alone is a split.
    ['orders by country', { reads: { 'dim:country': [] } }],
    [
      'orders by campaign in norway',
      { reads: { 'dim:campaign': [], 'dim:country': ['val:country/norway'] } },
    ],
    ['tickets for the mobile team', { reads: { 'dim:team': ['val:team/mobile'] } }],
    // was: asked Aisle or Brand. A dimension word beside a shared value says which, and is no split.
    ['orders at the alder brand', { reads: { 'dim:brand': ['val:brand/alder'] } }],
    ['orders for brand alder', { reads: { 'dim:brand': ['val:brand/alder'] } }],
    ['orders for brand: alder', { reads: { 'dim:brand': ['val:brand/alder'] } }],
    ['orders in the alder aisle', { reads: { 'dim:aisle': ['val:aisle/alder'] } }],
    // was: asked Aisle, Brand or Audience. The metric's data narrows a shared value: Orders cannot
    // be split by Audience, and Ad spend only by Audience.
    ['orders in alder', { asks: ['val:aisle/alder', 'val:brand/alder'] }],
    ['alder orders', { asks: ['val:aisle/alder', 'val:brand/alder'] }],
    ['ad spend for alder', { reads: { 'dim:audience': ['val:audience/alder'] } }],
    // No metric, or one in none of its dimensions' data: every meaning is asked about.
    ['how did alder do', { asks: ['val:aisle/alder', 'val:audience/alder', 'val:brand/alder'] }],
    ['tickets in alder', { asks: ['val:aisle/alder', 'val:audience/alder', 'val:brand/alder'] }],
    // was: "There is no value named 'doing'". An everyday word after a dimension's name says how.
    ['how is the mobile team doing', { reads: { 'dim:team': ['val:team/mobile'] } }],
    ['how is the mobile team doing this week', { reads: { 'dim:team': ['val:team/mobile'] } }],
    // was: read as Norway and Italy. A short code counts only in capitals or beside its dimension.
    ['orders with no discount', { reads: {} }],
    ['is it up for orders', { reads: {} }],
    ['orders in NO', { reads: { 'dim:country': ['val:country/norway'] } }],
    ['orders in IT last week', { reads: { 'dim:country': ['val:country/italy'] } }],
    ['orders for country no', { reads: { 'dim:country': ['val:country/norway'] } }],
    ['BF orders', { reads: { 'dim:campaign': ['val:campaign/black_friday'] } }],
    // A short code in lowercase where a value goes is asked about, never chosen.
    [
      'orders in bf',
      { none: 'bf', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'], near: 'Black Friday' },
    ],
    // was: read as Orders in every country. A word in no list where a value goes is no such value.
    [
      'orders in jordan',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders from jordan',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders for jordan',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders to jordan',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders at jordan',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders across jordan last month',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    ['jordan orders', { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] }],
    [
      'Jordan orders last month',
      { none: 'Jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders in jordan and norway',
      { none: 'jordan', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders in the nordics',
      { none: 'nordics', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders across the Nordics last week',
      { none: 'Nordics', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    [
      'orders in New York',
      { none: 'New York', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'] },
    ],
    // Beside a dimension's name, of that dimension alone.
    ['orders in the jordan market', { none: 'jordan', of: ['Country'] }],
    ['ad spend for the cyber brand', { none: 'cyber', of: ['Brand'] }],
    // A typo is asked about, with the value it misses: never chosen.
    [
      'orders in norwy',
      { none: 'norwy', of: ['Country', 'Campaign', 'Aisle', 'Brand', 'Store'], near: 'Norway' },
    ],
    ['tickets for the mobil team', { none: 'mobil', of: ['Team'], near: 'Mobile' }],
    // Everyday words where a value goes are no value.
    ['orders in total', { reads: {} }],
    ['orders to date', { reads: {} }],
    ['orders for each country', { reads: { 'dim:country': [] } }],
    ['orders compared to last year', { reads: {} }],
    ['what caused orders to drop', { reads: {} }],
    ['orders from returning customers', { reads: {} }],
    ['orders across all stores', { reads: {} }],
    ['orders in stores', { reads: {} }],
    ['orders at risk', { reads: {} }],
    // A word before a metric after another word is part of what it names, not a value.
    [
      'store credit orders in norway',
      { reads: { 'dim:country': ['val:country/norway'], 'dim:store': [] } },
    ],
    ['gift card orders', { reads: {} }],
    ['loyalty scheme orders', { reads: {} }],
    ['net revenue in local currency', { reads: {} }],
    ['orders in black friday week', { reads: { 'dim:campaign': ['val:campaign/black_friday'] } }],
    // A word outside a value's place is left to the word search, as before.
    [
      'what have we got on the italy regulator',
      { reads: { 'dim:country': ['val:country/italy'] } },
    ],
    [
      'should we bring the norway campaigns back',
      { reads: { 'dim:country': ['val:country/norway'] } },
    ],
  ])('reads "%s"', (question, reading) => {
    const read = short(ask(question))
    expect(as(read, reading)).toEqual(reading)
  })

  it('says no such value only for a question that names something to look up', () => {
    // Nothing named: the word search has the words, as before.
    expect(ask('anything from jordan?')).toMatchObject({
      status: 'need_more_detail',
      issues: [{ field: 'scope' }],
    })
  })
})

describe('golden questions: lowercase names that end like everyday words', () => {
  const without = terms.filter((t) => !t.key.startsWith('val:country/italy'))
  const read = (question: string) => short(extractScope(question, without, today, { loose: true }))
  const every = ['Country', 'Campaign', 'Aisle', 'Brand', 'Store']

  it.each<[string, Reading]>([
    ['orders from italy', { none: 'italy', of: every }],
    ['orders in beijing', { none: 'beijing', of: every }],
    ['orders to ealing', { none: 'ealing', of: every }],
    ['orders from sicily', { none: 'sicily', of: every }],
  ])('says "%s" has no such value', (question, reading) => {
    expect(read(question)).toEqual(reading)
  })

  it('still asks about a lowercase name after a dimension word, "country italy"', () => {
    const result = extractScope('orders for country italy', without, today, { loose: true })
    expect(result).toMatchObject({
      status: 'need_more_detail',
      issues: [{ field: 'dim:country', input: 'italy' }],
    })
  })

  it('still reads "doing" after a dimension word as how', () => {
    for (const question of ['how is the mobile team doing', 'how is the mobile team doing this week'])
      expect(read(question)).toMatchObject({ reads: { 'dim:team': ['val:team/mobile'] } })
  })
})

describe('golden questions: asking which', () => {
  const said = (question: string) => {
    const held = heldOf(ask(question))
    if (!held) throw new Error(`no question back for "${question}"`)
    return contestedQuestion(held, { terms })
  }

  it('names the dimensions of a value they share, not "the value Alder" twice', () => {
    // was: "Alder can mean the value Alder or the value Alder. Which do you mean?"
    expect(said('orders in alder')).toBe('Alder is a value of Aisle and Brand. Which do you mean?')
    expect(said('how did alder do')).toBe(
      'Alder is a value of Aisle, Audience and Brand. Which do you mean?',
    )
  })

  it('keeps every meaning and counts those the sentence does not name, past eight', () => {
    // was: cut to 8 meanings, with no word about the rest.
    const many = [
      ...terms,
      ...Array.from({ length: 11 }, (_, i) => [
        term(`dim:d${i}`, 'dimension', `Dimension ${i}`),
        term(`val:d${i}/oak`, 'dimension_value', 'Oak'),
      ]).flat(),
    ]
    const held = heldOf(extractScope('how did oak do', many, today, { loose: true }))
    expect(held?.meanings).toHaveLength(11)
    expect(contestedQuestion(held!, { terms: many })).toBe(
      'Oak is a value of Dimension 0, Dimension 1, Dimension 10, Dimension 2, Dimension 3, Dimension 4, Dimension 5, Dimension 6 and 3 more. Which do you mean?',
    )
  })

  it('counts the meanings past eight for terms, and beside an answer', () => {
    const meanings = Array.from({ length: 10 }, (_, i) => ({
      key: `term:t${i}`,
      name: `Meaning ${i}`,
    }))
    const said = contestedQuestion({ word: 'oak', meanings } as never, { terms })
    expect(said).toBe(
      'Oak can mean the term Meaning 0, the term Meaning 1, the term Meaning 2, the term Meaning 3, the term Meaning 4, the term Meaning 5, the term Meaning 6, the term Meaning 7 or 2 more. Which do you mean?',
    )
    expect(contestedAlso('oak', meanings as never, { terms })).toContain(' or 2 more.')
  })
})

describe('golden questions: answering which, in Ask', () => {
  // Larchwood's names, with Alder a value of Product and of Campaign.
  const bundle = {
    ...planBundle,
    terms: [
      ...planBundle.terms,
      term('val:product/alder', 'dimension_value', 'Alder'),
      term('val:campaign/alder', 'dimension_value', 'Alder'),
    ],
    areas: planBundle.areas ?? [],
  }
  const route = (question: string, turns: ChatTurn[] = []) =>
    routeQuestion({
      bundle,
      ask: { question },
      turns: chatOf(bundle, turns, PLAN_TODAY),
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })

  it('asks by dimension, and reads the answer "the product one" as Alder the product', async () => {
    const asked = await route('orders in alder last month')
    // was: "Alder can mean the value Alder or the value Alder", and "product" settled nothing.
    expect(asked).toMatchObject({
      kind: 'reply',
      reply: { text: 'Alder is a value of Campaign and Product. Which do you mean?' },
    })
    if (asked.kind !== 'reply') return
    const turn: ChatTurn = {
      question: 'orders in alder last month',
      scope: null,
      sources: [],
      asked: asked.reply.text,
      ...(asked.reply.held ? { held: asked.reply.held } : {}),
    }
    for (const answer of ['product', 'the product one'])
      expect(await route(answer, [turn])).toMatchObject({
        kind: 'reads',
        planned: {
          reads: [
            {
              scope: {
                metrics: ['metric:orders'],
                filters: { 'dim:product': ['val:product/alder'] },
              },
            },
          ],
        },
      })
  })
})

describe('golden questions: as an agent asks', () => {
  const agent = (question: string) =>
    short(scopeOf({ question }, { terms } as unknown as ServingBundle, today))

  it.each<[string, Reading]>([
    // Read as before V1: an agent passes structured fields, and a word in no list is dropped.
    ['orders from jordan', { reads: {} }],
    ['jordan orders', { reads: {} }],
    ['orders in the nordics', { reads: {} }],
    ['orders in Jordan', { reads: {} }],
    // The reader's own fixes read alike for agents.
    ['orders at the alder brand', { reads: { 'dim:brand': ['val:brand/alder'] } }],
    ['ad spend for alder', { reads: { 'dim:audience': ['val:audience/alder'] } }],
    ['how is the mobile team doing', { reads: { 'dim:team': ['val:team/mobile'] } }],
    ['orders with no discount', { reads: {} }],
    ['orders in NO', { reads: { 'dim:country': ['val:country/norway'] } }],
    ['orders in alder', { asks: ['val:aisle/alder', 'val:brand/alder'] }],
  ])('reads "%s"', (question, reading) => {
    const read = agent(question)
    expect(as(read, reading)).toEqual(reading)
  })

  it('says no such value after a dimension name, as before', () => {
    expect(agent('orders for country: jordan')).toMatchObject({
      other: [
        { field: 'dim:country', input: 'jordan', message: "There is no value named 'jordan'." },
      ],
    })
  })

  it('reads the Applies to words as before', () => {
    expect(readQuestion('orders at the alder brand', terms, today).terms.map((t) => t.key)).toEqual(
      ['metric:orders', 'val:brand/alder'],
    )
  })
})

describe('golden questions: Larchwood, PR 180 checks', () => {
  const read = (question: string) =>
    extractScope(question, planBundle.terms, PLAN_TODAY, { loose: true })
  const asked = (question: string) => {
    const r = read(question)
    return r.status === 'need_more_detail' ? r.issues.map((i) => i.message ?? i.input) : []
  }

  it.each([
    'net revenue in local currency',
    'gross margin in percentage points',
    'gross margin in relative terms',
    'orders in absolute numbers',
    'orders in plain words',
    'discount cost in campaigns',
    'orders in heed',
    'orders in stores',
    'orders in black friday week',
    'orders in other markets',
    'orders in markets other than norway',
    'orders in online channel',
    'orders in total',
    'orders in practice',
    'net revenue in euros',
    'orders in short',
    'revenue in gbp',
    'orders in bulk',
    'discount cost in cash',
    'revenue in GBP',
    'discount cost in CHF',
    'sales in YTD',
    'orders in English',
    'orders in gbp last week',
  ])('reads "%s" as an ordinary word: no value', (question) => {
    expect(asked(question)).toEqual([])
  })

  it('reads the name of the tool a definition comes from as no value', () => {
    // The plan world's terms name no source member; on the service they do (cube:orders.orders).
    const named = planBundle.terms.map((t) =>
      t.key === 'metric:orders' ? { ...t, definitionRefs: ['cube:orders.orders'] } : t,
    )
    expect(extractScope('orders in cube', named, PLAN_TODAY, { loose: true }).status).toBe(
      'resolved',
    )
  })

  it('still reads "orders in online channel" as the Channel dimension', () => {
    expect(read('orders in online channel')).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:orders'], filters: { 'dim:channel': [] } },
    })
  })

  it.each([
    'anything written about orders in Jordan?',
    'orders in Norwy last month',
    'net revenue in local currency',
    'orders in gbp',
  ])('reads "%s" as before when an agent asks: no issue', (question) => {
    const r = extractScope(question, planBundle.terms, PLAN_TODAY)
    expect(r.status).toBe('resolved')
    if (r.status !== 'resolved') return
    expect(r.scope.filters).toEqual({})
    expect(r.scope.metrics).toHaveLength(1)
  })

  it.each([
    ['anything written about orders in Jordan?', /named 'Jordan'\.$/],
    ['anything written about orders in jordan?', /named 'jordan'\.$/],
    ['orders from Jordan last month', /named 'Jordan'\.$/],
    ['orders in Oslo', /named 'Oslo'\.$/],
    ['orders in Norwy last month', /named 'Norwy'\. Did you mean Norway\?$/],
    ['do orders in germnay lag 2 days or what', /named 'germnay'\. Did you mean Germany\?$/],
  ])('asks about "%s"', (question, message) => {
    const said = asked(question)
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(message)
  })
})
