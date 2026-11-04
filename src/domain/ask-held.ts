import { HELD_MEANINGS, type HeldReading } from './ask-chat.ts'
import type { PlannedRead, PlanPeriod } from './ask-plan.ts'
import { readQuestion, type ScopeIssue, type ScopeResult } from './scope.ts'
import { shiftDate, type DateWindow } from './validity.ts'
import { normalizeName, type Term, type WordMeaning } from './vocabulary.ts'

/*
  What Ask holds while it waits for a person to say which meaning of a word they mean. The turn
  that asks keeps how it read the rest of the question and the meanings (`HeldReading`), and the
  next message is read against them by fixed rules, before any model: a name, a word of a name, a
  place in the list or "both". The planner sees only what these rules cannot read. Pure, so the
  service, the mock and the planner cases read an answer alike.
*/

/** The contested words of a read question, each one to ask about in turn. */
const contestedOf = (issues: readonly ScopeIssue[]) =>
  issues.flatMap((issue) =>
    issue.meanings
      ? [{ word: issue.word ?? issue.input, meanings: issue.meanings.slice(0, HELD_MEANINGS) }]
      : [],
  )

/** What a question that stopped at a word holds on to, or null when it stopped for another reason. */
export function heldOf(read: ScopeResult): HeldReading | null {
  if (read.status !== 'need_more_detail' || !read.held) return null
  const [first, ...more] = contestedOf(read.issues)
  if (!first) return null
  return { ...first, ...read.held, ...(more.length ? { more } : {}) }
}

/** Words that say nothing about which meaning: "the second one, please". */
const PASSING = new Set(
  "a an and at i in it its is it's just me mean meant of ok okay on one ones or please pls prefer the thanks that want we with yes".split(
    ' ',
  ),
)

/** The place a word points at in the list, from its start; `last` from its end. */
const PLACES: Record<string, number | 'last'> = {
  first: 0,
  '1st': 0,
  '1': 0,
  former: 0,
  second: 1,
  '2nd': 1,
  '2': 1,
  third: 2,
  '3rd': 2,
  '3': 2,
  fourth: 3,
  '4th': 3,
  '4': 3,
  fifth: 4,
  '5th': 4,
  '5': 4,
  last: 'last',
  latter: 'last',
}
const EVERY = new Set(['both', 'all', 'each'])

const wordsOf = (text: string) =>
  normalizeName(text)
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)

/** The meaning every word points at: "net" and "net revenue" are Net revenue; "term" is the term. */
function meaningOfWords(words: readonly string[], meanings: readonly WordMeaning[]) {
  const fits = meanings.filter((m) => {
    const own = new Set(wordsOf(m.name))
    if (m.key.startsWith('term:')) own.add('term')
    return words.every((word) => own.has(word))
  })
  return fits.length === 1 ? fits : []
}

/**
 * Which meanings a message chooses, read by fixed rules, or null when it does not say. A message
 * that names something else as well keeps it: "net, in Spain last week" is Net revenue with those
 * filters and dates. A metric that is no meaning of the word is another question, and a word with
 * more than one meaning of its own is read as its own question.
 */
export function chosenMeanings(
  message: string,
  held: Pick<HeldReading, 'meanings'>,
  terms: readonly Term[],
  today: string,
) {
  const own = readQuestion(message, terms, today)
  if (own.issues.some((issue) => issue.meanings)) return null
  const keys = new Set(own.terms.map((term) => term.key))
  const named = held.meanings.filter((m) => keys.has(m.key))
  const others = own.terms.filter((term) => !named.some((m) => m.key === term.key))
  if (others.some((term) => term.kind === 'metric' || term.kind === 'metric_group')) return null
  // Only the words nothing else read: names and dates are taken out where they stand.
  const spans = [...own.spans].sort((a, b) => b.start - a.start)
  const rest = spans.reduce((t, s) => `${t.slice(0, s.start)} ${t.slice(s.end)}`, message)
  const words = wordsOf(rest).filter((word) => !PASSING.has(word))
  const picked = named.length
    ? words.length
      ? []
      : named
    : words.length === 1 && EVERY.has(words[0]!)
      ? held.meanings
      : words.length === 1 && words[0]! in PLACES
        ? placed(words[0]!, held.meanings)
        : words.length
          ? meaningOfWords(words, held.meanings)
          : []
  return picked.length ? { picked, others, window: own.window } : null
}

function placed(word: string, meanings: readonly WordMeaning[]) {
  const place = PLACES[word]!
  const meaning = meanings[place === 'last' ? meanings.length - 1 : place]
  return meaning ? [meaning] : []
}

/** What a chosen meaning adds to the rest of the question. */
function withMeanings(
  held: Pick<HeldReading, 'metrics' | 'filters'>,
  picked: readonly WordMeaning[],
  others: readonly Term[],
  terms: readonly Term[],
) {
  const metrics = [...held.metrics]
  const filters: Record<string, string[]> = Object.fromEntries(
    Object.entries(held.filters).map(([dimension, values]) => [dimension, [...values]]),
  )
  const byKey = new Map(terms.map((term) => [term.key, term]))
  for (const term of [...picked.flatMap((m) => byKey.get(m.key) ?? []), ...others]) {
    if (term.kind === 'dimension_value') (filters[term.parentKey!] ??= []).push(term.key)
    else if (term.kind === 'dimension') filters[term.key] ??= []
    else metrics.push(term.key)
  }
  return {
    metrics: [...new Set(metrics)].sort(),
    filters: Object.fromEntries(
      Object.entries(filters)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([dimension, values]) => [dimension, [...new Set(values)].sort()]),
    ),
  }
}

/** What a settled word leads to: another word to ask about, one read, or nothing to look up. */
export type Settled =
  | { kind: 'ask'; held: HeldReading }
  | { kind: 'read'; read: PlannedRead; others: WordMeaning[]; word: string }
  | { kind: 'nothing'; word: string }

/** The reading once a person chose: the rest of the question with the meanings it chose. */
export function settled(
  held: HeldReading,
  chosen: NonNullable<ReturnType<typeof chosenMeanings>>,
  terms: readonly Term[],
  today: string,
): Settled {
  const { metrics, filters } = withMeanings(held, chosen.picked, chosen.others, terms)
  const window = chosen.window ?? held.window
  const [next, ...more] = held.more ?? []
  if (next)
    return {
      kind: 'ask',
      held: { ...next, metrics, filters, window, ...(more.length ? { more } : {}) },
    }
  if (!metrics.length && !Object.keys(filters).length) return { kind: 'nothing', word: held.word }
  const period: PlanPeriod = chosen.window ? 'asked' : held.window ? 'carried' : 'today'
  const days: DateWindow = window ?? { start: today, end: shiftDate(today, 1) }
  return {
    kind: 'read',
    read: {
      kind: 'lookup',
      scope: { metrics, filters, window: days },
      period,
      why: false,
    },
    others: held.meanings.filter((m) => !chosen.picked.includes(m)),
    word: held.word,
  }
}
