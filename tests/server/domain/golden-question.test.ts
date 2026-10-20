import { describe, expect, it } from 'vitest'
import {
  agreementOf,
  flipOf,
  goldenQuestionSchema,
  judgingWords,
  layerAgreement,
  layerOf,
  questionLayers,
  questionVerdict,
  retrievalChecks,
  scoreTry,
  tryAgreement,
  wordingVerdict,
  type CellScore,
  type Expected,
  type Observation,
} from '../../../src/domain/golden-question.ts'

const base = {
  id: 'norway-orders',
  area: 'finance',
  wordings: [
    { text: 'Why did orders drop in Norway?', kind: 'natural' },
    { text: 'Orders in Norway, August 2026', kind: 'precise' },
  ],
  scope: { metrics: ['metric:orders'] },
  expected: { must_deliver: ['itm_closure0001'], caveat: 'Online sales stopped on 4 August' },
  source: 'tests',
}

describe('the golden question format (FR-501, FR-504)', () => {
  it('fills the defaults and keeps the file format small', () => {
    expect(goldenQuestionSchema.parse(base)).toMatchObject({
      rubrics: [],
      risk: 'normal',
      status: 'active',
      split: 'development',
      expected: { must_not_deliver: [], no_cause_claim: true, clarifying_question: false },
    })
  })
  it('needs a natural and a precise wording', () => {
    const result = goldenQuestionSchema.safeParse({
      ...base,
      wordings: base.wordings.map((w) => ({ ...w, kind: 'natural' })),
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/natural and one precise/)
  })
  it('refuses an item that is both expected and forbidden, and a backwards window', () => {
    expect(
      goldenQuestionSchema.safeParse({
        ...base,
        expected: { must_deliver: ['itm_closure0001'], must_not_deliver: ['itm_closure0001'] },
      }).success,
    ).toBe(false)
    expect(
      goldenQuestionSchema.safeParse({
        ...base,
        scope: { window: { from: '2026-08-31', to: '2026-08-01' } },
      }).success,
    ).toBe(false)
  })
})

const expected: Expected = goldenQuestionSchema.parse(base).expected
const good: Observation = {
  refused: false,
  answer: '[itm_closure0001] Online sales stopped on 4 August.',
  delivered: ['itm_closure0001'],
  applied: ['itm_closure0001'],
  reached: [],
  statuses: ['matched'],
  verdict: {
    caveat_present: true,
    cause_claimed: false,
    asks_clarifying_question: false,
    rubrics: [],
    reason: '',
  },
}
/** The same answer with its one rubric graded by its id. */
const graded = (passed = true): Observation => ({
  ...good,
  verdict: { ...good.verdict!, rubrics: [{ id: 'rubric_1', passed }] },
})

describe('scoring a try (FR-508)', () => {
  it('passes when the item is delivered and cited, the caveat is there and no cause is claimed', () => {
    expect(scoreTry(expected, ['Names Norway'], graded())).toEqual({
      passed: true,
      caveat: true,
      checks: {
        delivered: true,
        not_delivered: true,
        cited: true,
        caveat: true,
        no_cause_claim: true,
        rubric_1: true,
      },
    })
  })
  it('fails a claimed cause, a missing citation and an unmet rubric', () => {
    const verdict = { ...good.verdict!, cause_claimed: true }
    expect(scoreTry(expected, [], { ...good, verdict })).toMatchObject({
      passed: false,
      checks: { no_cause_claim: false },
    })
    expect(scoreTry(expected, [], { ...good, answer: 'Online sales stopped.' })).toMatchObject({
      passed: false,
      checks: { cited: false },
    })
    const two = {
      ...good,
      verdict: {
        ...good.verdict!,
        rubrics: [
          { id: 'rubric_1', passed: true },
          { id: 'rubric_2', passed: false },
        ],
      },
    }
    expect(scoreTry(expected, ['A', 'B'], two)).toMatchObject({
      passed: false,
      checks: { rubric_1: true, rubric_2: false },
    })
  })
  it('checks the delivery status and the clarifying question when the question asks for them', () => {
    const vague: Expected = {
      ...expected,
      must_deliver: [],
      status: 'need_more_detail',
      clarifying_question: true,
    }
    const asked = {
      ...good,
      statuses: ['need_more_detail'],
      verdict: { ...good.verdict!, asks_clarifying_question: true },
    }
    expect(scoreTry(vague, [], asked).passed).toBe(true)
    expect(scoreTry(vague, [], { ...asked, statuses: ['matched'] }).checks.status).toBe(false)
  })
  it('needs a link-follow answer to reach and cite the linked item, and never a stale one (FR-523)', () => {
    const linked: Expected = {
      ...expected,
      reachable_via_link: ['itm_refunds001'],
      forbidden_links: ['itm_oldrule001'],
    }
    const followed = {
      ...good,
      answer: `${good.answer} [itm_refunds001] Counted net of refunds.`,
      reached: ['itm_refunds001'],
    }
    expect(scoreTry(linked, [], followed)).toMatchObject({
      passed: true,
      checks: { linked: true, cited: true, no_forbidden_link: true },
    })
    expect(scoreTry(linked, [], good)).toMatchObject({
      passed: false,
      checks: { linked: false },
    })
    expect(
      scoreTry(linked, [], { ...followed, answer: `${followed.answer} [itm_oldrule001]` }).checks
        .no_forbidden_link,
    ).toBe(false)
    expect(
      scoreTry(linked, [], { ...followed, reached: [...followed.reached, 'itm_oldrule001'] }).checks
        .no_forbidden_link,
    ).toBe(false)
    // Reached but not cited: relied on without a source.
    expect(scoreTry(linked, [], { ...followed, answer: good.answer }).checks.cited).toBe(false)
    // A question without link expectations scores exactly as before.
    expect(Object.keys(scoreTry(expected, [], good).checks)).not.toContain('linked')
  })
  it('refuses a link target that is both reachable and forbidden', () => {
    expect(
      goldenQuestionSchema.safeParse({
        ...base,
        expected: { reachable_via_link: ['itm_refunds001'], forbidden_links: ['itm_refunds001'] },
      }).success,
    ).toBe(false)
  })
  // Round 6: the judge numbered rubrics from 1 (`1, 2`) or as fractions (`1.23, 2.34`) in most
  // tries while passing every one, and a lookup by position failed them all: the runner printed
  // 2 of 15 where the answers passed 12. A verdict that does not grade each rubric once, by its
  // id, is the judge's failure: no pass and no fail.
  it('reads rubrics by id, and scores a verdict that does not grade each rubric once as a judge error', () => {
    const rubrics = ['Names Norway', 'Says the date']
    const verdictWith = (given: unknown[]): Observation => ({
      ...good,
      verdict: { ...good.verdict!, rubrics: given as { id: string; passed: boolean }[] },
    })
    const reversed = verdictWith([
      { id: 'rubric_2', passed: true },
      { id: 'rubric_1', passed: false },
    ])
    expect(scoreTry(expected, rubrics, reversed).checks).toMatchObject({
      rubric_1: false,
      rubric_2: true,
    })
    const cases: [unknown[], RegExp][] = [
      [
        [
          { index: 1, passed: true },
          { index: 2, passed: true },
        ],
        /left out rubric_1, rubric_2/,
      ],
      [
        [
          { index: 1.23, passed: true },
          { index: 2.34, passed: true },
        ],
        /left out rubric_1, rubric_2/,
      ],
      [[{ id: 'rubric_1', passed: true }], /^The judge left out rubric_2$/],
      [
        [
          { id: 'rubric_1', passed: true },
          { id: 'rubric_1', passed: true },
          { id: 'rubric_2', passed: true },
        ],
        /graded rubric_1 twice/,
      ],
      [
        [
          { id: 'rubric_1', passed: true },
          { id: 'rubric_2', passed: true },
          { id: 'rubric_3', passed: true },
        ],
        /^The judge graded rubrics the question does not have \(\[\{"id":"rubric_3","passed":true\}\]\)$/,
      ],
    ]
    for (const [given, problem] of cases) {
      const score = scoreTry(expected, rubrics, verdictWith(given))
      expect(score).toMatchObject({ passed: null, caveat: null, checks: {} })
      expect(score.judgeError).toMatch(problem)
    }
    // A judge error from the judge call itself is kept as given.
    expect(
      scoreTry(expected, rubrics, {
        ...good,
        verdict: null,
        judgeError: 'The judge gave no readable verdict',
      }),
    ).toEqual({
      passed: null,
      caveat: null,
      checks: {},
      judgeError: 'The judge gave no readable verdict',
    })
  })
  it('counts a judge error as no answer in a wording, never as a pass or a fail', () => {
    const erred: CellScore = { passed: null, caveat: null, checks: {}, judgeError: 'x' }
    const ok: CellScore = { passed: true, caveat: null, checks: {} }
    expect(wordingVerdict([ok, ok, erred])).toBe('pass')
    expect(wordingVerdict([erred, erred])).toBe('no_answer')
    expect(wordingVerdict([ok, ok, erred], 'all')).toBe('no_answer')
  })
  it('says the judge-error rate of a run', () => {
    expect(judgingWords({ judged: 90, errors: 0 }, 'answers')).toBe(
      'Judge errors: 0 of 90 judged answers (0.0%).',
    )
    expect(judgingWords({ judged: 90, errors: 3 }, 'answers')).toBe(
      'Judge errors: 3 of 90 judged answers (3.3%): each is neither a pass nor a fail.',
    )
    expect(judgingWords({ judged: 0, errors: 0 }, 'turns')).toBe(
      'Judge errors: 0 of 0 judged turns.',
    )
  })
  it('scores a refusal as no answer, never a pass or a fail', () => {
    expect(scoreTry(expected, [], { ...good, refused: true })).toEqual({
      passed: null,
      caveat: null,
      checks: {},
    })
  })
})

const pass: CellScore = { passed: true, caveat: true, checks: {} }
const fail: CellScore = { passed: false, caveat: true, checks: {} }
const noCaveat: CellScore = { passed: false, caveat: false, checks: {} }
const silent: CellScore = { passed: null, caveat: null, checks: {} }

describe('verdicts over tries (FR-515)', () => {
  it('takes the majority of answered tries', () => {
    expect(wordingVerdict([pass, pass, fail])).toBe('pass')
    expect(wordingVerdict([pass, fail, fail])).toBe('fail')
    expect(wordingVerdict([pass, fail])).toBe('fail')
    expect(wordingVerdict([pass, silent, silent])).toBe('pass')
  })
  it('needs the must-have caveat in every answered try', () => {
    expect(wordingVerdict([pass, pass, pass, pass, pass, pass, noCaveat])).toBe('fail')
  })
  it('gives no verdict without an answered try', () => {
    expect(wordingVerdict([silent, silent, silent])).toBe('no_answer')
    expect(wordingVerdict([])).toBe('no_answer')
  })
  it('counts a wording only when every try passes, in the reliability mode (pass^k)', () => {
    expect(wordingVerdict([pass, pass, fail], 'all')).toBe('fail')
    expect(wordingVerdict([pass, pass, pass], 'all')).toBe('pass')
    // A try without an answer leaves it open, unless another try already failed it.
    expect(wordingVerdict([pass, pass, silent], 'all')).toBe('no_answer')
    expect(wordingVerdict([fail, silent, silent], 'all')).toBe('fail')
    expect(wordingVerdict([silent], 'all')).toBe('no_answer')
  })
  it('passes a question only when every wording passes', () => {
    expect(questionVerdict(['pass', 'pass'])).toBe('pass')
    expect(questionVerdict(['pass', 'no_answer'])).toBe('no_answer')
    expect(questionVerdict(['no_answer', 'fail'])).toBe('fail')
  })
  it('names flips in both directions and nothing else', () => {
    expect(flipOf('pass', 'fail')).toBe('pass_to_fail')
    expect(flipOf('fail', 'pass')).toBe('fail_to_pass')
    expect(flipOf('pass', 'pass')).toBeNull()
    expect(flipOf('pass', 'no_answer')).toBeNull()
  })
})

describe('keeping the code and judge layers apart', () => {
  const tried = (checks: Record<string, boolean>, caveat: boolean | null = null): CellScore => ({
    passed: Object.values(checks).every(Boolean),
    caveat,
    checks,
  })
  const good = { delivered: true, cited: true, no_cause_claim: true, rubric_1: true }

  it('gives tool-result checks to code and answer-reading checks to the judge', () => {
    expect(
      ['delivered', 'not_delivered', 'cited', 'linked', 'no_forbidden_link', 'status'].map(layerOf),
    ).toEqual(Array(6).fill('code'))
    expect(['caveat', 'no_cause_claim', 'clarifying_question', 'rubric_3'].map(layerOf)).toEqual(
      Array(4).fill('judge'),
    )
  })
  it('traces a drop in retrieval to code while the judge still passes', () => {
    const missed = tried({ ...good, delivered: false })
    expect(questionLayers([[missed, missed, tried(good)], [tried(good)]])).toEqual({
      code: 'fail',
      judge: 'pass',
      failedChecks: ['delivered'],
    })
  })
  it('traces a claimed cause to the judge, by majority, while code passes', () => {
    const cause = tried({ ...good, no_cause_claim: false })
    expect(questionLayers([[cause, cause, tried(good)]])).toEqual({
      code: 'pass',
      judge: 'fail',
      failedChecks: ['no_cause_claim'],
    })
    // One claim in three tries is not the majority: neither layer fails.
    expect(questionLayers([[cause, tried(good), tried(good)]])).toMatchObject({
      judge: 'pass',
      failedChecks: [],
    })
  })
  it('keeps the strict caveat in the judge layer: one missing caveat fails it', () => {
    const withCaveat = tried({ ...good, caveat: true }, true)
    const without = tried({ ...good, caveat: false }, false)
    expect(questionLayers([[withCaveat, withCaveat, without]])).toEqual({
      code: 'pass',
      judge: 'fail',
      failedChecks: ['caveat'],
    })
  })
  it('gives a layer with nothing to check no verdict, and no answer no verdict either', () => {
    expect(questionLayers([[tried({ delivered: true })]])).toEqual({
      code: 'pass',
      judge: null,
      failedChecks: [],
    })
    expect(questionLayers([[silent, silent]])).toEqual({
      code: 'no_answer',
      judge: 'no_answer',
      failedChecks: [],
    })
  })
})

describe('judge against code (try-it-2, round 3)', () => {
  const tried = (checks: Record<string, boolean>): CellScore => ({
    passed: Object.values(checks).every(Boolean),
    caveat: null,
    checks,
  })
  it('names where the judge passed what code failed, and the other way round', () => {
    expect(layerAgreement({ code: 'fail', judge: 'pass' })).toBe('judge_passed_code_failed')
    expect(layerAgreement({ code: 'pass', judge: 'fail' })).toBe('code_passed_judge_failed')
    expect(layerAgreement({ code: 'pass', judge: 'pass' })).toBe('agree')
    expect(layerAgreement({ code: 'pass', judge: null })).toBeNull()
    expect(layerAgreement({ code: 'no_answer', judge: 'pass' })).toBeNull()
  })
  it('counts questions by id and tries by number', () => {
    const lenient = tried({ delivered: false, rubric_1: true })
    const strict = tried({ delivered: true, no_cause_claim: false })
    expect(tryAgreement(lenient)).toBe('judge_passed_code_failed')
    expect(tryAgreement(silent)).toBeNull()
    expect(
      agreementOf(
        [
          { id: 'a', layers: { code: 'fail', judge: 'pass' } },
          { id: 'b', layers: { code: 'pass', judge: 'pass' } },
          { id: 'c', layers: { code: 'pass', judge: 'fail' } },
          { id: 'd', layers: { code: 'pass', judge: null } },
        ],
        [lenient, lenient, strict, silent],
      ),
    ).toEqual({
      questions: 3,
      judgePassedCodeFailed: ['a'],
      codePassedJudgeFailed: ['c'],
      tries: { compared: 3, judgePassedCodeFailed: 2, codePassedJudgeFailed: 1 },
    })
  })
  it('fails a layer on any failed try in the reliability mode', () => {
    const missed = tried({ delivered: false, rubric_1: true })
    const good = tried({ delivered: true, rubric_1: true })
    expect(questionLayers([[good, good, missed]], 'all')).toEqual({
      code: 'fail',
      judge: 'pass',
      failedChecks: ['delivered'],
    })
  })
})

describe('the retrieval checks (FR-504, FR-507)', () => {
  const expected = { must_deliver: ['itm_closure0001'], must_not_deliver: ['itm_wrong00001'] }
  it('passes when the expected items appear and the forbidden ones do not', () => {
    expect(
      retrievalChecks(expected, { status: 'matched', delivered: ['itm_closure0001'] }),
    ).toEqual({ served: true, delivered: true, not_delivered: true })
  })
  it('names each failure apart, and checks the status only when one is expected', () => {
    expect(
      retrievalChecks(
        { ...expected, status: 'need_more_detail' },
        { status: 'matched', delivered: ['itm_wrong00001'] },
      ),
    ).toEqual({ served: true, delivered: false, not_delivered: false, status: false })
    expect(retrievalChecks(expected, { status: 'check_failed', delivered: [] })).toMatchObject({
      served: false,
    })
  })
})
