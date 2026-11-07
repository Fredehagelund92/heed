import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '../../../src/domain/ask-chat.ts'
import {
  checkPlan,
  checkedQuestionBack,
  leftOpen,
  parsePlan,
  plannerPrompt,
  plannerReason,
  plannerSystem,
  plannerVocabulary,
  PLANNER_VALUES,
  readsAsFollowUp,
  recentWindow,
  type PlanContext,
} from '../../../src/domain/ask-plan.ts'
import { plannerInputOf, routeQuestion } from '../../../src/domain/ask-route.ts'
import { combined, explore, plannedAnswer } from '../../../src/domain/planned-answer.ts'
import { anyDate } from '../../../src/domain/validity.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'
import { PLAN_NOW, PLAN_TODAY, planBundle } from '../../../src/server/modules/answer/plan-world.ts'

// Ask's planner (FR-719): what a model may choose is checked before anything is read, and the
// reads it chooses are Ask's own.

const titles = (ids: readonly string[]) =>
  ids.map((id) => planBundle.items.find((item) => item.id === id)!.title)

const previous: ChatTurn = {
  question: 'why did orders drop in Norway?',
  scope: {
    metrics: ['metric:orders'],
    filters: { 'dim:market': ['val:market/norway'] },
    window: { start: PLAN_TODAY, end: '2026-10-24' },
  },
  sources: ['evt_norway_stop', 'rul_norway_cash', 'rul_norway_credit'],
}
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  question: 'what about Sweden?',
  terms: planBundle.terms,
  areas: planBundle.areas ?? [],
  today: PLAN_TODAY,
  now: PLAN_NOW,
  previous,
  readable: (id) => id !== 'rul_finance_only',
  ...over,
})

describe('a plan as the model writes it', () => {
  it('reads the first JSON object in the reply, and nothing else', () => {
    expect(parsePlan('Here it is: {"off_topic":true} done')).toEqual({ off_topic: true })
    expect(parsePlan('no plan')).toBeNull()
    expect(parsePlan('{"reads": [')).toBeNull()
  })

  it('is refused when it is no plan at all', () => {
    for (const raw of [
      null,
      {},
      { reads: [] },
      { reads: [{ kind: 'guess' }] },
      { off_topic: false },
    ])
      expect(checkPlan(raw, ctx()), JSON.stringify(raw)).toEqual({ ok: false, why: 'not a plan' })
  })

  it('is refused whole when one key is not in the vocabulary', () => {
    expect(
      checkPlan(
        {
          reads: [{ kind: 'lookup', metrics: ['metric:orders'], values: ['val:market/denmark'] }],
        },
        ctx(),
      ),
    ).toEqual({ ok: false, why: 'unknown key' })
    // A metric where a market belongs is unknown too.
    expect(checkPlan({ reads: [{ kind: 'lookup', values: ['metric:orders'] }] }, ctx())).toEqual({
      ok: false,
      why: 'unknown key',
    })
  })

  it('reads its dates as a person writes them, and no date loses the plan', () => {
    const read = (dates: string | null, why = false, question = 'orders in Sweden') => {
      const checked = checkPlan(
        {
          reads: [
            {
              kind: 'lookup',
              metrics: ['metric:orders'],
              values: ['val:market/norway'],
              dates,
              why,
            },
          ],
        },
        ctx({ question }),
      )
      if (!checked.ok || checked.plan.kind !== 'reads') throw new Error(JSON.stringify(checked))
      const [first] = checked.plan.reads
      if (first?.kind !== 'lookup') throw new Error('not a look-up')
      return { window: first.scope.window, period: first.period }
    }
    expect(read('September')).toEqual({
      window: { start: '2026-09-01', end: '2026-10-01' },
      period: 'asked',
    })
    // No dates: every date, and today only for a question about now.
    expect(read(null)).toEqual({ window: anyDate, period: 'any' })
    expect(read(null, false, 'orders in Sweden now').period).toBe('today')
    expect(read(null, true)).toEqual({ window: anyDate, period: 'any' })
    // The question's own loose words, whatever the model wrote.
    expect(read(null, false, 'orders in Sweden last summer')).toEqual({
      window: { start: '2026-06-01', end: '2026-09-01' },
      period: 'asked',
    })
    // The last question's period, carried, only when its words named one.
    expect(read('same').period).toBe('any')
    const dated = { ...previous, question: 'why did orders drop in Norway in May 2026?' }
    const carried = checkPlan(
      { reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: 'same' }] },
      ctx({ previous: dated }),
    )
    expect(carried).toMatchObject({ ok: true, plan: { reads: [{ period: 'carried' }] } })
    // Words no reader can place: the plan stands, undated.
    expect(
      checkPlan(
        { reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: 'the 45th of Smarch' }] },
        ctx(),
      ),
    ).toMatchObject({ ok: true, plan: { reads: [{ kind: 'lookup' }] } })
  })

  it('reads a search with no dates over the last 3 months, with only the words asked', () => {
    const checked = checkPlan(
      {
        reads: [{ kind: 'explore', words: 'jumps spikes anomalies', kinds: ['guide', 'warning'] }],
      },
      ctx({ question: 'any interesting jumps?' }),
    )
    expect(checked).toMatchObject({
      ok: true,
      plan: {
        kind: 'reads',
        reads: [
          {
            kind: 'explore',
            words: 'jumps',
            kinds: ['guide', 'issue'],
            period: 'recent',
            scope: { window: { start: '2026-07-23', end: '2026-10-24' } },
          },
        ],
      },
    })
    expect(recentWindow('2026-05-31')).toEqual({ start: '2026-02-28', end: '2026-06-01' })
  })

  it('names the last answer’s sources by number, and drops one nobody may read', () => {
    const turn = { ...previous, sources: ['rul_finance_only', 'evt_norway_stop'] }
    expect(
      checkPlan({ reads: [{ kind: 'about_previous', sources: [1, 2] }] }, ctx({ previous: turn })),
    ).toEqual({
      ok: true,
      plan: {
        kind: 'reads',
        reads: [{ kind: 'about_previous', ids: ['evt_norway_stop'], why: false }],
      },
    })
    for (const sources of [[0], [4], [1.5]])
      expect(
        checkPlan({ reads: [{ kind: 'about_previous', sources }] }, ctx()),
        JSON.stringify(sources),
      ).toEqual({ ok: false, why: 'no last answer' })
    expect(
      checkPlan({ reads: [{ kind: 'about_previous', sources: [1] }] }, ctx({ previous: null })),
    ).toEqual({ ok: false, why: 'no last answer' })
  })

  it('makes a records plan the records question it names, its period read from its words', () => {
    expect(
      checkPlan({ records: { intent: 'changed', of: 'guide', period: 'last week' } }, ctx()),
    ).toMatchObject({
      ok: true,
      plan: {
        kind: 'records',
        ask: { intent: 'changed', kind: 'guide', period: { words: 'last week' } },
      },
    })
    expect(checkPlan({ records: { intent: 'owner', domain: 'area_nowhere' } }, ctx())).toEqual({
      ok: false,
      why: 'unknown domain',
    })
    expect(
      checkPlan({ records: { intent: 'values', dimension: 'dim:market' } }, ctx()),
    ).toMatchObject({
      ok: true,
      plan: { ask: { intent: 'values', catalogue: { of: 'value', dimension: 'dim:market' } } },
    })
  })
})

describe('a plan that does not answer the question asked', () => {
  const plan = (raw: unknown, over: Partial<PlanContext>) => checkPlan(raw, ctx(over))

  it.each([
    'how healthy is our documentation?',
    'how covered are we?',
    'which domain has the worst coverage?',
    'what changed at the source?',
  ])('fails a search that names nothing for "%s"', (question) => {
    expect(plan({ reads: [{ kind: 'explore', kinds: ['event'] }] }, { question })).toEqual({
      ok: false,
      why: 'does not fit',
    })
  })

  it('stops at the sentence when values are ranked by a figure', () => {
    const got = plan(
      { reads: [{ kind: 'explore', metrics: ['metric:net_revenue'] }], limit: 'numbers' },
      { question: 'which campaign made the most money?' },
    )
    expect(got).toMatchObject({ ok: true, plan: { kind: 'cannot', reason: 'numbers' } })
  })

  it('reads a limit written as an exit as that limit, whatever key it came in', () => {
    const named = plan({ cannot: 'advice' }, { question: 'what would you do about orders?' })
    expect(named).toMatchObject({ ok: true, plan: { kind: 'reads', limit: 'advice' } })
    const nothing = plan({ cannot: 'advice' }, { question: 'what should we add?' })
    expect(nothing).toMatchObject({ ok: true, plan: { kind: 'records', ask: { limit: 'advice' } } })
  })

  it('reads what has no owner from the metrics, unless it asks about domains', () => {
    const no_owner = { records: { intent: 'owner', no_owner: true } }
    expect(plan(no_owner, { question: 'what is nobody responsible for?' })).toMatchObject({
      ok: true,
      plan: { kind: 'records', ask: { intent: 'audit', audit: { facets: ['no_domain'] } } },
    })
    expect(plan(no_owner, { question: 'which domains are unclaimed?' })).toMatchObject({
      ok: true,
      plan: { kind: 'records', ask: { intent: 'owner' } },
    })
  })

  const listed = { question: 'which metrics have no context?', sources: [], rows: ['a', 'b'] }

  it('asks which one when "that one" could be any of several rows', () => {
    const got = plan(
      { records: { intent: 'owner', metric: 'metric:orders' } },
      { question: 'who owns that one?', previous: listed },
    )
    expect(got).toMatchObject({ ok: true, plan: { kind: 'clarify' } })
  })

  it('takes "that one" as the domain a ranking put first', () => {
    const got = plan(
      { records: { intent: 'owner' } },
      {
        question: 'who owns that one?',
        previous: { ...listed, rows: [], domain: 'area_sales' },
      },
    )
    expect(got).toMatchObject({ ok: true, plan: { kind: 'records' } })
  })

  it('keeps a plan with a word that is no kind, and a question back with a colon', () => {
    const search = { reads: [{ kind: 'explore', kinds: ['rule', 'definition'] }] }
    expect(plan(search, { question: 'what do we know about VAT?' })).toMatchObject({
      ok: true,
      plan: { kind: 'reads', reads: [{ kinds: ['note'] }] },
    })
    const back = { clarify: 'Which metric do you mean: Orders or Net revenue?' }
    expect(plan(back, { question: 'how is Sweden doing?' })).toMatchObject({
      ok: true,
      plan: { kind: 'clarify', question: 'Which metric do you mean, Orders or Net revenue?' },
    })
  })

  it('searches for a market alone, and keeps a look-up when a metric carries over', () => {
    const value = { reads: [{ kind: 'lookup', values: ['val:market/sweden'] }] }
    const alone = plan(value, { question: 'is Sweden doing better?', previous: null })
    expect(alone).toMatchObject({ ok: true, plan: { reads: [{ kind: 'explore' }] } })
    const carried = plan(value, { question: 'and in Sweden?' })
    expect(carried).toMatchObject({ ok: true, plan: { reads: [{ kind: 'lookup' }] } })
  })

  it('gives a ranking of metrics the facet its rule comes from', () => {
    const got = plan(
      { audit: { facets: ['no_context', 'no_words'] } },
      { question: 'what are our weakest metrics?', previous: null },
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { ask: { audit: { facets: ['no_context', 'no_words', 'asked_nothing'] } } },
    })
  })

  it('lets an exit stand over "the first one", and keeps the limit of a read', () => {
    const exit = plan({ cannot: 'write' }, { question: 'rewrite the first one' })
    expect(exit).toMatchObject({ ok: true, plan: { kind: 'cannot', reason: 'write' } })
    const limited = plan(
      { reads: [{ kind: 'definition', metrics: ['metric:orders'] }], limit: 'advice' },
      { question: 'tell me more about the first one' },
    )
    expect(limited).toMatchObject({
      ok: true,
      plan: { reads: [{ kind: 'about_previous' }], limit: 'advice' },
    })
  })

  it('reads "the first one" of an answer with sources as that source', () => {
    const got = plan(
      { reads: [{ kind: 'definition', metrics: ['metric:orders'] }] },
      { question: 'tell me more about the first one' },
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { reads: [{ kind: 'about_previous', ids: ['evt_norway_stop'] }] },
    })
  })

  it('reads a queue narrowed to a domain as what is due there', () => {
    const narrowed = { queue: true, audit: { facets: ['due'], domain: 'area_paid_media' } }
    expect(plan(narrowed, { question: 'I am in Paid media, what needs checking?' })).toMatchObject({
      ok: true,
      plan: { kind: 'records', ask: { intent: 'due', domain: 'area_paid_media' } },
    })
  })

  it('never shows a key as a name in how the question reads alone', () => {
    const got = plan(
      {
        standalone: 'Who owns on_time_shipping_rate?',
        records: { intent: 'owner', metric: 'metric:orders' },
      },
      { question: 'who owns it?' },
    )
    expect(got).toMatchObject({ ok: true })
    expect(got.ok && got.plan.kind === 'records' && got.plan.standalone).toBeFalsy()
  })
})

describe('the question Ask asks back', () => {
  const back = (text: string) => checkedQuestionBack(text, ctx())

  it('is one short question in prose, with names Heed holds', () => {
    expect(back(' Do you mean Orders or Net revenue in Sweden? ')).toBe(
      'Do you mean Orders or Net revenue in Sweden?',
    )
  })

  it('is refused with a number, a link, a list, a second sentence or a name Heed does not hold', () => {
    for (const text of [
      'Do you mean the 12 markets?',
      'Do you mean Orders? Or Net revenue?',
      'Orders fell. Do you mean Orders?',
      'Do you mean Orders in Denmark?',
      'See www.example.com for help?',
      'Do you mean: Orders, Returns?',
      'Do you mean Orders or Net revenue in Sweden',
      `Do you mean ${'Orders or '.repeat(20)}Returns?`,
    ])
      expect(back(text), text).toBeNull()
  })
})

describe('when the planner reads a question', () => {
  const rules = (status: string, metrics: string[] = []) => ({
    status,
    scope: status === 'need_more_detail' ? null : { metrics },
  })
  const reason = (question: string, over: Partial<Parameters<typeof plannerReason>[0]> = {}) =>
    plannerReason({
      question,
      previous: null,
      scoped: false,
      plain: true,
      records: null,
      rules: rules('matched', ['metric:orders']),
      ...over,
    })

  it('leaves the rules what they read', () => {
    expect(reason('why did orders drop in Norway?')).toBeNull()
    expect(reason('list conflicts', { records: { type: 'records' } })).toBeNull()
    // A question scoped with @ is the person's own reading, even unread.
    expect(reason('this', { scoped: true, rules: rules('need_more_detail') })).toBeNull()
  })

  it('reads what the rules could not, a market alone, and what changed in the business', () => {
    expect(reason('any jumps?', { rules: rules('need_more_detail') })).toBe('unread')
    expect(reason('Norway?', { rules: rules('no_match') })).toBe('market alone')
    expect(reason('what changed last month?', { records: { type: 'records', loose: true } })).toBe(
      'business change',
    )
  })

  it('leaves the rules a question they answered in full after a metric turn', () => {
    expect(
      reason('list conflicts', {
        previous,
        records: { type: 'records' },
        rules: rules('no_match'),
      }),
    ).toBeNull()
    expect(
      reason('who owns Sales?', {
        previous,
        records: { type: 'records' },
        rules: rules('no_match'),
      }),
    ).toBeNull()
    expect(reason('why did orders drop in Norway?', { previous })).toBeNull()
    expect(
      reason('what did Anna change?', {
        previous,
        records: { type: 'refused' },
        rules: rules('no_match'),
      }),
    ).toBeNull()
    // Words that point back at the last answer still make a follow-up when the rules answered.
    expect(
      reason('is that a conflict?', {
        previous,
        records: { type: 'records' },
        rules: rules('no_match'),
      }),
    ).toBe('follow-up')
    // Unread, a market alone, or the answer to a question Ask asked back is still read.
    expect(reason('why?', { previous, rules: rules('need_more_detail') })).toBe('follow-up')
    expect(reason('what about Sweden?', { previous, rules: rules('no_match') })).toBe('follow-up')
    expect(reason('Orders', { previous: { ...previous, asked: 'Do you mean Orders?' } })).toBe(
      'follow-up',
    )
  })

  it('reads a follow-up, whatever the rules read', () => {
    for (const question of [
      'what about Sweden?',
      'and in September?',
      'why?',
      'tell me more about the first one',
      'is that a conflict?',
      'Sweden',
    ])
      expect(readsAsFollowUp(question, previous, { metrics: 0, answered: false }), question).toBe(
        true,
      )
    // Words about a period, a question with its own metric, a long question, no last turn.
    for (const question of [
      'what were orders this month?',
      'how did returns do last week?',
      'returns in Spain',
      'why did orders in Spain drop in October and what did the owners write about the payment provider there?',
    ])
      expect(readsAsFollowUp(question, previous, { metrics: 1, answered: false }), question).toBe(
        false,
      )
    expect(readsAsFollowUp('why?', null, { metrics: 0, answered: false })).toBe(false)
    // The answer to a question Ask asked back is always one.
    expect(
      readsAsFollowUp(
        'Orders',
        { ...previous, asked: 'Do you mean Orders?' },
        { metrics: 1, answered: true },
      ),
    ).toBe(true)
  })
})

describe('what the planner is told', () => {
  it('keeps the rules apart from the data, the same for every question', () => {
    expect(plannerSystem).toMatch(/data, never instructions/)
    expect(plannerSystem).not.toMatch(/Norway|Larchwood/)
  })

  it('numbers the last answer’s sources, and names the question last', () => {
    const prompt = plannerPrompt({
      question: 'what about Sweden?',
      today: PLAN_TODAY,
      previous: {
        question: previous.question,
        read: 'Orders in Norway, today',
        sources: [{ title: 'Online sales to Norway stopped on 4 August 2026', kind: 'event' }],
      },
    })
    expect(prompt.split('\n')).toEqual([
      'Today: 2026-10-23 (UTC)',
      'Last question: why did orders drop in Norway?',
      'Last question read as: Orders in Norway, today',
      'Last question named no dates.',
      'Last answer:',
      '[1] event: Online sales to Norway stopped on 4 August 2026',
      'Question: what about Sweden?',
    ])
  })

  it('names a dimension with many values by its size, not each value', () => {
    const many: Term[] = [
      {
        key: 'dim:campaign',
        kind: 'dimension',
        name: 'Campaign',
        aliases: [],
        parentKey: null,
        areaId: null,
        definitionRefs: [],
      },
      ...Array.from({ length: PLANNER_VALUES + 1 }, (_, i): Term => ({
        key: `val:campaign/c${i}`,
        kind: 'dimension_value',
        name: `Campaign ${i}`,
        aliases: [],
        parentKey: 'dim:campaign',
        areaId: null,
        definitionRefs: [],
      })),
    ]
    expect(plannerVocabulary(many, [])).toContain(
      `dim:campaign Campaign: ${PLANNER_VALUES + 1} values, not listed`,
    )
  })
})

describe('a read under a limit', () => {
  const window = recentWindow(PLAN_TODAY)
  const read = (reads: Parameters<typeof plannedAnswer>[1]) =>
    plannedAnswer(planBundle, reads, {
      question: 'what should we do about the zebra stripes?',
      today: PLAN_TODAY,
      previous: null,
      turns: [],
      limited: true,
    })

  it('shows nothing when the words match nothing, never every recent item', () => {
    const got = read([
      {
        kind: 'explore',
        words: 'zebra stripes',
        kinds: [],
        scope: { metrics: [], filters: {}, window },
        period: 'recent',
      },
    ])
    expect(got.answer.items).toEqual([])
  })

  it('keeps to the kinds asked when no name holds a wider read to the question', () => {
    const got = read([
      {
        kind: 'explore',
        words: '',
        kinds: ['event'],
        scope: { metrics: [], filters: {}, window },
        period: 'recent',
      },
    ])
    expect(got.answer.items.length).toBeGreaterThan(0)
    expect(got.answer.items.every((item) => item.kind === 'event')).toBe(true)
  })
})

describe('the reads a plan runs', () => {
  const search = (over: Partial<Parameters<typeof explore>[1]> = {}) =>
    explore(
      planBundle,
      {
        kind: 'explore',
        words: '',
        kinds: [],
        scope: { metrics: [], filters: {}, window: recentWindow(PLAN_TODAY) },
        period: 'recent',
        ...over,
      },
      PLAN_TODAY,
    )

  it('reads the kinds asked whose dates overlap the period, never an item for another group', () => {
    const { answer } = search({ kinds: ['event'] })
    expect(answer.items.every((item) => item.kind === 'event')).toBe(true)
    // The March campaign ended in May: outside the last 3 months.
    expect(titles(answer.items.map((i) => i.id))).not.toContain(
      'Norway launch campaign started on 24 March 2026',
    )
    expect(answer.items.map((i) => i.id)).not.toContain('rul_finance_only')
    expect(search().answer.items.length).toBeLessThanOrEqual(7)
  })

  it('reads every item of the kinds, and says so, when the words match none', () => {
    const { answer, reads } = search({ kinds: ['issue'], words: 'zebra' })
    expect(reads.map((r) => r.words)).toEqual([''])
    expect(answer.items).toHaveLength(2)
    expect(answer.state).toBe('grounded')
  })

  it('gives the state from the items read: Conflict for a pair, Outdated for an item past its check', () => {
    expect(
      search({
        scope: {
          metrics: [],
          filters: { 'dim:market': ['val:market/norway'] },
          window: recentWindow(PLAN_TODAY),
        },
      }).answer.state,
    ).toBe('conflict')
    expect(
      search({
        kinds: ['event'],
        words: 'promotions',
        scope: {
          metrics: [],
          filters: { 'dim:market': ['val:market/italy'] },
          window: { start: '2026-04-01', end: '2026-06-01' },
        },
      }).answer.state,
    ).toBe('stale')
    expect(
      search({
        kinds: ['event'],
        words: 'zebra',
        scope: { metrics: [], filters: {}, window: { start: '2020-01-01', end: '2020-02-01' } },
      }).answer.state,
    ).toBe('missing')
  })

  it('reads a kind none of whose items has the words apart, and says so', () => {
    const { answer, reads } = search({ kinds: ['event', 'guide'], words: 'jump' })
    expect(reads.map((r) => [r.kinds, r.words])).toEqual([
      [['guide'], 'jump'],
      [['event'], ''],
    ])
    expect(answer.items.some((item) => item.kind === 'event')).toBe(true)
    expect(answer.items.some((item) => item.kind === 'guide')).toBe(true)
  })

  it('is Partial when one read finds something and another nothing', () => {
    const found = search({ kinds: ['issue'] }).answer
    const none = search({
      kinds: ['event'],
      scope: { metrics: [], filters: {}, window: { start: '2020-01-01', end: '2020-02-01' } },
    }).answer
    expect(combined([found, none]).state).toBe('partial')
    expect(combined([found, none]).items).toEqual(found.items)
  })

  it('says how it was read, and what it carried', () => {
    const planned = plannedAnswer(
      planBundle,
      [
        {
          kind: 'lookup',
          scope: {
            metrics: ['metric:orders'],
            filters: { 'dim:market': ['val:market/sweden'] },
            window: anyDate,
          },
          period: 'any',
          why: true,
        },
      ],
      { question: 'what about Sweden?', today: PLAN_TODAY, previous },
    )
    expect(planned.reading).toEqual({
      words: 'Orders in Sweden, at any date',
      carried: ['Orders'],
      period: 'any',
    })
    expect(titles(planned.answer.items.map((i) => i.id))).toEqual([
      'Data for Orders before 19 January 2026 is not reliable',
    ])
  })

  it('says an item is due for a check when its flag is on and its date is still to come', () => {
    const read = [
      {
        kind: 'lookup' as const,
        scope: {
          metrics: ['metric:orders'],
          filters: { 'dim:market': ['val:market/sweden'] },
          window: anyDate,
        },
        period: 'any' as const,
        why: true,
      },
    ]
    const base = {
      question: 'what about Sweden?',
      today: PLAN_TODAY,
      previous,
      facts: ['due' as const],
    }
    const bundle = (over: object) => ({
      ...planBundle,
      items: planBundle.items.map((item) => ({ ...item, ...over })),
    })
    const flagged = plannedAnswer(
      bundle({ reviewDate: '2099-03-01', checkFlag: 'needs_check' }),
      read,
      base,
    )
    expect(flagged.reading.facts?.join(' ')).toContain('check date 1 Mar 2099, due for a check')
    const calm = plannedAnswer(bundle({ reviewDate: '2099-03-01', checkFlag: null }), read, base)
    expect(calm.reading.facts?.join(' ')).not.toContain('due for a check')
    const undated = plannedAnswer(
      bundle({ reviewDate: null, checkFlag: 'source_missing' }),
      read,
      base,
    )
    expect(undated.reading.facts?.join(' ')).toContain(
      'no check date, due for a check, its source is missing',
    )
  })
})

describe('a follow-up keeps what it does not change', () => {
  const lookup = (values: string[]) => ({
    reads: [{ kind: 'lookup', values, metrics: [], dates: null, why: false }],
  })

  it('keeps the metric when the plan left it out, and changes the market', () => {
    const got = checkPlan(lookup(['val:market/sweden']), ctx({ question: 'and in Sweden?' }))
    expect(got).toMatchObject({
      ok: true,
      plan: {
        reads: [
          {
            scope: { metrics: ['metric:orders'], filters: { 'dim:market': ['val:market/sweden'] } },
          },
        ],
      },
    })
  })

  it('keeps the dates of a dated question, and says they were carried', () => {
    const window = { start: '2026-05-01', end: '2026-06-01' }
    const dated = {
      ...previous,
      question: 'why did orders drop in Norway in May 2026?',
      scope: { ...previous.scope!, window },
    }
    const got = checkPlan(
      lookup(['val:market/sweden']),
      ctx({
        question: 'and in Sweden?',
        previous: { ...dated, scope: { ...dated.scope, window } },
      }),
    )
    expect(got).toMatchObject({ ok: true, plan: { reads: [{ period: 'carried' }] } })
    if (got.ok && got.plan.kind === 'reads' && got.plan.reads[0]?.kind === 'lookup')
      expect(got.plan.reads[0].scope.window).toEqual(window)
  })

  it('stays a question about why, at any date, when the last one was', () => {
    const got = checkPlan(
      { reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: null, why: false }] },
      ctx({ question: 'and in Sweden?' }),
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { reads: [{ why: true, period: 'any', scope: { window: anyDate } }] },
    })
  })

  it('keeps nothing for a question with a subject of its own', () => {
    const got = checkPlan(
      { reads: [{ kind: 'explore', kinds: ['event'], dates: 'August' }] },
      ctx({ question: 'what events happened in August?' }),
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { reads: [{ scope: { metrics: [], filters: {} } }] },
    })
  })

  it('keeps no market for a question about all of them', () => {
    const got = checkPlan(
      { reads: [{ kind: 'explore', kinds: ['event'], dates: 'August' }] },
      ctx({ question: 'and overall in August?' }),
    )
    expect(got).toMatchObject({ ok: true, plan: { reads: [{ scope: { filters: {} } }] } })
  })

  it('reads a key written as the kind of a records question as naming no kind', () => {
    const got = checkPlan(
      { records: { intent: 'owner', of: 'metric:orders', metric: 'metric:orders' } },
      ctx({ question: 'and the owner?' }),
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { kind: 'records', ask: { intent: 'owner', kind: null, metric: 'metric:orders' } },
    })
  })

  it('keeps the domain of a records question', () => {
    const got = checkPlan(
      { records: { intent: 'owner' } },
      ctx({
        question: 'and the owner?',
        previous: {
          question: 'what is due in Paid media?',
          sources: [],
          domain: 'area_paid_media',
        },
      }),
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { kind: 'records', ask: { domain: 'area_paid_media' }, carried: ['Paid media'] },
    })
  })

  it('reads a records question that leans on the last one as a follow-up, not a refusal', () => {
    expect(readsAsFollowUp('and the owner?', previous, { metrics: 0, answered: true })).toBe(true)
    expect(
      readsAsFollowUp('and what did Anna change?', previous, {
        metrics: 0,
        answered: true,
        refused: true,
      }),
    ).toBe(false)
    expect(readsAsFollowUp('and Orders in Sweden?', previous, { metrics: 1, answered: true })).toBe(
      false,
    )
  })
})

describe('the answer to a question Ask asked back', () => {
  // A model asked it, so no meanings are held: the rest of the question still carries.
  const asked: ChatTurn = {
    question: 'how did Sweden do last month?',
    scope: null,
    sources: [],
    asked: 'Do you mean Orders or Net revenue in Sweden?',
  }
  const reply = (question: string, raw: unknown) => {
    const checked = checkPlan(raw, ctx({ question, previous: asked }))
    if (!checked.ok || checked.plan.kind !== 'reads') throw new Error('not reads')
    return checked.plan.reads[0]
  }

  it('keeps the period and the market, however short it is', () => {
    expect(
      reply('net', { reads: [{ kind: 'lookup', metrics: ['metric:net_revenue'], dates: null }] }),
    ).toMatchObject({
      period: 'carried',
      scope: {
        metrics: ['metric:net_revenue'],
        window: { start: '2026-09-01', end: '2026-10-01' },
      },
    })
  })

  it('keeps the words of its own period', () => {
    expect(
      reply('orders in August', {
        reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: 'in August' }],
      }),
    ).toMatchObject({ period: 'asked' })
  })
})

describe('what a follow-up leans on', () => {
  const lookup = [
    { kind: 'lookup', values: [], metrics: ['metric:net_revenue'], dates: null, why: false },
  ]
  const scopeOf = (got: ReturnType<typeof checkPlan>) =>
    got.ok && got.plan.kind === 'reads' && got.plan.reads[0]?.kind === 'lookup'
      ? got.plan.reads[0].scope
      : null

  it('keeps nothing for a relative "that" with a metric of its own', () => {
    const got = checkPlan(
      { reads: lookup },
      ctx({ question: 'What are the rules that apply to net revenue?' }),
    )
    expect(scopeOf(got)?.filters).toEqual({})
  })

  it('keeps the market for "and total net revenue?"', () => {
    const got = checkPlan({ reads: lookup }, ctx({ question: 'and total net revenue?' }))
    expect(scopeOf(got)?.filters).toEqual({ 'dim:market': ['val:market/norway'] })
  })

  it('carries the days a question back left unread but its words named', () => {
    const asked: ChatTurn = {
      question: 'How is Sweden doing in August 2026?',
      scope: null,
      sources: [],
      asked: 'Which metric?',
    }
    const got = checkPlan(
      {
        reads: [
          { kind: 'lookup', values: [], metrics: ['metric:orders'], dates: 'same', why: false },
        ],
      },
      ctx({ question: 'Orders', previous: asked }),
    )
    expect(scopeOf(got)?.window).toEqual({ start: '2026-08-01', end: '2026-09-01' })
  })

  it('holds a quarter in a restated question', () => {
    const got = checkPlan(
      {
        standalone: 'Why did Orders drop in Sweden in Q3?',
        reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: null, why: false }],
      },
      ctx(),
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { standalone: 'Why did Orders drop in Sweden in Q3?' },
    })
  })
})

describe('the question as it reads alone', () => {
  const reads = [{ kind: 'lookup', metrics: ['metric:orders'], dates: null, why: false }]
  const standalone = (text: string) => {
    const got = checkPlan({ standalone: text, reads }, ctx())
    return got.ok && got.plan.kind === 'reads' ? got.plan.standalone : 'no plan'
  }

  it('is kept when it says only what the chat said and Heed holds', () => {
    expect(standalone('Why did Orders drop in Sweden?')).toBe('Why did Orders drop in Sweden?')
    expect(standalone('What about Orders in Sweden in August?')).toBeDefined()
  })

  it('is left out, and the plan stands, when it says anything else', () => {
    for (const text of [
      'Orders in Sweden.',
      'Why did Orders drop 12 percent in Sweden?',
      'Why did Orders drop in Atlantis?',
      'First this. Then what?',
      'x'.repeat(170) + '?',
    ])
      expect(standalone(text), text).toBeUndefined()
  })
})

describe('the chat the planner reads', () => {
  const turn = (n: number, over: Partial<ChatTurn> = {}): ChatTurn => ({
    question: `question ${n}`,
    sources: [],
    ...over,
  })

  it('numbers the last answer first, then the first few of each earlier one', () => {
    const turns = [
      turn(1, { sources: ['evt_norway_stop', 'rul_norway_cash', 'rul_norway_credit'] }),
      turn(2, { sources: ['rul_norway_cash'] }),
    ]
    const { prompt } = plannerInputOf(
      { ...planBundle, areas: planBundle.areas ?? [] },
      'is that a conflict?',
      turns,
      PLAN_TODAY,
    )
    expect(prompt).toContain('Earlier in the chat, oldest first:')
    expect(prompt).toMatch(/\[1\] rule: /)
    expect(prompt).toMatch(/sources: \[2\] event: /)
    const got = checkPlan(
      { reads: [{ kind: 'about_previous', sources: [2] }] },
      ctx({ previous: turns[1]!, earlier: turns.slice(0, 1) }),
    )
    expect(got).toMatchObject({
      ok: true,
      plan: { reads: [{ ids: ['evt_norway_stop'] }] },
    })
  })

  it('never shows the answers’ words, only how each turn was read and what it found', () => {
    const { prompt } = plannerInputOf(
      { ...planBundle, areas: planBundle.areas ?? [] },
      'and in Sweden?',
      [
        turn(1, {
          understood: 'Orders in Norway',
          state: 'missing',
          headline: '0 context items about Orders in Norway.',
        }),
      ],
      PLAN_TODAY,
    )
    expect(prompt).toContain(
      'Last question answered: Not found: 0 context items about Orders in Norway.',
    )
  })
})

describe('a message that names a term spelled like a word that says nothing', () => {
  const nice: Term = {
    key: 'val:market/nice',
    kind: 'dimension_value',
    name: 'Nice',
    aliases: [],
    parentKey: 'dim:market',
    areaId: null,
    definitionRefs: [],
  }
  const route = (terms: Term[]) =>
    routeQuestion({
      bundle: { ...planBundle, terms, areas: planBundle.areas ?? [] },
      ask: { question: 'Nice' },
      turns: [],
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })

  it('is read, not told it asks nothing', async () => {
    const routed = await route([...planBundle.terms, nice])
    expect(routed.kind).toBe('rules')
  })

  it('is told it asks nothing when the edition has no such term', async () => {
    const routed = await route(planBundle.terms.filter((t) => t.key !== nice.key))
    expect(routed).toMatchObject({ kind: 'reply', reply: { kind: 'nothing_asked' } })
  })
})

describe('what a question back leaves open', () => {
  const back: ChatTurn = {
    question: 'sales in Sweden last month',
    scope: null,
    sources: [],
    asked: 'Sales can mean Net revenue or Gross sales. Which do you mean?',
    held: {
      word: 'Sales',
      meanings: [
        { key: 'metric:net_revenue', name: 'Net revenue' },
        { key: 'metric:gross_sales', name: 'Gross sales' },
      ],
      metrics: [],
      filters: { 'dim:market': ['val:market/sweden'] },
      window: { start: '2026-09-01', end: '2026-10-01' },
    },
  }
  const open = (question: string, previous: ChatTurn = back) =>
    leftOpen(ctx({ question, previous }))

  it.each(['net', 'orders', 'last month', 'the second one'])(
    'carries all of it to the answer "%s"',
    (answer) => {
      expect(open(answer)).toMatchObject({ filters: { 'dim:market': ['val:market/sweden'] } })
    },
  )

  it('carries the period too, when the answer names none', () => {
    expect(open('net')).toMatchObject({ window: { start: '2026-09-01', end: '2026-10-01' } })
  })

  it.each(['what campaigns ran?', 'orders?', 'list the rules', 'show me the events'])(
    'carries nothing to a question of its own: "%s"',
    (question) => {
      expect(open(question)).toBeNull()
    },
  )

  it('does the same after a question back the planner asked', () => {
    const planner: ChatTurn = {
      question: back.question,
      sources: [],
      asked: 'Do you mean Orders or Net revenue?',
      scope: { metrics: [], filters: back.held!.filters, window: back.held!.window! },
    }
    expect(open('what campaigns ran?', planner)).toBeNull()
    expect(open('net', planner)).toMatchObject({
      filters: { 'dim:market': ['val:market/sweden'] },
    })
  })
})

// Fix round 3: what a model wrote never takes the question somewhere else, and a stray word never
// loses a plan the question can use.
describe('a plan is held to the question', () => {
  const alone = (question: string) => ctx({ question, previous: null })
  const planned = (raw: unknown, question: string, over: Partial<PlanContext> = {}) => {
    const checked = checkPlan(raw, { ...alone(question), ...over })
    if (!checked.ok) throw new Error(checked.why)
    return checked.plan
  }

  it('keeps a plan with a word that is no limit', () => {
    const plan = planned(
      { reads: [{ kind: 'explore', values: ['val:market/norway'] }], limit: 'cannot' },
      'what do we know about Norway?',
    )
    expect(plan).toMatchObject({ kind: 'reads' })
    expect(plan).not.toHaveProperty('limit')
  })

  it('keeps a records plan with a key where a number goes', () => {
    const plan = planned(
      { records: { intent: 'conflicts', limit: 'val:market/france' } },
      'which conflicts are about France?',
    )
    expect(plan).toMatchObject({
      kind: 'records',
      ask: { intent: 'conflicts', about: { values: ['val:market/france'] } },
    })
  })

  it('keeps an analysis with every facet', () => {
    const facets = [
      'no_context',
      'no_words',
      'no_domain',
      'unlinked',
      'asked_nothing',
      'due',
      'review',
    ]
    expect(planned({ audit: { facets } }, 'are we missing anything?')).toMatchObject({
      kind: 'records',
    })
  })

  it('counts metrics as metrics, never as context items', () => {
    expect(
      planned({ records: { intent: 'count', of: 'metric' } }, 'how many metrics are there?'),
    ).toMatchObject({ ask: { intent: 'terms', catalogue: { of: 'metric', count: true } } })
  })

  it('reads what changed as what changed, whichever read the model chose', () => {
    expect(
      planned(
        { records: { intent: 'created', domain: 'area_marketing' } },
        'what changed in Marketing last month?',
      ),
    ).toMatchObject({ ask: { intent: 'changed', domain: 'area_marketing' } })
  })

  it('reads the question’s own period when the plan leaves it out', () => {
    expect(
      planned({ records: { intent: 'created' } }, 'what was added last summer?'),
    ).toMatchObject({ ask: { period: { words: 'from June to August 2026', assumed: false } } })
  })

  it('reads a domain that is also a metric’s other name as the domain', () => {
    const plan = planned(
      { records: { intent: 'due', domain: 'area_sales' } },
      'what is due for a check in Sales?',
    )
    expect(plan).toMatchObject({ ask: { domain: 'area_sales' } })
    expect(plan).not.toHaveProperty('ask.about')
  })

  it('answers who owns something, never as one person’s work', () => {
    expect(
      planned(
        { cannot: 'person', metrics: ['metric:on_time_shipping_rate'] },
        'who is in charge of on-time shipping?',
      ),
    ).toMatchObject({ kind: 'records', ask: { intent: 'owner' } })
    expect(planned({ cannot: 'person' }, 'whose fault is the Norway drop?')).toMatchObject({
      kind: 'cannot',
    })
  })

  it.each(['which owner has done the least this month?', 'which owners are slacking?'])(
    'keeps the exit for "%s"',
    (question) => {
      expect(planned({ cannot: 'person' }, question)).toMatchObject({ kind: 'cannot' })
    },
  )

  it.each(["who's responsible for on-time shipping?", 'who’s in charge of on-time shipping?'])(
    'answers the contraction "%s" as who owns it',
    (question) => {
      expect(
        planned({ cannot: 'person', metrics: ['metric:on_time_shipping_rate'] }, question),
      ).toMatchObject({ kind: 'records', ask: { intent: 'owner' } })
    },
  )

  it('searches for the topic of a who-owns question beside the names it holds', () => {
    expect(
      planned({ records: { intent: 'owner' } }, 'who owns the vat rule in norway'),
    ).toMatchObject({ kind: 'reads', facts: ['owner'] })
  })

  it('reads the date of a due question from the plan when the question has none', () => {
    const plan = planned(
      { records: { intent: 'due', period: 'next week' } },
      'what is due for a check then?',
    )
    expect(plan).toMatchObject({ kind: 'records', ask: { intent: 'due', period: {} } })
  })

  it('reads one due question for each of two periods', () => {
    const plan = planned(
      { records: { intent: 'due' } },
      'what is due for a check this month and next month?',
    )
    expect(plan).toMatchObject({ kind: 'records', ask: { parts: [{}, {}] } })
  })

  it.each(['what is due for a check on Revenue', 'what changed in Revenue metrics this month'])(
    'narrows "%s" to the metrics of the group',
    (question) => {
      const intent = question.includes('due') ? 'due' : 'changed'
      const plan = planned({ records: { intent } }, question)
      expect(plan).toMatchObject({
        kind: 'records',
        ask: {
          about: {
            metrics: ['metric:net_revenue', 'metric:gross_sales', 'metric:units_sold'],
          },
        },
      })
    },
  )

  it('says the words it could not place when a read keeps no history by date', () => {
    const plan = planned(
      { records: { intent: 'count', of: 'rule' } },
      'how many metrics did we have before the rebrand',
    )
    expect(plan).toMatchObject({ kind: 'records', ask: { asOfUnplaced: ['before the rebrand'] } })
    expect(plan).not.toHaveProperty('ask.asOf')
  })

  it.each(['who is the owner of the vat rule', 'who are the owners of the vat rule'])(
    'answers "%s" as who owns it',
    (question) => {
      expect(planned({ cannot: 'person' }, question)).toMatchObject({ kind: 'reads' })
    },
  )

  it.each(['and the owner of that rule?', 'who owns the latest rule'])(
    'answers "%s" as who owns it',
    (question) => {
      expect(planned({ cannot: 'person' }, question).kind).not.toBe('cannot')
    },
  )

  it.each(['who owns the most domains', 'who is responsible for the fault in the vat rule'])(
    'keeps the exit for "%s"',
    (question) => {
      expect(planned({ cannot: 'person' }, question)).toMatchObject({ kind: 'cannot' })
    },
  )

  it.each(['how many context items mention the metric orders', 'how many items name a dimension'])(
    'does not count the vocabulary for "%s"',
    (question) => {
      const plan = planned({ records: { intent: 'count' } }, question)
      expect(plan).not.toMatchObject({ ask: { intent: 'terms' } })
    },
  )

  it('counts the metrics when they are what is counted', () => {
    expect(
      planned({ records: { intent: 'count' } }, 'how many of our metrics are there'),
    ).toMatchObject({ ask: { intent: 'terms', catalogue: { of: 'metric', count: true } } })
  })

  it('reads a domain named with special characters', () => {
    const areas = [
      { id: 'area_rd', name: 'R&D (Nordics' },
      { id: 'area_cpp', name: 'C++' },
    ]
    const plan = planned(
      { records: { intent: 'owner', domain: 'area_rd' } },
      'who owns R&D (Nordics and C++?',
      { areas },
    )
    expect(plan).toMatchObject({ kind: 'records' })
  })

  it.each([
    ['how many rules mention the metric orders', { intent: 'count', of: 'rule' }],
    ['how many warnings are about kpis in sales', { intent: 'count', of: 'warning' }],
  ])('keeps the count of context items in "%s"', (question, records) => {
    const plan = planned({ records }, question)
    expect(plan).not.toMatchObject({ ask: { intent: 'terms' } })
  })

  it('takes a change to a definition to the exit, however the plan read it', () => {
    expect(
      planned(
        { reads: [{ kind: 'definition', metrics: ['metric:churn_rate'] }], limit: 'advice' },
        'what would you change in the definition of churn rate?',
      ),
    ).toMatchObject({ kind: 'cannot', reason: 'source' })
  })

  it('leaves a records plan as the model wrote it: no word of the question rewrites it', () => {
    const plan = planned(
      { records: { intent: 'due' } },
      'when was what is due for Paid media last checked?',
    )
    expect(plan).toMatchObject({ kind: 'records', ask: { intent: 'due' } })
  })

  it('reads a kind of context written as a read as a search of that kind', () => {
    const plan = planned(
      { reads: [{ kind: 'guide', metrics: ['metric:returns'] }] },
      'what does the guide for Returns say?',
    )
    expect(plan).toMatchObject({ kind: 'reads', reads: [{ kind: 'explore', kinds: ['guide'] }] })
  })

  it('reads what changed in the definitions as the source, not the context', () => {
    const plan = planned(
      { records: { intent: 'changed', of: 'definition' } },
      'which definitions changed last month?',
    )
    expect(plan).toMatchObject({ kind: 'records', ask: { intent: 'audit' } })
  })

  it('keeps what the model wrote left out, whatever its punctuation', () => {
    const left = (text: string) =>
      planned(
        { reads: [{ kind: 'explore', values: ['val:market/norway'] }], left: text },
        'how many items are about Norway, and how many still apply?',
      )
    expect(left('how many of those still apply')).toMatchObject({
      left: 'how many of those still apply.',
    })
    expect(left('how many of those still apply?')).toMatchObject({
      left: 'how many of those still apply?',
    })
    expect(left('see https://example.test/page?')).not.toHaveProperty('left')
  })

  it('keeps only a part of what was asked as what is left, in any punctuation', () => {
    const left = (text: string, question = 'what happened with the margin and cost in Norway?') =>
      planned({ reads: [{ kind: 'explore', values: ['val:market/norway'] }], left: text }, question)
    for (const text of [
      'Orders fell sharply in Norway',
      'You should recheck Orders with finance',
      'Contoso pricing',
    ]) {
      expect(left(text)).not.toHaveProperty('left')
    }
    expect(
      left('one thing: the margin', 'what one thing about the margin in Norway?'),
    ).toMatchObject({ left: 'one thing the margin.' })
    expect(left('the margin!')).toMatchObject({ left: 'the margin.' })
    expect(left('margin and/or cost')).toMatchObject({ left: 'margin and or cost.' })
    expect(
      left('whether anything is written twice', 'is anything written twice about Norway?'),
    ).toHaveProperty('left')
  })

  it('keeps an honest note and refuses one that leaves nothing out', () => {
    const left = (text: string, question: string) =>
      planned({ reads: [{ kind: 'explore', values: ['val:market/norway'] }], left: text }, question)
    expect(
      left('Jordan is not in the vocabulary', 'anything written about orders in jordan?'),
    ).toHaveProperty('left')
    expect(
      left('whether the definition changed', 'what is the definition of orders in Norway?'),
    ).toHaveProperty('left')
    expect(
      left('this week; net revenue', 'what is net revenue in Norway this week?'),
    ).not.toHaveProperty('left')
  })

  it('leaves the words of the question out of what is left', () => {
    const question = 'explain the Norway situation in two lines'
    const plan = planned(
      {
        reads: [{ kind: 'explore', values: ['val:market/norway'] }],
        left: 'Explain the Norway situation in two lines?',
      },
      question,
    )
    expect(plan).not.toHaveProperty('left')
  })

  it('keeps what the model carried: the model reads the chat, no word of it decides', () => {
    const plan = planned(
      {
        reads: [
          { kind: 'explore', kinds: ['event'], metrics: ['metric:orders'], dates: 'in August' },
        ],
      },
      'what events happened in August?',
      { previous },
    )
    expect(plan).toMatchObject({ reads: [{ scope: { metrics: ['metric:orders'] } }] })
  })

  describe('the dates, read twice', () => {
    const read = (dates: string, from?: string | null, to?: string | null) => ({
      kind: 'explore',
      kinds: ['event'],
      dates,
      from,
      to,
    })

    it('takes the days the model worked out, for words the reader cannot place', () => {
      const plan = planned(
        { reads: [read('the three months before 4 August 2026', '2026-05-04', '2026-08-03')] },
        'what happened in the three months before 4 August 2026?',
      )
      expect(plan).toMatchObject({
        reads: [{ scope: { window: { start: '2026-05-04', end: '2026-08-04' } } }],
      })
    })

    it('says the other reading when the two disagree, and never loses the plan', () => {
      const plan = planned(
        { reads: [read('in november', '2026-11-01', '2026-11-30')] },
        'what happens in november?',
      )
      expect(plan).toMatchObject({
        reads: [{ scope: { window: { start: '2026-11-01', end: '2026-12-01' } } }],
        otherDays: { start: '2025-11-01', end: '2025-12-01' },
      })
    })

    it('takes no days with no first day: only the business could date those words', () => {
      const plan = planned(
        { reads: [read('since the rebrand', null, '2026-10-23')] },
        'what happened since the rebrand?',
      )
      expect(plan).toMatchObject({ unplaced: ['since the rebrand'] })
    })

    it('says nothing when they agree, and reads the words when the model gave no days', () => {
      const same = planned(
        { reads: [read('in august 2026', '2026-08-01', '2026-08-31')] },
        'what happened in august 2026?',
      )
      expect(same).not.toHaveProperty('otherDays')
      const words = planned({ reads: [read('in august 2026')] }, 'what happened in august 2026?')
      expect(words).toMatchObject({
        reads: [{ scope: { window: { start: '2026-08-01', end: '2026-09-01' } } }],
      })
    })

    it('keeps the model days on a market read with no metric, and says the other reading', () => {
      const plan = planned(
        {
          reads: [
            {
              kind: 'lookup',
              values: ['val:market/norway'],
              dates: 'in november',
              from: '2026-11-01',
              to: '2026-11-30',
            },
          ],
        },
        'what happened in Norway in november?',
      )
      expect(plan).toMatchObject({
        reads: [{ scope: { window: { start: '2026-11-01', end: '2026-12-01' } } }],
        otherDays: { start: '2025-11-01', end: '2025-12-01' },
      })
    })

    it('takes no model days when the reader placed nothing in the question', () => {
      const since = planned(
        { reads: [read('since the rebrand', '2026-03-01', null)] },
        'what happened since the rebrand?',
      )
      expect(since).toMatchObject({ unplaced: ['since the rebrand'] })
      expect(since).not.toMatchObject({ reads: [{ scope: { window: { start: '2026-03-01' } } }] })
      const none = planned(
        { reads: [read('around the audit', '2026-08-01', '2026-08-31')] },
        'what is written about Orders?',
      )
      expect(none).not.toMatchObject({ reads: [{ scope: { window: { start: '2026-08-01' } } }] })
    })

    it('keeps the plan when a model day is not a date at all', () => {
      const plan = planned(
        { reads: [read('in february 2026', '2026-02-01', '2026-13-01')] },
        'what happened in february 2026?',
      )
      expect(plan).toMatchObject({ kind: 'reads' })
    })

    it('takes the model today for a question about now that the reader places nowhere', () => {
      const plan = planned(
        { reads: [read('today', PLAN_NOW.slice(0, 10), PLAN_NOW.slice(0, 10))] },
        'which rules apply to Orders in Norway right now?',
      )
      expect(plan).toMatchObject({
        reads: [{ scope: { window: { start: PLAN_NOW.slice(0, 10) } } }],
      })
    })

    it('never takes a day that does not exist', () => {
      const plan = planned(
        { reads: [read('in february 2026', '2026-02-31', '2026-02-28')] },
        'what happened in february 2026?',
      )
      expect(plan).toMatchObject({
        reads: [{ scope: { window: { start: '2026-02-01', end: '2026-03-01' } } }],
      })
    })

    it('takes no days for a question that names no period', () => {
      const plan = planned(
        { records: { intent: 'due', period: null, from: '1900-01-01', to: '2026-10-23' } },
        'anything overdue in Sales?',
      )
      expect(plan).toMatchObject({ kind: 'records', ask: { intent: 'due', period: null } })
    })

    it('never takes days that are not days', () => {
      const plan = planned(
        { reads: [read('in august 2026', 'soon', '2026-13-45')] },
        'what happened in august 2026?',
      )
      expect(plan).toMatchObject({
        reads: [{ scope: { window: { start: '2026-08-01', end: '2026-09-01' } } }],
      })
    })

    it('reads a records period from them too', () => {
      const plan = planned(
        { records: { intent: 'created', period: 'since october', from: '2026-10-01' } },
        'what went into context since october?',
      )
      expect(plan).toMatchObject({ kind: 'records', ask: { period: { assumed: false } } })
    })
  })
})

describe('a search that finds what it finds', () => {
  const everyDate = { metrics: [], filters: {}, window: anyDate }
  const search = (words: string, kinds: ('event' | 'issue' | 'note' | 'guide')[]) =>
    explore(
      { ...planBundle, areas: planBundle.areas ?? [] },
      { kind: 'explore', words, kinds, scope: everyDate, period: 'any' },
      PLAN_TODAY,
    )

  it('finds nothing for words nothing has, across every kind', () => {
    expect(search('loyalty points', []).answer.state).toBe('missing')
    expect(search('loyalty points', ['event', 'issue', 'note', 'guide']).answer.items).toEqual([])
  })

  it('leaves no part open for a kind with nothing to say', () => {
    const { answer } = search('card failed', ['event', 'guide'])
    expect(answer.items.length).toBeGreaterThan(0)
    expect(answer.state).not.toBe('partial')
  })
})
