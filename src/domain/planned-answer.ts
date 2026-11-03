import type { PlannedRead, PlanPeriod, PreviousTurn } from './ask-plan.ts'
import { rankItems, readQuery, type SearchArea } from './context-search.ts'
import { fullDayWords } from './dates.ts'
import {
  answer,
  answerItemOf,
  answerState,
  type Answer,
  type AnswerBundle,
  type AnswerItem,
  type AnswerSource,
  type AnswerStep,
} from './answer.ts'
import type { ItemKind } from './item.ts'
import { canRead } from './links.ts'
import { compareIds, metricsOf } from './resolver.ts'
import { scopeWords } from './say.ts'
import { readQuestion, type ResolvedScope } from './scope.ts'
import { isAnyDate, overlaps, type DateWindow } from './validity.ts'

/*
  The answer to a planned question (FR-719): each read the planner chose, run by Ask's own
  deterministic code. A look-up and a definition are the answer engine's, as for a question the
  rules read. A search reads the items an agent would be given, of the kinds asked, whose dates
  overlap the period and that are about the metrics and values asked, ranked by the words as
  search_facts ranks them, at most seven. The last answer's sources are read again by id. The
  state comes from the items read, by the engine's own rules: Conflict when two of them disagree,
  Partial when a metric asked has no item, Outdated when one may be out of date, else Checked, and
  Not found when nothing was read. The model chose the reads, and the answer says so; it decides
  nothing else.
*/

/** How many items a search gives at most: a few, read whole. */
export const EXPLORE_MAX_ITEMS = 7

/** How a planned question was read, said with its answer: the reads, the dates and what was carried. */
export type PlanReading = {
  /** The reads in words: "Events and guides about jumps, from 23 July to 23 October 2026". */
  words: string
  /** The names and the period carried from the last question, in words. */
  carried: string[]
  /** Where the dates came from, for the answer to say when it took some. */
  period: PlanPeriod | null
}

/** A bundle the planned reads run on: what the engine reads, with the domains a search names. */
export type PlannedBundle = AnswerBundle & { areas?: readonly SearchArea[] }

const kindWords: Record<ItemKind, [string, string]> = {
  event: ['event', 'events'],
  issue: ['warning', 'warnings'],
  note: ['rule', 'rules'],
  guide: ['guide', 'guides'],
  example: ['example', 'examples'],
}
const list = (names: readonly string[], and = 'and') =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The days a planned read is for, in words, with why when Ask took them: "in the last 3 months". */
function periodText(window: DateWindow, period: PlanPeriod, today: string): string {
  if (period === 'today') return `today, ${fullDayWords(today)}`
  if (isAnyDate(window)) return 'at any date'
  const days = scopeWords({ terms: [] }, { metrics: [], filters: {}, window })
  return period === 'recent' ? `in the last 3 months (${days.replace(/^from /, '')})` : days
}

/** A read in words, as the read-as line says it: what it reads, and the days, apart. */
export function readWords(
  bundle: Pick<AnswerBundle, 'terms'>,
  read: PlannedRead,
  today: string,
): { what: string; when: string | null } {
  switch (read.kind) {
    case 'lookup':
      return {
        what: scopeWords(bundle, read.scope, { show: false }),
        when: periodText(read.scope.window, read.period, today),
      }
    case 'explore': {
      const kinds = read.kinds.length
        ? list(read.kinds.map((k) => kindWords[k][1]))
        : 'everything written'
      const scope = scopeWords(bundle, read.scope, { show: false })
      const words = read.words.split(' ').filter(Boolean)
      const about = [
        words.length && `with the ${words.length === 1 ? 'word' : 'words'} ${list(words)}`,
        scope && `for ${scope}`,
      ]
        .filter(Boolean)
        .join(' ')
      return {
        what: `${kinds}${about ? ` ${about}` : ''}`,
        when: periodText(read.scope.window, read.period, today),
      }
    }
    case 'definition':
      return {
        what: `what ${list(read.metrics.map((key) => nameOf(bundle, key)))} ${read.metrics.length === 1 ? 'means' : 'mean'}`,
        when: null,
      }
    case 'about_previous':
      return {
        what:
          read.ids.length === 1
            ? 'a source of your last answer'
            : `${read.ids.length} sources of your last answer`,
        when: null,
      }
  }
}

/**
 * The reads of a plan in words, as the read-as line says them: "Guides with the word jumps, and
 * events, in the last 3 months (23 July to 23 October 2026)". Days several reads share are said
 * once.
 */
export function readsWords(
  bundle: Pick<AnswerBundle, 'terms'>,
  reads: readonly PlannedRead[],
  today: string,
): string {
  const parts = reads.map((read) => readWords(bundle, read, today))
  const days = [...new Set(parts.map((p) => p.when))]
  const said =
    days.length === 1
      ? `${parts.map((p) => p.what).join(', and ')}${days[0] ? `, ${days[0]}` : ''}`
      : parts.map((p) => (p.when ? `${p.what}, ${p.when}` : p.what)).join('; ')
  return capital(said)
}

const nameOf = (bundle: Pick<AnswerBundle, 'terms'>, key: string) =>
  bundle.terms.find((t) => t.key === key)?.name ?? key

/**
 * What a planned read carried from the last question: the metrics and values it reads that the
 * last question had and the question's own words do not name, and the last question's period.
 */
export function carriedNames(
  bundle: Pick<AnswerBundle, 'terms'>,
  reads: readonly PlannedRead[],
  question: string,
  previous: PreviousTurn | null,
  today: string,
): string[] {
  if (!previous) return []
  const keysIn = (words: string) => readQuestion(words, bundle.terms, today).terms.map((t) => t.key)
  const named = new Set(keysIn(question))
  // What the last question asked: how it was read, or its own words when nothing was looked up.
  const last = previous.scope
  const before = new Set([
    ...(last ? [...last.metrics, ...Object.values(last.filters).flat()] : []),
    ...keysIn(previous.question),
  ])
  const carried = new Set<string>()
  let period = false
  for (const read of reads) {
    if (read.kind !== 'lookup' && read.kind !== 'explore') continue
    for (const key of [...read.scope.metrics, ...Object.values(read.scope.filters).flat()])
      if (before.has(key) && !named.has(key)) carried.add(key)
    if (read.period === 'carried') period = true
  }
  return [...[...carried].map((key) => nameOf(bundle, key)), ...(period ? ['the dates'] : [])]
}

/** The engine's steps for an answer read without the resolver, each timed by `now`. */
function stepsOf(
  a: Omit<Answer, 'steps' | 'ms'>,
  times: readonly number[],
): Pick<Answer, 'steps' | 'ms'> {
  const [scope = 0, looked = 0, said = 0] = times
  const steps: AnswerStep[] = [
    {
      step: 'read_scope',
      ms: scope,
      scope: a.scope,
      dates: a.dates,
      assumed: a.assumed,
      issues: [],
    },
    { step: 'looked_up', ms: looked, status: a.status, items: a.items },
    { step: 'left_out', ms: 0, leftOut: [], more: 0, forAnotherGroup: 0 },
    { step: 'checked', ms: 0, state: a.state, uncovered: a.uncovered },
    { step: 'said', ms: said, say: a.say, next: a.next },
  ]
  return { steps, ms: Math.round(steps.reduce((t, s) => t + s.ms, 0) * 100) / 100 }
}

/** An answer from items read without the resolver: their state by the engine's rules. */
function itemsAnswer(
  bundle: PlannedBundle,
  found: readonly AnswerSource[],
  scope: ResolvedScope | null,
  say: (n: number) => string,
  today: string,
  now: () => number,
): Answer {
  const start = now()
  const ids = new Set(found.map((item) => item.id))
  const items: AnswerItem[] = found.map((item) => answerItemOf(item, null, ids, today))
  const looked = now()
  // A metric asked that no item is about, or about every metric, is the part with nothing.
  const covers = (item: AnswerSource, metric: string) =>
    item.scope.metrics.length === 0 ||
    item.scope.metrics.some((key) => key === metric || metricsOf(bundle, key).includes(metric))
  const metrics = (scope?.metrics ?? []).flatMap((key) => {
    const opened = metricsOf(bundle, key)
    return opened.length ? opened : [key]
  })
  const uncovered = {
    metrics: [...new Set(metrics)].filter((m) => !found.some((item) => covers(item, m))).sort(),
    values: [],
  }
  const status = !items.length
    ? 'no_match'
    : items.some((item) => item.conflictsWith.length)
      ? 'conflict'
      : 'matched'
  const state = answerState({ status, given: items, uncovered, assumed: false })
  const base = {
    edition: bundle.edition,
    overlay: bundle.overlay,
    status,
    state,
    scope,
    dates: null,
    assumed: null,
    issues: [],
    items,
    leftOut: [],
    leftOutMore: 0,
    forAnotherGroup: 0,
    uncovered,
    say: say(items.length),
    next: null,
  } satisfies Omit<Answer, 'steps' | 'ms'>
  return { ...base, ...stepsOf(base, [0, Math.round((looked - start) * 100) / 100, 0]) }
}

const itemsWord = (n: number) => (n === 1 ? '1 context item' : `${n} context items`)

/** Whether an item is about what a search asked: the metrics and values, each when asked. */
function aboutScope(bundle: AnswerBundle, item: AnswerSource, scope: ResolvedScope) {
  const metrics = scope.metrics.flatMap((key) => [key, ...metricsOf(bundle, key)])
  const metricOk =
    !metrics.length ||
    !item.scope.metrics.length ||
    item.scope.metrics.some(
      (key) => metrics.includes(key) || metrics.some((m) => metricsOf(bundle, key).includes(m)),
    )
  const valuesOk = Object.entries(scope.filters).every(([dimension, values]) => {
    const own = item.scope.dimensionValues.filter((row) => row.dimension === dimension)
    return !values.length || !own.length || own.some((row) => values.includes(row.value))
  })
  return metricOk && valuesOk
}

type ExploreRead = Extract<PlannedRead, { kind: 'explore' }>

/**
 * A search of the context (`explore`): the items an agent would be given, of the kinds asked,
 * that apply to some of the period and to what the scope names, and that match the words, ranked
 * as search_facts ranks them, those that start in the period first among equals, at most
 * `EXPLORE_MAX_ITEMS`. When no item matches the words, every item of the kinds is read, and the
 * read says so by dropping its words: never items that match nothing under words they do not have.
 */
export function explore(
  bundle: PlannedBundle,
  asked: ExploreRead,
  today: string,
  now: () => number = () => 0,
): { answer: Answer; read: ExploreRead } {
  const { scope } = asked
  const { window } = scope
  const candidates = bundle.items.filter(
    (item) =>
      (!asked.kinds.length || asked.kinds.includes(item.kind)) &&
      item.kind !== 'example' &&
      overlaps(item.validity, window) &&
      aboutScope(bundle, item, asked.scope) &&
      canRead(bundle, item, today),
  )
  const query = readQuery(asked.words, bundle.terms, bundle.areas ?? [])
  const matched = query.concepts.length ? rankItems(query, candidates, bundle.terms) : []
  const read = matched.length ? asked : { ...asked, words: '' }
  const ranked = matched.length
    ? matched
    : candidates.map((item) => ({ item, score: 0, all: true }))
  const starts = (item: AnswerSource) =>
    Number(item.validity.start >= window.start && (!window.end || item.validity.start < window.end))
  // An item that names what was asked comes before one that applies to every value of it.
  const wanted = new Set([...scope.metrics, ...Object.values(scope.filters).flat()])
  const names = (item: AnswerSource) =>
    [...item.scope.metrics, ...item.scope.dimensionValues.map((row) => row.value)].filter((key) =>
      wanted.has(key),
    ).length
  const found = ranked
    .sort(
      (a, b) =>
        Number(b.all) - Number(a.all) ||
        b.score - a.score ||
        names(b.item) - names(a.item) ||
        starts(b.item) - starts(a.item) ||
        compareIds(b.item.validity.start, a.item.validity.start) ||
        compareIds(a.item.id, b.item.id),
    )
    .slice(0, EXPLORE_MAX_ITEMS)
    .map((r) => r.item)
  const what = readsWords(bundle, [read], today)
  const answer = itemsAnswer(
    bundle,
    found,
    read.scope,
    (n) =>
      n
        ? `${capital(itemsWord(n))} ${n === 1 ? 'matches' : 'match'}: ${what}. A search matches words and dates; it does not say what applies to one metric or market.`
        : `No context item matches: ${what}. A search that finds nothing does not prove nothing applies.`,
    today,
    now,
  )
  return { answer, read }
}

/** The sources of the last answer, read again by id: those an agent would still be given. */
export function previousSources(
  bundle: PlannedBundle,
  ids: readonly string[],
  scope: ResolvedScope | null,
  today: string,
  now: () => number = () => 0,
): Answer {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const found = ids.flatMap((id) => {
    const item = byId.get(id)
    return item && canRead(bundle, item, today) ? [item] : []
  })
  return itemsAnswer(
    bundle,
    found,
    scope,
    (n) =>
      n
        ? `${capital(itemsWord(n))} from the last answer ${n === 1 ? 'applies' : 'apply'}, read again as ${n === 1 ? 'it is' : 'they are'} now.`
        : 'Nothing from the last answer can be read now. That does not prove nothing applies.',
    today,
    now,
  )
}

/**
 * One planned read, run: the answer engine's for a look-up or a definition, else read by id or
 * words; with the read as it was run (a search whose words matched nothing reads without them).
 */
export function runRead(
  bundle: PlannedBundle,
  read: PlannedRead,
  c: { today: string; previous: PreviousTurn | null; now?: () => number },
): { answer: Answer; read: PlannedRead } {
  const now = c.now ?? (() => 0)
  if (read.kind === 'explore') return explore(bundle, read, c.today, now)
  return { answer: engineRead(bundle, read, c, now), read }
}

function engineRead(
  bundle: PlannedBundle,
  read: Exclude<PlannedRead, { kind: 'explore' }>,
  c: { today: string; previous: PreviousTurn | null },
  now: () => number,
): Answer {
  switch (read.kind) {
    case 'lookup':
      // Read at today, as the rules read an undated question, it says it assumed today.
      return read.period === 'today'
        ? answer(
            bundle,
            {
              question: '',
              metrics: read.scope.metrics,
              dimension_filters: Object.entries(read.scope.filters).map(([dimension, values]) => ({
                dimension,
                values,
              })),
            },
            { today: c.today, now },
          )
        : answer(bundle, { scope: read.scope }, { today: c.today, now })
    case 'definition':
      return answer(bundle, { question: '', metrics: read.metrics }, { today: c.today, now })
    case 'about_previous':
      return previousSources(bundle, read.ids, c.previous?.scope ?? null, c.today, now)
  }
}

/**
 * The answer to every read of a plan together: the first read's, with the items of the others
 * after its own, once each, at most twenty. Its state is the worst of the reads' by the order the
 * states win, and Partial when one read found nothing and another found something.
 */
export function combined(answers: readonly Answer[]): Answer {
  const [first, ...rest] = answers
  if (!first) throw new Error('A plan reads at least once.')
  if (!rest.length) return first
  const seen = new Set<string>()
  const items = answers
    .flatMap((a) => a.items)
    .filter((item) => !seen.has(item.id) && (seen.add(item.id), true))
    .slice(0, 20)
  const ids = new Set(items.map((i) => i.id))
  const order = ['failed', 'conflict', 'partial', 'stale', 'grounded', 'missing'] as const
  const found = answers.filter((a) => a.items.length)
  const worst = found.length
    ? found.map((a) => a.state).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]!
    : 'missing'
  const state =
    worst !== 'conflict' && found.length < answers.length && found.length ? 'partial' : worst
  return {
    ...first,
    status: found.some((a) => a.status === 'conflict')
      ? 'conflict'
      : found.length
        ? 'matched'
        : 'no_match',
    state,
    items: items.map((item) => ({
      ...item,
      conflictsWith: answers
        .flatMap((a) => a.items.filter((i) => i.id === item.id).flatMap((i) => i.conflictsWith))
        .filter((id, i, all) => ids.has(id) && all.indexOf(id) === i),
    })),
    leftOut: answers.flatMap((a) => a.leftOut).filter((l) => !ids.has(l.id)),
    leftOutMore: answers.reduce((t, a) => t + a.leftOutMore, 0),
    forAnotherGroup: answers.reduce((t, a) => t + a.forAnotherGroup, 0),
    uncovered: {
      metrics: [...new Set(answers.flatMap((a) => a.uncovered.metrics))].sort(),
      values: [...new Set(answers.flatMap((a) => a.uncovered.values))].sort(),
    },
    say: answers.map((a) => a.say).join(' '),
    steps: answers.flatMap((a) => a.steps),
    ms: answers.reduce((t, a) => t + a.ms, 0),
  }
}

/**
 * A planned question answered: the reads as they ran, their answer, how the question was read,
 * and the metrics whose definitions the answer shows.
 */
export type PlannedAnswer = {
  reads: PlannedRead[]
  answer: Answer
  reading: PlanReading
  defines: string[]
}

/** Runs every read of a plan and says how the question was read (FR-719). */
export function plannedAnswer(
  bundle: PlannedBundle,
  reads: readonly PlannedRead[],
  c: { question: string; today: string; previous: PreviousTurn | null; now?: () => number },
): PlannedAnswer {
  const runs = reads.map((read) => runRead(bundle, read, c))
  const ran = runs.map((r) => r.read)
  const dated = ran.find((r) => r.kind === 'lookup' || r.kind === 'explore')
  return {
    reads: ran,
    answer: combined(runs.map((r) => r.answer)),
    reading: {
      words: readsWords(bundle, ran, c.today),
      carried: carriedNames(bundle, ran, c.question, c.previous, c.today),
      period: dated?.period ?? null,
    },
    defines: [...new Set(ran.flatMap((r) => (r.kind === 'definition' ? r.metrics : [])))],
  }
}

/** What the working line says while a plan's reads run: "Looking for events and guides…". */
export function workingWords(bundle: Pick<AnswerBundle, 'terms'>, reads: readonly PlannedRead[]) {
  const [read] = reads
  switch (read?.kind) {
    case 'lookup':
      return `Looking up ${scopeWords(bundle, read.scope, { show: false })}…`
    case 'explore':
      return read.kinds.length
        ? `Looking for ${list(read.kinds.map((k) => kindWords[k][1]))}…`
        : 'Looking through what is written…'
    case 'definition':
      return `Looking up what ${list(read.metrics.map((key) => nameOf(bundle, key)))} ${read.metrics.length === 1 ? 'means' : 'mean'}…`
    case 'about_previous':
      return 'Reading your last answer’s sources again…'
    default:
      return 'Looking up context…'
  }
}
