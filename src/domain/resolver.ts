import {
  type Audience,
  audienceAllows,
  type CheckFlag,
  type RiskLevel,
  type Scope,
} from './item.ts'
import type { DateWindow } from './validity.ts'
import { overlaps, calendarDateSchema, dateWindowSchema } from './validity.ts'
import type { ScopeResult, ResolvedScope } from './scope.ts'

export type ResolverItem = {
  id: string
  version: number
  areaId: string
  scope: Scope
  validity: DateWindow
  reviewDate: string | null
  riskLevel: RiskLevel
  checkFlag: CheckFlag | null
  status: 'accepted' | 'retired' | 'proposal'
  audience: Audience
  summary: string
  body?: string
  conflicts: readonly string[]
  replacedBy?: string
  proposerId: string
}
export type EditionBundle = {
  edition: string
  overlay: string
  items: readonly ResolverItem[]
  groupsOfMetric: Readonly<Record<string, readonly string[]>>
  metricArea: Readonly<Record<string, string>>
  stopped: { all: boolean; areas: readonly string[]; items: readonly string[] }
}
export type ResolveRequest = {
  scope: ScopeResult
  today: string
  sizeLimit: number
  dependenciesAvailable: boolean
  // The reader's audience groups: `noGroups` while groups are parked. Hidden metrics stay parked
  // (C17/C26): first-version callers have none.
  groups: readonly string[]
  hiddenMetrics: readonly string[]
  preview?: {
    personId: string
    ownerAreas: readonly string[]
    administrator: boolean
    testRun: boolean
  }
}
export type Match = {
  id: string
  version: number
  match: 'exact' | 'partial'
  unverified: boolean
  checkFlag: CheckFlag | null
  restrictions: { dimension: string; values: string[] }[]
  startsAfterQuestion: boolean
}
export type Withheld = {
  id: string
  reason: 'audience' | 'source_visibility' | 'stopped' | 'high_risk_unverified'
}
export type Resolution = {
  edition: string
  overlay: string
  status: 'matched' | 'conflict' | 'no_match' | 'need_more_detail' | 'check_failed'
  items: Match[]
  withheld: Withheld[]
  cut: string[]
  replacements: { id: string; replacedBy: string }[]
  scope: ResolvedScope | null
  issues: Extract<ScopeResult, { status: 'need_more_detail' }>['issues']
  report: { matched: number; withheld: number; cut: boolean; checked: string[]; coverage: string }
  instructions: string
}
export const coverageStatement = 'No match does not prove that no caveat exists.'
/** Added to the instructions when a delivered item says what not to conclude (FR-104). */
export const caveatInstruction =
  'When an item has not_to_conclude, never conclude what it rules out.'
export const agentInstructions =
  'State the documented fact with its source and dates. Say "might be related" only for an event whose dates overlap and whose metric is in scope, and state that the context does not prove a cause. Never say "caused by" unless the claim level is effect_stated. Suggest a check that would test the effect. A link shows what text refers to; it proves neither cause nor applicability. Other guidance in the data tools still applies.'
const risk = { low: 0, normal: 1, high: 2 }
export const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
export function itemTextSize(item: ResolverItem): number {
  return [...item.summary].length + [...(item.body ?? '')].length
}

/** The metrics a scope key stands for: a metric itself, or every metric of a group. */
export function metricsOf(bundle: Pick<EditionBundle, 'groupsOfMetric'>, key: string): string[] {
  return key.startsWith('group:')
    ? Object.keys(bundle.groupsOfMetric).filter((metric) =>
        bundle.groupsOfMetric[metric]?.includes(key),
      )
    : [key]
}

export function resolve(bundle: EditionBundle, request: ResolveRequest): Resolution {
  const result: Resolution = {
    edition: bundle.edition,
    overlay: bundle.overlay,
    status: 'no_match',
    items: [],
    withheld: [],
    cut: [],
    replacements: [],
    scope: null,
    issues: [],
    report: { matched: 0, withheld: 0, cut: false, checked: [], coverage: coverageStatement },
    instructions: agentInstructions,
  }
  if (
    !request.dependenciesAvailable ||
    !Number.isSafeInteger(request.sizeLimit) ||
    request.sizeLimit < 0 ||
    !calendarDateSchema.safeParse(request.today).success ||
    new Set(bundle.items.map((item) => item.id)).size !== bundle.items.length
  ) {
    result.status = 'check_failed'
    return result
  }
  if (request.scope.status === 'need_more_detail') {
    result.status = 'need_more_detail'
    result.issues = request.scope.issues
    return result
  }
  const scope = request.scope.scope
  if (!dateWindowSchema.safeParse(scope.window).success || scope.window.end === null) {
    result.status = 'check_failed'
    return result
  }
  result.scope = scope
  // A metric group asked for stands for its metrics: their items and their domains.
  const asked = [...new Set(scope.metrics.flatMap((key) => [key, ...metricsOf(bundle, key)]))]
  result.report.checked = [
    'edition',
    'scope',
    'validity',
    'audience',
    'source_visibility',
    'stop_switch',
    'freshness',
  ]
  const keys = new Set(
    asked.flatMap((metric) => [metric, ...(bundle.groupsOfMetric[metric] ?? [])]),
  )
  const byMetric = new Map<string, ResolverItem[]>()
  const candidates = new Set<ResolverItem>()
  for (const item of bundle.items) {
    if (!item.scope.metrics.length) candidates.add(item)
    for (const metric of item.scope.metrics) {
      const rows = byMetric.get(metric) ?? []
      rows.push(item)
      byMetric.set(metric, rows)
    }
  }
  for (const metric of keys) for (const item of byMetric.get(metric) ?? []) candidates.add(item)
  const hits: { item: ResolverItem; match: Match }[] = []
  for (const item of candidates) {
    if (!overlaps(item.validity, scope.window)) continue
    const dimensions = new Map<string, string[]>()
    for (const row of item.scope.dimensionValues)
      dimensions.set(row.dimension, [...(dimensions.get(row.dimension) ?? []), row.value])
    const restrictions: Match['restrictions'] = []
    let matches = true
    for (const [dimension, values] of dimensions) {
      const asked = scope.filters[dimension]
      if (!asked?.length)
        restrictions.push({ dimension, values: [...new Set(values)].sort(compareIds) })
      else if (!values.some((value) => asked.includes(value))) matches = false
    }
    // A dimension with any value applies only when the question names that dimension (FR-316).
    if (!matches || !item.scope.dimensions.every((d) => Object.hasOwn(scope.filters, d))) continue
    if (item.status === 'proposal') {
      const preview = request.preview
      if (
        !preview ||
        !(
          preview.personId === item.proposerId ||
          preview.ownerAreas.includes(item.areaId) ||
          preview.administrator ||
          preview.testRun
        )
      )
        continue
    }
    if (!audienceAllows(item.audience, request.groups)) {
      result.withheld.push({ id: item.id, reason: 'audience' })
      continue
    }
    const expandedMetrics = item.scope.metrics.flatMap((metric) => metricsOf(bundle, metric))
    if (
      expandedMetrics.length &&
      expandedMetrics.every((metric) => request.hiddenMetrics.includes(metric))
    ) {
      result.withheld.push({ id: item.id, reason: 'source_visibility' })
      continue
    }
    if (item.status === 'retired') {
      if (
        item.replacedBy &&
        bundle.items.some(
          (replacement) =>
            replacement.id === item.replacedBy &&
            replacement.status === 'accepted' &&
            audienceAllows(replacement.audience, request.groups),
        )
      )
        result.replacements.push({ id: item.id, replacedBy: item.replacedBy })
      continue
    }
    let reason: Withheld['reason'] | undefined
    if (
      bundle.stopped.all ||
      bundle.stopped.areas.includes(item.areaId) ||
      bundle.stopped.items.includes(item.id)
    )
      reason = 'stopped'
    const unverified =
      item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < request.today)
    if (!reason && unverified && item.riskLevel === 'high') reason = 'high_risk_unverified'
    if (reason) {
      result.withheld.push({ id: item.id, reason })
      continue
    }
    hits.push({
      item,
      match: {
        id: item.id,
        version: item.version,
        match: restrictions.length ? 'partial' : 'exact',
        unverified,
        checkFlag: item.checkFlag,
        restrictions: restrictions.sort((a, b) => compareIds(a.dimension, b.dimension)),
        startsAfterQuestion: item.validity.start > scope.window.start,
      },
    })
  }
  hits.sort(
    (a, b) =>
      Number(a.match.match === 'partial') - Number(b.match.match === 'partial') ||
      risk[b.item.riskLevel] - risk[a.item.riskLevel] ||
      compareIds(b.item.validity.start, a.item.validity.start) ||
      compareIds(a.item.id, b.item.id),
  )
  result.report.matched = hits.length
  // Remove the lowest-ranked tail until the text fits; do not skip a higher-ranked large item.
  let size = hits.reduce((total, hit) => total + itemTextSize(hit.item), 0)
  while (size > request.sizeLimit && hits.length) {
    const removed = hits.pop()!
    size -= itemTextSize(removed.item)
    result.cut.push(removed.item.id)
  }
  result.items = hits.map((hit) => hit.match)
  const ids = new Set(result.items.map((item) => item.id))
  result.status = !hits.length
    ? 'no_match'
    : hits.some((hit) => hit.item.conflicts.some((id) => ids.has(id)))
      ? 'conflict'
      : 'matched'
  result.withheld.sort((a, b) => compareIds(a.id, b.id))
  result.replacements.sort((a, b) => compareIds(a.id, b.id))
  result.report.withheld = result.withheld.length
  result.report.cut = result.cut.length > 0
  return result
}
