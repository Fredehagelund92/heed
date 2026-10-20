import { describe, expect, it } from 'vitest'
import {
  answerText,
  compareRuns,
  heldConstant,
  rankFixNext,
  rate,
  signTest,
  tryEvidence,
  type FixCandidate,
  type RunQuestion,
  type RunSetup,
} from '../../../src/domain/quality.ts'

describe('the sign test', () => {
  it('is the exact two-sided binomial test on the questions that changed', () => {
    // 5 of 5 one way: 2 x (1/2)^5.
    expect(signTest(5, 0)).toBeCloseTo(0.0625, 10)
    expect(signTest(0, 5)).toBeCloseTo(0.0625, 10)
    // The Quality design's example: 14 better and 8 worse is no clear change.
    expect(signTest(14, 8)).toBeCloseTo(0.2863, 4)
    expect(signTest(3, 3)).toBe(1)
    expect(signTest(1, 0)).toBe(1)
  })
  it('says nothing when no question changed', () => {
    expect(signTest(0, 0)).toBeNull()
  })
  it('holds for large test sets without overflow', () => {
    const p = signTest(600, 400)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1e-9)
    expect(signTest(500, 500)).toBeCloseTo(1, 6)
  })
})

describe('comparing two runs', () => {
  const q = (id: string, verdict: RunQuestion['verdict'], failedChecks: string[] = []) => ({
    id,
    verdict,
    failedChecks,
  })
  it('lists questions that crossed pass, with the checks they failed', () => {
    const older = [
      q('a', 'pass'),
      q('b', 'fail', ['caveat']),
      q('c', 'pass'),
      q('d', 'fail'),
      q('e', 'no_answer'),
      q('gone', 'pass'),
      q('unknown', null),
    ]
    const newer = [
      q('a', 'pass'),
      q('b', 'pass'),
      q('c', 'fail', ['delivered']),
      q('d', 'no_answer'),
      q('e', 'pass'),
      q('new', 'fail'),
      q('unknown', 'pass'),
    ]
    expect(compareRuns(older, newer)).toEqual({
      questions: 5,
      better: [
        { id: 'b', from: 'fail', to: 'pass', failedChecks: ['caveat'] },
        { id: 'e', from: 'no_answer', to: 'pass', failedChecks: [] },
      ],
      worse: [{ id: 'c', from: 'pass', to: 'fail', failedChecks: ['delivered'] }],
      unchanged: { pass: 1, fail: 0, noAnswer: 1 },
      added: 2,
      removed: 1,
      signTest: { better: 2, worse: 1, pValue: 1 },
    })
  })
  it('gives shares only when there is something to divide by', () => {
    expect(rate(3, 4)).toBe(0.75)
    expect(rate(0, 0)).toBeNull()
  })
})

describe('the Fix next ranking', () => {
  const question = (extra: Partial<Extract<FixCandidate, { type: 'question' }>>): FixCandidate => ({
    type: 'question',
    area: 'finance',
    id: 'q',
    risk: 'normal',
    answer: 'pass',
    regression: false,
    retrieval: true,
    failedChecks: [],
    since: '2026-10-05T04:30:00Z',
    ...extra,
  })
  const item = (extra: Partial<Extract<FixCandidate, { type: 'item' }>>): FixCandidate => ({
    type: 'item',
    area: 'finance',
    id: 'itm_x0000001',
    title: 'Norway closure',
    kind: 'note',
    risk: 'normal',
    daysPastReview: null,
    reviewDate: '2026-12-01',
    untested: false,
    ...extra,
  })
  const gap: FixCandidate = {
    type: 'gap',
    area: 'finance',
    id: '00000000-0000-4000-8000-000000000001',
    ref: 'gap-abc',
    gapType: 'missing',
    status: 'open',
    severity: 3,
    reports: 7,
    lastSeen: '2026-10-07',
  }

  it('puts a regression first, then proven failures, gaps, stale and untested items', () => {
    const ranked = rankFixNext(
      [
        item({ id: 'itm_untested1', untested: true, kind: 'event' }),
        item({ id: 'itm_stale0001', daysPastReview: 12, reviewDate: '2026-09-27' }),
        gap,
        question({ id: 'fails-retrieval', retrieval: false }),
        question({ id: 'regressed', answer: 'fail', regression: true, failedChecks: ['caveat'] }),
        question({ id: 'passes' }),
        item({ id: 'itm_fine00001' }),
      ],
      10,
    )
    expect(ranked.map((e) => [e.kind, e.subject.id, e.score])).toEqual([
      ['regression', 'regressed', 65],
      ['gap', gap.id, 56],
      ['failing_question', 'fails-retrieval', 45],
      ['past_review', 'itm_stale0001', 39],
      ['untested', 'itm_untested1', 30],
    ])
    expect(ranked[0]).toMatchObject({
      subject: { type: 'question', label: null },
      checks: ['caveat'],
      reasons: ['Passed in the baseline run and fails in the newest weekly run'],
    })
    expect(ranked[1]!.reasons).toEqual([
      'Open gap, severity 3',
      '7 reports from agents and feedback',
    ])
    expect(ranked[3]!.reasons).toEqual(['The review date passed 12 days ago'])
    expect(ranked[4]!.reasons).toEqual(['No test question covers this event, which needs one'])
  })

  it('merges the reasons of one subject and keeps the stronger as its kind', () => {
    const [entry] = rankFixNext(
      [item({ untested: true, daysPastReview: 90, reviewDate: '2026-07-11', risk: 'high' })],
      5,
    )
    expect(entry).toMatchObject({
      kind: 'past_review',
      score: 15 + 30 + 20 + 10,
      since: '2026-07-11',
      reasons: ['The review date passed 90 days ago', 'No test question covers this note'],
    })
    const [both] = rankFixNext([question({ answer: 'fail', retrieval: false, risk: 'high' })], 5)
    expect(both).toMatchObject({ kind: 'failing_question', score: 15 + 40 + 40 })
    expect(both!.reasons).toHaveLength(2)
  })

  it('ranks a gap already being worked on lower, and stops at the limit in a stable order', () => {
    const underway = { ...gap, status: 'proposal_made' as const, reports: 0 }
    expect(rankFixNext([underway], 1)[0]).toMatchObject({ score: 5 + 24 })
    const same = ['b', 'a', 'c'].map((id) => question({ id, retrieval: false }))
    expect(rankFixNext(same, 2).map((e) => e.subject.id)).toEqual(['a', 'b'])
  })
})

describe('one question across two runs', () => {
  const setup = (extra: Partial<RunSetup> = {}): RunSetup => ({
    edition: '2026-10-07.2',
    revision: 3,
    wordings: 'w1',
    tries: 3,
    answer_model: 'answer-a',
    judge_model: 'judge-a',
    tool_descriptions: 'tools-a',
    prompt: 'prompt-a',
    ...extra,
  })
  it('says only the edition differs when everything else was held', () => {
    expect(heldConstant(setup(), setup({ edition: '2026-10-10.1' }))).toEqual({
      held: [
        'revision',
        'wordings',
        'tries',
        'answer_model',
        'judge_model',
        'tool_descriptions',
        'prompt',
      ],
      changed: ['edition'],
      unknown: [],
    })
  })
  it('names what else changed, such as the judge or the question', () => {
    const result = heldConstant(
      setup(),
      setup({ edition: '2026-10-10.1', judge_model: 'judge-b', revision: 4 }),
    )
    expect(result.changed).toEqual(['edition', 'revision', 'judge_model'])
    // A new revision that kept its wordings still asks the same way.
    expect(result.held).toContain('wordings')
  })
  it('never counts a factor a run did not record as held', () => {
    const result = heldConstant(setup({ prompt: null }), setup({ revision: null, wordings: null }))
    expect(result.unknown).toEqual(['revision', 'wordings', 'prompt'])
    expect(result.held).toEqual([
      'edition',
      'tries',
      'answer_model',
      'judge_model',
      'tool_descriptions',
    ])
    expect(result.changed).toEqual([])
  })
})

describe("a try's evidence", () => {
  const final = {
    role: 'assistant',
    content: [{ type: 'text', text: ' Orders fell [itm_abc12345]. ' }],
  }
  it('reads the final answer from the last message the agent wrote', () => {
    expect(answerText([{ role: 'user', content: 'Why?' }, final])).toBe(
      'Orders fell [itm_abc12345].',
    )
    expect(answerText([{ role: 'assistant', content: 'Plain text.' }])).toBe('Plain text.')
    // Text parts join; tool calls in the same message are not answer text.
    expect(
      answerText([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First.' },
            { type: 'tool-call', toolName: 'get_context', input: {} },
            { type: 'text', text: 'Second.' },
          ],
        },
      ]),
    ).toBe('First.\nSecond.')
  })
  it('has no final answer when the transcript ends on a tool, is empty, or is not a transcript', () => {
    expect(answerText([final, { role: 'tool', content: [{ type: 'tool-result' }] }])).toBeNull()
    expect(answerText([{ role: 'assistant', content: [{ type: 'text', text: '  ' }] }])).toBeNull()
    expect(answerText([])).toBeNull()
    expect(answerText(['not a message', null])).toBeNull()
  })
  it('reads what the worker stores for a try', () => {
    const scores = {
      passed: false,
      caveat: false,
      checks: { delivered: true, caveat: false, odd: 'yes' },
      verdict: { caveat_present: false, reason: 'The answer leaves out the caveat.' },
      delivered: ['itm_abc12345', 7],
      reached: [],
      statuses: ['matched'],
      calls: 2,
    }
    expect(tryEvidence(scores, [final])).toEqual({
      checks: { delivered: true, caveat: false },
      delivered: ['itm_abc12345'],
      reached: [],
      statuses: ['matched'],
      judgeReason: 'The answer leaves out the caveat.',
      answer: 'Orders fell [itm_abc12345].',
    })
  })
  it('reads a refused or failed try as empty, never as a pass', () => {
    expect(tryEvidence({ passed: null, caveat: null, checks: {} }, [])).toEqual({
      checks: {},
      delivered: [],
      reached: [],
      statuses: [],
      judgeReason: null,
      answer: null,
    })
    expect(tryEvidence(null, [])).toMatchObject({ checks: {}, judgeReason: null })
  })
})
