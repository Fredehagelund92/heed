import {
  compareIds,
  metricsOf,
  resolve,
  type EditionBundle,
  type ResolveRequest,
  type Withheld,
} from './resolver.ts'
import type { ResolvedScope } from './scope.ts'
import { shiftDate } from './validity.ts'

/**
 * Why one item does or does not apply to a scope (FR-703). Every answer comes from the resolver
 * itself (FR-709): the full request first, then, for an item the scope did not reach, the same
 * request with all but one of its parts (metric, dates, dimensions and their values) set to what
 * the item covers. A part that still keeps the item out is a reason.
 */

export type ScopePart = 'metric' | 'dates' | 'dimension'
export type Applicability =
  | {
      applies: true
      match: 'exact' | 'partial'
      restrictions: { dimension: string; values: string[] }[]
      unverified: boolean
    }
  | {
      applies: false
      reason: 'not_in_edition' | 'not_accepted' | 'need_more_detail' | 'check_failed'
    }
  | { applies: false; reason: Withheld['reason'] | 'cut' }
  | { applies: false; reason: 'replaced'; replacedBy: string }
  | { applies: false; reason: 'retired' }
  | { applies: false; reason: 'scope'; parts: ScopePart[] }

/** The scope with one part kept as asked and the other two set to what the item covers. */
function only(
  part: ScopePart,
  asked: ResolvedScope,
  item: EditionBundle['items'][number],
  bundle: EditionBundle,
): ResolvedScope {
  const metric =
    item.scope.metrics.flatMap((key) => metricsOf(bundle, key)).sort(compareIds)[0] ??
    asked.metrics[0]
  const constrained = new Set(item.scope.dimensionValues.map((v) => v.dimension))
  return {
    metrics: part === 'metric' || metric === undefined ? asked.metrics : [metric],
    filters:
      part === 'dimension'
        ? asked.filters
        : Object.fromEntries([
            ...Object.entries(asked.filters).filter(([d]) => !constrained.has(d)),
            ...item.scope.dimensions
              .filter((d) => !Object.hasOwn(asked.filters, d))
              .map((d): [string, string[]] => [d, []]),
          ]),
    window:
      part === 'dates'
        ? asked.window
        : { start: item.validity.start, end: shiftDate(item.validity.start, 1) },
  }
}

export function explainApplicability(
  bundle: EditionBundle,
  request: ResolveRequest,
  itemId: string,
): Applicability {
  const item = bundle.items.find((i) => i.id === itemId)
  if (!item) return { applies: false, reason: 'not_in_edition' }
  if (item.status === 'proposal') return { applies: false, reason: 'not_accepted' }
  const result = resolve(bundle, request)
  if (result.status === 'need_more_detail' || result.status === 'check_failed')
    return { applies: false, reason: result.status }
  const hit = result.items.find((i) => i.id === itemId)
  if (hit)
    return {
      applies: true,
      match: hit.match,
      restrictions: hit.restrictions,
      unverified: hit.unverified,
    }
  const withheld = result.withheld.find((w) => w.id === itemId)
  if (withheld) return { applies: false, reason: withheld.reason }
  if (result.cut.includes(itemId)) return { applies: false, reason: 'cut' }
  const replaced = result.replacements.find((r) => r.id === itemId)
  if (replaced) return { applies: false, reason: 'replaced', replacedBy: replaced.replacedBy }
  if (item.status === 'retired') return { applies: false, reason: 'retired' }
  const asked = result.scope
  if (!asked) return { applies: false, reason: 'check_failed' }
  const alone = { ...bundle, items: [item] }
  const parts = (['metric', 'dates', 'dimension'] as const).filter(
    (part) =>
      !resolve(alone, {
        ...request,
        scope: { status: 'resolved', scope: only(part, asked, item, bundle) },
      }).items.length,
  )
  return { applies: false, reason: 'scope', parts }
}
