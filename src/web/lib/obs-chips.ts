import { SHOWN } from '@/model/observability'
import type { DomainId } from '@/model/items'

// Overview's filters as the address keeps them: a chip is a field, how it matches (is, is any of,
// is not) and its values, in the order they were put in. Apart from the rest of the filters
// (lib/obs-views.ts), as every page of Observability reads its domain and kind of agent from here,
// and the app's first load carries it.

/** The fields a chip can filter on, in the order the type-ahead and the facets list them. */
export const FILTER_KEYS = [
  'answer',
  'domain',
  'agent',
  'market',
  'metric',
  'month',
  'gap',
  'reported',
  'topic',
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

/** One filter that is on: "Market is not Norway". `not` leaves its values out. */
export type Chip = { key: FilterKey; not?: boolean; values: string[] }
export type Filters = Chip[]

export const FILTER_WORDS: Record<FilterKey, string> = {
  answer: 'Answer',
  domain: 'Domain',
  agent: 'Agent kind',
  market: 'Market',
  metric: 'Metric',
  month: 'Month asked about',
  gap: 'In the Inbox',
  reported: 'Reported',
  topic: 'Topic',
}

/** The address keeps each field in its own param; a topic's words are the search, `q`. */
const PARAM: Record<FilterKey, string> = {
  answer: 'answer',
  domain: 'domain',
  agent: 'agent',
  market: 'market',
  metric: 'metric',
  month: 'month',
  gap: 'gap',
  reported: 'reported',
  topic: 'q',
}

export type Gap = 'draft' | 'suggestion' | 'none'
export const GAP_WORDS: Record<Gap, string> = {
  draft: 'Draft ready',
  suggestion: 'A suggestion waits',
  none: 'No draft yet',
}
export const REPORTED_WORDS = { yes: 'Yes', no: 'No' } as const

/** The chip on a field, if one is on. */
export const chipOf = (chips: Filters, key: FilterKey) => chips.find((c) => c.key === key)

/** The domain the service reads, when the domain chip is one domain as it is. */
export function readDomain(chips: Filters) {
  const c = chipOf(chips, 'domain')
  return c && !c.not && c.values.length === 1 ? (c.values[0] as DomainId) : undefined
}

/* ---------- the address ---------- */

const MONTH = /^\d{4}-\d{2}$/
/** Most values a chip keeps, and how long one may be. */
const MAX_VALUES = 50
const MAX_VALUE = 200

/** What a field may hold, from the address: unknown answer states and months are dropped. */
function allowed(key: FilterKey, v: string) {
  if (!v || v.length > MAX_VALUE) return false
  if (key === 'answer') return (SHOWN as string[]).includes(v)
  if (key === 'gap') return v in GAP_WORDS
  if (key === 'reported') return v in REPORTED_WORDS
  if (key === 'month') return MONTH.test(v)
  return true
}

/** A value in a param: a comma or a leading "!" in it is escaped, so the list splits safely. */
const encode = (v: string) => v.replace(/%/g, '%25').replace(/,/g, '%2C').replace(/^!/, '%21')
function decode(v: string) {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/**
 * The chips in the address, in their order: each field in its own param ("answer=missing,partial",
 * "market=!Norway" for is not), and `chips` when they are in another order than the fields'. The
 * old "answer=found" is every answer that found something.
 */
export function chipsFrom(q: URLSearchParams): Filters {
  const chips: Filters = []
  for (const key of FILTER_KEYS) {
    const raw = q.get(PARAM[key])
    if (!raw) continue
    let not = raw.startsWith('!')
    const body = not ? raw.slice(1) : raw
    let values =
      key === 'answer' && body === 'found'
        ? SHOWN.filter((s) => s !== 'missing')
        : body.split(',').map(decode)
    values = [...new Set(values.filter((v) => allowed(key, v)))].slice(0, MAX_VALUES)
    // A topic's words are searched for; a kind of agent is one, as the service counts one kind
    // against all of them.
    if (key === 'topic') not = false
    if (key === 'agent') {
      if (not) continue
      values = values.slice(0, 1)
    }
    if (values.length) chips.push({ key, ...(not ? { not } : {}), values })
  }
  const order = (q.get('chips') ?? '').split(',')
  const at = (k: FilterKey) => {
    const i = order.indexOf(k)
    return i < 0 ? order.length + FILTER_KEYS.indexOf(k) : i
  }
  return chips.sort((a, b) => at(a.key) - at(b.key))
}

/** The same chips, back into the address: a field that is off clears its param. */
export function chipsTo(chips: Filters): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const key of FILTER_KEYS) {
    const c = chipOf(chips, key)
    out[PARAM[key]] = c?.values.length
      ? `${c.not ? '!' : ''}${c.values.map(encode).join(',')}`
      : undefined
  }
  const keys = chips.map((c) => c.key)
  const canonical = FILTER_KEYS.filter((k) => keys.includes(k))
  out.chips = keys.join(',') === canonical.join(',') ? undefined : keys.join(',')
  return out
}
