import {
  dateLabel,
  monthName,
  STATE_WORDS,
  type Bar,
  type Count,
  type Observability,
  type Shown,
  type Topic,
  type TopicGroup,
} from '@/model/observability'
import type { Domains } from '@/model/people'
import type { ObsFilter } from '@domain/obs-filters'
import { matches } from '@/lib/list'
import {
  ANY,
  chipOf,
  FILTER_WORDS,
  GAP_WORDS,
  isDim,
  MAX_CHIPS,
  readDomain,
  REPORTED_WORDS,
  type Chip,
  type DimKey,
  type FieldKey,
  type FilterKey,
  type Filters,
  type Gap,
} from '@/lib/obs-chips'
import { nameOf } from '@/lib/obs-names'

export * from '@/lib/obs-chips'

// Overview's filters and saved views. A filter is a chip: a field, how it matches (is, is any of,
// is not) and its values, in the order they were added. A view belongs to the workspace, as
// LangSmith's do: saved once, everyone with access sees it beside the others. Six come with it;
// more are saved from the filters and kept by the workspace (src/web/api).

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

/** Whether a topic was answered so, as far as a reader can see. */
const answered = (t: Topic, s: string) =>
  t.in.answers.includes(s as Shown) || (s === 'missing' && t.in.notFound)

/** The one value a topic has for a field, as the address writes it; none for a field it lacks. */
export function valueOf(t: Topic, key: FieldKey): string | undefined {
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

/** Whether a topic names a dimension at all: one of its values, or the dimension with none. */
export const namesDimension = (t: Topic, key: DimKey) =>
  t.values.some((v) => v.dimension === key) || t.dimensions.some((d) => d.dimension === key)

/**
 * Whether a topic has one of the values: an answer state as far as it shows, a value of a
 * dimension by its key or any value of it, or its own value of a field.
 */
export const hasValue = (t: Topic, key: FilterKey, v: string) =>
  isDim(key)
    ? v === ANY
      ? namesDimension(t, key)
      : t.values.some((x) => x.value === v)
    : key === 'answer'
      ? answered(t, v)
      : valueOf(t, key) === v

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

/**
 * Whether the topics are narrowed to fewer than the view's own: by a view or a chip. The domain the
 * service reads and the kind of agent narrow the read itself, so they don't count.
 */
export const narrowed = (chips: Filters, view: string) =>
  view !== 'all' ||
  chips.some((c) => c.key !== 'agent' && !(c.key === 'domain' && readDomain(chips)))

/** A field's name, or a dimension's, as the bar says it. */
export const keyWords = (key: FilterKey) => (isDim(key) ? nameOf(key) : FILTER_WORDS[key])

/** Whether a chip is a dimension's any value: "Store has any value", "Store has no value". */
export const anyValue = (c: Chip) => isDim(c.key) && c.values[0] === ANY

/**
 * How a chip matches, in words: "is", "is any of", "is not", "is none of"; "has" for a topic's
 * words and a dimension's any value, "has no" for none of it.
 */
export function opWords(c: Chip) {
  if (c.key === 'topic') return 'has'
  if (anyValue(c)) return c.not ? 'has no' : 'has'
  if (c.not) return c.values.length > 1 ? 'is none of' : 'is not'
  return c.values.length > 1 ? 'is any of' : 'is'
}

/** A chip's values in words: their names, or "any value" and "value" after "has no". */
export const chipValueWords = (c: Chip, words: (key: FilterKey, v: string) => string) =>
  anyValue(c) ? (c.not ? 'value' : 'any value') : c.values.map((v) => words(c.key, v))

/** A value as people read it. */
export function valueWords(key: FilterKey, v: string, domains: Domains) {
  if (isDim(key)) return v === ANY ? 'Any value' : nameOf(v)
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

/** A chip read as a sentence: "Answer is any of Not found, Partial", "Store has any value". */
export function chipSentence(c: Chip, domains: Domains) {
  const values = chipValueWords(c, (k, v) => valueWords(k, v, domains))
  const said = typeof values === 'string' ? values : values.join(c.key === 'topic' ? ' and ' : ', ')
  return `${keyWords(c.key)} ${opWords(c)} ${said}`
}

/** The chips read back as sentences, the way Context and Definitions say theirs. */
export const sentence = (chips: Filters, domains: Domains) =>
  chips.map((c) => chipSentence(c, domains))

/* ---------- changing the chips ---------- */

/**
 * The chips with one field's values set: none takes the chip off; a new chip goes last, unless
 * the filters hold as many chips as they keep already.
 */
export function withValues(chips: Filters, key: FilterKey, values: string[], not?: boolean) {
  const at = chips.findIndex((c) => c.key === key)
  if (!values.length) return chips.filter((c) => c.key !== key)
  const was = chips[at]
  const chip: Chip = { key, values, ...((not ?? was?.not) ? { not: true } : {}) }
  if (at < 0) return chips.length < MAX_CHIPS ? [...chips, chip] : chips
  return chips.map((c, i) => (i === at ? chip : c))
}

/**
 * One value on or off in a field's chip, keeping how it matches. A dimension's any value takes
 * the place of its values, and a value the place of any value.
 */
export function toggled(chips: Filters, key: FilterKey, v: string) {
  const c = chipOf(chips, key)
  let values = c?.values ?? []
  if (isDim(key))
    values = v === ANY ? values.filter((x) => x === ANY) : values.filter((x) => x !== ANY)
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

/* ---------- the filters as the service takes them ---------- */

/** The built-in views that are one field's filter, as the service takes them. */
const VIEW_FILTERS: Record<string, ObsFilter> = {
  disagree: { key: 'answer', values: ['conflict'] },
  stale: { key: 'answer', values: ['stale'] },
  reported: { key: 'reported', values: ['yes'] },
}

/**
 * The chips and the view as the service's filters take them, for its counts of dimensions and
 * values, and in words what it cannot take (`left`): a topic's words, an old Value chip, and a
 * view that is not one field's filter. A metric's name becomes its keys, from the topics that have
 * it. The domain the service reads and the kind of agent are its view already.
 */
export function wireFilters(
  chips: Filters,
  view: { id: string; name: string },
  topics: readonly Topic[],
  domains: Domains,
): { filters: ObsFilter[]; left: string[] } {
  const filters: ObsFilter[] = []
  const left: string[] = []
  const domain = readDomain(chips)
  for (const c of chips) {
    if (c.key === 'agent' || (c.key === 'domain' && domain)) continue
    if (c.key === 'topic' || c.key === 'market') {
      left.push(chipSentence(c, domains))
      continue
    }
    if (c.key === 'metric') {
      const keys = [
        ...new Set(topics.filter((t) => c.values.includes(t.metric)).flatMap((t) => t.metrics)),
      ]
      if (keys.length)
        filters.push({ key: 'metric', ...(c.not ? { not: true } : {}), values: keys })
      else if (!c.not) left.push(chipSentence(c, domains))
      continue
    }
    filters.push({ key: c.key, ...(c.not ? { not: true } : {}), values: c.values })
  }
  const own = VIEW_FILTERS[view.id]
  if (own && !filters.some((f) => f.key === own.key)) filters.push(own)
  else if (view.id !== 'all' && !chipsView(view.id)) left.push(`the view ${view.name}`)
  return { filters, left }
}

/** Whether a view is one of the workspace's saved ones: its chips are in the address already. */
const chipsView = (id: string) => !BUILT_IN.some((v) => v.id === id)

/**
 * An old Value chip ("market=Norway", by name) as a dimension's chip, when each of its names is
 * one value, all of one dimension, among the topics: by their keys. Otherwise it stays as it was,
 * and `why` says why: a name that two values share is never merged into one of them.
 */
export function fromLegacy(
  chips: Filters,
  topics: readonly Topic[],
): { chips: Filters; why?: string } {
  const c = chipOf(chips, 'market')
  if (!c) return { chips }
  const keysOf = (name: string) => [
    ...new Map(
      topics
        .flatMap((t) => t.values)
        .filter((v) => v.name === name)
        .map((v) => [v.value, v]),
    ).values(),
  ]
  const found = c.values.map((name) => ({ name, keys: keysOf(name) }))
  const shared = found.find((f) => f.keys.length > 1)
  if (shared) {
    const dims = [...new Set(shared.keys.map((k) => k.dimension))].map(nameOf)
    return {
      chips,
      why:
        dims.length > 1
          ? `${shared.name} is a value of ${dims.length} dimensions: ${dims.join(', ')}. Choose one in the filter.`
          : `${shared.name} names ${shared.keys.length} values of ${dims[0]}. Choose one in the filter.`,
    }
  }
  const missing = found.find((f) => !f.keys.length)
  if (missing) return { chips, why: `No topic in this range asked about ${missing.name}.` }
  const dims = new Set(found.map((f) => f.keys[0]!.dimension))
  if (dims.size > 1)
    return { chips, why: 'Its values are of different dimensions. Choose each in the filter.' }
  const key = [...dims][0] as DimKey
  if (!isDim(key) || chipOf(chips, key))
    return { chips, why: `${nameOf(key)} is filtered already. Choose its values there.` }
  const chip: Chip = {
    key,
    ...(c.not ? { not: true } : {}),
    values: found.map((f) => f.keys[0]!.value),
  }
  return { chips: chips.map((x) => (x === c ? chip : x)) }
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

/* ---------- the days chosen on the chart ---------- */

/** The bars chosen on the chart, the first and the last, by their place. */
export type Span = { from: number; to: number }

const DAY = 86_400_000
/** A day as the address writes it: "2026-10-12". */
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)
/** A bar's last day: the day before the next one starts, or the last day counted. */
const endOf = (bars: readonly Bar[], last: number, i: number) =>
  i + 1 < bars.length ? bars[i + 1]!.at - DAY : last

/**
 * The bars the address chooses ("days=2026-10-12..2026-10-18", or one day): every bar one of its
 * days falls in, so over 90 days it is whole weeks. Days the range no longer has are left out, and
 * none left is no choice.
 */
export function spanFrom(q: URLSearchParams, bars: readonly Bar[], last: number): Span | null {
  const [a, b = a] = (q.get('days') ?? '').split('..')
  const from = Date.parse(a ?? '')
  const to = Date.parse(b ?? '')
  if (!bars.length || Number.isNaN(from) || Number.isNaN(to)) return null
  const lo = Math.max(Math.min(from, to), bars[0]!.at)
  const hi = Math.min(Math.max(from, to), last)
  if (lo > hi) return null
  const at = (t: number) => bars.findLastIndex((x) => x.at <= t)
  return { from: at(lo), to: at(hi) }
}

/** The bars chosen, as the address keeps their days. */
export function spanTo(span: Span | null, bars: readonly Bar[], last: number) {
  if (!span || !bars[span.from] || !bars[span.to]) return undefined
  const a = dayOf(bars[span.from]!.at)
  const b = dayOf(endOf(bars, last, span.to))
  return a === b ? a : `${a}..${b}`
}

/** The days of the bars chosen, in words: "12 Oct", "12 to 18 Oct", "28 Sep to 4 Oct". */
export function spanWords(span: Span, bars: readonly Bar[], last: number) {
  const a = bars[span.from]?.at ?? last
  const b = endOf(bars, last, span.to)
  if (dayOf(a) === dayOf(b)) return dateLabel(a)
  const same = new Date(a).getUTCMonth() === new Date(b).getUTCMonth()
  return `${same ? new Date(a).getUTCDate() : dateLabel(a)} to ${dateLabel(b)}`
}
