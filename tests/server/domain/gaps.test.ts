import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  clearsVerification,
  dimensionOfValue,
  draftFromTopic,
  gapOrigin,
  gapVerification,
  passVerifies,
  visibleCount,
  visibleShare,
  type LinkedTest,
} from '../../../src/domain/gaps.ts'
import { noteFindings, scopeIssueFindings } from '../../../src/domain/gap-reports.ts'

it('hides counts from one to just under the minimum, and shows zero and the rest', () => {
  expect([0, 1, 4, 5, 6].map((n) => visibleCount(n, 5))).toEqual([0, null, null, 5, 6])
  fc.assert(
    fc.property(fc.nat(1000), fc.integer({ min: 1, max: 100 }), (count, minimum) => {
      const shown = visibleCount(count, minimum)
      expect(shown === null).toBe(count > 0 && count < minimum)
    }),
  )
})

it('hides a share whenever either count is hidden or there were no calls', () => {
  expect(visibleShare(5, 10)).toBe(0.5)
  expect(visibleShare(null, 10)).toBeNull()
  expect(visibleShare(5, null)).toBeNull()
  expect(visibleShare(0, 0)).toBeNull()
})

it('names the five ways a gap opens by case number', () => {
  expect([1, 2, 3, 4, 5].map(gapOrigin)).toEqual([
    'no_item_calls',
    'report_gap',
    'feedback',
    'source_change',
    'person',
  ])
  expect(() => gapOrigin(6)).toThrow(/Unknown gap case/)
  expect(() => gapOrigin(0)).toThrow(/Unknown gap case/)
})

it('starts a draft with the topic scope and no dates, as its month is when people asked', () => {
  expect(dimensionOfValue('val:market/norway')).toBe('dim:market')
  expect(
    draftFromTopic(
      {
        metricKeys: ['metric:orders'],
        valueKeys: ['val:market/norway', 'val:product/sports'],
        dimensionKeys: [],
      },
      'finance',
    ),
  ).toEqual({
    areaId: 'finance',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [
        { dimension: 'dim:market', value: 'val:market/norway' },
        { dimension: 'dim:product', value: 'val:product/sports' },
      ],
    },
  })
})

it('refuses a note with personal data, a secret or the question, and names why', () => {
  expect(noteFindings('Norway closed on 4 August.')).toEqual([])
  expect(noteFindings('Mail ravi@example.test').map((finding) => finding.code)).toEqual([
    'email_address',
  ])
  // Words FR-117's check lets through, but an anonymous note must not hold.
  expect(noteFindings('the api key is in the vault').map((finding) => finding.code)).toEqual([
    'personal_data',
  ])
  expect(noteFindings('call 0045 1234 5678').map((finding) => finding.code)).toEqual([
    'personal_data',
  ])
  const question = 'Why did orders in Norway drop so sharply in the first week of August?'
  expect(noteFindings(`Asked: ${question}`, question).map((finding) => finding.field)).toEqual([
    'note',
  ])
  expect(noteFindings('Orders in Norway', question)).toEqual([])
})

it('says why a scope names no topic, in findings', () => {
  expect(
    scopeIssueFindings([
      { field: 'dates', input: '', options: [] },
      { field: 'scope', input: '', options: ['metric:orders'] },
      { field: 'metrics', input: 'metric:nothing', options: [] },
    ]).map((finding) => [finding.code, finding.field]),
  ).toEqual([
    ['dates', 'dates'],
    ['scope', 'scope'],
    ['unknown_term', 'metrics'],
  ])
})

describe('verification by test (FR-610)', () => {
  const weekly = { kind: 'scheduled', finished: true, editionSeq: 12 }

  it('counts a pass only from a finished weekly or full run on the resolving edition or later', () => {
    expect(passVerifies(weekly, 'pass', 12)).toBe(true)
    expect(passVerifies({ ...weekly, kind: 'full', editionSeq: 14 }, 'pass', 12)).toBe(true)
    // An impact run's candidate edition was never sealed; other kinds test something else.
    for (const kind of ['impact', 'replay', 'links', 'assistant_mock'])
      expect(passVerifies({ ...weekly, kind }, 'pass', 12), kind).toBe(false)
    expect(passVerifies({ ...weekly, editionSeq: 11 }, 'pass', 12)).toBe(false)
    expect(passVerifies({ ...weekly, editionSeq: null }, 'pass', 12)).toBe(false)
    expect(passVerifies({ ...weekly, finished: false }, 'pass', 12)).toBe(false)
    expect(passVerifies(weekly, 'fail', 12)).toBe(false)
    expect(passVerifies(weekly, 'no_answer', 12)).toBe(false)
    expect(passVerifies(weekly, null, 12)).toBe(false)
  })

  it('verifies nothing without a resolving edition: unknown stays unknown', () => {
    expect(passVerifies(weekly, 'pass', null)).toBe(false)
    const passed: LinkedTest = {
      questionId: 'orders-norway',
      active: true,
      pass: { editionSeq: 12, hour: '2026-10-13T06:00:00Z' },
    }
    expect(gapVerification([passed], null)).toEqual({ state: 'no_edition' })
  })

  const test = (questionId: string, pass: LinkedTest['pass'], active = true): LinkedTest => ({
    questionId,
    active,
    pass,
  })

  it('needs at least one active linked test', () => {
    expect(gapVerification([], 12)).toEqual({ state: 'no_tests' })
    expect(
      gapVerification(
        [test('retired', { editionSeq: 12, hour: '2026-10-13T06:00:00Z' }, false)],
        12,
      ),
    ).toEqual({ state: 'no_tests' })
  })

  it('waits for every active test, and ignores passes before the resolving edition', () => {
    expect(
      gapVerification(
        [
          test('b-fails-still', null),
          test('a-passed-too-early', { editionSeq: 11, hour: '2026-10-06T06:00:00Z' }),
          test('c-passed', { editionSeq: 12, hour: '2026-10-13T06:00:00Z' }),
          test('d-retired', null, false),
        ],
        12,
      ),
    ).toEqual({ state: 'waiting', waitingFor: ['a-passed-too-early', 'b-fails-still'] })
  })

  it('is verified at the hour and edition of the last pass it needed', () => {
    expect(
      gapVerification(
        [
          test('a', { editionSeq: 13, hour: '2026-10-20T06:00:00Z' }),
          test('b', { editionSeq: 12, hour: '2026-10-13T06:00:00Z' }),
          test('retired', null, false),
        ],
        12,
      ),
    ).toEqual({ state: 'verified', editionSeq: 13, hour: '2026-10-20T06:00:00Z' })
    // Two runs in one hour: the later edition.
    expect(
      gapVerification(
        [
          test('a', { editionSeq: 14, hour: '2026-10-20T06:00:00Z' }),
          test('b', { editionSeq: 13, hour: '2026-10-20T06:00:00Z' }),
        ],
        12,
      ),
    ).toEqual({ state: 'verified', editionSeq: 14, hour: '2026-10-20T06:00:00Z' })
  })

  it('is verified exactly when no active test waits', () => {
    const pass = fc.option(
      fc.record({
        editionSeq: fc.integer({ min: 1, max: 30 }),
        hour: fc.integer({ min: 0, max: 1000 }).map((h) => new Date(h * 3_600_000).toISOString()),
      }),
      { nil: null },
    )
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ questionId: fc.string(), active: fc.boolean(), pass }), {
          selector: (t) => t.questionId,
        }),
        fc.integer({ min: 1, max: 30 }),
        (tests, resolved) => {
          const result = gapVerification(tests, resolved)
          const counted = tests.filter((t) => t.active)
          const waiting = counted.filter((t) => !t.pass || t.pass.editionSeq < resolved)
          if (!counted.length) expect(result.state).toBe('no_tests')
          else if (waiting.length) expect(result.state).toBe('waiting')
          else {
            expect(result.state).toBe('verified')
            if (result.state === 'verified')
              expect(result.editionSeq).toBeGreaterThanOrEqual(resolved)
          }
        },
      ),
    )
  })

  it('clears verification whenever a gap leaves resolved, and only then', () => {
    expect(clearsVerification('resolved', 'open')).toBe(true)
    expect(clearsVerification('resolved', 'wont_fix')).toBe(true)
    expect(clearsVerification('resolved', 'proposal_made')).toBe(true)
    expect(clearsVerification('resolved', 'resolved')).toBe(false)
    expect(clearsVerification('open', 'resolved')).toBe(false)
    expect(clearsVerification('proposal_made', 'wont_fix')).toBe(false)
  })
})
