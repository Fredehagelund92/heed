import { describe, expect, it } from 'vitest'
import type { AttachedTest, Permissions, ProposalTest } from '@/api'
import { readAttachedTest, withResults } from '@/lib/attached-tests'
import { canAttachTests } from '@/lib/permissions'

/*
  A test attached to a draft or proposal (FR-524, Workbench plan, slice V6): its report-only
  results in words, and who may attach and detach it.
*/

const test = (patch: Partial<ProposalTest> = {}): ProposalTest => ({
  question: 'net-revenue-spain',
  active: true,
  attachedHour: '2026-10-12T09:00:00.000Z',
  ...patch,
})
const results = (patch: Partial<AttachedTest>): AttachedTest => ({
  ...test(),
  retrieval: null,
  answer: null,
  ...patch,
})
const inReview = { state: 'in_review' } as const

describe('readAttachedTest', () => {
  it('says a draft is checked and answered once it is submitted', () => {
    expect(readAttachedTest(test(), { state: 'draft' })).toEqual({
      question: 'net-revenue-spain',
      state: 'not_run',
      delivery: "We check whether it finds the fact once it's sent.",
      answer: "No answer tests run on a proposal. It's answered once the change is accepted.",
    })
  })

  it('says what is not checked yet once it is sent', () => {
    expect(readAttachedTest(results({}), inReview).delivery).toBe('Not checked yet.')
  })

  it('reads delivery without and with the change', () => {
    const delivery = (baseline: boolean, candidate: boolean) =>
      readAttachedTest(results({ retrieval: { baseline, candidate } }), inReview)
    expect(delivery(false, true)).toMatchObject({
      state: 'passed',
      delivery: 'It finds the fact with this change, not without it.',
    })
    expect(delivery(true, true).delivery).toBe('It finds the fact, with and without this change.')
    expect(delivery(true, false)).toMatchObject({
      state: 'failed',
      delivery: 'It no longer finds the fact with this change.',
    })
    expect(delivery(false, false).delivery).toBe("It still doesn't find the fact with this change.")
  })

  it('reads the answer without and with the change, and its glyph wins over delivery', () => {
    const answer = (
      baseline: 'pass' | 'fail' | 'no_answer' | null,
      candidate: 'pass' | 'fail' | 'no_answer' | null,
    ) =>
      readAttachedTest(
        results({
          retrieval: { baseline: true, candidate: true },
          answer: { run: 'run-1', baseline, candidate },
        }),
        inReview,
      )
    expect(answer('fail', 'pass')).toMatchObject({
      state: 'passed',
      answer: 'Passes with this change.',
    })
    expect(answer('pass', 'pass').answer).toBe('Passes with and without this change.')
    expect(answer('pass', 'fail')).toMatchObject({
      state: 'failed',
      answer: 'Fails with this change.',
    })
    expect(answer('fail', 'fail').answer).toBe('Still fails with this change.')
    expect(answer('pass', 'no_answer').answer).toBe('No answer with this change.')
    // Not answered with the change: the glyph falls back to delivery.
    expect(answer('pass', null)).toMatchObject({
      state: 'passed',
      answer: 'Not answered with this change.',
    })
  })

  it('says no answer tests run on a proposal, at any risk (FR-513)', () => {
    expect(readAttachedTest(results({}), inReview).answer).toBe(
      "No answer tests run on a proposal. It's answered once the change is accepted.",
    )
  })

  it('says a set-aside question is no longer checked', () => {
    expect(readAttachedTest(test({ active: false }), inReview)).toEqual({
      question: 'net-revenue-spain',
      state: 'not_run',
      delivery: "Set aside, so it's no longer checked.",
      answer: '',
    })
  })
})

describe('withResults', () => {
  it("keeps the service's order and adds each test's results from the gate", () => {
    const first = test({ question: 'a' })
    const second = test({ question: 'b' })
    const merged = withResults(
      [first, second],
      [results({ question: 'b', retrieval: { baseline: false, candidate: true } })],
    )
    expect(merged.map((entry) => entry.question)).toEqual(['a', 'b'])
    expect(merged[0]).toEqual(first)
    expect(merged[1]?.retrieval).toEqual({ baseline: false, candidate: true })
  })
})

describe('canAttachTests', () => {
  const contributor: Permissions = { roles: [], assignments: [] }
  const owner: Permissions = {
    roles: [],
    assignments: [{ areaId: 'area_commercial', role: 'owner' }],
  }
  const approver: Permissions = {
    roles: [],
    assignments: [{ areaId: 'area_commercial', role: 'approver' }],
  }
  const admin: Permissions = { roles: ['administrator'], assignments: [] }
  const proposal = (state: 'draft' | 'in_review' | 'accepted', proposerId = 'per_maria') => ({
    areaId: 'area_commercial',
    proposerId,
    state,
  })

  it("lets the draft's author attach while it is a draft, and no longer once it is sent", () => {
    expect(canAttachTests(contributor, 'per_maria', proposal('draft'))).toBe(true)
    expect(canAttachTests(contributor, 'per_maria', proposal('in_review'))).toBe(false)
    expect(canAttachTests(contributor, 'per_ali', proposal('draft'))).toBe(false)
  })

  it("lets the area's owners and administrators attach until a decision", () => {
    expect(canAttachTests(owner, 'per_jon', proposal('in_review'))).toBe(true)
    expect(canAttachTests(admin, 'per_ravi', proposal('draft'))).toBe(true)
    expect(canAttachTests(owner, 'per_jon', proposal('accepted'))).toBe(false)
    expect(
      canAttachTests(owner, 'per_jon', { ...proposal('in_review'), areaId: 'area_sales' }),
    ).toBe(false)
  })

  it('does not let a high-risk approver attach', () => {
    expect(canAttachTests(approver, 'per_lars', proposal('in_review'))).toBe(false)
  })
})
