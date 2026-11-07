import type { ChatTurn } from './ask-chat.ts'
import type { PlanFact, PlannedRead, PlanPeriod } from './ask-plan.ts'
import { rankItems, readQuery, type SearchArea } from './context-search.ts'
import { dayWords, fullDayWords } from './dates.ts'
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
import { itemTrust } from './status.ts'
import { readQuestion, type ResolvedScope } from './scope.ts'
import { anyDate, isAnyDate, overlaps, type DateWindow } from './validity.ts'

/*
  The answer to a planned question (FR-719): each read the planner chose, run by Ask's own
  deterministic code. A look-up and a definition are the answer engine's, as for a question the
  rules read. A search reads the items an agent would be given, of the kinds asked, whose dates
  overlap the period and that are about the metrics and values asked, ranked by the words as
  find_context ranks them, at most seven. The last answer's sources are read again by id. The
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
  /** The question as it reads alone, as the planner restated it, when the chat matters. */
  standalone?: string
  /** Where the dates came from, for the answer to say when it took some. */
  period: PlanPeriod | null
  /** The part of the question these reads do not answer, as a short question (FR-720). */
  left?: string
  /** What the records say about what was read, in fixed sentences: who owns it, when it is due. */
  facts?: string[]
  /**
   * The person said which meaning of a word they meant, and the fixed rules read it, with no
   * model. `also` names the meanings left, so the other one stays in sight.
   */
  settled?: { also: string | null }
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
  const days = scopeWords(
    { terms: [] },
    { metrics: [], filters: {}, window },
    { show: true, upTo: true },
  )
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
 * What a planned read carried from the chat: the metrics and values it reads that the chat's
 * questions had and the question's own words do not name, and the last question's period.
 */
export function carriedNames(
  bundle: Pick<AnswerBundle, 'terms'>,
  reads: readonly PlannedRead[],
  question: string,
  turns: readonly ChatTurn[],
  today: string,
): string[] {
  if (!turns.length) return []
  const keysIn = (words: string) => readQuestion(words, bundle.terms, today).terms.map((t) => t.key)
  const named = new Set(keysIn(question))
  // What the chat asked: how each turn was read, or its own words when nothing was looked up.
  const before = new Set(
    turns.flatMap((turn) => [
      ...(turn.scope ? [...turn.scope.metrics, ...Object.values(turn.scope.filters).flat()] : []),
      ...keysIn(turn.question),
    ]),
  )
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
  /** Values asked that no item is written for. */
  values: readonly string[] = [],
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
    values: [...values],
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

/** How a search reads under a limit: only what names what was asked, and only its words. */
type Strict = { names?: boolean; words?: boolean }

/** A search of every kind that names nothing: only its words say what it is about. */
const wordsAlone = ({ scope, kinds }: ExploreRead) =>
  !scope.metrics.length && !Object.keys(scope.filters).length && (!kinds.length || kinds.length > 3)

/** A read, run: its answer, the reads as they ran, and the values only general items cover. */
type ReadRun = { answer: Answer; reads: PlannedRead[]; general: string[] }

/**
 * A search of the context (`explore`): the items an agent would be given, of the kinds asked,
 * that apply to some of the period and to what the scope names, and that match the words, ranked
 * as find_context ranks them, those that start in the period first among equals, at most
 * `EXPLORE_MAX_ITEMS`. When no item matches the words, every item of the kinds is read, and the
 * read says so by dropping its words: never items that match nothing under words they do not have.
 */
export function explore(
  bundle: PlannedBundle,
  asked: ExploreRead,
  today: string,
  now: () => number = () => 0,
  strict: Strict = {},
): { answer: Answer; reads: ExploreRead[]; general: string[] } {
  const first = searchOnce(bundle, asked, today, now, strict)
  // A kind none of whose items has the words is read whole, apart: a word for guides ("jump")
  // never hides the events asked beside them, and the read says which had the words.
  const found = new Set(first.answer.items.map((item) => item.kind))
  const rest = asked.kinds.filter((kind) => !found.has(kind))
  if (!first.read.words || !found.size || !rest.length)
    return { answer: first.answer, reads: [first.read], general: first.general }
  const matched = searchOnce(
    bundle,
    { ...asked, kinds: asked.kinds.filter((kind) => found.has(kind)) },
    today,
    now,
    strict,
  )
  const whole = searchOnce(bundle, { ...asked, kinds: rest, words: '' }, today, now, strict)
  // One search in two halves: a kind with nothing to say leaves no part of the question open.
  const empty = !whole.answer.items.length || whole.general.length > 0
  return {
    answer: empty ? matched.answer : combined([matched.answer, whole.answer]),
    reads: empty ? [{ ...matched.read, kinds: asked.kinds }] : [matched.read, whole.read],
    general: matched.general.filter((value) => whole.general.includes(value)),
  }
}

/** One search of the context, as `explore` runs it. */
function searchOnce(
  bundle: PlannedBundle,
  asked: ExploreRead,
  today: string,
  now: () => number,
  strict: Strict = {},
): { answer: Answer; read: ExploreRead; general: string[] } {
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
  // A search with a scope that matches no word reads the scope, and says so by dropping its words.
  const read = matched.length || wordsAlone(asked) ? asked : { ...asked, words: '' }
  // Words are all a search of everything with no scope is about: matching nothing, it reads nothing.
  const every = matched.length
    ? matched
    : (strict.words || wordsAlone(asked)) && asked.words.trim()
      ? []
      : candidates.map((item) => ({ item, score: 0, all: true }))
  // An item for no value applies to every one, so it says nothing of the value asked: it is read
  // only when nothing names that value, and then as what it is, general.
  const values = Object.values(scope.filters).flat()
  const own = every.filter(({ item }) =>
    item.scope.dimensionValues.some((row) => values.includes(row.value)),
  )
  const ranked =
    own.length || !values.length || strict.names ? (values.length ? own : every) : every
  const general = ranked.length && values.length && !own.length ? values : []
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
    general,
  )
  return { answer, read, general }
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
 * words; with the reads as they were run (a search whose words matched nothing reads without
 * them, and one whose words matched only some of its kinds reads the others apart).
 */
export function runRead(
  bundle: PlannedBundle,
  read: PlannedRead,
  c: { today: string; previous: ChatTurn | null; now?: () => number },
  strict: Strict = {},
): ReadRun {
  const now = c.now ?? (() => 0)
  if (read.kind === 'explore') return explore(bundle, read, c.today, now, strict)
  return { answer: engineRead(bundle, read, c, now), reads: [read], general: [] }
}

/**
 * What a read under a limit reads next when it finds nothing: the same names in everything written,
 * at any date, and last the value alone with the question's own words, for a question that named
 * the wrong metric for it. Each says what it read, and none reads an item that is not about what
 * was asked, so nothing fills an answer that has nothing to say.
 */
function widerReads(
  bundle: PlannedBundle,
  read: PlannedRead,
  question: string,
): { read: ExploreRead; strict: Strict }[] {
  if (read.kind !== 'lookup' && read.kind !== 'explore') return []
  const scoped = read.scope.metrics.length > 0 || Object.keys(read.scope.filters).length > 0
  // A name holds a wider read to the question. With none, only the kinds asked can, and with no
  // kinds either there is nothing it could be about.
  const kinds = !scoped && read.kind === 'explore' ? read.kinds : []
  if (!scoped && !kinds.length) return []
  const every = { ...read.scope, window: anyDate }
  const widest = {
    kind: 'explore' as const,
    words: '',
    kinds,
    scope: every,
    period: 'any' as const,
  }
  const values = Object.keys(read.scope.filters).length > 0
  // The question's own words, without the names read from it: a name would match all it names.
  const words = readQuery(question, bundle.terms, bundle.areas ?? []).used.words.join(' ')
  return [
    { read: widest, strict: { names: true } },
    ...(values && read.scope.metrics.length && words
      ? [
          {
            read: { ...widest, words, scope: { ...every, metrics: [] } },
            strict: { names: true, words: true },
          },
        ]
      : []),
  ]
}

/** A read under a limit: only what is about what was asked, widened until something is. */
function limitedRead(
  bundle: PlannedBundle,
  read: PlannedRead,
  c: { question: string; today: string; previous: ChatTurn | null; now?: () => number },
): ReadRun {
  // Words alone are all a search with no scope is about, so words that match nothing read nothing.
  const wordsAlone =
    read.kind === 'explore' &&
    read.words.trim() !== '' &&
    !read.scope.metrics.length &&
    !Object.keys(read.scope.filters).length
  const first = runRead(bundle, read, c, { names: true, words: wordsAlone })
  if (first.answer.items.length) return first
  for (const wider of widerReads(bundle, read, c.question)) {
    const run = runRead(bundle, wider.read, c, wider.strict)
    if (run.answer.items.length) return run
  }
  return first
}

function engineRead(
  bundle: PlannedBundle,
  read: Exclude<PlannedRead, { kind: 'explore' }>,
  c: { today: string; previous: ChatTurn | null },
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
            { today: c.today, now, person: true },
          )
        : answer(bundle, { scope: read.scope }, { today: c.today, now, person: true })
    case 'definition':
      // What a metric means is no question of a day: what is written about it is read whole.
      return answer(
        bundle,
        { scope: { metrics: read.metrics, filters: {}, window: anyDate } },
        { today: c.today, now, person: true },
      )
    case 'about_previous':
      return previousSources(
        bundle,
        read.ids,
        c.previous && read.ids.every((id) => c.previous!.sources.includes(id))
          ? (c.previous.scope ?? null)
          : null,
        c.today,
        now,
      )
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
  /** The names nothing is written about, when what was read applies to everything. */
  general?: string[]
}

/** Runs every read of a plan and says how the question was read (FR-719). */
export function plannedAnswer(
  bundle: PlannedBundle,
  reads: readonly PlannedRead[],
  c: {
    question: string
    today: string
    previous: ChatTurn | null
    /** The chat, oldest first: what the read may have carried. */
    turns?: readonly ChatTurn[]
    standalone?: string
    left?: string
    settled?: PlanReading['settled']
    now?: () => number
    /** A limit sentence leads the answer: only what is about what was asked may follow it. */
    limited?: boolean
    /** What the question asks of the records about what is read. */
    facts?: readonly PlanFact[]
    stewards?: Stewards
    /** Words of the question that name dates Ask could not place. */
    unplaced?: readonly string[]
  },
): PlannedAnswer {
  const runs = reads.map((read) =>
    c.limited ? limitedRead(bundle, read, c) : runRead(bundle, read, c),
  )
  const ran = runs.flatMap((r) => r.reads)
  const dated = ran.find((r) => r.kind === 'lookup' || r.kind === 'explore')
  const answered = combined(runs.map((r) => r.answer))
  // A metric with nothing written is still defined: its definition is the whole answer.
  const asked = answered.items.length
    ? []
    : ran.flatMap((r) => (r.kind === 'lookup' || r.kind === 'explore' ? r.scope.metrics : []))
  const general = runs.every((r) => r.general.length) ? runs.flatMap((r) => r.general) : []
  const facts = [
    ...(c.unplaced?.length
      ? [
          `Ask could not place ${list(c.unplaced.map((w) => `"${w}"`))} as dates, so it read every date.`,
        ]
      : []),
    ...factLines(bundle, answered, c),
  ]
  return {
    reads: ran,
    answer: answered,
    reading: {
      words: readsWords(bundle, ran, c.today),
      carried: carriedNames(
        bundle,
        ran,
        c.question,
        c.turns ?? (c.previous ? [c.previous] : []),
        c.today,
      ),
      period: dated?.period ?? null,
      ...(c.standalone ? { standalone: c.standalone } : {}),
      ...(c.left ? { left: c.left } : {}),
      ...(facts.length ? { facts } : {}),
      ...(c.settled ? { settled: c.settled } : {}),
    },
    defines: [
      ...new Set([...ran.flatMap((r) => (r.kind === 'definition' ? r.metrics : [])), ...asked]),
    ],
    ...(general.length ? { general: [...new Set(general)].map((key) => nameOf(bundle, key)) } : {}),
  }
}

/** How many items a line about check dates names. */
const FACT_ITEMS = 5

/**
 * What the records keep about the items an answer found, which no item's words say, in fixed
 * sentences (FR-720): the owners of each one's domain, and each one's check date. No model writes
 * them, and they name only what the answer already gives.
 */
function factLines(
  bundle: PlannedBundle,
  answered: Answer,
  c: { facts?: readonly PlanFact[]; stewards?: Stewards; today: string },
): string[] {
  const homes = [...new Set(answered.items.map((item) => item.areaId))]
  const names = new Map((bundle.areas ?? []).map((a) => [a.id, a.name]))
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const owners = c.facts?.includes('owner') ? (c.stewards?.owners ?? null) : null
  const ownerLines = homes.flatMap((id) => {
    const who = owners?.[id]
    const name = names.get(id)
    if (!who || !name) return []
    return [
      who.length
        ? `${list(who)} ${who.length === 1 ? 'owns' : 'own'} ${name}.`
        : `${name} has no owner. An administrator can add one.`,
    ]
  })
  const dueLines = c.facts?.includes('due')
    ? answered.items.slice(0, FACT_ITEMS).flatMap((item) => {
        const source = byId.get(item.id)
        if (!source) return []
        const due =
          itemTrust(
            { ...source, status: source.status === 'retired' ? 'retired' : 'accepted' },
            c.today,
          ) === 'needs_check'
        const date = source.reviewDate
          ? `check date ${dayWords(source.reviewDate)}`
          : 'no check date'
        const missing = source.checkFlag === 'source_missing' ? ', its source is missing' : ''
        const checked = c.stewards?.checked[item.id]
        const last = checked ? `, last checked ${dayWords(checked)}` : ''
        return [`${item.title}: ${date}${due ? ', due for a check' : ''}${missing}${last}.`]
      })
    : []
  return [...ownerLines, ...dueLines]
}

/** What the records keep about items, beside the items: each domain's owners, each item's last check. */
export type Stewards = {
  owners: Readonly<Record<string, readonly string[]>>
  checked: Readonly<Record<string, string | null>>
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
