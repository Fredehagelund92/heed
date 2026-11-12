/**
 * The answer engine: one deterministic function that answers what is asked on one edition bundle,
 * the way get_context answers an agent, with no model. Ask, Try it, the review's before and after,
 * the replay of a topic, Asked this week, the reach of a draft and the free check of a saved
 * question all read it, so a person sees what an agent gets.
 *
 * What is asked is the words of a question with what an agent may send beside them (get_context's
 * input), a typed scope with no words (Try it), or a scope already read (a topic's). The bundle is
 * the live edition, a past edition or the live edition with a draft in it (the service picks it).
 *
 * The answer runs in five steps, each timed: read the scope, look up what applies, say what was
 * left out and why, check the answer's state, and say it. `lookUp` gives the steps one by one, so
 * a caller can stream them; `answer` runs them all. Steps are timed with the `now` the caller
 * passes; without one they take no time, and the answer is the same for the same inputs.
 *
 * Pure: no clock, no input or output. The words of a question are read in memory only and are
 * never part of the answer (FR-602).
 */
import { visibleCount } from './gaps.ts'
import { ownCaveat } from './proposal-rules.ts'
import { audienceAllows, noGroups, type ItemKind } from './item.ts'
import {
  compareIds,
  metricsOf,
  resolve,
  type EditionBundle,
  type Match,
  type ResolverItem,
  type Resolution,
} from './resolver.ts'
import { answerStateOf } from './answer-state.ts'
import { askedGroups, askedMetrics, contextSaid, scopeWords, type Voice } from './say.ts'
import {
  assumedDate,
  extractScope,
  type AssumedDate,
  type DatesRead,
  type ResolvedScope,
  type ScopeIssue,
  type ScopeResult,
} from './scope.ts'
import { overlaps, shiftDate, type DateWindow } from './validity.ts'
import type { Term } from './vocabulary.ts'

/**
 * The six answer states (FR-349), in the order a state wins: an answer that could not run is Not
 * checked, one with nothing is Not found, then Conflict, Partial, Outdated and Checked. Their
 * words are in docs/design/copy.md; a draft's answer is never called Checked.
 */
export const answerStates = [
  'failed',
  'missing',
  'conflict',
  'partial',
  'stale',
  'grounded',
] as const
export type AnswerState = (typeof answerStates)[number]

/** How many items an answer gives, as get_context does by default (`max_items`). */
export const ANSWER_MAX_ITEMS = 20

/** An item of the bundle as the engine needs it: what the resolver reads, its kind and title. */
export type AnswerSource = ResolverItem & {
  kind: ItemKind
  title: string
  /** Where it comes from: each source's address and the line its owner copied from it. */
  evidence?: readonly { url: string; quote: string }[]
  /** What not to conclude from it (FR-104). */
  notToConclude?: string
}
/** An edition bundle with its vocabulary: the live edition, a past one, or one with a draft in it. */
export type AnswerBundle = Omit<EditionBundle, 'items'> & {
  items: readonly AnswerSource[]
  terms: readonly Term[]
}

/** A dimension and the values asked for, by name or key; no values names the dimension only. */
export type AskedFilter = { dimension: string; values: readonly string[] }
/**
 * What is asked: a question's words with the names an agent may send beside them, as get_context
 * reads them (an empty question is a typed scope, as Try it sends), or a scope already read.
 */
export type AnswerAsk =
  | {
      question: string
      metrics?: readonly string[]
      dimension_filters?: readonly AskedFilter[]
      /** Both days included, as in get_context. */
      window?: { from: string; to: string }
    }
  | { scope: ResolvedScope }

export type AnswerOptions = {
  /** The UTC day the answer is for: what "no dates" means, and when a check date has passed. */
  today: string
  /** How many items the answer gives at most; the rest are left out as `cut`. */
  maxItems?: number
  /** A clock in milliseconds, to time the steps; without it every step takes 0 ms. */
  now?: () => number
  /** Whose words `say` is in; the words of get_facts without it, the reply a draft's preview reads. */
  voice?: Voice
  /**
   * Answering a person in Ask, not an agent: the dates are read as people write them, and an item
   * for another group is neither named nor counted (FR-128, FR-614).
   */
  person?: boolean
}

/** An item the answer gives, in the order get_context gives it. */
export type AnswerItem = {
  id: string
  version: number
  areaId: string
  kind: ItemKind
  title: string
  summary: string
  validity: DateWindow
  /** `partial` when the item applies to only part of what was asked (FR-316). */
  match: Match['match']
  /** Its source changed or its check date passed: it may be out of date. */
  unverified: boolean
  unverifiedReason: 'needs_check' | 'source_missing' | 'past_review_date' | null
  /** The values the item applies to where the question asked for every value. */
  restrictions: Match['restrictions']
  /** The items given with it that it disagrees with. */
  conflictsWith: string[]
  /** The line its owner copied from its first source, which Where walks a sentence back to. */
  quote: string | null
  /** What not to conclude from it, when its writer said; null for the default "cause not proven". */
  notToConclude: string | null
}

/**
 * Why an item that is about what was asked did not reach the answer. The resolver's own reasons
 * (FR-314): about metrics the reader cannot see, paused, high risk and waiting for a check; then
 * `cut` past the item limit and `replaced` by another item. The near misses are about an asked
 * metric but not this question: other `dates`, other `values` of a dimension, or a `dimension`
 * the question did not name. An item for another group is never named, not even by its id: the
 * answer only counts it (`forAnotherGroup`).
 */
export const leftOutReasons = [
  'source_visibility',
  'stopped',
  'high_risk_unverified',
  'cut',
  'replaced',
  'dates',
  'values',
  'dimension',
] as const
export type LeftOutReason = (typeof leftOutReasons)[number]
export type LeftOut = {
  id: string
  reason: LeftOutReason
  kind: ItemKind
  title: string
  /** The item that replaces it, for `replaced`. */
  replacedBy: string | null
}
/** At most this many near misses are listed; `leftOutMore` counts the rest. */
export const NEAR_MISSES_SHOWN = 10

/** What an answer covers only in part: asked metrics and values no item covers in full. */
export type Uncovered = { metrics: string[]; values: string[] }

type Timed = { ms: number }
export type AnswerStep =
  | (Timed & {
      step: 'read_scope'
      scope: ResolvedScope | null
      dates: DatesRead | null
      assumed: AssumedDate | null
      issues: ScopeIssue[]
    })
  | (Timed & { step: 'looked_up'; status: Resolution['status']; items: AnswerItem[] })
  | (Timed & { step: 'left_out'; leftOut: LeftOut[]; more: number; forAnotherGroup: number })
  | (Timed & { step: 'checked'; state: AnswerState; uncovered: Uncovered })
  | (Timed & { step: 'said'; say: string; next: string | null })
export type AnswerStepName = AnswerStep['step']

export type Answer = {
  edition: string
  overlay: string
  /** The resolver's status, as get_context gives it. */
  status: Resolution['status']
  state: AnswerState
  scope: ResolvedScope | null
  dates: DatesRead | null
  assumed: AssumedDate | null
  issues: ScopeIssue[]
  items: AnswerItem[]
  leftOut: LeftOut[]
  /** Near misses past `NEAR_MISSES_SHOWN`, counted only. */
  leftOutMore: number
  /** Items that apply but are for another group: counted, never named. */
  forAnotherGroup: number
  uncovered: Uncovered
  /** What a person hears, and what an agent does next, as get_context says them (FR-344). */
  say: string
  next: string | null
  steps: AnswerStep[]
  /** The steps' time together. */
  ms: number
}

const ms = (value: number) => Math.round(value * 100) / 100

/** A question as get_context reads it: the names it was sent first, then the words for the rest. */
export function readAsk(
  ask: AnswerAsk,
  terms: readonly Term[],
  today: string,
  person = false,
): ScopeResult {
  if ('scope' in ask) return { status: 'resolved', scope: ask.scope }
  const filters: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  for (const filter of ask.dimension_filters ?? [])
    filters[filter.dimension] = [...(filters[filter.dimension] ?? []), ...filter.values]
  return extractScope(ask.question, terms, today, {
    ...(ask.metrics === undefined ? {} : { metrics: [...ask.metrics] }),
    ...(ask.dimension_filters === undefined ? {} : { filters }),
    ...(ask.window === undefined
      ? {}
      : { window: { start: ask.window.from, end: shiftDate(ask.window.to, 1) } }),
    ...(person ? { loose: true } : {}),
  })
}

/** What the resolver gives an agent for a read scope, with no audience groups, as get_context. */
function resolved(bundle: AnswerBundle, scope: ScopeResult, today: string): Resolution {
  return resolve(bundle, {
    scope,
    today,
    groups: noGroups,
    hiddenMetrics: [],
    sizeLimit: Number.MAX_SAFE_INTEGER,
    dependenciesAvailable: true,
  })
}

const unverifiedReason = (item: AnswerSource, today: string): AnswerItem['unverifiedReason'] =>
  item.checkFlag ??
  (item.reviewDate !== null && item.reviewDate < today ? 'past_review_date' : null)

/**
 * An item as an answer gives it, from how the resolver matched it, with the items given beside it
 * that it disagrees with (`given`), the line its owner copied and what not to conclude. An item
 * read without the resolver (found by words, or named by id) is an exact match, out of date when
 * its source changed or its check date passed.
 */
export function answerItemOf(
  item: AnswerSource,
  match: Pick<Match, 'match' | 'unverified' | 'restrictions'> | null,
  given: ReadonlySet<string>,
  today: string,
): AnswerItem {
  const reason = unverifiedReason(item, today)
  const unverified = match ? match.unverified : reason !== null
  return {
    id: item.id,
    version: item.version,
    areaId: item.areaId,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    validity: item.validity,
    match: match?.match ?? 'exact',
    unverified,
    unverifiedReason: unverified ? reason : null,
    restrictions: match?.restrictions ?? [],
    conflictsWith: item.conflicts.filter((id) => given.has(id)).sort(compareIds),
    quote: item.evidence?.find((e) => e.quote.trim())?.quote ?? null,
    notToConclude: ownCaveat(item.notToConclude),
  }
}

/** The metric keys an item is about, with a group opened into its metrics. */
const itemMetrics = (bundle: Pick<EditionBundle, 'groupsOfMetric'>, item: ResolverItem) =>
  new Set(item.scope.metrics.flatMap((key) => metricsOf(bundle, key)))

/**
 * The asked parts no item covers in full: each metric asked (a group opened into its metrics),
 * and each value asked for a dimension. An item covers a metric when it is about no metric or
 * about that one, and a value when it names no value of that dimension or names that one. An item
 * that applies to only part of what was asked (`partial`) covers nothing in full.
 */
export function uncoveredParts(
  bundle: Parameters<typeof askedMetrics>[0],
  scope: ResolvedScope,
  given: readonly { item: ResolverItem; match: Match['match'] }[],
): Uncovered {
  const full = given.filter((g) => g.match === 'exact').map((g) => g.item)
  const metrics = askedMetrics(bundle, scope).filter(
    (metric) =>
      !full.some(
        (item) => item.scope.metrics.length === 0 || itemMetrics(bundle, item).has(metric),
      ),
  )
  const values = Object.entries(scope.filters)
    .flatMap(([dimension, asked]) =>
      asked.filter(
        (value) =>
          !full.some((item) => {
            const own = item.scope.dimensionValues.filter((row) => row.dimension === dimension)
            return own.length === 0 || own.some((row) => row.value === value)
          }),
      ),
    )
    .sort(compareIds)
  return { metrics, values }
}

/**
 * The items about an asked metric that did not apply to this question, and why: their dates,
 * a value of a dimension, or a dimension the question did not name. Items about no metric apply
 * to every question about their values and dates, so they are not listed, and neither is an item
 * for another group. The latest first.
 */
function nearMisses(
  bundle: AnswerBundle,
  scope: ResolvedScope,
  seen: ReadonlySet<string>,
): { item: AnswerSource; reason: 'dates' | 'values' | 'dimension' }[] {
  if (!scope.metrics.length) return []
  const asked = new Set(scope.metrics.flatMap((key) => [key, ...metricsOf(bundle, key)]))
  const keys = new Set([...asked].flatMap((key) => [key, ...(bundle.groupsOfMetric[key] ?? [])]))
  return bundle.items
    .filter(
      (item) =>
        item.status === 'accepted' &&
        audienceAllows(item.audience, noGroups) &&
        !seen.has(item.id) &&
        item.scope.metrics.some((metric) => keys.has(metric)),
    )
    .flatMap((item): { item: AnswerSource; reason: 'dates' | 'values' | 'dimension' }[] => {
      if (!overlaps(item.validity, scope.window)) return [{ item, reason: 'dates' }]
      const off = item.scope.dimensionValues.some(
        (row) =>
          scope.filters[row.dimension]?.length &&
          !item.scope.dimensionValues.some(
            (other) =>
              other.dimension === row.dimension &&
              scope.filters[row.dimension]!.includes(other.value),
          ),
      )
      if (off) return [{ item, reason: 'values' }]
      if (!item.scope.dimensions.every((dimension) => Object.hasOwn(scope.filters, dimension)))
        return [{ item, reason: 'dimension' }]
      return []
    })
    .sort(
      (a, b) =>
        compareIds(b.item.validity.start, a.item.validity.start) ||
        compareIds(a.item.id, b.item.id),
    )
}

/**
 * Answers `ask` on `bundle`, one step at a time: each step is yielded when it is done, and the
 * answer is returned at the end. Deterministic for the same inputs, apart from the steps' times.
 */
export function* lookUp(
  bundle: AnswerBundle,
  ask: AnswerAsk,
  { today, maxItems = ANSWER_MAX_ITEMS, now = () => 0, voice, person = false }: AnswerOptions,
): Generator<AnswerStep, Answer, void> {
  const steps: AnswerStep[] = []
  // A step's time is its own work: the clock starts again when the caller asks for the next step.
  let mark = now()
  const lap = () => {
    const at = now()
    const took = ms(at - mark)
    mark = at
    return took
  }
  const step = <S extends AnswerStep>(value: S): S => {
    steps.push(value)
    return value
  }

  const read = readAsk(ask, bundle.terms, today, person)
  const scope = read.status === 'resolved' ? read.scope : null
  const dates = (read.status === 'resolved' && read.dates) || null
  const assumed = (read.status === 'resolved' && read.assumed) || null
  const issues = read.status === 'need_more_detail' ? read.issues : []
  yield step({ step: 'read_scope', ms: lap(), scope, dates, assumed, issues })
  mark = now()

  const resolution = resolved(bundle, read, today)
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const matched = resolution.items.map((match) => ({ match, item: byId.get(match.id)! }))
  const given = matched.slice(0, Math.max(0, maxItems))
  const cut = [...matched.slice(given.length).map((g) => g.item.id), ...resolution.cut]
  const givenIds = new Set(given.map((g) => g.item.id))
  const items = given.map(({ match, item }) => answerItemOf(item, match, givenIds, today))
  yield step({ step: 'looked_up', ms: lap(), status: resolution.status, items })
  mark = now()

  const named = (id: string, reason: LeftOutReason, replacedBy: string | null = null): LeftOut => {
    const item = byId.get(id)!
    return { id, reason, kind: item.kind, title: item.title, replacedBy }
  }
  const hidden = person ? 'audience' : null
  const withheld = resolution.withheld.filter((w) => w.reason !== hidden)
  const forAnotherGroup = withheld.filter((w) => w.reason === 'audience').length
  const leftOut: LeftOut[] = [
    ...withheld.flatMap((w) => (w.reason === 'audience' ? [] : [named(w.id, w.reason)])),
    ...cut.map((id) => named(id, 'cut')),
    ...resolution.replacements.map((r) => named(r.id, 'replaced', r.replacedBy)),
  ]
  const seen = new Set([
    ...givenIds,
    ...leftOut.map((l) => l.id),
    ...resolution.withheld.map((w) => w.id),
  ])
  const misses = scope ? nearMisses(bundle, scope, seen) : []
  leftOut.push(...misses.slice(0, NEAR_MISSES_SHOWN).map((m) => named(m.item.id, m.reason)))
  const more = Math.max(0, misses.length - NEAR_MISSES_SHOWN)
  yield step({ step: 'left_out', ms: lap(), leftOut, more, forAnotherGroup })
  mark = now()

  const uncovered = scope
    ? uncoveredParts(
        bundle,
        scope,
        given.map((g) => ({ item: g.item, match: g.match.match })),
      )
    : { metrics: [], values: [] }
  const state = answerStateOf({
    status: resolution.status,
    items,
    uncovered,
    assumed: assumed !== null,
  })
  yield step({ step: 'checked', ms: lap(), state, uncovered })
  mark = now()

  const metrics = scope ? askedMetrics(bundle, scope) : []
  const said = contextSaid(
    bundle,
    {
      status: resolution.status,
      scope: resolution.scope,
      issues: resolution.issues,
      question: 'question' in ask ? ask.question : '',
      delivered: items.length,
      partial: items.filter((item) => item.match === 'partial').length,
      unverified: items.filter((item) => item.unverified).length,
      cut: cut.length,
      withheld: withheld.map((w) => w.reason),
      assumed: assumed ? assumedDate(assumed).note.sentence : null,
      readsAs: dates?.reads_as ?? null,
      upTo: person,
      groups: resolution.scope ? askedGroups(bundle, resolution.scope) : [],
      about: metrics.length > 1,
    },
    voice,
  )
  yield step({ step: 'said', ms: lap(), say: said.say, next: said.next ?? null })
  mark = now()

  return {
    edition: bundle.edition,
    overlay: bundle.overlay,
    status: resolution.status,
    state,
    scope,
    dates,
    assumed,
    issues,
    items,
    leftOut,
    leftOutMore: more,
    forAnotherGroup,
    uncovered,
    say: said.say,
    next: said.next ?? null,
    steps,
    ms: ms(steps.reduce((total, s) => total + s.ms, 0)),
  }
}

/** Answers `ask` on `bundle`: every step of `lookUp`, run to the end. */
export function answer(bundle: AnswerBundle, ask: AnswerAsk, options: AnswerOptions): Answer {
  const steps = lookUp(bundle, ask, options)
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

/**
 * A topic as agents asked about it in one calendar month: its domain, metrics, values, the
 * dimensions named without a value, the month, and how often it was asked (FR-604).
 */
export type TopicCount = {
  id: string
  area: string | null
  metrics: readonly string[]
  values: readonly string[]
  dimensions: readonly string[]
  /** The first day of the month, `YYYY-MM-01`. */
  month: string
  calls: number
  /** The calls that delivered no item. */
  noItem?: number
}

/**
 * The scope a topic stands for: its metrics, its values by dimension, the dimensions named
 * without a value, and its whole month. The question's own dates are not kept, so a topic is
 * answered for the month it is about.
 */
export function topicScope(topic: Omit<TopicCount, 'id' | 'area' | 'calls'>): ResolvedScope {
  const filters: Record<string, string[]> = {}
  for (const value of topic.values) {
    const dimension = `dim:${value.slice(4).split('/')[0]}`
    filters[dimension] = [...(filters[dimension] ?? []), value]
  }
  for (const dimension of topic.dimensions) filters[dimension] ??= []
  const [year, month] = topic.month.split('-').map(Number) as [number, number]
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return {
    metrics: [...topic.metrics].sort(compareIds),
    filters: Object.fromEntries(
      Object.entries(filters)
        .sort(([a], [b]) => compareIds(a, b))
        .map(([dimension, values]) => [dimension, [...new Set(values)].sort(compareIds)]),
    ),
    window: { start: topic.month, end: next },
  }
}

/**
 * A workspace's first questions in Ask, made from what it has written (decided 27 October 2026):
 * the scope of each live context item, a metric and the first value it names, then the metrics of
 * the vocabulary on their own, at most `count`, each at the month of `today`. Only items an agent
 * would be given count: for everyone, and not stopped. With none of those there are none.
 */
export function startersOf(bundle: AnswerBundle, today: string, count = 4): ResolvedScope[] {
  const month = `${today.slice(0, 7)}-01`
  const seen = new Set<string>()
  const scopes: ResolvedScope[] = []
  const add = (metrics: string[], values: string[]) => {
    const key = [...metrics, ...values].join('|')
    if (!key || seen.has(key) || scopes.length >= count) return
    seen.add(key)
    scopes.push(topicScope({ metrics, values, dimensions: [], month }))
  }
  // Only items an agent would be given: for everyone, and not stopped.
  const served = bundle.items.filter(
    (item) =>
      item.status === 'accepted' &&
      audienceAllows(item.audience, noGroups) &&
      !bundle.stopped.all &&
      !bundle.stopped.areas.includes(item.areaId) &&
      !bundle.stopped.items.includes(item.id),
  )
  if (!served.length) return []
  for (const item of served)
    add(
      item.scope.metrics.slice(0, 1),
      item.scope.dimensionValues.slice(0, 1).map((v) => v.value),
    )
  for (const term of bundle.terms) if (term.kind === 'metric') add([term.key], [])
  return scopes
}

/** A row of Asked this week in words, as get_context says a scope: "Orders in Norway". */
export const topicWords = (bundle: Pick<AnswerBundle, 'terms'>, scope: ResolvedScope) =>
  scopeWords(bundle, scope, { show: false })

/**
 * How many questions agents asked about the topics that would get `itemId` (an editor's or a
 * review's "12 questions agents asked this week would get it"): each topic is answered on
 * `bundle` for its month, as an agent would be, and the topics whose answer gives the item count.
 * Only topics shown on their own (at least `minimum` calls, FR-614) count, so the total gives no
 * hidden topic away, and is either 0 or at least the minimum.
 */
export function reach(
  bundle: AnswerBundle,
  itemId: string,
  topics: readonly TopicCount[],
  today: string,
  minimum: number,
  maxItems = ANSWER_MAX_ITEMS,
): number {
  let total = 0
  for (const topic of topics) {
    if (visibleCount(topic.calls, minimum) === null || topic.calls === 0) continue
    const resolution = resolved(bundle, { status: 'resolved', scope: topicScope(topic) }, today)
    if (resolution.items.slice(0, maxItems).some((match) => match.id === itemId))
      total += topic.calls
  }
  return total
}
