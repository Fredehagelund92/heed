import { describe, expect, it } from 'vitest'
import { levelResults } from '../../../src/server/modules/evals/runs.ts'

const flipped = (id: string) =>
  ({ id, impact: true, baseline: 'pass', candidate: 'fail', flip: 'pass_to_fail' }) as const

describe('the gate messages of answer tests (FR-503, FR-513)', () => {
  it('counts held-out questions without naming them to the proposer', () => {
    const levels = levelResults(
      'full',
      [flipped('norway-cause'), flipped('norway-secret')],
      new Set(['norway-secret']),
    )
    expect(levels.answer_impact).toMatchObject({ outcome: 'failed' })
    expect(levels.answer_impact!.message).toContain('norway-cause, 1 held-out question')
    expect(levels.answer_full!.message).not.toContain('norway-secret')
  })
  it('fails the full set when the area has no active test questions', () => {
    expect(levelResults('full', []).answer_full).toMatchObject({ outcome: 'failed' })
    expect(levelResults('impact', []).answer_impact).toMatchObject({ outcome: 'passed' })
  })
})

describe('tests attached to a proposal (FR-524)', () => {
  it('reports an attached test with the change and leaves the outcome alone', () => {
    const attachedOnly = {
      ...flipped('spain-attached'),
      impact: false,
      attached: true,
    } as const
    const fixed = {
      id: 'spain-fixed',
      impact: true,
      attached: true,
      baseline: 'fail',
      candidate: 'pass',
      flip: 'fail_to_pass',
    } as const
    const levels = levelResults('impact', [attachedOnly, fixed])
    expect(levels.answer_impact).toEqual({
      outcome: 'passed',
      message:
        "1 test question could change. It didn't get worse. 1 went from failing to passing. Attached tests, reported only: spain-attached fails with this change; spain-fixed passes with this change.",
      attached: [
        { id: 'spain-attached', baseline: 'pass', candidate: 'fail' },
        { id: 'spain-fixed', baseline: 'fail', candidate: 'pass' },
      ],
    })
  })
  it('still fails a level on a test in the impact set, attached or not', () => {
    const levels = levelResults('full', [{ ...flipped('norway-cause'), attached: true }])
    expect(levels.answer_impact).toMatchObject({ outcome: 'failed' })
    expect(levels.answer_full).toMatchObject({
      outcome: 'failed',
      attached: [{ id: 'norway-cause', baseline: 'pass', candidate: 'fail' }],
    })
  })
  it('never names a held-out question, attached or not', () => {
    const levels = levelResults(
      'impact',
      [{ ...flipped('norway-secret'), impact: false, attached: true }],
      new Set(['norway-secret']),
    )
    expect(levels.answer_impact).toEqual({
      outcome: 'passed',
      message: 'None of the test questions could change.',
    })
  })
})
