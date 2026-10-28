import { describe, expect, it } from 'vitest'
import type { Area } from '@domain/item'
import type { Comparison } from '@/api'
import type { DomainHealth } from '@/lib/quality'
import { scopeSummary } from '@/lib/workbench-scope'

const area = (id: string): Area => ({
  id,
  name: id,
  summary: '',
  description: '',
  ownerIds: [],
  label: 'teal',
  revision: 1,
  demo: false,
})

function row(id: string, patch: Partial<DomainHealth> = {}): DomainHealth {
  return {
    area: area(id),
    questions: 9,
    state: { kind: 'steady' },
    retrieval: { rate: 8 / 9, passed: 8, questions: 9, edition: '2026-10-10.1', change: null },
    answers: {
      rate: 6 / 9,
      passed: 6,
      questions: 9,
      run: '00000000-0000-4000-b000-000000000090',
      finishedAt: '2026-10-10T06:00:00Z',
      change: null,
    },
    caveats: null,
    flips: { better: 0, worse: 3, pValue: 0.25 },
    openGaps: 3,
    pastReview: 19,
    untested: 0,
    untestedRequired: 0,
    ...patch,
  }
}

const comparison = (worse: number) =>
  ({ signTest: { better: 0, worse, pValue: null } }) as unknown as Comparison

describe('the scope strip summary (Workbench plan, 3.2)', () => {
  it('waits for the domains', () => {
    expect(scopeSummary({ rows: null })).toEqual({ state: 'pending' })
    expect(scopeSummary({ rows: [row('a')], area: 'b' })).toEqual({ state: 'pending' })
  })

  it('gives one domain its retrieval, answers and what got worse in its comparison', () => {
    expect(
      scopeSummary({ rows: [row('a'), row('b')], area: 'a', comparison: comparison(1) }),
    ).toEqual({
      state: 'ready',
      retrieval: { passed: 8, questions: 9 },
      answers: { passed: 6, questions: 9 },
      worse: 1,
    })
    // Before the chosen comparison is read, the run before.
    expect(scopeSummary({ rows: [row('a')], area: 'a' })).toMatchObject({ worse: 3 })
  })

  it('says a domain has no test questions yet, instead of numbers', () => {
    const empty = row('a', { state: { kind: 'not_started' }, retrieval: null, answers: null })
    expect(scopeSummary({ rows: [empty], area: 'a' })).toEqual({
      state: 'not_started',
      area: empty.area,
    })
  })

  it('adds every domain up, leaving out the ones with nothing to count', () => {
    const empty = row('c', {
      state: { kind: 'not_started' },
      retrieval: null,
      answers: null,
      flips: null,
    })
    expect(scopeSummary({ rows: [row('a'), row('b'), empty] })).toEqual({
      state: 'ready',
      retrieval: { passed: 16, questions: 18 },
      answers: { passed: 12, questions: 18 },
      worse: 6,
    })
  })

  it('says nothing is known yet rather than zero', () => {
    const fresh = row('a', { retrieval: null, answers: null, flips: null })
    expect(scopeSummary({ rows: [fresh] })).toEqual({
      state: 'ready',
      retrieval: null,
      answers: null,
      worse: null,
    })
  })
})
