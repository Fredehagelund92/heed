import { describe, expect, it } from 'vitest'
import { answer, type AnswerBundle } from '../../../src/domain/answer.ts'
import { topicFor } from '../../../src/domain/gap-reports.ts'
import {
  CASES_TODAY,
  labCases,
  larchwoodGroupsOfMetric,
  larchwoodLibrary,
  larchwoodMetricArea,
  larchwoodTerms,
  phrasings,
  PHRASINGS_TODAY,
} from './topics-lab.ts'

/*
  The topics lab's phrasings and cases through the answer engine: each is read as the topics
  study recorded (its scope and topic key, misses included), and answered with the state the
  Larchwood library gives it. See topics-lab.ts.
*/

const bundle: AnswerBundle = {
  edition: '2026-10-20.1',
  overlay: '0',
  items: larchwoodLibrary,
  terms: larchwoodTerms,
  groupsOfMetric: larchwoodGroupsOfMetric,
  metricArea: larchwoodMetricArea,
  stopped: { all: false, areas: [], items: [] },
}
const topicOf = (result: ReturnType<typeof answer>) =>
  result.scope ? topicFor(result.scope, larchwoodMetricArea).key : null

describe('the 50 phrasings', () => {
  it('are all here, in the nine kinds the study sorted them into', () => {
    expect(phrasings).toHaveLength(50)
    expect(new Set(phrasings.map((p) => p.question)).size).toBe(50)
    expect(new Set(phrasings.map((p) => p.kind)).size).toBe(9)
  })

  it.each(phrasings)('$kind: $question', ({ question, topic, state }) => {
    const result = answer(bundle, { question }, { today: PHRASINGS_TODAY })
    expect(topicOf(result)).toBe(topic)
    expect(result.status === 'need_more_detail').toBe(topic === null)
    expect(result.state).toBe(state)
    // The first step says what was read: the scope the topic is made of.
    expect(result.steps[0]).toMatchObject({ step: 'read_scope', scope: result.scope })
  })
})

describe('the named cases', () => {
  it('are all here', () => {
    expect(labCases).toHaveLength(24)
  })

  it.each(labCases)('$label', ({ ask, scope, topic, state }) => {
    const result = answer(bundle, ask, { today: CASES_TODAY })
    expect(result.scope).toEqual(scope)
    expect(topicOf(result)).toBe(topic)
    expect(result.state).toBe(state)
  })

  it('say what was read and what applies, as get_context says it', () => {
    const at = (label: string) => {
      const c = labCases.find((x) => x.label === label)!
      return answer(bundle, c.ask, { today: CASES_TODAY })
    }
    expect(at('A1 text only, August').say).toBe(
      '1 fact applies to Orders in Norway in August 2026. Only that was checked.',
    )
    // No dates: read at today, and the answer says so; that makes it Partial.
    expect(at('A3 text, no month')).toMatchObject({
      state: 'partial',
      assumed: { date: CASES_TODAY, reason: 'no date given' },
    })
    expect(at('A3 text, no month').say).toContain('I assumed today, 25 October 2026.')
    // Two markets, one written down: the answer names the market that is not.
    expect(at('D1 two markets').uncovered).toEqual({
      metrics: [],
      values: ['val:market/spain'],
    })
    // A name nobody knows is never chosen: nothing is looked up.
    expect(at('B2 turnover structured by agent')).toMatchObject({
      status: 'need_more_detail',
      state: 'missing',
      items: [],
    })
  })
})
