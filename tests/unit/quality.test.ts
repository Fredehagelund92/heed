import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type { Area } from '@domain/item'
import type { Comparison, Gap, HistoryPoint, RetrievalPoint, TestQuestion, Untested } from '@/api'
import {
  changeOf,
  checkName,
  domainHealth,
  fixEntryView,
  formatRate,
  openGapsByArea,
  pastReviewByArea,
  qualityAreas,
  retrievalOf,
  transcriptChecks,
  transcriptTurns,
  verdictOf,
  visibleQuestions,
  type DomainHealth,
} from '@/lib/quality'
import {
  newQuestionValues,
  questionFormSchema,
  questionIdFrom,
  questionValues,
  toSaveQuestionInput,
} from '@/lib/question-form'
import { validateQualitySearch } from '@/lib/search-params'
import { mockTestQuestions } from '@/mocks/test-questions'

const area = (id: string, name: string): Area => ({
  id,
  name,
  summary: '',
  description: '',
  ownerIds: [],
  label: 'teal',
  revision: 1,
  demo: false,
})
const commercial = area('area_sales', 'Sales')
const question = mockTestQuestions[0]!

const point = (
  run: string,
  finishedAt: string,
  passed: number,
  questions = 10,
  extra: Partial<HistoryPoint> = {},
): HistoryPoint => ({
  run,
  area: commercial.id,
  edition: '2026-10-05.1',
  finishedAt,
  questions,
  passed,
  failed: questions - passed,
  noAnswer: 0,
  setAside: 0,
  regressions: 0,
  rates: { pass: passed / questions, caveats: null, causeClaims: null, acceptable: null },
  heldOut: {
    questions: 0,
    answers: 0,
    caveats: { required: 0, present: 0 },
    causeClaims: 0,
    acceptable: 0,
    meetsTargets: false,
  },
  layers: null,
  failedChecks: null,
  retrieval: null,
  costMicros: 1,
  estimatedCostMicros: 1,
  modelId: 'm',
  judgeModelId: 'j',
  ...extra,
})

const pass = (edition: string, passed: number, questions = 10): RetrievalPoint => ({
  id: edition,
  edition,
  asOf: edition.slice(0, 10),
  trigger: 'edition',
  createdAt: `${edition.slice(0, 10)}T08:00:00Z`,
  testSetDigest: 'd',
  questions,
  passed,
  failed: questions - passed,
  setAside: 0,
  failedChecks: { served: 0, delivered: 0, not_delivered: 0, status: 0 },
})

const comparison = (better: number, worse: number, pValue: number | null): Comparison => ({
  area: commercial.id,
  run: { id: 'r2', kind: 'scheduled', edition: 'e', finishedAt: '2026-10-05T04:30:00Z' },
  against: { id: 'r1', kind: 'scheduled', edition: 'e', finishedAt: '2026-09-28T04:30:00Z' },
  questions: 10,
  better: [],
  worse: [],
  unchanged: { pass: 0, fail: 0, noAnswer: 0 },
  added: 0,
  removed: 0,
  signTest: { better, worse, pValue },
})

describe('shares and changes', () => {
  it('prints a share with at most one decimal, and nothing when there is none', () => {
    expect(formatRate(0.946)).toBe('94.6%')
    expect(formatRate(1)).toBe('100%')
    expect(formatRate(null)).toBeNull()
  })

  it('gives a change in points with its direction and words', () => {
    expect(changeOf(0.851, 0.797)).toMatchObject({
      points: 5.4,
      direction: 'up',
      text: '+5.4 pts',
      spoken: 'up 5.4 points',
    })
    expect(changeOf(0.6, 0.8)).toMatchObject({ direction: 'down', text: '-20 pts' })
    expect(changeOf(0.5, 0.5)).toMatchObject({ direction: 'flat', text: 'No change' })
    expect(changeOf(0.5, null)).toBeNull()
  })

  it('names a check in words, a rubric by its number from one', () => {
    expect(checkName('no_cause_claim')).toBe('no cause claimed')
    expect(checkName('rubric_1')).toBe('right-answer point 2')
    expect(checkName('something_new')).toBe('something new')
  })
})

describe('the domain health grid', () => {
  it('compares the newest retrieval pass with the newest of an earlier edition', () => {
    const shown = retrievalOf([
      pass('2026-10-07.2', 9),
      pass('2026-10-07.2', 9),
      pass('2026-10-06.1', 8),
    ])
    expect(shown).toMatchObject({ rate: 0.9, edition: '2026-10-07.2' })
    expect(shown?.change?.text).toBe('+10 pts')
    expect(retrievalOf([pass('2026-10-07.2', 0, 0)])).toBeNull()
  })

  it('counts open gaps per domain and the newest week of items past review', () => {
    const gap = (id: string, areaIds: string[], status: Gap['status']) =>
      ({ id, status, topic: { areaId: areaIds.length === 1 ? areaIds[0] : null, areaIds } }) as Gap
    expect(
      openGapsByArea([
        gap('1', ['a'], 'open'),
        gap('2', ['a'], 'proposal_made'),
        gap('3', ['a'], 'resolved'),
        gap('4', [], 'open'),
        // A topic that spans domains counts in each.
        gap('5', ['a', 'b'], 'open'),
      ]),
    ).toEqual(
      new Map([
        ['a', 3],
        ['b', 1],
      ]),
    )
    expect(
      pastReviewByArea({
        today: '2026-10-07',
        rows: [
          { area: 'a', week: '2026-09-28', itemsPastReview: 4, proposalsAccepted: 0 },
          { area: 'a', week: '2026-10-05', itemsPastReview: 6, proposalsAccepted: 1 },
        ],
      }),
    ).toEqual(new Map([['a', 6]]))
  })

  const untested: Untested = {
    edition: 'e',
    areas: [
      {
        area: commercial.id,
        items: 40,
        untested: 11,
        untestedRequired: 3,
        byKind: { event: 2, note: 5, guide: 3, example: 1, issue: 0 },
      },
    ],
  }
  const row = (history: HistoryPoint[], extra: Partial<Parameters<typeof domainHealth>[0]> = {}) =>
    domainHealth({
      area: commercial,
      questions: [question],
      history,
      retrieval: [pass('2026-10-07.2', 9), pass('2026-10-06.1', 9)],
      comparison: undefined,
      untested,
      openGaps: 2,
      pastReview: 5,
      ...extra,
    })

  it('says a domain has not started when it has no question and no run', () => {
    expect(row([], { questions: [] }).state).toEqual({ kind: 'not_started' })
    expect(row([]).state).toEqual({ kind: 'no_run' })
  })

  it('counts failing questions, and asks for a look on a drop of five points', () => {
    const failing = row([point('r2', '2026-10-05T04:30:00Z', 8)])
    expect(failing.state).toEqual({ kind: 'failing', count: 2 })
    expect(failing).toMatchObject({ openGaps: 2, pastReview: 5, untested: 11, untestedRequired: 3 })

    const all = (passed: number) => ({ ...point('x', 'x', passed), failed: 0 })
    const dropped = row([
      {
        ...all(9),
        run: 'r2',
        finishedAt: '2026-10-05T04:30:00Z',
        rates: { ...all(9).rates, pass: 0.9 },
      },
      {
        ...all(10),
        run: 'r1',
        finishedAt: '2026-09-28T04:30:00Z',
        rates: { ...all(10).rates, pass: 1 },
      },
    ])
    expect(dropped.state).toEqual({
      kind: 'attention',
      reason: 'Answers got worse since the last run',
    })
    expect(dropped.answers?.change?.text).toBe('-10 pts')
  })

  it('is steady when every question passes and nothing dropped', () => {
    const steady = row(
      [point('r2', '2026-10-05T04:30:00Z', 10), point('r1', '2026-09-28T04:30:00Z', 10)],
      { comparison: comparison(0, 0, null) },
    )
    expect(steady.state).toEqual({ kind: 'steady' })
    expect(steady.flips).toEqual({ better: 0, worse: 0, pValue: null })
  })

  it('shows an owner their own domains, an administrator every one', () => {
    const areas = [area('b', 'Beta'), area('a', 'Alpha'), area('c', 'Gamma')]
    expect(qualityAreas(areas, { admin: true, maintained: [] }).map((a) => a.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(qualityAreas(areas, { admin: false, maintained: ['c'] }).map((a) => a.id)).toEqual(['c'])
  })
})

describe('the verdict line', () => {
  const health = (flips: DomainHealth['flips'], answers = true) =>
    ({
      questions: 3,
      answers: answers ? { finishedAt: '2026-10-05' } : null,
      flips,
    }) as DomainHealth

  it('waits for the first run, and for a second one to compare with', () => {
    expect(verdictOf([health(null, false)]).tone).toBe('none')
    expect(verdictOf([health(null)]).text).toMatch(/^One weekly run so far/)
  })

  it('adds up the domains and says better only when the sign test says it is not noise', () => {
    const clear = verdictOf([
      health({ better: 7, worse: 0, pValue: null }),
      health({ better: 3, worse: 0, pValue: null }),
    ])
    expect(clear.tone).toBe('better')
    expect(clear.text).toBe('Better than last time: 10 questions got better and 0 got worse.')
    expect(clear.detail).toMatch(/p = 0\.00/)

    const unclear = verdictOf([health({ better: 14, worse: 8, pValue: 0.29 })])
    expect(unclear.tone).toBe('unclear')
    expect(unclear.text).toMatch(/^No clear change since last time/)

    expect(verdictOf([health({ better: 0, worse: 9, pValue: null })]).tone).toBe('worse')
    expect(verdictOf([health({ better: 0, worse: 0, pValue: null })]).tone).toBe('same')
  })
})

describe('Fix next', () => {
  it('names each entry in words, with the action that fixes it', () => {
    const questions = new Map([[question.id, question]])
    const failing = fixEntryView(
      {
        kind: 'regression',
        area: commercial.id,
        subject: { type: 'question', id: question.id, label: null },
        score: 80,
        reasons: ['Passed in the baseline run and fails in the newest weekly run'],
        checks: ['caveat', 'rubric_0'],
        since: '2026-10-05T04:30:00Z',
      },
      questions,
    )
    expect(failing).toMatchObject({
      badge: { label: 'Got worse', tone: 'danger' },
      title: question.wordings[0]!.text,
      reasons:
        'Passed in the baseline run and fails in the newest weekly run. Failed: fact mentioned, right-answer point 1.',
      action: { kind: 'question', id: question.id },
    })
    const untested = fixEntryView(
      {
        kind: 'untested',
        area: commercial.id,
        subject: { type: 'item', id: 'itm_abcdefgh', label: 'United Kingdom launch' },
        score: 25,
        reasons: ['No test question covers this event, which needs one'],
        checks: [],
        since: null,
      },
      questions,
    )
    expect(untested.action).toEqual({
      kind: 'write',
      itemId: 'itm_abcdefgh',
      area: commercial.id,
      label: 'Write a test',
    })
  })
})

describe('test questions and transcripts', () => {
  it('finds questions by their words and their name, active ones first', () => {
    const aside: TestQuestion = { ...question, id: 'zzz-aside', setAsideReason: 'old' }
    const found = visibleQuestions([aside, ...mockTestQuestions], { q: 'units sold' })
    expect(found.length).toBeGreaterThan(0)
    expect(
      found.every((q) => JSON.stringify(q.wordings).toLowerCase().includes('units sold')),
    ).toBe(true)
    expect(visibleQuestions([aside, question], {}).at(-1)?.id).toBe('zzz-aside')
  })

  it('reads a transcript as turns, whatever its parts', () => {
    expect(
      transcriptTurns([
        { role: 'user', content: 'Why?' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolName: 'get_facts', input: { question: 'Why?' } },
            { type: 'text', text: '  ' },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: 'get_facts',
              output: { type: 'json', value: { items: [] } },
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Because.' }] },
        'not a message',
      ]),
    ).toEqual([
      { kind: 'text', role: 'person', text: 'Why?' },
      { kind: 'call', tool: 'get_facts', input: '{\n  "question": "Why?"\n}' },
      { kind: 'result', tool: 'get_facts', output: '{\n  "items": []\n}' },
      { kind: 'text', role: 'agent', text: 'Because.' },
    ])
    expect(transcriptChecks({ checks: { cited: true, caveat: false, odd: 'x' } })).toEqual([
      { check: 'cited', held: true },
      { check: 'caveat', held: false },
    ])
  })

  it('keeps only valid Quality addresses', () => {
    expect(
      validateQualitySearch({
        view: 'questions',
        panel: 'question:units-sold-source-lag',
        tab: 'results',
        area: 'Not An Id',
      }),
    ).toMatchObject({ view: 'questions', panel: 'question:units-sold-source-lag', area: undefined })
    expect(validateQualitySearch({ panel: 'item:x' }).panel).toBeUndefined()
  })
})

describe('the question form', () => {
  const schema = questionFormSchema({ isNew: true, takenIds: new Set(['taken-name']) })

  it('makes a short name from the natural wording', () => {
    expect(questionIdFrom('Why did units sold in Norway drop in August?')).toBe(
      'why-did-units-sold-in-norway-drop-in-august',
    )
    expect(questionIdFrom('?!')).toBe('')
  })

  it('says what is missing in words, and refuses a taken name', () => {
    const result = z.safeParse(schema, { ...newQuestionValues(''), id: 'taken-name' })
    expect(result.success).toBe(false)
    const messages = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]),
    )
    expect(messages).toMatchObject({
      area: 'Choose the domain the question tests.',
      id: 'A test question has this name already. Choose another one.',
      natural: 'Write the natural wording.',
      precise: 'Write the precise wording.',
      source: 'Say where the question comes from, such as a team and a month.',
    })
  })

  it('refuses an item that is both expected and kept out', () => {
    const result = z.safeParse(schema, {
      ...newQuestionValues('area_sales', 'itm_aaaaaaaa'),
      id: 'a-name',
      natural: 'Why?? and how',
      precise: 'Precisely why',
      source: 'Team',
      mustNotDeliver: ['itm_aaaaaaaa'],
    })
    expect(result.error?.issues[0]).toMatchObject({ path: ['mustNotDeliver'] })
  })

  it('saves the form and keeps what the form does not show', () => {
    const original: TestQuestion = {
      ...question,
      wordings: [...question.wordings, { kind: 'natural', text: 'A third way to ask it' }],
      expected: { ...question.expected, status: 'matched' },
    }
    const values = { ...questionValues(original), caveat: ' Not final ', rubrics: 'One\n\n Two ' }
    const input = toSaveQuestionInput(values, original)
    expect(input).toMatchObject({ id: original.id, revision: original.revision })
    expect(input.question.wordings).toHaveLength(3)
    expect(input.question.expected).toMatchObject({ status: 'matched', caveat: 'Not final' })
    expect(input.question.rubrics).toEqual(['One', 'Two'])
    expect(input.question.scope).toEqual(original.scope)
  })
})
