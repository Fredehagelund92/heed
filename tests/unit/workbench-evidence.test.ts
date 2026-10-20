import { describe, expect, it } from 'vitest'
import type { Gap, QuestionComparison, QuestionHistory, TestQuestion } from '@/api'
import {
  checkTallies,
  comparisonFactors,
  deliveredRows,
  gapHistory,
  gapsForScope,
  questionHistory,
} from '@/lib/workbench-evidence'

/*
  What a test question's record in the Workbench reads out of its two runs, its history and the
  gaps (Workbench plan, slice W6b), and a gap's history (W6c).
*/

const question: Pick<TestQuestion, 'area' | 'scope' | 'expected'> = {
  area: 'area_commercial',
  scope: {
    metrics: ['net_revenue'],
    dimension_filters: [{ dimension: 'market', values: ['spain'] }],
  },
  expected: {
    must_deliver: ['itm_note'],
    must_not_deliver: ['itm_old'],
    no_cause_claim: true,
    clarifying_question: false,
  },
}

let gapId = 0
function gap(
  topic: Partial<Gap['topic']>,
  patch: Partial<Pick<Gap, 'status' | 'lastSeen'>> = {},
): Gap {
  gapId += 1
  return {
    id: `ca9a0000-0000-4000-8000-${gapId.toString().padStart(12, '0')}`,
    ref: `gap-${gapId}`,
    topic: {
      areaId: 'area_commercial',
      areaIds: ['area_commercial'],
      metrics: ['metric:net_revenue'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
      month: '2026-10-01',
      ...topic,
    },
    type: 'missing',
    status: 'open',
    severity: 2,
    openedBy: 'no_item_calls',
    firstSeen: '2026-09-28T10:00:00Z',
    lastSeen: '2026-10-05T10:00:00Z',
    statusSince: '2026-09-28T10:00:00Z',
    reports: 0,
    personReports: 0,
    noItemCalls: 15,
    weeks: [],
    proposals: [],
    canManage: true,
    ...patch,
  }
}

type Try = QuestionComparison['run']['wordings'][number]['tries'][number]
const attempt = (
  trial: number,
  passed: boolean | null,
  checks: Record<string, boolean>,
  delivered: string[],
): Try => ({
  cell: `00000000-0000-4000-c000-${trial.toString().padStart(12, '0')}`,
  trial,
  passed,
  refused: false,
  reused: false,
  error: null,
  checks,
  delivered,
  reached: [],
  statuses: [],
  judgeReason: null,
  answer: null,
})

function side(
  id: string,
  edition: string,
  tries: Try[][],
  verdict: 'pass' | 'fail' = 'pass',
): QuestionComparison['run'] {
  return {
    run: {
      id,
      kind: 'scheduled',
      edition,
      finishedAt: '2026-10-05T04:30:00Z',
      modelId: 'model',
      judgeModelId: 'judge',
      toolSchemaDigest: null,
      promptDigest: null,
      tries: tries[0]?.length ?? 0,
    },
    revision: 1,
    verdict,
    layers: null,
    wordings: tries.map((wording, index) => ({ wording: index, verdict, tries: wording })),
  }
}

const passing = { delivered: true, caveat: true, cited: true }
const failing = { delivered: false, caveat: false, cited: true }
const before = side('before', '2026-09-27.1', [
  [attempt(1, true, passing, ['itm_note']), attempt(2, true, passing, ['itm_note'])],
  [attempt(1, true, passing, ['itm_note']), attempt(2, true, passing, ['itm_note'])],
])
const now = side(
  'now',
  '2026-10-07.2',
  [
    [attempt(1, false, failing, ['itm_other']), attempt(2, false, failing, [])],
    [attempt(1, false, failing, []), attempt(2, true, passing, ['itm_note'])],
  ],
  'fail',
)

describe('the gaps on a test question’s scope', () => {
  it('matches the domain, a metric it asks about and the values it narrows to', () => {
    const same = gap({})
    const allMarkets = gap({ dimensionValues: [] })
    const noDomain = gap({ areaId: null })
    const otherMarket = gap({
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    })
    const otherMetric = gap({ metrics: ['metric:orders'] })
    const otherDomain = gap({ areaId: 'area_sandbox' })
    const otherDimension = gap({
      dimensionValues: [{ dimension: 'dim:product', value: 'val:product/clothing' }],
    })
    expect(
      gapsForScope(question, [
        same,
        allMarkets,
        noDomain,
        otherMarket,
        otherMetric,
        otherDomain,
        otherDimension,
      ]),
    ).toEqual([same, allMarkets, noDomain, otherDimension])
  })

  it('reads a question that names no metric as about gaps that name none', () => {
    const scope = { area: 'area_commercial', scope: {} }
    const none = gap({ metrics: [], dimensionValues: [] })
    expect(gapsForScope(scope, [gap({}), none])).toEqual([none])
  })

  it('takes the vocabulary’s full keys too', () => {
    const full = {
      area: 'area_commercial',
      scope: {
        metrics: ['metric:net_revenue'],
        dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
      },
    }
    const same = gap({})
    expect(gapsForScope(full, [same])).toEqual([same])
  })

  it('puts open gaps first, then drafts, then closed, the latest seen first in each', () => {
    const closed = gap({}, { status: 'resolved', lastSeen: '2026-10-09T10:00:00Z' })
    const drafting = gap({}, { status: 'proposal_made' })
    const older = gap({}, { lastSeen: '2026-09-01T10:00:00Z' })
    const newer = gap({}, { lastSeen: '2026-10-08T10:00:00Z' })
    expect(gapsForScope(question, [closed, drafting, older, newer])).toEqual([
      newer,
      older,
      drafting,
      closed,
    ])
  })
})

describe('the checks over a run’s tries', () => {
  it('counts the tries that held each check, in the order checks are named', () => {
    expect(checkTallies(now)).toEqual([
      { check: 'delivered', held: 1, tries: 4 },
      { check: 'cited', held: 4, tries: 4 },
      { check: 'caveat', held: 1, tries: 4 },
    ])
  })

  it('has none without a run, and puts a rubric after the named checks', () => {
    expect(checkTallies(null)).toEqual([])
    const rubric = side('r', 'x', [[attempt(1, true, { rubric_0: true, caveat: true }, [])]])
    expect(checkTallies(rubric).map((tally) => tally.check)).toEqual(['caveat', 'rubric_0'])
  })
})

describe('what Heed gave the test in each run', () => {
  it('lists the items the question names, then the others, with how many tries got each', () => {
    expect(deliveredRows(question, { run: now, against: before })).toEqual([
      {
        itemId: 'itm_note',
        named: 'must_deliver',
        run: { tries: 1, of: 4 },
        against: { tries: 4, of: 4 },
      },
      {
        itemId: 'itm_old',
        named: 'must_not_deliver',
        run: { tries: 0, of: 4 },
        against: { tries: 0, of: 4 },
      },
      {
        itemId: 'itm_other',
        named: null,
        run: { tries: 1, of: 4 },
        against: { tries: 0, of: 4 },
      },
    ])
  })

  it('has no other side without a run to compare with', () => {
    expect(deliveredRows(question, { run: now, against: null })[0]!.against).toBeNull()
  })
})

describe('what else differed between the two runs', () => {
  it('says only the edition differs when everything else was held', () => {
    expect(comparisonFactors({ against: before, changed: ['edition'], unknown: [] })).toEqual({
      onlyEdition: true,
      changed: [],
      unknown: [],
    })
  })

  it('never counts what a run did not record as held', () => {
    expect(
      comparisonFactors({ against: before, changed: ['edition'], unknown: ['prompt'] }),
    ).toEqual({ onlyEdition: false, changed: [], unknown: ['prompt'] })
    expect(
      comparisonFactors({ against: before, changed: ['edition', 'answer_model'], unknown: [] }),
    ).toEqual({ onlyEdition: false, changed: ['answer_model'], unknown: [] })
    expect(comparisonFactors({ against: before, changed: [], unknown: [] })?.onlyEdition).toBe(
      false,
    )
  })

  it('has nothing to say without a run to compare with', () => {
    expect(comparisonFactors({ against: null, changed: [], unknown: [] })).toBeNull()
  })
})

describe('a test question’s history', () => {
  const run = (id: string, finishedAt: string, verdict: 'pass' | 'fail') => ({
    run: id,
    kind: 'scheduled' as const,
    edition: `${finishedAt.slice(0, 10)}.1`,
    finishedAt,
    state: 'tested' as const,
    revision: 1,
    verdict,
    layers: null,
  })
  const pass = (edition: string, asOf: string, passed: boolean) => ({
    run: `pass-${edition}`,
    edition,
    asOf,
    revision: 1,
    passed,
    checks: { served: true, delivered: passed, not_delivered: true },
  })
  const history: Pick<QuestionHistory, 'runs' | 'retrieval'> = {
    runs: [run('r3', '2026-10-05T04:30:00Z', 'fail'), run('r2', '2026-09-28T04:30:00Z', 'pass')],
    retrieval: [
      pass('2026-10-07.2', '2026-10-07', false),
      pass('2026-10-03.1', '2026-10-03', false),
      pass('2026-10-01.1', '2026-10-01', false),
      pass('2026-09-27.1', '2026-09-27', true),
      pass('2026-09-20.1', '2026-09-20', true),
    ],
  }

  it('keeps each run, the retrieval passes that changed and the newest, newest first', () => {
    const events = questionHistory(history, [
      {
        itemId: 'itm_note',
        title: 'Net revenue excludes test accounts',
        steps: [
          {
            edition: {
              label: '2026-10-01.1',
              sealedAt: '2026-10-01T09:00:00Z',
              createdAt: '2026-10-01T08:00:00Z',
            },
            change: 'changed',
            from: { version: 1 },
            to: { version: 2 },
          },
        ],
      },
    ])
    expect(
      events.map((event) =>
        event.kind === 'run'
          ? `run ${event.run.run}`
          : event.kind === 'retrieval'
            ? `retrieval ${event.edition} ${event.change}`
            : `edition ${event.edition} ${event.from} to ${event.to}`,
      ),
    ).toEqual([
      'retrieval 2026-10-07.2 same',
      'run r3',
      'retrieval 2026-10-01.1 changed',
      'edition 2026-10-01.1 1 to 2',
      'run r2',
      'retrieval 2026-09-20.1 first',
    ])
  })

  it('is empty before any run or pass', () => {
    expect(questionHistory({ runs: [], retrieval: [] })).toEqual([])
  })
})

describe('a gap’s history', () => {
  const opened = {
    firstSeen: '2026-09-14',
    lastSeen: '2026-10-06',
    status: 'open' as const,
    statusSince: '2026-09-14T09:00:00Z',
  }

  it('begins when it was first seen and ends when it was last seen, newest first', () => {
    expect(gapHistory(opened)).toEqual([
      { kind: 'last_seen', at: '2026-10-06' },
      { kind: 'first_seen', at: '2026-09-14' },
    ])
  })

  it('says a gap seen on one day once', () => {
    expect(gapHistory({ ...opened, lastSeen: '2026-09-14' })).toEqual([
      { kind: 'first_seen', at: '2026-09-14' },
    ])
  })

  it('names where a closed or reopened gap stands since when', () => {
    expect(
      gapHistory({ ...opened, status: 'resolved', statusSince: '2026-10-08T07:00:00Z' }),
    ).toEqual([
      { kind: 'status', at: '2026-10-08T07:00:00Z', status: 'resolved' },
      { kind: 'last_seen', at: '2026-10-06' },
      { kind: 'first_seen', at: '2026-09-14' },
    ])
    expect(
      gapHistory({ ...opened, status: 'open', statusSince: '2026-10-01T10:00:00Z' })[1],
    ).toEqual({ kind: 'status', at: '2026-10-01T10:00:00Z', status: 'open' })
  })

  it('tells a draft started by the draft, and by the status only when no draft can be read', () => {
    const drafted = {
      ...opened,
      status: 'proposal_made' as const,
      statusSince: '2026-10-07T12:00:00Z',
    }
    expect(
      gapHistory(drafted, [{ id: 'prop_1', createdAt: '2026-10-07T12:00:00Z' }]).map(
        (event) => event.kind,
      ),
    ).toEqual(['draft', 'last_seen', 'first_seen'])
    expect(gapHistory(drafted).map((event) => event.kind)).toEqual([
      'status',
      'last_seen',
      'first_seen',
    ])
  })

  it('puts the moments of one day in the order a reader works back in', () => {
    expect(
      gapHistory(
        {
          firstSeen: '2026-10-06',
          lastSeen: '2026-10-07',
          status: 'resolved',
          statusSince: '2026-10-07T15:00:00Z',
        },
        [{ id: 'prop_1', createdAt: '2026-10-07T09:00:00Z' }],
      ).map((event) => event.kind),
    ).toEqual(['last_seen', 'status', 'draft', 'first_seen'])
  })

  it('tells its managers the lifecycle from the history log (V5)', () => {
    const history = [
      { action: 'gap.test_linked', hour: '2026-10-07T09:00:00Z', details: { question: 'q-1' } },
      { action: 'gap.note_added', hour: '2026-10-07T10:00:00Z', details: {} },
      {
        action: 'gap.status_changed',
        hour: '2026-10-08T07:00:00Z',
        details: { from: 'open', to: 'resolved', edition: '2026-10-08.1', reason: 'Fixed.' },
      },
      {
        action: 'gap.verified',
        hour: '2026-10-12T06:00:00Z',
        details: { edition: '2026-10-08.1', run: 'run-1' },
      },
      { action: 'gap.test_unlinked', hour: '2026-10-12T08:00:00Z', details: { question: 'q-2' } },
      // A draft the reader cannot open stays out, as in the drafts list.
      {
        action: 'gap.draft_started',
        hour: '2026-10-07T11:00:00Z',
        details: { proposal: 'prop_hidden' },
      },
    ] as const
    expect(
      gapHistory(
        { ...opened, status: 'resolved', statusSince: '2026-10-08T07:00:00Z' },
        [],
        history.map((entry) => ({ ...entry, details: { ...entry.details } })),
      ),
    ).toEqual([
      { kind: 'test_unlinked', at: '2026-10-12T08:00:00Z', question: 'q-2' },
      { kind: 'verified', at: '2026-10-12T06:00:00Z', edition: '2026-10-08.1', run: 'run-1' },
      {
        kind: 'status',
        at: '2026-10-08T07:00:00Z',
        status: 'resolved',
        edition: '2026-10-08.1',
        reason: 'Fixed.',
      },
      { kind: 'note', at: '2026-10-07T10:00:00Z' },
      { kind: 'test_linked', at: '2026-10-07T09:00:00Z', question: 'q-1' },
      { kind: 'last_seen', at: '2026-10-06' },
      { kind: 'first_seen', at: '2026-09-14' },
    ])
  })

  it('stands in the current status for a change the log does not hold, and tells a draft once', () => {
    const events = gapHistory(
      { ...opened, status: 'proposal_made', statusSince: '2026-10-07T12:00:00Z' },
      [{ id: 'prop_1', createdAt: '2026-10-07T12:00:00Z' }],
      [
        {
          action: 'gap.draft_started',
          hour: '2026-10-07T12:00:00Z',
          details: { proposal: 'prop_1', tests: ['q-1'] },
        },
        { action: 'gap.verification_cleared', hour: '2026-10-05T12:00:00Z', details: {} },
      ],
    )
    expect(events.map((event) => event.kind)).toEqual([
      'draft',
      'last_seen',
      'verification_cleared',
      'first_seen',
    ])
    expect(
      gapHistory({ ...opened, status: 'wont_fix', statusSince: '2026-10-02T12:00:00Z' }, [], [])[1],
    ).toEqual({ kind: 'status', at: '2026-10-02T12:00:00Z', status: 'wont_fix' })
  })
})
