import { describe, expect, it } from 'vitest'
import { askedTopics } from '../../../src/domain/answer.ts'
import { askedCell, shownTopics, visibleTotal } from '../../../src/domain/gaps.ts'
import { answerRecords, type RecordsAsk } from '../../../src/domain/records.ts'
import { recordsText } from '../../../src/server/modules/answer/plan-cases.ts'
import { askPlanCase, PLAN_NOW, planBundle } from '../../../src/server/modules/answer/index.ts'
import { planRecords } from '../../../src/server/modules/answer/plan-world.ts'

// One rule for a count a person may see (FR-614, FR-620), wherever Ask states one: every display
// rule the app has, each held on Ask's own answers. A count under the minimum is hidden, a floor
// shows where a page shows one, and no count is shown that gives a hidden one away by subtraction.

const row = (count: number | null, atLeast: number, nothing: number | null) => ({
  title: 't',
  count,
  atLeast,
  nothing,
})

describe('the one rule for what may show together', () => {
  it('hides a count from one to under the minimum', () => {
    expect(shownTopics([row(3, 3, 0)], 5)).toEqual([])
    expect(shownTopics([row(4, 4, 4)], 5)).toEqual([])
  })

  it('shows zero and a count at the minimum', () => {
    expect(shownTopics([row(5, 5, 0)], 5)[0]).toMatchObject({ count: 5, nothing: 0 })
    expect(shownTopics([row(6, 6, 6)], 5)[0]).toMatchObject({ count: 6, nothing: 6 })
  })

  it('hides what found nothing under the minimum, and keeps the total', () => {
    expect(shownTopics([row(14, 14, 2)], 5)[0]).toMatchObject({ count: 14, nothing: null })
  })

  it('takes a total to a floor when subtraction would give a small count away', () => {
    expect(shownTopics([row(11, 11, 8)], 5)[0]).toMatchObject({
      count: null,
      atLeast: 8,
      nothing: 8,
    })
    expect(askedCell({ count: null, atLeast: 8 }, 5)).toBe('8+')
  })

  it('never shows both of a total and a part whose difference is small, for any counts', () => {
    for (let total = 1; total <= 30; total++)
      for (let nothing = 0; nothing <= total; nothing++) {
        const [shown] = shownTopics([row(total, total, nothing)], 5)
        if (!shown) {
          expect(total).toBeLessThan(5)
          continue
        }
        if (shown.count === null || !shown.nothing) continue
        const rest = shown.count - shown.nothing
        expect(rest === 0 || rest >= 5, `${total} and ${nothing}`).toBe(true)
      }
  })

  it('says "Fewer than 5" where not even a floor shows', () => {
    expect(askedCell({ count: null, atLeast: 0 }, 5)).toBe('Fewer than 5')
    expect(askedCell({ count: null, atLeast: 13 }, 5)).toBe('13+')
    expect(askedCell({ count: 1200, atLeast: 1200 }, 5)).toBe('1,200')
  })

  it('holds for what Asked this week shows too', () => {
    const topic = (calls: number, noItem: number) => ({
      id: 't',
      area: 'a',
      metrics: ['metric:orders'],
      values: [],
      dimensions: [],
      month: '2026-10-01',
      calls,
      noItem,
    })
    const { topics } = askedTopics([topic(12, 9)], 5, '2026-10-23')
    expect(topics[0]).toMatchObject({ count: null, atLeast: 9, nothing: 9 })
  })

  it('leaves the total of a week as it was: only over shown parts', () => {
    expect(visibleTotal(14, 12, 5)).toBeNull()
    expect(visibleTotal(17, 12, 5)).toBe(17)
  })
})

describe('what agents asked, as Ask states it, fed raw', () => {
  const world = {
    ...planRecords,
    asked: {
      minimum: 5,
      rows: [
        {
          title: 'Small',
          count: 3,
          atLeast: 3,
          nothing: 3,
          state: 'missing' as const,
          gap: null,
          metrics: ['metric:returns'],
        },
        {
          title: 'Left over',
          count: 12,
          atLeast: 12,
          nothing: 9,
          state: 'missing' as const,
          gap: null,
          metrics: ['metric:orders'],
        },
      ],
    },
  }
  const ask = (facets: NonNullable<RecordsAsk['audit']>['facets']): RecordsAsk => ({
    intent: 'audit',
    domain: null,
    kind: null,
    metric: null,
    period: null,
    noOwner: false,
    audit: { facets, of: null, kind: null, value: null },
  })
  const said = (a: RecordsAsk) => recordsText(answerRecords(a, world, PLAN_NOW)).join('\n')

  it.each([
    ['what was asked most', ['asked_most'] as const],
    ['what found nothing', ['asked_nothing'] as const],
    ['both at once', ['asked_most', 'asked_nothing'] as const],
    ['what is asked and not covered', ['asked_most', 'no_context'] as const],
  ])('%s', (_name, facets) => {
    const text = said(ask([...facets]))
    expect(text).not.toMatch(/\bSmall\b/)
    expect(text).not.toMatch(/\b12\b/)
    expect(text).not.toMatch(/9 of 12/)
  })

  it('does not count a topic it hides in a denominator', () => {
    expect(said(ask(['asked_nothing']))).toContain('1 of 1 topics')
  })
})

describe('an item for another group, to a person', () => {
  it('is neither named nor counted, in any line of the answer', async () => {
    const { routed } = await askPlanCase({ question: 'why did orders drop in Norway?' }, null, [])
    if (routed.kind !== 'rules') throw new Error('read by the rules')
    expect(routed.answer.forAnotherGroup).toBe(0)
    expect(routed.answer.say).not.toMatch(/another group|isn't shared/)
    expect(JSON.stringify(routed.answer.steps)).not.toMatch(/another group/)
    expect(routed.answer.steps.find((s) => s.step === 'left_out')).toMatchObject({
      forAnotherGroup: 0,
    })
  })

  it('is still told to an agent: get_context does not change', async () => {
    const { answer } = await import('../../../src/domain/answer.ts')
    const said = answer(
      planBundle,
      { question: 'why did orders drop in Norway?' },
      {
        today: '2026-10-23',
      },
    )
    expect(said.forAnotherGroup).toBe(1)
    expect(said.say).toMatch(/for another group/)
  })
})
