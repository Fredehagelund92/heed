import { describe, expect, it } from 'vitest'
import { rankFixNext, type FixCandidate } from '@domain/quality'
import type { Area } from '@domain/item'
import type { Comparison, EvalRun, Gap, TestQuestion } from '@/api'
import {
  groupWorkRows,
  searchWork,
  workCounts,
  workList,
  workTotals,
  type WorkInput,
} from '@/lib/workbench'
import { mockTestQuestions } from '@/mocks/test-questions'

const area = (id: string, name: string): Area => ({
  id,
  name,
  summary: '',
  description: '',
  ownerIds: [],
  label: 'teal',
  revision: 1,
})
const commercial = area('area_commercial', 'Commercial')
const sandbox = area('area_sandbox', 'Sandbox')

const testQuestion = (id: string, text: string, areaId = commercial.id): TestQuestion => ({
  ...mockTestQuestions[0]!,
  id,
  area: areaId,
  wordings: [{ kind: 'natural', text }],
})
const questions = [
  testQuestion('net-revenue-month', 'How is net revenue doing this month?'),
  testQuestion('orders-week', 'Orders by market, last week'),
  testQuestion('units-sold-lag', 'Is yesterday’s units sold complete?'),
  testQuestion('sandbox-question', 'A sandbox question', sandbox.id),
]
const byId = new Map(questions.map((question) => [question.id, question]))

const gap = (id: string, patch: Partial<Gap> = {}): Gap => ({
  id,
  ref: `gap_${id.slice(-4)}`,
  topic: {
    areaId: commercial.id,
    areaIds: [commercial.id],
    metrics: [],
    dimensions: [],
    dimensionValues: [],
    month: '2026-10-01',
  },
  type: 'missing',
  status: 'open',
  severity: 3,
  openedBy: 'no_item_calls',
  firstSeen: '2026-09-14',
  lastSeen: '2026-10-06',
  statusSince: '2026-09-14T09:00:00Z',
  reports: 6,
  personReports: 0,
  noItemCalls: 40,
  weeks: [],
  proposals: [],
  canManage: true,
  ...patch,
})
const gapIds = {
  open: 'ca9a0000-0000-4000-8000-000000000001',
  small: 'ca9a0000-0000-4000-8000-000000000002',
  drafting: 'ca9a0000-0000-4000-8000-000000000003',
  resolved: 'ca9a0000-0000-4000-8000-000000000004',
  spanning: 'ca9a0000-0000-4000-8000-000000000005',
  sandbox: 'ca9a0000-0000-4000-8000-000000000006',
}
const gaps: Gap[] = [
  gap(gapIds.open),
  // People's reports and calls under the minimum: never printed as a number.
  gap(gapIds.small, { type: 'unclear_question', reports: 3, noItemCalls: 2 }),
  gap(gapIds.drafting, { status: 'proposal_made', type: 'outdated', noItemCalls: 8 }),
  gap(gapIds.resolved, { status: 'resolved', type: 'incorrect', reports: 0, noItemCalls: 12 }),
  gap(gapIds.spanning, {
    topic: {
      areaId: null,
      areaIds: [],
      metrics: [],
      dimensions: [],
      dimensionValues: [],
      month: '2026-10-01',
    },
  }),
  gap(gapIds.sandbox, {
    topic: {
      areaId: sandbox.id,
      areaIds: [sandbox.id],
      metrics: [],
      dimensions: [],
      dimensionValues: [],
      month: '2026-10-01',
    },
  }),
]

/** Fix next's candidates: what the service ranks, so the list can be checked against it. */
const candidates: FixCandidate[] = [
  {
    type: 'question',
    area: commercial.id,
    id: 'net-revenue-month',
    risk: 'high',
    answer: 'fail',
    regression: true,
    retrieval: false,
    failedChecks: ['caveat', 'delivered'],
    since: '2026-10-05T04:30:00Z',
  },
  {
    // Fix next calls it a regression against the scorecard's baseline; the comparison does not.
    type: 'question',
    area: commercial.id,
    id: 'orders-week',
    risk: 'normal',
    answer: 'fail',
    regression: true,
    retrieval: true,
    failedChecks: ['cited'],
    since: '2026-10-05T04:30:00Z',
  },
  ...[gapIds.open, gapIds.small, gapIds.drafting, gapIds.spanning, gapIds.sandbox].map(
    (id): FixCandidate => {
      const found = gaps.find((candidate) => candidate.id === id)!
      return {
        type: 'gap',
        area: found.topic.areaId,
        id,
        ref: found.ref,
        gapType: found.type,
        status: found.status as 'open' | 'proposal_made',
        severity: found.severity,
        reports: found.reports ?? 0,
        lastSeen: found.lastSeen,
      }
    },
  ),
  {
    type: 'item',
    area: commercial.id,
    id: 'itm_l639hm4u',
    title: 'Checklist before you report a change in Retention rate',
    kind: 'guide',
    risk: 'normal',
    daysPastReview: 41,
    reviewDate: '2026-08-31',
    untested: true,
  },
  {
    type: 'item',
    area: commercial.id,
    id: 'itm_abcdefgh',
    title: 'What explains the movement of Marketing spend in January 2025?',
    kind: 'example',
    risk: 'low',
    daysPastReview: null,
    reviewDate: null,
    untested: true,
  },
  {
    type: 'item',
    area: sandbox.id,
    id: 'itm_sandbox1',
    title: 'A sandbox guide',
    kind: 'guide',
    risk: 'low',
    daysPastReview: 3,
    reviewDate: '2026-10-08',
    untested: false,
  },
]
const fix = rankFixNext(candidates, 200)

const change = (id: string, patch: Partial<Comparison['worse'][number]> = {}) => ({
  id,
  from: 'pass' as const,
  to: 'fail' as const,
  failedChecks: [],
  ...patch,
})
const comparison = (patch: Partial<Comparison> = {}): Comparison => ({
  area: commercial.id,
  run: {
    id: '00000000-0000-4000-b000-000000000002',
    kind: 'scheduled',
    edition: '2026-10-07.2',
    finishedAt: '2026-10-05T04:30:00Z',
  },
  against: {
    id: '00000000-0000-4000-b000-000000000001',
    kind: 'scheduled',
    edition: '2026-09-27.1',
    finishedAt: '2026-09-28T04:30:00Z',
  },
  questions: 9,
  better: [],
  worse: [change('net-revenue-month', { failedChecks: ['caveat'] })],
  unchanged: { pass: 7, fail: 1, noAnswer: 0 },
  added: 0,
  removed: 0,
  signTest: { better: 0, worse: 1, pValue: 1 },
  ...patch,
})

const run = (id: string, patch: Partial<EvalRun> = {}) =>
  ({
    id,
    kind: 'scheduled',
    state: 'finished',
    areaId: commercial.id,
    edition: '2026-10-07.2',
    trigger: null,
    createdAt: '2026-10-05T04:00:00Z',
    finishedAt: '2026-10-05T04:30:00Z',
    ...patch,
  }) as unknown as EvalRun

const input = (patch: Partial<WorkInput> = {}): WorkInput => ({
  fix,
  comparisons: [comparison()],
  gaps,
  questions: byId,
  verdicts: new Map([
    ['net-revenue-month', { verdict: 'fail' as const }],
    ['orders-week', { verdict: 'fail' as const }],
    ['units-sold-lag', { verdict: 'pass' as const }],
  ]),
  runs: [
    run('00000000-0000-4000-b000-000000000002'),
    run('00000000-0000-4000-b000-000000000003', { kind: 'full', state: 'failed' }),
    run('00000000-0000-4000-b000-000000000004', { areaId: sandbox.id }),
  ],
  areas: [commercial],
  everyArea: false,
  minimum: 5,
  vocabulary: undefined,
  ...patch,
})

const keys = (rows: readonly { key: string }[]) => rows.map((row) => row.key)

describe('the work list (Workbench plan, slice W5)', () => {
  it('keeps Fix next’s order inside each group, the groups in the order of why', () => {
    const rows = workList(input(), 'all')
    expect(rows.map((row) => row.group)).toEqual([
      'worse',
      'failing',
      'gaps',
      'gaps',
      'gaps',
      'review',
      'untested',
    ])
    // Inside a group the rows are in Fix next's ranking.
    for (const group of new Set(rows.map((row) => row.group))) {
      const ranks = rows.filter((row) => row.group === group).map((row) => row.rank!)
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    }
    // Every row is the subject Fix next ranked at that place.
    for (const row of rows)
      expect(row.open).toBe(`${fix[row.rank!]!.subject.type}:${fix[row.rank!]!.subject.id}`)
  })

  it('lists a subject once, in Got worse when the comparison says so', () => {
    const rows = workList(input(), 'all')
    expect(keys(rows).filter((key) => key === 'question:net-revenue-month')).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'question:net-revenue-month',
      open: 'question:net-revenue-month',
      group: 'worse',
      title: 'How is net revenue doing this month?',
      status: { label: 'Got worse', tone: 'danger', mark: 'worse' },
      // The comparison's failed checks, the ones that changed.
      reason: 'Failed: fact mentioned',
    })
    // Fix next's regression against its own baseline is not "got worse" against this comparison.
    expect(rows.find((row) => row.key === 'question:orders-week')).toMatchObject({
      group: 'failing',
      status: { label: 'Test fails' },
    })
  })

  it('without a comparison, takes what got worse from Fix next', () => {
    const rows = workList(input({ comparisons: [] }), 'worse')
    expect(keys(rows)).toEqual(['question:net-revenue-month', 'question:orders-week'])
  })

  it('adds what the comparison names and Fix next does not, worse after it and better last', () => {
    const rows = workList(
      input({
        comparisons: [
          comparison({
            worse: [
              change('net-revenue-month', { failedChecks: ['caveat'] }),
              change('units-sold-lag', { to: 'no_answer' }),
            ],
            better: [
              change('net-revenue-month', { from: 'fail', to: 'pass' }),
              change('orders-week', { from: 'fail', to: 'pass' }),
              change('sandbox-question', { from: 'fail', to: 'pass' }),
            ],
          }),
        ],
        fix: fix.filter((entry) => entry.subject.id !== 'orders-week'),
      }),
      'all',
    )
    expect(keys(rows.filter((row) => row.group === 'worse'))).toEqual([
      'question:net-revenue-month',
      'question:units-sold-lag',
    ])
    expect(rows.find((row) => row.key === 'question:units-sold-lag')).toMatchObject({
      rank: null,
      reason: 'Passes before, no answer now',
    })
    expect(rows.at(-2)).toMatchObject({
      key: 'question:orders-week',
      group: 'better',
      status: { label: 'Got better', tone: 'success' },
      reason: 'Fails before, passes now',
    })
    // Better is only for a question nothing else lists.
    expect(keys(rows).filter((key) => key === 'question:net-revenue-month')).toHaveLength(1)
  })

  it('gives each view its rows', () => {
    const all = input()
    expect(keys(workList(all, 'worse'))).toEqual(['question:net-revenue-month'])
    expect(keys(workList(all, 'upkeep'))).toEqual(['item:itm_l639hm4u', 'item:itm_abcdefgh'])
    // Every gap of the domain, open first, then with a draft, then closed.
    const gapRows = workList(all, 'gaps')
    expect(gapRows.map((row) => [row.key, row.group])).toEqual([
      [`gap:${gapIds.open}`, 'gap_open'],
      [`gap:${gapIds.small}`, 'gap_open'],
      [`gap:${gapIds.drafting}`, 'gap_drafting'],
      [`gap:${gapIds.resolved}`, 'gap_closed'],
    ])
    expect(gapRows[3]).toMatchObject({ status: { label: 'Resolved', tone: null }, rank: null })
    expect(keys(workList(all, 'gaps', { status: 'proposal_made' }))).toEqual([
      `gap:${gapIds.drafting}`,
    ])
    expect(keys(workList(all, 'gaps', { type: 'unclear_question' }))).toEqual([
      `gap:${gapIds.small}`,
    ])
    expect(workList(all, 'gaps', { origin: 'person' })).toEqual([])
    // Quality's lists: active questions of the domain with their newest verdict, and its runs.
    const questionRows = workList(all, 'questions')
    expect(questionRows.map((row) => [row.key, row.status.label, row.group])).toEqual([
      ['question:net-revenue-month', 'Fails', null],
      ['question:orders-week', 'Fails', null],
      ['question:units-sold-lag', 'Passes', null],
    ])
    expect(workList(all, 'runs').map((row) => [row.title, row.status])).toEqual([
      ['Weekly run, 5 Oct 2026', { label: 'Finished', tone: null, mark: 'run' }],
      ['Full run, 5 Oct 2026', { label: 'Failed', tone: 'danger', mark: 'run' }],
    ])
    expect(workCounts(all)).toEqual({
      all: 7,
      worse: 1,
      gaps: 4,
      upkeep: 2,
      questions: 3,
      runs: 2,
    })
  })

  it('keeps to the domains in scope; a gap that spans domains only for every domain', () => {
    const owner = workList(input({ areas: [commercial, sandbox] }), 'all')
    expect(keys(owner)).toContain(`gap:${gapIds.sandbox}`)
    expect(keys(owner)).toContain('item:itm_sandbox1')
    expect(keys(owner)).not.toContain(`gap:${gapIds.spanning}`)
    const admin = workList(input({ areas: [commercial, sandbox], everyArea: true }), 'gaps')
    expect(keys(admin)).toContain(`gap:${gapIds.spanning}`)
  })

  it('shows a gap whose topic spans domains to the owner of each of them', () => {
    const spanning = gaps.map((entry) =>
      entry.id === gapIds.spanning
        ? { ...entry, topic: { ...entry.topic, areaIds: [commercial.id, sandbox.id] } }
        : entry,
    )
    for (const area of [commercial, sandbox])
      expect(keys(workList(input({ gaps: spanning, areas: [area] }), 'gaps'))).toContain(
        `gap:${gapIds.spanning}`,
      )
  })

  it('never prints a count from 1 to 4, and none before the minimum is known', () => {
    const shown = workList(input(), 'gaps')
    expect(shown.find((row) => row.key === `gap:${gapIds.open}`)?.reason).toBe(
      'Oct 2026 · Missing · 40 calls found nothing · 6 reports',
    )
    const small = shown.find((row) => row.key === `gap:${gapIds.small}`)!
    expect(small.reason).toBe(
      'Oct 2026 · Unclear question · fewer than 5 calls found nothing · fewer than 5 reports',
    )
    for (const row of [...shown, ...workList(input(), 'all')])
      expect(`${row.title} ${row.status.label} ${row.reason}`).not.toMatch(/(^|[^\d.])[1-4](?!\d)/)
    // Until the minimum is known, no count but zero shows.
    for (const row of workList(input({ minimum: null }), 'gaps'))
      expect(row.reason).toBe(
        `Oct 2026 · ${
          {
            missing: 'Missing',
            unclear_question: 'Unclear question',
            outdated: 'Outdated',
            incorrect: 'Incorrect',
          }[gaps.find((candidate) => `gap:${candidate.id}` === row.key)!.type as string]
        }`,
      )
  })

  it('gives each held-out question a row of its own that opens nothing', () => {
    const heldOut = fix
      .filter((entry) => entry.subject.type === 'question')
      .map((entry) => ({ ...entry, subject: { ...entry.subject, id: 'held-out' } }))
    const rows = workList(input({ fix: heldOut, comparisons: [] }), 'all')
    expect(rows.map((row) => [row.key, row.open, row.title])).toEqual([
      ['held-out:0', null, 'A hidden test question'],
      ['held-out:1', null, 'A hidden test question'],
    ])
  })

  it('is the same list every time, whatever order the comparisons come in', () => {
    const one = input({
      areas: [commercial, sandbox],
      comparisons: [
        comparison(),
        comparison({ area: sandbox.id, worse: [change('sandbox-question')] }),
      ],
    })
    const two = { ...one, comparisons: [...one.comparisons].reverse() }
    expect(keys(workList(one, 'all'))).toEqual(keys(workList(two, 'all')))
    expect(keys(workList(one, 'all'))).toEqual(keys(workList(one, 'all')))
  })

  it('searches every word in the title, the reason and the domain', () => {
    const rows = workList(input({ areas: [commercial, sandbox] }), 'all')
    const name = (id: string) => (id === sandbox.id ? 'Sandbox' : 'Commercial')
    expect(keys(searchWork(rows, 'net revenue', name))).toEqual(['question:net-revenue-month'])
    expect(keys(searchWork(rows, 'FACT mentioned', name))).toEqual(['question:net-revenue-month'])
    expect(keys(searchWork(rows, 'sandbox', name))).toEqual([
      `gap:${gapIds.sandbox}`,
      'item:itm_sandbox1',
    ])
    expect(searchWork(rows, '  ', name)).toHaveLength(rows.length)
  })

  it('heads each group with its name and count, and the run compared with', () => {
    const rows = workList(input(), 'all')
    const entries = groupWorkRows(rows, { since: comparison().against })
    expect(
      entries.flatMap((entry) => (entry.type === 'group' ? [[entry.title, entry.count]] : [])),
    ).toEqual([
      ['Got worse since 28 Sept 2026', 1],
      ['Failing tests', 1],
      ['Open gaps', 3],
      ['Check date passed', 1],
      ['No test question covers it', 1],
    ])
    expect(groupWorkRows(workList(input(), 'runs')).every((entry) => entry.type === 'row')).toBe(
      true,
    )
  })

  it('totals what shows, what got worse and the gaps still open', () => {
    expect(workTotals(input(), 3, 7)).toEqual({ shown: 3, total: 7, worse: 1, openGaps: 3 })
  })
})
