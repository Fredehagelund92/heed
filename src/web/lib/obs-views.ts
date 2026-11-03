import {
  monthName,
  SHOWN,
  STATE_WORDS,
  type Count,
  type Observability,
  type Shown,
  type Topic,
  type TopicGroup,
} from '@/model/observability'
import type { DomainId } from '@/model/items'
import type { Domains } from '@/model/people'
import { matches } from '@/lib/list'

// Overview's filters and saved views. A filter is a chip: a field, how it matches (is, is any of,
// is not) and its values, in the order they were added. A view belongs to the workspace, as
// LangSmith's do: saved once, everyone with access sees it beside the others. Six come with it;
// more are saved from the filters and kept by the workspace (src/web/api).

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
export type SavedView = {
  id: string
  name: string
  filters: Filters
  by?: string
  custom?: boolean
}

/**
 * The six every workspace starts with: what most often needs a look. A topic is in a view as the
 * binding says, from what a reader may see: a hidden count puts it in no view.
 */
export const BUILT_IN: (SavedView & { has: (t: Topic) => boolean })[] = [
  { id: 'all', name: 'All topics', filters: [], has: () => true },
  // Anything but a checked answer, or a report: the other five views together.
  {
    id: 'look',
    name: 'Needs a look',
    filters: [],
    has: (t) => t.in.notFound || t.in.reported || t.in.answers.some((s) => s !== 'grounded'),
  },
  { id: 'not-covered', name: 'Not found', filters: [], has: (t) => t.in.notFound },
  { id: 'disagree', name: 'Conflict', filters: [], has: (t) => t.in.answers.includes('conflict') },
  { id: 'stale', name: 'Outdated', filters: [], has: (t) => t.in.answers.includes('stale') },
  { id: 'reported', name: 'Reported', filters: [], has: (t) => t.in.reported },
]

/** A topic's gap, as In the Inbox reads it. */
export const gapOf = (t: Topic): Gap | undefined =>
  t.gap?.label === 'Draft ready'
    ? 'draft'
    : t.gap?.label === 'A suggestion waits'
      ? 'suggestion'
      : t.gap || t.in.notFound
        ? 'none'
        : undefined
export const GAP_WORDS: Record<Gap, string> = {
  draft: 'Draft ready',
  suggestion: 'A suggestion waits',
  none: 'No draft yet',
}
export const REPORTED_WORDS = { yes: 'Yes', no: 'No' } as const

/** Whether a topic was answered so, as far as a reader can see. */
const answered = (t: Topic, s: string) =>
  t.in.answers.includes(s as Shown) || (s === 'missing' && t.in.notFound)

/** The one value a topic has for a field, as the address writes it; none for a field it lacks. */
export function valueOf(t: Topic, key: FilterKey): string | undefined {
  switch (key) {
    case 'domain':
      return t.domain
    case 'market':
      return t.where
    case 'metric':
      return t.named === 'none' || !t.metric ? undefined : t.metric
    case 'month':
      return t.month
    case 'gap':
      return gapOf(t)
    case 'reported':
      return t.in.reported ? 'yes' : 'no'
    default:
      return undefined
  }
}

/** Whether a topic has one of the values: an answer state as far as it shows, or its own value. */
export const hasValue = (t: Topic, key: FilterKey, v: string) =>
  key === 'answer' ? answered(t, v) : valueOf(t, key) === v

/**
 * Whether a topic passes the chips, all but `skip` (a facet counts without its own filter). The
 * kind of agent narrows the read itself, so every topic here already passes it. `name` is how the
 * topic reads, for its words.
 */
export function passes(t: Topic, chips: Filters, name: (t: Topic) => string, skip?: FilterKey) {
  return chips.every((c) => {
    if (c.key === skip || c.key === 'agent') return true
    if (c.key === 'topic') return c.values.every((q) => matches(q, name(t)))
    const hit = c.values.some((v) => hasValue(t, c.key, v))
    return c.not ? !hit : hit
  })
}

/** The chip on a field, if one is on. */
export const chipOf = (chips: Filters, key: FilterKey) => chips.find((c) => c.key === key)

/** The domain the service reads, when the domain chip is one domain as it is. */
export function readDomain(chips: Filters) {
  const c = chipOf(chips, 'domain')
  return c && !c.not && c.values.length === 1 ? (c.values[0] as DomainId) : undefined
}

/**
 * Whether the topics are narrowed to fewer than the view's own: by a view or a chip. The domain the
 * service reads and the kind of agent narrow the read itself, so they don't count.
 */
export const narrowed = (chips: Filters, view: string) =>
  view !== 'all' ||
  chips.some((c) => c.key !== 'agent' && !(c.key === 'domain' && readDomain(chips)))

/** How a chip matches, in words: "is", "is any of", "is not", "is none of", "has". */
export function opWords(c: Chip) {
  if (c.key === 'topic') return 'has'
  if (c.not) return c.values.length > 1 ? 'is none of' : 'is not'
  return c.values.length > 1 ? 'is any of' : 'is'
}

/** A value as people read it. */
export function valueWords(key: FilterKey, v: string, domains: Domains) {
  switch (key) {
    case 'answer':
      return STATE_WORDS[v as Shown] ?? v
    case 'domain':
      return domains[v]?.name ?? v
    case 'month':
      return monthName(v)
    case 'gap':
      return GAP_WORDS[v as Gap] ?? v
    case 'reported':
      return REPORTED_WORDS[v as 'yes'] ?? v
    case 'topic':
      return `“${v}”`
    default:
      return v
  }
}

/** A chip read as a sentence: "Answer is any of Not found, Partial". */
export function chipSentence(c: Chip, domains: Domains) {
  const values = c.values.map((v) => valueWords(c.key, v, domains))
  return `${FILTER_WORDS[c.key]} ${opWords(c)} ${values.join(c.key === 'topic' ? ' and ' : ', ')}`
}

/** The chips read back as sentences, the way Context and Definitions say theirs. */
export const sentence = (chips: Filters, domains: Domains) =>
  chips.map((c) => chipSentence(c, domains))

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

/* ---------- changing the chips ---------- */

/** The chips with one field's values set: none takes the chip off; a new chip goes last. */
export function withValues(chips: Filters, key: FilterKey, values: string[], not?: boolean) {
  const at = chips.findIndex((c) => c.key === key)
  if (!values.length) return chips.filter((c) => c.key !== key)
  const was = chips[at]
  const chip: Chip = { key, values, ...((not ?? was?.not) ? { not: true } : {}) }
  if (at < 0) return [...chips, chip]
  return chips.map((c, i) => (i === at ? chip : c))
}

/** One value on or off in a field's chip, keeping how it matches. */
export function toggled(chips: Filters, key: FilterKey, v: string) {
  const c = chipOf(chips, key)
  const values = c?.values ?? []
  return withValues(chips, key, values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
}

/** A chip moved one place to the left (-1) or the right (1), or to an index. */
export function moved(chips: Filters, key: FilterKey, to: number) {
  const from = chips.findIndex((c) => c.key === key)
  if (from < 0) return chips
  const index = Math.max(0, Math.min(chips.length - 1, to))
  if (index === from) return chips
  const out = chips.filter((c) => c.key !== key)
  out.splice(index, 0, chips[from]!)
  return out
}

/* ---------- facets: each value with what it counts ---------- */

/** What a facet value counts: its topics and what they asked; `count` is null when not shown. */
export type FacetValue = {
  value: string
  topics: number
  count: Pick<TopicGroup, 'visible' | 'shown'> | null
}

/** A count as a facet says it: the number, "13+", "Fewer than 5", "-" for an answer state, or none. */
export function facetWords(count: FacetValue['count'], state?: boolean) {
  if (!count) return 'Not shown'
  if (count.visible !== null) return count.visible.toLocaleString('en-GB')
  if (count.shown > 0) return `${count.shown.toLocaleString('en-GB')}+`
  return state ? '-' : 'Fewer than 5'
}

/** A facet value's count read out: "3 topics, asked at least 88 times. Look at only these". */
export function facetSaid(f: FacetValue, state?: boolean) {
  const topics = f.topics ? `${f.topics} ${f.topics === 1 ? 'topic' : 'topics'}, ` : ''
  const c = f.count
  if (!c) return 'not shown: the service counts this for every topic only'
  const n = (x: number) => x.toLocaleString('en-GB')
  if (state)
    return `${topics}${
      c.visible !== null
        ? `${n(c.visible)} answered so`
        : c.shown > 0
          ? `at least ${n(c.shown)} answered so`
          : 'how many answered so is hidden'
    }`
  return `${topics}asked ${
    c.visible !== null
      ? `${n(c.visible)} times`
      : c.shown > 0
        ? `at least ${n(c.shown)} times`
        : 'fewer than 5 times'
  }`
}

/** How much a facet count weighs, for its bar and its order: what it shows. */
export const facetSize = (count: FacetValue['count']) =>
  count ? (count.visible ?? count.shown) : 0

export type FacetInput = {
  obs: Observability
  chips: Filters
  /** Whether a topic is in the view chosen. */
  inView: (t: Topic) => boolean
  /** Whether the view is every topic, so the service's own counts of the view apply. */
  all: boolean
  /** The values a field offers: the domains a reader may filter on, the kinds of agent. */
  values: (key: FilterKey) => string[]
}

/**
 * A field's values, each counted without the field's own chip, so the other values stay in sight
 * (Langfuse and Datadog count theirs so). A count is only ever what the binding disclosed, added up:
 * a topic's own total, a domain's or a subject's when all of it is in, the service's count of an
 * answer state when nothing else narrows, else the shown parts as "13+". The service keeps no
 * count of a kind of agent by topic, so those show only while nothing but the domain it reads
 * narrows the topics, and are not shown otherwise.
 */
export function facet(key: FilterKey, input: FacetInput): FacetValue[] {
  const { obs, chips, inView } = input
  const others = obs.data.topics.filter((t) => inView(t) && passes(t, chips, obs.topicName, key))
  // Nothing narrows the topics but the domain the service reads: its own counts are the view's.
  const whole =
    input.all &&
    chips.every(
      (c) => c.key === key || c.key === 'agent' || (c.key === 'domain' && !!readDomain(chips)),
    )
  if (key === 'agent') {
    const agents = new Map(obs.data.agents.map((a) => [a.name, a.count]))
    return input.values(key).map((value) => {
      const n = agents.get(value) ?? 0
      return {
        value,
        topics: 0,
        count: whole ? (n === null ? { visible: null, shown: 0 } : { visible: n, shown: n }) : null,
      }
    })
  }
  // An answer state counts its questions in every topic the other chips keep: a topic whose
  // counts are all hidden then makes the sum "13+", never a number short of it.
  const states = key === 'answer' ? obs.selection(others) : null
  return input.values(key).map((value) => {
    const hits = others.filter((t) => hasValue(t, key, value))
    if (states) {
      const s = value as Shown
      const head: Count = whole ? obs.data.numbers.counts[s] : null
      return {
        value,
        topics: hits.length,
        count: head !== null ? { visible: head, shown: head } : states.state(s),
      }
    }
    return { value, topics: hits.length, count: obs.selection(hits).asked }
  })
}
