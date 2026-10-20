import { describe, expect, it } from 'vitest'
import {
  addWorkingDays,
  matchingCheck,
  matchingProbes,
  mentionDiff,
  narrowerAudienceWarnings,
  noneWorseWords,
  testChange,
  testChangeWords,
  versionDiff,
  vocabularyChangeOf,
  vocabularyFindings,
  type VocabularyChange,
  type VocabularyContext,
} from '../../../src/domain/review.ts'
import type { Mention } from '../../../src/domain/mentions.ts'
import { bundle, event, terms, version } from './fixtures.ts'

const mention = (target: string, label = 'Words', field: Mention['field'] = 'summary') => ({
  field,
  position: 0,
  target,
  label,
})

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

describe('mentionDiff', () => {
  it('reports added and removed mentions by field, target and words, counting repeats', () => {
    const before = [mention('metric:orders'), mention('metric:orders'), mention('area:finance')]
    const after = [
      mention('metric:orders'),
      mention('area:finance', 'Finance'),
      mention('item:itm_00000002', 'Old note', 'body'),
    ]
    expect(mentionDiff(before, after)).toEqual({
      added: [mention('area:finance', 'Finance'), mention('item:itm_00000002', 'Old note', 'body')],
      removed: [mention('metric:orders'), mention('area:finance')],
    })
  })
})

describe('narrowerAudienceWarnings', () => {
  it('warns once per target that fewer people can see, and stays quiet while audiences are everyone', () => {
    const mentions = [mention('metric:orders'), mention('metric:orders'), mention('area:x')]
    expect(
      narrowerAudienceWarnings(null, mentions, [
        { target: 'metric:orders', groups: null },
        { target: 'area:x', groups: null },
      ]),
    ).toEqual([])
    const warnings = narrowerAudienceWarnings(null, mentions, [
      { target: 'metric:orders', groups: ['finance'] },
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ target: 'metric:orders', label: 'Words' })
    expect(
      narrowerAudienceWarnings(['finance'], mentions, [
        { target: 'metric:orders', groups: ['finance', 'risk'] },
      ]),
    ).toEqual([])
    expect(
      narrowerAudienceWarnings(['finance', 'risk'], mentions, [
        { target: 'metric:orders', groups: ['finance'] },
      ]),
    ).toHaveLength(1)
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

describe('vocabularyFindings', () => {
  const change = (overrides: Partial<VocabularyChange> = {}): VocabularyChange => ({
    key: 'val:market/norway',
    kind: 'dimension_value',
    parentKey: 'dim:market',
    name: 'Norway',
    aliases: ['Norge', 'Nordland'],
    areaId: null,
    definitionRefs: [],
    ...overrides,
  })
  const context = (overrides: Partial<VocabularyContext> = {}): VocabularyContext => ({
    live: terms,
    existing: { kind: 'dimension_value', parentKey: 'dim:market' },
    definitions: new Map([
      ['cube:payments.orders', { kind: 'metric', missing: false, areaHint: 'finance' }],
      ['cube:payments.market', { kind: 'dimension', missing: false, areaHint: 'finance' }],
      ['cube:traffic.market', { kind: 'dimension', missing: false, areaHint: 'marketing' }],
      ['cube:traffic.country', { kind: 'dimension', missing: false, areaHint: 'marketing' }],
      ['cube:gone', { kind: 'metric', missing: true, areaHint: null }],
    ] as const),
    areas: new Map([
      ['finance', 'Finance'],
      ['marketing', 'Marketing'],
    ]),
    ...overrides,
  })
  const codes = (findings: { code: string }[]) => findings.map((f) => f.code)
  it('accepts a new other name for a live term', () => {
    expect(vocabularyFindings(change(), context())).toEqual([])
  })
  it('refuses no change, a changed identity, unknown parents and clashing or repeated names', () => {
    expect(codes(vocabularyFindings(change({ aliases: ['Norge'] }), context()))).toEqual([
      'no_change',
    ])
    expect(
      codes(
        vocabularyFindings(
          change({ key: 'val:market/eastland', name: 'Spain', aliases: ['East', 'east'] }),
          context({ existing: null }),
        ),
      ),
    ).toEqual(['duplicate_name', 'name_taken'])
    expect(
      codes(
        vocabularyFindings(
          change({ key: 'metric:orders', kind: 'metric', parentKey: null, name: 'Orders' }),
          context({ existing: { kind: 'metric', parentKey: 'group:payments' } }),
        ),
      ),
    ).toContain('term_identity')
    expect(
      codes(
        vocabularyFindings(
          change({ key: 'val:brand/x', parentKey: 'dim:brand', name: 'X', aliases: [] }),
          context({ existing: null }),
        ),
      ),
    ).toEqual(['unknown_parent'])
    expect(codes(vocabularyFindings(change({ parentKey: 'dim:other' }), context()))).toContain(
      'format',
    )
  })
  it('checks the area and the definition, and treats a Cube domain mismatch as an error at decision', () => {
    const metric = change({
      key: 'metric:orders',
      kind: 'metric',
      parentKey: 'group:payments',
      name: 'Orders',
      aliases: ['Order amount', 'Paid orders'],
      areaId: 'marketing',
      definitionRefs: ['cube:payments.orders'],
    })
    const ctx = context({ existing: { kind: 'metric', parentKey: 'group:payments' } })
    // Named as people know them, never by ref or id.
    expect(vocabularyFindings(metric, ctx)).toEqual([
      expect.objectContaining({
        code: 'domain_mismatch',
        severity: 'warning',
        message: 'Cube puts Orders in Finance',
      }),
    ])
    expect(vocabularyFindings(metric, ctx, true)).toEqual([
      expect.objectContaining({ code: 'domain_mismatch', severity: 'error' }),
    ])
    expect(
      codes(
        vocabularyFindings({ ...metric, areaId: 'nowhere', definitionRefs: ['cube:gone'] }, ctx),
      ),
    ).toEqual(['unknown_area', 'source_missing'])
    expect(codes(vocabularyFindings({ ...metric, definitionRefs: ['cube:unknown'] }, ctx))).toEqual(
      ['unknown_definition'],
    )
    // A dimension such as market is in every view: its Cube domain is only a suggestion, so any
    // area, or none, may hold it.
    const market = change({
      key: 'dim:market',
      kind: 'dimension',
      parentKey: null,
      name: 'Market',
      aliases: [],
      areaId: 'marketing',
      definitionRefs: ['cube:payments.market'],
    })
    const fresh = context({ existing: null, live: [] })
    expect(vocabularyFindings(market, fresh, true)).toEqual([])
    expect(vocabularyFindings({ ...market, areaId: null }, fresh, true)).toEqual([])
  })
  it("lets a dimension name each view's member, one per view, and anything else one at most", () => {
    const market = change({
      key: 'dim:market',
      kind: 'dimension',
      parentKey: null,
      name: 'Market',
      aliases: [],
      areaId: null,
      definitionRefs: ['cube:payments.market', 'cube:traffic.market'],
    })
    const fresh = context({ existing: null, live: [] })
    expect(vocabularyFindings(market, fresh, true)).toEqual([])
    expect(
      codes(
        vocabularyFindings(
          { ...market, definitionRefs: ['cube:traffic.market', 'cube:traffic.country'] },
          fresh,
        ),
      ),
    ).toEqual(['definition_view'])
    expect(
      codes(
        vocabularyFindings(
          { ...market, definitionRefs: ['cube:traffic.market', 'cube:traffic.market'] },
          fresh,
        ),
      ),
    ).toEqual(['duplicate_definition', 'definition_view'])
    expect(
      codes(
        vocabularyFindings(
          change({
            key: 'metric:orders',
            kind: 'metric',
            parentKey: null,
            name: 'Orders',
            aliases: [],
            areaId: 'finance',
            definitionRefs: ['cube:payments.orders', 'cube:payments.market'],
          }),
          fresh,
        ),
      ),
    ).toEqual(['definition_count'])
    // Linking one more view's member is a change; the same members in another order is none.
    const live = { ...market, definitionRefs: ['cube:traffic.market', 'cube:payments.market'] }
    const linked = context({ existing: { kind: 'dimension', parentKey: null }, live: [live] })
    expect(codes(vocabularyFindings(market, linked))).toEqual(['no_change'])
    expect(
      vocabularyFindings({ ...market, definitionRefs: ['cube:payments.market'] }, linked),
    ).toEqual([])
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
