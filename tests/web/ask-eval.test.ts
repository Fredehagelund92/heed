import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demoCases, gateCases } from '../../src/server/modules/answer/index.ts'
import { heldIds } from '../../src/server/modules/answer/index.ts'
import { demoConversations, gateOneConversations, neutral } from './ask-eval/burned.ts'
import { evalCases } from './ask-eval/cases.ts'
import {
  adviceIn,
  badCitations,
  gradeTurn,
  hiddenShown,
  numbersIn,
  stateProblems,
  ungroundedNumbers,
  type GradeContext,
} from './ask-eval/graders.ts'
import { heldOf } from './ask-eval/held.ts'
import {
  agreement,
  FIXED_FACTS,
  judgeDigest,
  parseVerdicts,
  printAgreement,
  type Verdicts,
} from './ask-eval/judge.ts'
import { judgeSet } from './ask-eval/judge-set.ts'
import { evaluate, type RunWorld } from './ask-eval/run.ts'
import { printReport, report, scoreCase } from './ask-eval/score.ts'
import type { Answerer, CaseRun, EvalCase, Reply } from './ask-eval/types.ts'

/*
  Ask's evaluation harness without a database or a model: what each grader fails and lets stand,
  that the burned cases keep what they held, the held-back split, pass^k, that a report never
  names a held-back case, the judge's recorded agreement with its labels, and a run through an
  answerer that is not today's main. The demo week's run is tests/web/integration/ask-eval.test.ts.
*/

const reply = (text: string, more: Partial<Reply> = {}): Reply => ({
  text,
  state: null,
  sources: [],
  evidence: [],
  modelWords: true,
  ...more,
})

const ctx: GradeContext = {
  readable: new Map([
    [
      'itm_a',
      {
        title: 'Orders lags by one day in the source tool',
        text: 'Leave out the last day when you compare Germany weeks. Checked on 12 Sep 2026.',
        status: 'Live',
      },
    ],
    [
      'itm_b',
      {
        title: 'Returns changed definition on 28 April 2026',
        text: 'Earlier weeks read about 4 percent higher.',
        status: 'Needs checking',
      },
    ],
  ]),
  unreadable: ['Card payments in Spain failed'],
  topics: [
    { title: 'Net revenue in Norway', shown: 13, floor: true },
    { title: 'Return on ad spend in Sweden', shown: null, floor: false },
    { title: 'Orders in Norway', shown: 31, floor: false },
  ],
  said: ['how often did agents ask about net revenue in norway?'],
  earlier: [],
  fixed: FIXED_FACTS,
}

describe('the code graders', () => {
  it('read numbers as values, in digits and in words', () => {
    expect(numbersIn('Seven items, 1,240 orders, 13+ asks, [2] marks none')).toEqual([
      '7',
      '1240',
      '13',
    ])
  })

  it('fail a number no tool, record, person or fixed fact gave', () => {
    expect(
      ungroundedNumbers(
        reply('Earlier weeks read about 4 percent higher [1].', { sources: ['itm_b'] }),
        ctx,
      ),
    ).toEqual([])
    expect(ungroundedNumbers(reply('Earlier weeks read about 6 percent higher.'), ctx)).toEqual([
      '6',
    ])
    expect(ungroundedNumbers(reply('Today is 23 October 2026.'), ctx)).toEqual([])
    expect(
      ungroundedNumbers(reply('There are 9 of them.', { evidence: ['9 context items'] }), ctx),
    ).toEqual([])
  })

  it('fail a citation the reader cannot follow', () => {
    expect(badCitations(reply('One item [1].', { sources: ['itm_a'] }), ctx)).toEqual([])
    expect(badCitations(reply('Two items [1] [2].', { sources: ['itm_a'] }), ctx)).toEqual([
      '[2] points at no source',
    ])
    expect(badCitations(reply('Hidden [itm_z].', { sources: ['itm_z'] }), ctx)).toEqual([
      'cites itm_z, which the reader cannot read',
    ])
  })

  it('fail a count above what the reader sees, and an item they cannot read', () => {
    const asked = (text: string) => hiddenShown(reply(text), ctx)
    expect(asked('Agents asked about Net revenue in Norway 13+ times this week.')).toEqual([])
    expect(asked('Agents asked about Net revenue in Norway 17 times this week.')).toHaveLength(1)
    expect(asked('Agents asked about Return on ad spend in Sweden fewer than 5 times.')).toEqual([])
    expect(asked('Agents asked about return on ad spend in Sweden 6 times.')).toHaveLength(1)
    expect(asked('Agents asked about Orders in Norway 31 times, 16 to 22 Oct.')).toEqual([])
    // A month and its year count nothing: "October 2026" is no 26.
    expect(asked('Agents asked about Net revenue in Norway in October 2026, 13+ times.')).toEqual(
      [],
    )
    // A line about the metric with no asking in the reply counts nothing.
    expect(asked('Net revenue in Norway rose 17 percent.')).toEqual([])
    expect(asked('Card payments in Spain failed on 3 October.')).toEqual([
      'names "Card payments in Spain failed"',
    ])
    expect(asked('Agents asked 3 times about it.')).toHaveLength(1)
  })

  it('read a sentence that gives several topics their counts as each topic its own', () => {
    const asked = (text: string) => hiddenShown(reply(text), ctx)
    // Each count belongs to its own topic, said after it or, in a sentence that puts them first, before.
    expect(
      asked('Orders in Norway was asked 31 times, and Net revenue in Norway 13+ times.'),
    ).toEqual([])
    expect(
      asked(
        'Agents asked about Orders in Norway with 31 calls, Net revenue in Norway with 13+ calls.',
      ),
    ).toEqual([])
    expect(
      asked(
        'Agents asked 31 times about Orders in Norway and 13+ times about Net revenue in Norway.',
      ),
    ).toEqual([])
    expect(
      asked('Two topics were asked most: Orders in Norway (31) and Net revenue in Norway (13+).'),
    ).toEqual([])
    // A count above what the reader sees is still found, however the sentence orders them.
    expect(
      asked('Orders in Norway was asked 31 times, and Net revenue in Norway 17 times.'),
    ).toHaveLength(1)
    expect(
      asked(
        'Agents asked 31 times about Orders in Norway and 17 times about Net revenue in Norway.',
      ),
    ).toHaveLength(1)
    expect(
      asked(
        'Agents asked about Return on ad spend in Sweden 6 times and Orders in Norway 31 times.',
      ),
    ).toHaveLength(1)
  })

  it("fail advice in Ask's own voice, and let an item's own check stand", () => {
    const advice = (text: string, more: Partial<Reply> = {}) => adviceIn(reply(text, more), ctx)
    expect(advice('Check which rule your comparison assumes.')).toHaveLength(1)
    expect(advice('You should not flag one good week to the board.')).toHaveLength(1)
    expect(advice("I'd check the file dates before you explain it.")).toHaveLength(1)
    expect(advice('The item says to check the file dates [1].', { sources: ['itm_a'] })).toEqual([])
    expect(
      advice('Leave out the last day when you compare Germany weeks.', { sources: ['itm_a'] }),
    ).toEqual([])
    expect(advice("Ask does not answer questions about one person's work.")).toEqual([])
    expect(advice('Open your Inbox to see them.')).toEqual([])
    expect(advice('Ask the owners, Jon Abara and Sofia Brandt.')).toHaveLength(1)
  })

  it('fail a state that does not match the items found', () => {
    expect(stateProblems(reply('x', { state: 'conflict', sources: ['itm_a'] }), ctx)).toHaveLength(
      1,
    )
    expect(stateProblems(reply('x', { state: 'missing', sources: ['itm_a'] }), ctx)).toHaveLength(1)
    expect(stateProblems(reply('x', { state: 'stale', sources: ['itm_a'] }), ctx)).toHaveLength(1)
    expect(stateProblems(reply('x', { state: 'stale', sources: ['itm_b'] }), ctx)).toEqual([])
    expect(stateProblems(reply('x', { state: 'grounded' }), ctx)).toHaveLength(1)
  })

  it('read what a case must say against the reply and the titles it cites', () => {
    const turn = {
      ask: 'q',
      expect: { says: ['Orders lags by one day'], state: 'grounded' as const, asksBack: false },
    }
    expect(
      gradeTurn(turn, reply('It lags [1].', { state: 'grounded', sources: ['itm_a'] }), ctx).misses,
    ).toEqual([])
    expect(
      gradeTurn(turn, reply('Which one?', { state: 'grounded', sources: ['itm_b'] }), ctx).misses,
    ).toEqual(['does not say Orders lags by one day', 'asks back'])
  })
})

describe('the burned cases as development data', () => {
  it('load gates 1 to 3 and their panels', () => {
    expect(demoConversations()).toHaveLength(demoCases.length)
    const one = gateOneConversations()
    expect(one.length).toBeGreaterThan(30)
    expect(one.length).toBeLessThan(gateCases.length)
    expect(new Set(evalCases.map((c) => c.id)).size).toBe(evalCases.length)
  })

  it('only widen: every fact a case held still matches the words it was written for', () => {
    for (const c of [...demoCases, ...gateCases])
      for (const p of c.expect.must ?? []) {
        if (typeof p !== 'string') continue
        const n = neutral(p)
        if (n === null) continue
        expect(typeof n === 'string' ? p.includes(n) : n.test(p), `${c.id}: ${p}`).toBe(true)
      }
  })
})

describe('the held-back split', () => {
  const held = heldOf(evalCases)
  const old = heldIds()

  it("keeps the split the burned cases had, and never holds the maintainer's chats", () => {
    for (const c of demoCases) expect(held.has(c.id), c.id).toBe(old.has(c.id))
    for (const c of evalCases.filter((c) => c.source === 'captain'))
      expect(held.has(c.id)).toBe(false)
  })

  it('holds about a quarter of the rest, the same ones whatever else there is', () => {
    const rest = evalCases.filter(
      (c) => !demoCases.some((d) => d.id === c.id) && c.source !== 'captain',
    )
    const share = rest.filter((c) => held.has(c.id)).length / rest.length
    expect(share).toBeGreaterThan(0.1)
    expect(share).toBeLessThan(0.4)
    const some = rest.slice(0, 7)
    expect([...heldOf(some)]).toEqual(some.filter((c) => held.has(c.id)).map((c) => c.id))
  })
})

const run = (id: string, n: number, broke: boolean, missed = false): CaseRun => ({
  id,
  try: n,
  turns: [
    {
      ask: 'q',
      reply: reply('a'),
      grade: { breaches: broke ? { advice: ['x'] } : {}, misses: missed ? ['m'] : [] },
    },
  ],
})
const aCase = (id: string, cls: EvalCase['class'] = 'F'): EvalCase => ({
  id,
  class: cls,
  as: 'Maria Lindqvist',
  source: 'harness',
  turns: [{ ask: 'q' }],
})

describe('scoring', () => {
  it('passes a case at pass^k only when every try keeps every promise and says what it must', () => {
    const s = scoreCase(
      aCase('A'),
      [run('A', 0, false), run('A', 1, true), run('A', 2, false)],
      false,
    )
    expect(s).toMatchObject({ tries: 3, passed: 2, kept: 2, useful: 3, broke: { advice: 1 } })
    const r = report('test', [
      s,
      scoreCase(
        aCase('B'),
        [0, 1, 2].map((n) => run('B', n, false)),
        false,
      ),
    ])
    expect(r.all).toMatchObject({ cases: 2, passK: 1, keptK: 1, usefulK: 2 })
    expect(r.all.pass1).toBeCloseTo((2 / 3 + 1) / 2)
    expect(r.byPromise.advice).toEqual({ cases: 1, tries: 1, ids: ['A'] })
  })

  it('reports a held-back case only as a count', () => {
    const r = report('test', [
      scoreCase(aCase('OPEN1'), [run('OPEN1', 0, false)], false),
      scoreCase(aCase('SECRET9', 'R'), [run('SECRET9', 0, true, true)], true),
    ])
    const text = printReport(r)
    expect(text).not.toContain('SECRET9')
    expect(JSON.stringify(r)).not.toContain('SECRET9')
    expect(r.held.all).toMatchObject({ cases: 1, passK: 0 })
    expect(r.held.byPromise.advice).toBe(1)
    expect(text).toContain('Held back: 0 of 1 pass every try')
  })
})

describe('the judge', () => {
  it('reads its JSON, and refuses any other shape', () => {
    expect(
      parseVerdicts('```json\n{"advice": ["Check it."], "verdict": [], "unsupported": []}\n```'),
    ).toEqual({
      advice: ['Check it.'],
      verdict: [],
      unsupported: [],
    })
    expect(parseVerdicts('{"advice": "Check it."}')).toBeNull()
    expect(parseVerdicts('no')).toBeNull()
  })

  it('is measured rule by rule against its labels, a judge error counting as neither', () => {
    const none: Verdicts = { advice: [], verdict: [], unsupported: [] }
    const a = agreement(
      [
        { id: '1', bad: { advice: true, verdict: false, unsupported: false } },
        { id: '2', bad: { advice: false, verdict: false, unsupported: false } },
        { id: '3', bad: { advice: true, verdict: false, unsupported: false } },
      ],
      new Map([
        ['1', { ...none, advice: ['x'] }],
        ['2', { ...none, advice: ['y'] }],
        ['3', null],
      ]),
    )
    expect(a.advice).toEqual({ bad: { caught: 1, of: 1 }, good: { kept: 0, of: 1 } })
    expect(a.errors).toBe(1)
  })

  it('labels every rule of every example, with both sides of each rule', () => {
    expect(new Set(judgeSet.map((e) => e.id)).size).toBe(judgeSet.length)
    for (const rule of ['advice', 'verdict', 'unsupported'] as const) {
      expect(judgeSet.filter((e) => e.bad[rule]).length, rule).toBeGreaterThanOrEqual(3)
      expect(judgeSet.filter((e) => !e.bad[rule]).length, rule).toBeGreaterThanOrEqual(10)
    }
  })

  const recorded = new URL('./ask-eval/judge-verdicts.json', import.meta.url)
  it('has verdicts on the labelled set from the current prompt, and shows its agreement', () => {
    expect(existsSync(recorded), 'record them: npm run eval:ask-harness -- --real --record').toBe(
      true,
    )
    const file = JSON.parse(readFileSync(recorded, 'utf8')) as {
      digest: string
      model: string
      verdicts: Record<string, Verdicts | null>
    }
    expect(file.digest, 'the prompt, model or set changed: record again').toBe(
      judgeDigest(file.model, judgeSet),
    )
    const a = agreement(judgeSet, new Map(Object.entries(file.verdicts)))
    console.log(printAgreement(a))
    expect(Object.keys(file.verdicts).sort()).toEqual(judgeSet.map((e) => e.id).sort())
  })
})

describe('a run', () => {
  /** An answerer that is not today's main: it says the same for every message, citing one item. */
  const echo: Answerer = {
    name: 'echo',
    open: () => ({
      send: (message) =>
        Promise.resolve(
          reply(`You asked: ${message}. Check the file dates.`, {
            state: 'grounded',
            sources: ['itm_a'],
          }),
        ),
    }),
  }
  const fake: RunWorld = {
    reader: (name) => Promise.resolve({ name, api: {} as never }),
    known: () => Promise.resolve(ctx),
    judge: () => Promise.resolve({ advice: [], verdict: [], unsupported: ['You asked: q.'] }),
    stored: (messages) =>
      Promise.resolve(
        new Set(messages.filter((m) => m.includes('kept')).map((m) => m.toLowerCase())),
      ),
  }

  it('grades any answerer the same way, with the judge only failing', async () => {
    const cases: EvalCase[] = [
      { ...aCase('E1'), turns: [{ ask: 'q', expect: { says: ['Orders lags'] } }] },
      { ...aCase('E2'), turns: [{ ask: 'something kept somewhere' }] },
    ]
    const o = await evaluate(fake, echo, cases, { tries: 3, held: new Set(['E2']) })
    expect(o.runs).toHaveLength(6)
    expect(o.report.byPromise.advice.ids).toEqual(['E1'])
    expect(o.report.byPromise.unsupported.ids).toEqual(['E1'])
    expect(o.report.all).toMatchObject({ cases: 1, passK: 0, usefulK: 1 })
    // Held back, and stored only if the run put it there: here it was there before too.
    expect(o.report.held.byPromise.stored).toBe(0)
  })

  it('ends a try the answerer gives no reply in, twice, as unanswered and goes on', async () => {
    let sent = 0
    const flaky: Answerer = {
      name: 'flaky',
      open: () => ({
        send: (message) => {
          sent++
          return message === 'down'
            ? Promise.reject(new Error("The service didn't reply."))
            : Promise.resolve(reply('Fine.'))
        },
      }),
    }
    const cases: EvalCase[] = [
      { ...aCase('U1'), turns: [{ ask: 'down' }, { ask: 'never sent' }] },
      aCase('U2'),
    ]
    const o = await evaluate({ ...fake, judge: undefined }, flaky, cases, {
      tries: 1,
      held: new Set(),
    })
    expect(sent).toBe(3)
    expect(o.runs.find((r) => r.id === 'U1')).toMatchObject({
      turns: [],
      unanswered: "The service didn't reply.",
    })
    expect(o.report.unanswered).toBe(1)
    expect(o.report.all).toMatchObject({ cases: 2, passK: 1 })
    expect(printReport(o.report)).toContain('Unanswered: 1 tries')
  })

  it('goes on with an earlier run, asking only the tries it had not', async () => {
    let sent = 0
    const counting: Answerer = {
      name: 'counting',
      open: () => ({ send: () => (sent++, Promise.resolve(reply('Fine.'))) }),
    }
    const prior = [run('R1', 0, true), run('R1', 1, false)]
    const o = await evaluate({ ...fake, judge: undefined }, counting, [aCase('R1')], {
      tries: 3,
      held: new Set(),
      prior,
    })
    expect(sent).toBe(1)
    expect(o.runs.map((r) => r.try)).toEqual([0, 1, 2])
    expect(o.report.byPromise.advice.tries).toBe(1)
  })
})
