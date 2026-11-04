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

  it('reads its dates as get_context reads them, and refuses dates it cannot read', () => {
    const read = (dates: string | null, why = false) => {
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
        ctx({ question: 'orders in Sweden' }),
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
    // No dates: today, as the rules read it; for a question about why, every date.
    expect(read(null).period).toBe('today')
    expect(read(null, true)).toEqual({ window: anyDate, period: 'any' })
    // The last question's period, carried, only when its words named one.
    expect(read('same').period).toBe('today')
    const dated = { ...previous, question: 'why did orders drop in Norway in May 2026?' }
    const carried = checkPlan(
      { reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: 'same' }] },
      ctx({ previous: dated }),
    )
    expect(carried).toMatchObject({ ok: true, plan: { reads: [{ period: 'carried' }] } })
    expect(
      checkPlan(
        { reads: [{ kind: 'lookup', metrics: ['metric:orders'], dates: 'the 45th of Smarch' }] },
        ctx(),
      ),
    ).toEqual({ ok: false, why: 'dates not read' })
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
    expect(search({ kinds: ['guide'], words: 'jump' }).answer.state).toBe('stale')
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
  const open = (question: string, previous: ChatTurn = back) => leftOpen(ctx({ question, previous }))

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
