import { SHOWN } from '@/model/observability'
import type { DomainId } from '@/model/items'

// Overview's filters as the address keeps them: a chip is a field or a dimension, how it matches
// (is, is any of, is not) and its values, in the order they were put in. A dimension's chip keeps
// keys, never names: `d.store=alder_row,birch_quay` is Store is any of two values, `!` leaves them
// out and `*` is any value. Apart from the rest of the filters (lib/obs-views.ts), as every page of
// Observability reads its domain and kind of agent from here, and the app's first load carries it.

/**
 * The fixed fields a chip can filter on, in the order the facets list them. `market` is the old
 * "Value" field: a value's name in any dimension. It is still read from an old link or saved view,
 * and is no longer offered: a dimension's chip takes its place.
 */
export const FIELD_KEYS = [
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
/** The fields before dimensions, under their old name: every key a chip of a field can have. */
export const FILTER_KEYS = FIELD_KEYS
export type FieldKey = (typeof FIELD_KEYS)[number]
/** A dimension, by its key in the definitions: `dim:store`. */
export type DimKey = `dim:${string}`
export type FilterKey = FieldKey | DimKey

/** One filter that is on: "Store is not Alder Row". `not` leaves its values out. */
export type Chip = { key: FilterKey; not?: boolean; values: string[] }
export type Filters = Chip[]

/** Any value of a dimension: a topic that names it at all, with a value or "by" it. */
export const ANY = '*'

/** Whether a key is a dimension's. */
export const isDim = (key: string): key is DimKey => key.startsWith('dim:')

export const FILTER_WORDS: Record<FieldKey, string> = {
  answer: 'Answer',
  domain: 'Domain',
  agent: 'Agent kind',
  market: 'Value',
  metric: 'Metric',
  month: 'Month asked about',
  gap: 'In the Inbox',
  reported: 'Reported',
  topic: 'Topic',
}

/** The address keeps each field in its own param; a topic's words are the search, `q`. */
const PARAM: Record<FieldKey, string> = {
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
/** A dimension's own words in a key, and a value's: `store`, `alder_row`. */
const ID = /^[a-z0-9_]{1,80}$/
/** Most chips the filters keep, most values a chip keeps, and how long one may be. */
export const MAX_CHIPS = 20
const MAX_VALUES = 50
const MAX_VALUE = 200

/** The param a dimension's chip has: `d.store` for `dim:store`. */
const dimParam = (key: DimKey) => `d.${key.slice(4)}`
/** Where a chip sits in `chips`: a field by its key, a dimension by its param. */
const placeOf = (key: FilterKey) => (isDim(key) ? dimParam(key) : key)
/** A value's key, from its own words in the address: `alder_row` of `dim:store`. */
const valueKey = (dim: DimKey, id: string) => (id === ANY ? ANY : `val:${dim.slice(4)}/${id}`)
/** A value's own words, as the address writes them. */
const valueId = (v: string) => (v === ANY ? ANY : v.slice(v.indexOf('/') + 1))

/** What a field may hold, from the address: unknown answer states and months are dropped. */
function allowed(key: FieldKey, v: string) {
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

/** A param's "!" for is not, and its values. */
function split(raw: string) {
  const not = raw.startsWith('!')
  return { not, values: (not ? raw.slice(1) : raw).split(',').map(decode) }
}

/**
 * The chips in the address, in their order: each field in its own param ("answer=missing,partial",
 * "market=!Norway" for is not), each dimension in its own ("d.store=alder_row", "d.channel=*"), and
 * `chips` when they are in another order than the fields' then the dimensions'. The old
 * "answer=found" is every answer that found something; the old "market=Norway" is read as it was,
 * a value's name in any dimension, until the page finds the one value it names (lib/obs-views.ts).
 */
export function chipsFrom(q: URLSearchParams): Filters {
  const chips: Filters = []
  for (const key of FIELD_KEYS) {
    const raw = q.get(PARAM[key])
    if (!raw) continue
    let { not, values } = split(raw)
    if (key === 'answer' && values.join() === 'found') values = SHOWN.filter((s) => s !== 'missing')
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
  for (const [param, raw] of q) {
    const id = param.startsWith('d.') ? param.slice(2) : ''
    if (!ID.test(id) || !raw) continue
    const key: DimKey = `dim:${id}`
    if (chipOf(chips, key)) continue
    const { not, values: ids } = split(raw)
    const ok = [...new Set(ids.filter((v) => v === ANY || ID.test(v)))]
    // Any value takes the place of the values beside it.
    const values = (ok.includes(ANY) ? [ANY] : ok.slice(0, MAX_VALUES)).map((v) => valueKey(key, v))
    if (values.length) chips.push({ key, ...(not ? { not } : {}), values })
  }
  const order = (q.get('chips') ?? '').split(',')
  const canonical = canonicalOf(chips.map((c) => placeOf(c.key)))
  const at = (k: FilterKey) => {
    const i = order.indexOf(placeOf(k))
    return i < 0 ? order.length + canonical.indexOf(placeOf(k)) : i
  }
  return chips.sort((a, b) => at(a.key) - at(b.key)).slice(0, MAX_CHIPS)
}

/**
 * The same chips, back into the address: a field that is off clears its param, and so does a
 * dimension's chip taken off, for every `d.` param in `from`, the address now.
 */
export function chipsTo(
  chips: Filters,
  from?: URLSearchParams,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [param] of from ?? []) if (param.startsWith('d.')) out[param] = undefined
  for (const key of FIELD_KEYS) {
    const c = chipOf(chips, key)
    out[PARAM[key]] = c?.values.length
      ? `${c.not ? '!' : ''}${c.values.map(encode).join(',')}`
      : undefined
  }
  for (const c of chips)
    if (isDim(c.key) && c.values.length)
      out[dimParam(c.key)] = `${c.not ? '!' : ''}${c.values.map(valueId).join(',')}`
  const places = chips.map((c) => placeOf(c.key))
  out.chips = places.join(',') === canonicalOf(places).join(',') ? undefined : places.join(',')
  return out
}

/** The order chips have with no `chips` param: the fields in their own order, then the dimensions A to Z. */
const canonicalOf = (places: string[]) => [
  ...FIELD_KEYS.filter((k) => places.includes(k)),
  ...places.filter((p) => p.startsWith('d.')).sort(),
]
