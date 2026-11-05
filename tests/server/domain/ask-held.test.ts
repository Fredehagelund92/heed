import { describe, expect, it, vi } from 'vitest'
import type { ChatTurn } from '../../../src/domain/ask-chat.ts'
import { chatOf, routeQuestion, type Planner } from '../../../src/domain/ask-route.ts'
import { servedWords, type WrittenTerm } from '../../../src/domain/served-terms.ts'
import { PLAN_NOW, PLAN_TODAY, planBundle } from '../../../src/server/modules/answer/plan-world.ts'

/*
  A word with more than one meaning, in Ask (FR-138): nothing is looked up, one plain sentence
  names each meaning, and it comes from the fixed rules, never from a planner, which could just
  choose. The turn that asks keeps its reading and its meanings, so the next message settles the
  word with the period kept, again by the fixed rules. These are Larchwood Outdoor's words: a person
  wrote Sales for Net revenue, and then a read gave Sales to Gross sales.
*/

const sales: WrittenTerm = {
  id: '0190f3a2-0000-7000-8000-000000000001',
  name: 'Sales',
  meaning: null,
  sameAs: 'metric:net_revenue',
  areaId: 'sales',
  writtenOn: '2026-10-20',
  writtenAs: 'owner',
  conflict: true,
  alsoMeans: ['metric:gross_sales'],
}
const words = (written: WrittenTerm[]) => {
  const served = servedWords(planBundle.terms, written, { all: false, areas: [] })
  return { ...planBundle, terms: served.vocabulary, areas: planBundle.areas ?? [] }
}
const bundle = words([sales])

/** A planner that fails the test: the rules are to settle these. */
const noModel = () => vi.fn<Planner>(() => Promise.reject(new Error('no model call')))

const route = (question: string, turns: ChatTurn[] = [], planner: Planner = noModel()) =>
  routeQuestion({
    bundle,
    ask: { question },
    turns: chatOf(bundle, turns, PLAN_TODAY),
    records: null,
    today: PLAN_TODAY,
    now: PLAN_NOW,
    planner,
  })

/** The turn the browser sends on after Ask asked. */
async function asked(question: string): Promise<ChatTurn> {
  const routed = await route(question)
  if (routed.kind !== 'reply') throw new Error('Ask did not ask')
  return {
    question,
    scope: null,
    sources: [],
    asked: routed.reply.text,
    ...(routed.reply.held ? { held: routed.reply.held } : {}),
  }
}

const september = { start: '2026-09-01', end: '2026-10-01' }

describe('a question in a word with two meanings', () => {
  it('names both, in one plain sentence, looks nothing up and calls no model', async () => {
    const planner = noModel()
    const routed = await route('sales last month', [], planner)
    expect(routed).toMatchObject({
      kind: 'reply',
      reason: null,
      asked: false,
      reply: {
        kind: 'clarify',
        text: 'Sales can mean Net revenue or Gross sales. Which do you mean?',
      },
    })
    expect(planner).not.toHaveBeenCalled()
  })

  it('adds no sentence about metrics nobody asked about', async () => {
    const routed = await route('sales')
    expect(routed).toMatchObject({
      reply: { text: 'Sales can mean Net revenue or Gross sales. Which do you mean?' },
    })
  })

  it('asks with every meaning when three things claim the word', async () => {
    const three = words([{ ...sales, alsoMeans: ['metric:gross_sales', 'metric:orders'] }])
    const routed = await routeQuestion({
      bundle: three,
      ask: { question: 'sales last month' },
      turns: [],
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })
    expect(routed).toMatchObject({
      reply: { text: 'Sales can mean Net revenue, Gross sales or Orders. Which do you mean?' },
    })
  })

  it('never reaches a model on a follow-up either, and keeps the period the chat had', async () => {
    const planner = noModel()
    const before: ChatTurn = {
      question: 'orders last month',
      scope: { metrics: ['metric:orders'], filters: {}, window: september },
      sources: [],
      dated: true,
    }
    const routed = await route('and sales?', [before], planner)
    expect(routed).toMatchObject({
      kind: 'reply',
      reply: { held: { window: september, metrics: [] } },
    })
    expect(planner).not.toHaveBeenCalled()
  })
})

describe('the answer to it', () => {
  const answered = async (reply: string) => {
    const planner = noModel()
    const routed = await route(reply, [await asked('sales last month')], planner)
    expect(planner).not.toHaveBeenCalled()
    if (routed.kind !== 'reads') throw new Error(`read as ${routed.kind}`)
    const [read] = routed.planned.reads
    return { read, reading: routed.planned.reading }
  }

  it.each([
    ['net', ['metric:net_revenue']],
    ['Net revenue', ['metric:net_revenue']],
    ['the first', ['metric:net_revenue']],
    ['the first one', ['metric:net_revenue']],
    ['gross', ['metric:gross_sales']],
    ['Gross sales please', ['metric:gross_sales']],
    ['the second one', ['metric:gross_sales']],
    ['the latter', ['metric:gross_sales']],
    ['both', ['metric:gross_sales', 'metric:net_revenue']],
  ])('reads %s with the period kept', async (reply, metrics) => {
    const { read, reading } = await answered(reply)
    expect(read).toMatchObject({
      kind: 'lookup',
      period: 'carried',
      scope: { metrics, window: september },
    })
    expect(reading.period).toBe('carried')
  })

  it('keeps the other meaning in sight, one clause, and none when both were asked for', async () => {
    expect((await answered('net')).reading.settled).toEqual({
      also: 'Sales can also mean Gross sales.',
    })
    expect((await answered('both')).reading.settled).toEqual({ also: null })
  })

  it('takes a new period and a market said with it', async () => {
    const { read } = await answered('net, in Norway last week')
    expect(read).toMatchObject({
      period: 'asked',
      scope: {
        metrics: ['metric:net_revenue'],
        filters: { 'dim:market': ['val:market/norway'] },
      },
    })
    expect(read).not.toMatchObject({ scope: { window: september } })
  })

  it('reads at today when the question named no period, and says so', async () => {
    const routed = await route('net', [await asked('sales')])
    if (routed.kind !== 'reads') throw new Error('not read')
    expect(routed.planned.reads[0]).toMatchObject({ period: 'today' })
  })

  it('leaves what the rules cannot read to the planner, with the period to carry', async () => {
    const planner = vi.fn<Planner>(() => Promise.resolve(null))
    const turn = await asked('sales last month')
    await route('whichever makes us look best', [turn], planner)
    expect(planner).toHaveBeenCalledOnce()
    expect(planner.mock.calls[0]![0].prompt).toContain('Ask asked back: Sales can mean')
  })

  it('reads another metric as a new question, and the same word as the same question', async () => {
    const turn = await asked('sales last month')
    expect(
      await route(
        'orders',
        [turn],
        vi.fn<Planner>(() => Promise.resolve(null)),
      ),
    ).toMatchObject({ kind: 'rules' })
    expect(await route('sales', [turn])).toMatchObject({
      kind: 'reply',
      reply: { kind: 'clarify' },
    })
  })

  it('holds nothing the edition does not: a word from the browser is checked', async () => {
    const turn = await asked('sales last month')
    const forged = { ...turn, held: { ...turn.held!, word: 'Anything at all' } }
    expect(chatOf(bundle, [forged], PLAN_TODAY)[0]!.held).toBeUndefined()
    const renamed = {
      ...turn,
      held: {
        ...turn.held!,
        meanings: [
          { key: 'metric:net_revenue', name: 'Something else' },
          { key: 'metric:gross_sales', name: 'Gross sales' },
        ],
      },
    }
    expect(chatOf(bundle, [renamed], PLAN_TODAY)[0]!.held!.meanings[0]!.name).toBe('Net revenue')
  })
})

describe('two words with two meanings each', () => {
  const both = words([
    sales,
    {
      ...sales,
      id: '0190f3a2-0000-7000-8000-000000000002',
      name: 'Takings',
      sameAs: 'metric:orders',
    },
  ])
  const ask = async (question: string, turns: ChatTurn[]) =>
    routeQuestion({
      bundle: both,
      ask: { question },
      turns: chatOf(both, turns, PLAN_TODAY),
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })

  it('asks about one, then the other, and keeps the first answer', async () => {
    const first = await ask('sales and takings last month', [])
    if (first.kind !== 'reply') throw new Error('Ask did not ask')
    expect(first.reply.text).toBe('Sales can mean Net revenue or Gross sales. Which do you mean?')
    const turn: ChatTurn = {
      question: 'sales and takings last month',
      scope: null,
      sources: [],
      asked: first.reply.text,
      held: first.reply.held!,
    }
    const second = await ask('net', [turn])
    if (second.kind !== 'reply') throw new Error('Ask did not ask again')
    expect(second.reply.text).toBe('Takings can mean Orders or Gross sales. Which do you mean?')
    const third = await ask('orders', [
      { ...turn, question: 'net', asked: second.reply.text, held: second.reply.held! },
    ])
    if (third.kind !== 'reads') throw new Error('not read')
    expect(third.planned.reads[0]).toMatchObject({
      scope: { metrics: ['metric:net_revenue', 'metric:orders'], window: september },
    })
  })
})

describe('a term with its own meaning that shares a word with a metric', () => {
  const own: WrittenTerm = {
    ...sales,
    name: 'Takings',
    meaning: 'What the shop sells in a day.',
    sameAs: null,
    alsoMeans: ['metric:gross_sales'],
  }
  const withTerm = words([own])
  const ask = (question: string, turns: ChatTurn[] = []) =>
    routeQuestion({
      bundle: withTerm,
      ask: { question },
      turns: chatOf(withTerm, turns, PLAN_TODAY),
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })

  it('says which meaning is the term, and looks nothing up when the term is chosen', async () => {
    const first = await ask('takings last month')
    if (first.kind !== 'reply') throw new Error('Ask did not ask')
    expect(first.reply.text).toBe(
      'Takings can mean the term Takings or Gross sales. Which do you mean?',
    )
    const turn: ChatTurn = {
      question: 'takings last month',
      scope: null,
      sources: [],
      asked: first.reply.text,
      held: first.reply.held!,
    }
    expect(await ask('the term', [turn])).toMatchObject({
      kind: 'reply',
      reply: {
        kind: 'nothing_asked',
        text: 'Takings is a term with its own meaning in Definitions, so nothing was looked up.',
      },
    })
  })
})

describe('what the question asked is kept through the answer', () => {
  const settle = async (question: string, reply: string) => {
    const routed = await route(reply, [await asked(question)])
    if (routed.kind !== 'reads') throw new Error(`read as ${routed.kind}`)
    return routed.planned.reads[0]
  }

  it('answers with the definition of the chosen metric when it asked what the word means', async () => {
    expect(await settle('what does sales mean?', 'net')).toMatchObject({
      kind: 'definition',
      metrics: ['metric:net_revenue'],
    })
    expect(await settle('what does sales mean?', 'both')).toMatchObject({
      kind: 'definition',
      metrics: ['metric:gross_sales', 'metric:net_revenue'],
    })
  })

  it('answers why over every date when it asked why and named none', async () => {
    expect(await settle('why did sales drop?', 'net')).toMatchObject({
      kind: 'lookup',
      why: true,
      period: 'any',
      scope: {
        metrics: ['metric:net_revenue'],
        window: { start: '1900-01-01', end: '9999-12-31' },
      },
    })
  })

  it('keeps the period it asked why for', async () => {
    expect(await settle('why did sales drop last month?', 'net')).toMatchObject({
      kind: 'lookup',
      why: true,
      period: 'carried',
      scope: { window: september },
    })
  })

  it('holds what it asked, and nothing for a plain question', async () => {
    expect((await asked('what does sales mean?')).held).toMatchObject({ defines: true })
    expect((await asked('why did sales drop?')).held).toMatchObject({ why: true })
    expect((await asked('sales last month')).held).not.toHaveProperty('why')
    expect((await asked('sales last month')).held).not.toHaveProperty('defines')
  })

  it('keeps it across a second word to ask about', async () => {
    const both = words([
      sales,
      {
        ...sales,
        id: '0190f3a2-0000-7000-8000-000000000002',
        name: 'Takings',
        sameAs: 'metric:orders',
      },
    ])
    const first = await routeQuestion({
      bundle: both,
      ask: { question: 'why did sales and takings drop?' },
      turns: [],
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })
    if (first.kind !== 'reply') throw new Error('Ask did not ask')
    const turn: ChatTurn = {
      question: 'why did sales and takings drop?',
      scope: null,
      sources: [],
      asked: first.reply.text,
      held: first.reply.held!,
    }
    const second = await routeQuestion({
      bundle: both,
      ask: { question: 'net' },
      turns: chatOf(both, [turn], PLAN_TODAY),
      records: null,
      today: PLAN_TODAY,
      now: PLAN_NOW,
    })
    if (second.kind !== 'reply') throw new Error('Ask did not ask again')
    expect(second.reply.held).toMatchObject({ why: true })
  })
})

describe('a word named twice in one question', () => {
  it('asks about it once', async () => {
    const turn = await asked('compare sales this month with sales last month')
    expect(turn.held!.more).toBeUndefined()
    const routed = await route('gross', [turn])
    if (routed.kind !== 'reads') throw new Error(`read as ${routed.kind}`)
    expect(routed.planned.reads[0]).toMatchObject({ scope: { metrics: ['metric:gross_sales'] } })
  })

  it('does not say the other meaning is also one when both were read', async () => {
    const turn = await asked('compare sales this month with sales last month')
    const routed = await route('both', [turn])
    if (routed.kind !== 'reads') throw new Error(`read as ${routed.kind}`)
    expect(routed.planned.reading.settled).toEqual({ also: null })
  })
})

describe('replies the fixed rules read, and replies they leave alone', () => {
  const outcome = async (reply: string) => {
    const planner = vi.fn<Planner>(() => Promise.resolve(null))
    const routed = await route(reply, [await asked('sales last month')], planner)
    return { routed, planner }
  }

  it.each([
    ['net revenue for Sweden', ['metric:net_revenue']],
    ['gross for Sweden', ['metric:gross_sales']],
    ['by gross', ['metric:gross_sales']],
    ['it\u2019s net', ['metric:net_revenue']],
    ["it's net", ['metric:net_revenue']],
  ])('reads "%s"', async (reply, metrics) => {
    const { routed } = await outcome(reply)
    if (routed.kind !== 'reads') throw new Error(`read as ${routed.kind}`)
    expect(routed.planned.reads[0]).toMatchObject({ scope: { metrics } })
  })

  it.each(['each market', 'the first market', 'no gross', 'not gross', 'not the first'])(
    'does not take "%s" for a choice',
    async (reply) => {
      const { routed } = await outcome(reply)
      expect(routed.kind).not.toBe('reads')
    },
  )

  it('chooses a term meaning by its name, with the word term, as Ask words it', async () => {
    const own: WrittenTerm = {
      ...sales,
      name: 'Takings',
      meaning: 'What the shop sells in a day.',
      sameAs: null,
      alsoMeans: ['metric:gross_sales'],
    }
    const withTerm = words([own])
    const ask = (question: string, turns: ChatTurn[] = []) =>
      routeQuestion({
        bundle: withTerm,
        ask: { question },
        turns: chatOf(withTerm, turns, PLAN_TODAY),
        records: null,
        today: PLAN_TODAY,
        now: PLAN_NOW,
      })
    const first = await ask('takings last month')
    if (first.kind !== 'reply') throw new Error('Ask did not ask')
    const turn: ChatTurn = {
      question: 'takings last month',
      scope: null,
      sources: [],
      asked: first.reply.text,
      held: first.reply.held!,
    }
    expect(await ask('the term Takings', [turn])).toMatchObject({
      kind: 'reply',
      reply: { kind: 'nothing_asked' },
    })
  })
})
