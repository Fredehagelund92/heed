import { describe, expect, it } from 'vitest'
import {
  addWorkingDays,
  matchingCheck,
  matchingProbes,
  noneWorseWords,
  testChange,
  testChangeWords,
  versionDiff,
  vocabularyChangeOf,
} from '../../../src/domain/review.ts'
import { bundle, event, terms, version } from './fixtures.ts'

describe('versionDiff', () => {
  it('lists every governed field of a new item and only the changed fields of a change', () => {
    const before = version()
    expect(versionDiff(null, before).map((c) => c.field)).toContain('scope')
    expect(versionDiff(before, before)).toEqual([])
    const after = version({ title: 'Online sales started again', riskLevel: 'high' })
    expect(versionDiff(before, after)).toEqual([
      { field: 'title', before: 'Online sales stopped', after: 'Online sales started again' },
      { field: 'riskLevel', before: 'normal', after: 'high' },
    ])
  })
  it('ignores the order of scope, references, replaced and conflicting items', () => {
    const a = version({
      scope: {
        metrics: ['metric:orders', 'metric:revenue'],
        dimensions: [],
        dimensionValues: [
          { dimension: 'dim:market', value: 'val:market/norway' },
          { dimension: 'dim:market', value: 'val:market/spain' },
        ],
      },
      conflicts: ['itm_00000002', 'itm_00000003'],
    })
    const b = version({
      scope: {
        metrics: ['metric:revenue', 'metric:orders'],
        dimensions: [],
        dimensionValues: [...a.scope.dimensionValues].reverse(),
      },
      conflicts: ['itm_00000003', 'itm_00000002'],
    })
    expect(versionDiff(a, b)).toEqual([])
  })
  it('shows a dimension with any value added to the scope', () => {
    const before = version()
    const after = version({ scope: { ...before.scope, dimensions: ['dim:product'] } })
    const changes = versionDiff(before, after)
    expect(changes.map((change) => change.field)).toEqual(['scope'])
    expect(changes[0]!.before).toMatchObject({ dimensions: [] })
    expect(changes[0]!.after).toMatchObject({ dimensions: ['dim:product'] })
  })
})

describe('matching probes (level 2)', () => {
  const item = event({
    id: 'itm_candidate1',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: '2026-09-01' },
  })
  it('probes inside, before the start, on the end day, other values and other metrics', () => {
    const probes = matchingProbes(item, bundle([item]), terms)
    expect(probes.map((p) => [p.name, p.expect])).toEqual([
      ['inside', 'delivered'],
      ['before_start', 'silent'],
      ['on_end_day', 'silent'],
      ['other_value:dim:market', 'silent'],
      ['all_values', 'delivered'],
      ['other_metric', 'silent'],
    ])
    expect(probes[0]!.scope).toEqual({
      metrics: ['metric:orders'],
      filters: { 'dim:market': ['val:market/norway'] },
      window: { start: '2026-08-04', end: '2026-08-05' },
    })
    expect(probes.at(-1)!.scope.metrics).toEqual(['metric:revenue'])
  })
  it('passes for a well-scoped item, even while delivery is stopped', () => {
    const result = matchingCheck(
      bundle([item], {
        stopped: { all: true, areas: [], items: [] },
      }),
      item.id,
      terms,
      '2026-08-05',
    )
    expect(result.probes.filter((p) => !p.passed)).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.probes.find((p) => p.name === 'all_values')).toMatchObject({ match: 'partial' })
  })
  it('expands a metric group to one of its metrics and fails when nothing can select the item', () => {
    const grouped = event({
      id: 'itm_grouped01',
      scope: { metrics: ['group:payments'], dimensions: [], dimensionValues: [] },
    })
    const probes = matchingProbes(grouped, bundle([grouped]), terms)
    expect(probes[0]!.scope.metrics).toEqual(['metric:orders'])
    expect(matchingCheck(bundle([grouped]), grouped.id, terms, '2026-08-05').passed).toBe(true)
    const empty = event({
      id: 'itm_emptygrp1',
      scope: { metrics: ['group:empty'], dimensions: [], dimensionValues: [] },
    })
    const failed = matchingCheck(bundle([empty]), empty.id, terms, '2026-08-05')
    expect(failed.passed).toBe(false)
    expect(failed.probes[0]).toMatchObject({ name: 'inside', actual: 'silent', passed: false })
  })
  it('fails when a high-risk item past its review date would be withheld', () => {
    const overdue = event({ id: 'itm_overdue01', riskLevel: 'high', reviewDate: '2026-08-01' })
    const result = matchingCheck(bundle([overdue]), overdue.id, terms, '2026-08-05')
    expect(result.passed).toBe(false)
    expect(result.probes[0]).toMatchObject({ withheld: 'high_risk_unverified' })
  })
  it('names the dimension of an item about any value, and is silent without it', () => {
    const anyMarket = event({
      id: 'itm_anymarket',
      scope: { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] },
    })
    const probes = matchingProbes(anyMarket, bundle([anyMarket]), terms)
    expect(probes.map((p) => [p.name, p.expect])).toEqual([
      ['inside', 'delivered'],
      ['before_start', 'silent'],
      ['without_dimension:dim:market', 'silent'],
      ['other_metric', 'silent'],
    ])
    expect(probes[0]!.scope.filters).toEqual({ 'dim:market': [] })
    expect(probes[2]!.scope.filters).toEqual({})
    const result = matchingCheck(bundle([anyMarket]), anyMarket.id, terms, '2026-08-05')
    expect(result.probes.filter((p) => !p.passed)).toEqual([])
    expect(result.probes[0]).toMatchObject({ match: 'exact' })
  })
  it('fails for an id that is not in the bundle', () => {
    expect(matchingCheck(bundle([item]), 'itm_missing01', terms, '2026-08-05')).toEqual({
      passed: false,
      probes: [],
    })
  })
})

describe('vocabularyChangeOf', () => {
  it('reads a draft stored before a term could name several definitions', () => {
    const draft = {
      key: 'dim:market',
      kind: 'dimension' as const,
      parentKey: null,
      name: 'Market',
      aliases: [],
      areaId: null,
      definitionRef: 'cube:payments.market',
      base: null,
    }
    expect(vocabularyChangeOf(draft)).toEqual({
      key: 'dim:market',
      kind: 'dimension',
      parentKey: null,
      name: 'Market',
      aliases: [],
      areaId: null,
      definitionRefs: ['cube:payments.market'],
      base: null,
    })
    expect(vocabularyChangeOf({ ...draft, definitionRef: null }).definitionRefs).toEqual([])
    const { definitionRef: _old, ...current } = draft
    expect(
      vocabularyChangeOf({ ...current, definitionRefs: ['cube:a.market', 'cube:b.market'] }),
    ).toMatchObject({ definitionRefs: ['cube:a.market', 'cube:b.market'] })
  })
})

describe('addWorkingDays', () => {
  it('skips Saturdays and Sundays in UTC', () => {
    expect(addWorkingDays('2026-10-09T15:00:00.000Z', 2)).toBe('2026-10-13T15:00:00.000Z')
    expect(addWorkingDays('2026-10-10T08:00:00.000Z', 1)).toBe('2026-10-12T08:00:00.000Z')
    expect(addWorkingDays('2026-10-08T00:00:00.000Z', 0)).toBe('2026-10-08T00:00:00.000Z')
    expect(() => addWorkingDays('not a date', 1)).toThrow()
    expect(() => addWorkingDays('2026-10-08T00:00:00.000Z', -1)).toThrow()
  })
})

describe('testChange (FR-524)', () => {
  it('names what an attached test says about a change, and nothing when a side is unknown', () => {
    expect(testChange(false, true)).toBe('fixed')
    expect(testChange(false, false)).toBe('still_fails')
    expect(testChange(true, true)).toBe('still_passes')
    expect(testChange(true, false)).toBe('broken')
    expect(testChange(null, true)).toBeNull()
    expect(testChange(true, null)).toBeNull()
    expect(testChangeWords.fixed).toBe('passes with this change')
    expect(testChangeWords.still_fails).toBe('still fails')
  })
})

describe('noneWorseWords', () => {
  it('says only that none got worse when every affected question passes', () => {
    expect(noneWorseWords(2)).toBe('2 test questions could change. None got worse.')
    expect(noneWorseWords(1)).toBe("1 test question could change. It didn't get worse.")
  })
  it('says plainly when questions were already failing and still fail', () => {
    expect(noneWorseWords(3, { alreadyFailing: 1 })).toBe(
      '3 test questions could change. None got worse. 1 was already failing and still fails.',
    )
    expect(noneWorseWords(3, { alreadyFailing: 2 })).toBe(
      '3 test questions could change. None got worse. 2 were already failing and still fail.',
    )
  })
  it('says plainly when questions went from failing to passing', () => {
    expect(noneWorseWords(2, { nowPassing: 1 })).toBe(
      '2 test questions could change. None got worse. 1 went from failing to passing.',
    )
    expect(noneWorseWords(3, { alreadyFailing: 1, nowPassing: 2 })).toBe(
      '3 test questions could change. None got worse. 1 was already failing and still fails. 2 went from failing to passing.',
    )
  })
})
