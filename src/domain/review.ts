import { canonicalJson } from './canonical.ts'
import type { ItemVersion } from './item-version.ts'
import {
  compareIds,
  metricsOf,
  resolve,
  type EditionBundle,
  type ResolverItem,
} from './resolver.ts'
import type { ResolvedScope } from './scope.ts'
import { noGroups } from './item.ts'
import { shiftDate } from './validity.ts'
import { type Term } from './vocabulary.ts'

/** One governed field that differs between the version in service and the proposed version. */
export type FieldChange = { field: string; before: unknown; after: unknown }

const reviewedFields = [
  'kind',
  'areaId',
  'title',
  'summary',
  'summaryMarkup',
  'body',
  'bodyMarkup',
  'scope',
  'validity',
  'reviewDate',
  'evidence',
  'references',
  'changeMarks',
  'claimLevel',
  'claimAuthority',
  'claimQuote',
  'riskLevel',
  'audience',
  'ownerId',
  'notToConclude',
  'replaces',
  'conflicts',
] as const satisfies readonly (keyof ItemVersion)[]

/** Order does not matter for these lists, so they are compared sorted. */
function normalized(version: ItemVersion, field: (typeof reviewedFields)[number]): unknown {
  const value = version[field]
  if (field === 'scope')
    return {
      metrics: [...version.scope.metrics].sort(compareIds),
      dimensions: [...version.scope.dimensions].sort(compareIds),
      dimensionValues: [...version.scope.dimensionValues].sort((a, b) =>
        compareIds(a.value, b.value),
      ),
    }
  if (field === 'references' || field === 'replaces' || field === 'conflicts')
    return [...(value as string[])].sort(compareIds)
  return value ?? null
}

/** Field by field, in a fixed order, so the browser and the assistant show the same diff (FR-209). */
export function versionDiff(before: ItemVersion | null, after: ItemVersion): FieldChange[] {
  return reviewedFields.flatMap((field) => {
    const old = before ? normalized(before, field) : null
    const now = normalized(after, field)
    return canonicalJson(old) === canonicalJson(now) ? [] : [{ field, before: old, after: now }]
  })
}

export type Probe = { name: string; scope: ResolvedScope; expect: 'delivered' | 'silent' }
export type ProbeResult = Probe & {
  actual: 'delivered' | 'silent'
  match?: 'exact' | 'partial'
  withheld?: string
  passed: boolean
}

/**
 * Level 2 probes generated from the item's own scope: inside its scope and first day it must be
 * delivered; a day before it starts, on its end day, for another value of a filtered dimension,
 * without a dimension it scopes with any value and for an unrelated metric it must stay silent;
 * with no filter on its values it is a partial match.
 */
export function matchingProbes(
  item: ResolverItem,
  bundle: Pick<EditionBundle, 'groupsOfMetric'>,
  terms: readonly Term[],
): Probe[] {
  const membersOf = (key: string) => metricsOf(bundle, key).sort(compareIds)
  const covered = new Set(item.scope.metrics.flatMap(membersOf))
  const metrics = [
    ...new Set(item.scope.metrics.flatMap((key) => membersOf(key).slice(0, 1))),
  ].sort(compareIds)
  const filters: Record<string, string[]> = {}
  for (const row of [...item.scope.dimensionValues].sort((a, b) => compareIds(a.value, b.value)))
    filters[row.dimension] ??= [row.value]
  const anyValue = [...item.scope.dimensions].sort(compareIds)
  const named = Object.fromEntries(anyValue.map((dimension): [string, string[]] => [dimension, []]))
  const valueDimensions = Object.keys(filters).sort(compareIds)
  Object.assign(filters, named)
  const day = (start: string) => ({ start, end: shiftDate(start, 1) })
  const inside = { metrics, filters, window: day(item.validity.start) }
  const probes: Probe[] = [
    { name: 'inside', scope: inside, expect: 'delivered' },
    {
      name: 'before_start',
      scope: { ...inside, window: day(shiftDate(item.validity.start, -1)) },
      expect: 'silent',
    },
  ]
  if (item.validity.end !== null)
    probes.push({
      name: 'on_end_day',
      scope: { ...inside, window: day(item.validity.end) },
      expect: 'silent',
    })
  for (const dimension of valueDimensions) {
    const own = new Set(
      item.scope.dimensionValues.filter((r) => r.dimension === dimension).map((r) => r.value),
    )
    const other = terms
      .filter((t) => t.kind === 'dimension_value' && t.parentKey === dimension && !own.has(t.key))
      .map((t) => t.key)
      .sort(compareIds)[0]
    if (other)
      probes.push({
        name: `other_value:${dimension}`,
        scope: { ...inside, filters: { ...filters, [dimension]: [other] } },
        expect: 'silent',
      })
  }
  if (valueDimensions.length)
    probes.push({ name: 'all_values', scope: { ...inside, filters: named }, expect: 'delivered' })
  for (const dimension of anyValue) {
    const { [dimension]: _left, ...rest } = filters
    probes.push({
      name: `without_dimension:${dimension}`,
      scope: { ...inside, filters: rest },
      expect: 'silent',
    })
  }
  if (item.scope.metrics.length) {
    const other = terms
      .filter((t) => t.kind === 'metric' && !covered.has(t.key))
      .map((t) => t.key)
      .sort(compareIds)[0]
    if (other)
      probes.push({
        name: 'other_metric',
        scope: { ...inside, metrics: [other] },
        expect: 'silent',
      })
  }
  return probes
}

/**
 * Runs the probes through the resolver. Stop switches are serving decisions, not matching, so
 * nothing is stopped here; review-date and freshness rules still apply.
 */
export function matchingCheck(
  bundle: EditionBundle,
  itemId: string,
  terms: readonly Term[],
  today: string,
): { passed: boolean; probes: ProbeResult[] } {
  const item = bundle.items.find((i) => i.id === itemId)
  if (!item) return { passed: false, probes: [] }
  const matching: EditionBundle = { ...bundle, stopped: { all: false, areas: [], items: [] } }
  const probes = matchingProbes(item, bundle, terms).map((probe): ProbeResult => {
    const result = resolve(matching, {
      scope: { status: 'resolved', scope: probe.scope },
      today,
      sizeLimit: Number.MAX_SAFE_INTEGER,
      dependenciesAvailable: true,
      groups: noGroups,
      hiddenMetrics: [],
    })
    const hit = result.items.find((m) => m.id === itemId)
    const withheld = result.withheld.find((w) => w.id === itemId)?.reason
    const actual = hit ? 'delivered' : 'silent'
    return {
      ...probe,
      actual,
      ...(hit ? { match: hit.match } : {}),
      ...(withheld ? { withheld } : {}),
      passed:
        actual === probe.expect &&
        (probe.name !== 'all_values' || hit?.match === 'partial') &&
        (probe.name !== 'inside' || hit?.match === 'exact'),
    }
  })
  return { passed: probes.every((p) => p.passed), probes }
}

/** A proposed vocabulary term version (FR-125). */
export type VocabularyChange = {
  key: string
  kind: Term['kind']
  parentKey: string | null
  name: string
  aliases: string[]
  areaId: string | null
  /** The source members it names: one at most, or for a dimension one per view (CON-208). */
  definitionRefs: string[]
}
/**
 * The term a vocabulary proposal holds, as its draft stored it. A proposal made before a term could
 * name several definitions stored one, as `definitionRef`.
 */
export function vocabularyChangeOf<T extends object>(
  draft: T,
): Omit<T, 'definitionRef'> & VocabularyChange {
  const { definitionRef, definitionRefs, ...rest } = draft as T & {
    definitionRef?: string | null
    definitionRefs?: string[]
  }
  return {
    ...rest,
    definitionRefs: definitionRefs ?? (definitionRef ? [definitionRef] : []),
  } as Omit<T, 'definitionRef'> & VocabularyChange
}

/** The review due time: `days` working days (Monday to Friday, UTC) after `from` (FR-212). */
export function addWorkingDays(from: string, days: number): string {
  const due = new Date(from)
  if (!Number.isFinite(due.getTime()) || !Number.isSafeInteger(days) || days < 0)
    throw new Error('Expected an instant and a whole number of days')
  for (let counted = 0; counted < days;) {
    due.setUTCDate(due.getUTCDate() + 1)
    if (![0, 6].includes(due.getUTCDay())) counted++
  }
  return due.toISOString()
}

/**
 * The answer tests on the questions a change could affect, when none got worse: "2 test questions
 * could change. None got worse." Questions that were already failing, or went from failing to
 * passing, are named plainly, since "still pass" would not be true of them.
 */
export function noneWorseWords(
  count: number,
  { alreadyFailing = 0, nowPassing = 0 }: { alreadyFailing?: number; nowPassing?: number } = {},
): string {
  const head =
    count === 1
      ? "1 test question could change. It didn't get worse."
      : `${count.toLocaleString('en')} test questions could change. None got worse.`
  const failing =
    alreadyFailing === 1
      ? ' 1 was already failing and still fails.'
      : alreadyFailing > 1
        ? ` ${alreadyFailing.toLocaleString('en')} were already failing and still fail.`
        : ''
  const fixed =
    nowPassing === 1
      ? ' 1 went from failing to passing.'
      : nowPassing > 1
        ? ` ${nowPassing.toLocaleString('en')} went from failing to passing.`
        : ''
  return head + failing + fixed
}

/** What a test attached to a proposal says about its change (FR-524). */
export type TestChange = 'fixed' | 'still_fails' | 'still_passes' | 'broken'
export const testChangeWords: Record<TestChange, string> = {
  fixed: 'passes with this change',
  still_fails: 'still fails',
  still_passes: 'still passes',
  broken: 'fails with this change',
}

/**
 * An attached test's change, from whether it passes without and with the change; null when either
 * side is unknown. It is reported only: it never decides a check (FR-524, FR-514).
 */
export function testChange(before: boolean | null, after: boolean | null): TestChange | null {
  if (before === null || after === null) return null
  if (after) return before ? 'still_passes' : 'fixed'
  return before ? 'broken' : 'still_fails'
}
