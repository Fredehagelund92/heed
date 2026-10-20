import { describe, expect, it } from 'vitest'
import type { GapDetail, GapTest, TestQuestion } from '@/api'
import { gapVerificationView, linkCandidates, scopeOfTopic } from '@/lib/gap-verification'

/*
  A gap's verification by test and its test links as the Workbench reads them (FR-610, Workbench
  plan, slice V5): Resolved and Verified by test as two facts, a test question's scope from a
  gap's topic, and the questions an owner may link.
*/

type Facts = Parameters<typeof gapVerificationView>[0]
const base: Facts = {
  status: 'open',
  resolvedEdition: null,
  verifiedAt: null,
  verifiedEdition: null,
  tests: [],
  history: [],
}
const test = (question: string, patch: Partial<GapTest> = {}): GapTest => ({
  question,
  split: 'development',
  active: true,
  linkedHour: '2026-10-07T09:00:00Z',
  evidenceRun: null,
  passed: null,
  latest: null,
  ...patch,
})
const passed = { run: 'run-2', edition: '2026-10-08.1', revision: 1, hour: '2026-10-12T06:00:00Z' }

describe('where a gap’s verification stands', () => {
  it('waits for the gap to be resolved, or says it cannot be verified without the edition', () => {
    expect(gapVerificationView({ ...base, tests: [test('q-1')] })).toEqual({ state: 'unresolved' })
    expect(gapVerificationView({ ...base, status: 'resolved' })).toEqual({ state: 'no_edition' })
  })

  it('counts the active tests that passed on the resolving edition or a later one', () => {
    const resolved = { ...base, status: 'resolved' as const, resolvedEdition: '2026-10-08.1' }
    expect(gapVerificationView(resolved)).toEqual({ state: 'no_tests', edition: '2026-10-08.1' })
    expect(
      gapVerificationView({
        ...resolved,
        tests: [test('q-1', { passed }), test('q-2'), test('q-3', { active: false })],
      }),
    ).toEqual({ state: 'waiting', edition: '2026-10-08.1', passed: 1, of: 2 })
    // A reader who does not manage the gap does not learn how many tests it has.
    expect(gapVerificationView({ ...resolved, tests: null, history: null })).toEqual({
      state: 'waiting',
      edition: '2026-10-08.1',
      passed: null,
      of: null,
    })
  })

  it('keeps the verification and shows a later failure beside it', () => {
    const verified: Facts = {
      ...base,
      status: 'resolved',
      resolvedEdition: '2026-10-08.1',
      verifiedAt: '2026-10-12T06:00:00Z',
      verifiedEdition: '2026-10-08.1',
      tests: [
        test('q-1', {
          passed,
          latest: {
            run: 'run-3',
            kind: 'scheduled',
            edition: '2026-10-19.1',
            finishedAt: '2026-10-19T06:00:00Z',
            verdict: 'fail',
          },
        }),
      ],
      history: [
        {
          action: 'gap.verified',
          hour: '2026-10-12T06:00:00Z',
          details: { edition: '2026-10-08.1', run: 'run-2' },
        },
      ],
    }
    expect(gapVerificationView(verified)).toEqual({
      state: 'verified',
      hour: '2026-10-12T06:00:00Z',
      edition: '2026-10-08.1',
      run: 'run-2',
      failing: [{ question: 'q-1', run: 'run-3', finishedAt: '2026-10-19T06:00:00Z' }],
    })
    // Every reader sees the fact; only its managers the run and the failures.
    expect(gapVerificationView({ ...verified, tests: null, history: null })).toEqual({
      state: 'verified',
      hour: '2026-10-12T06:00:00Z',
      edition: '2026-10-08.1',
      run: null,
      failing: [],
    })
  })
})

describe('a test question from a gap', () => {
  it('takes the topic’s metrics, dimension values by dimension, bare dimensions and month', () => {
    expect(
      scopeOfTopic({
        areaId: 'area_commercial',
        areaIds: ['area_commercial'],
        metrics: ['metric:orders'],
        dimensions: ['dim:product', 'dim:market'],
        dimensionValues: [
          { dimension: 'dim:market', value: 'val:market/norway' },
          { dimension: 'dim:market', value: 'val:market/spain' },
        ],
        month: '2026-02-01',
      }),
    ).toEqual({
      metrics: ['orders'],
      dimension_filters: [
        { dimension: 'market', values: ['norway', 'spain'] },
        { dimension: 'product', values: [] },
      ],
      window: { from: '2026-02-01', to: '2026-02-28' },
    })
    expect(
      scopeOfTopic({
        areaId: null,
        areaIds: [],
        metrics: [],
        dimensions: [],
        dimensionValues: [],
        month: '2026-10',
      }),
    ).toEqual({ window: { from: '2026-10-01', to: '2026-10-31' } })
  })
})

describe('the questions an owner may link', () => {
  const question = (id: string, natural: string, patch: Partial<TestQuestion> = {}) =>
    ({
      id,
      area: 'area_commercial',
      wordings: [{ kind: 'natural', text: natural }],
      scope: { metrics: ['orders'] },
      status: 'active',
      ...patch,
    }) as TestQuestion
  const gap: Pick<GapDetail, 'id' | 'topic' | 'status' | 'lastSeen'> = {
    id: 'gap-1',
    status: 'resolved',
    lastSeen: '2026-10-06',
    topic: {
      areaId: 'area_commercial',
      areaIds: ['area_commercial'],
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      month: '2026-10-01',
    },
  }
  const questions = [
    question('orders-south', 'Why are orders low in Spain?', {
      scope: {
        metrics: ['orders'],
        dimension_filters: [{ dimension: 'market', values: ['spain'] }],
      },
    }),
    question('orders-north', 'Why are orders low in Norway?', {
      scope: {
        metrics: ['orders'],
        dimension_filters: [{ dimension: 'market', values: ['norway'] }],
      },
    }),
    question('orders-all', 'Are all orders counted?'),
    question('units_sold', 'Is units sold complete?', { scope: { metrics: ['units_sold'] } }),
    question('linked', 'Already linked'),
    question('retired', 'Retired', { status: 'retired' }),
    question('other', 'Another domain', { area: 'area_marketing' }),
  ]

  it('offers the active questions of its domain not linked yet, those on its scope first', () => {
    const { onScope, others } = linkCandidates(gap, questions, ['linked'])
    expect(onScope.map((q) => q.id)).toEqual(['orders-all', 'orders-north'])
    expect(others.map((q) => q.id)).toEqual(['units_sold', 'orders-south'])
  })

  it('offers the questions of every domain of a topic that spans domains', () => {
    const spanning = {
      ...gap,
      topic: { ...gap.topic, areaId: null, areaIds: ['area_commercial', 'area_marketing'] },
    }
    const { onScope, others } = linkCandidates(spanning, questions, ['linked'])
    expect([...onScope, ...others].map((q) => q.id).sort()).toEqual([
      'orders-all',
      'orders-north',
      'orders-south',
      'other',
      'units_sold',
    ])
  })

  it('offers none for a topic with no domain', () => {
    expect(
      linkCandidates({ ...gap, topic: { ...gap.topic, areaId: null, areaIds: [] } }, questions, []),
    ).toEqual({ onScope: [], others: [] })
  })
})
