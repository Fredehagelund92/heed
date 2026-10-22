import { dayWords, fullDayWords, readDates, whatHeedReads, type DateSpan } from './dates.ts'
import { calendarDateSchema, dateWindowSchema, shiftDate, type DateWindow } from './validity.ts'
import {
  isMemberName,
  memberTokens,
  namesOf,
  normalizeName,
  normalizeWithMap,
  phrasesIn,
  resolveTerm,
  suggestTerms,
  type Term,
} from './vocabulary.ts'

/**
 * `filters` maps each dimension the question names to the values it chose. An empty list names
 * the dimension without a value ("orders by market"): every value is in, and an item scoped to
 * that dimension with any value applies.
 */
export type ResolvedScope = {
  metrics: string[]
  filters: Record<string, string[]>
  window: DateWindow
}
export type ScopeInput = {
  metrics?: string[]
  filters?: Record<string, string[]>
  window?: DateWindow
}
/**
 * A part of the scope Heed could not read. `message`, for a name it does not know, says so and
 * names the closest it does, so the caller can recover without guessing (FR-341).
 */
export type ScopeIssue = { field: string; input: string; options: string[]; message?: string }
/**
 * The day Heed read a question at because it gave no dates: today, a UTC day (NFR-048; Heed has
 * no company time zone). A reply that used it says so (`assumedDate`), never silently.
 */
export type AssumedDate = { date: string; time_zone: 'UTC'; reason: 'no date given' }
/**
 * The dates Heed read in the words of a question: the words as written, and how it read them for
 * a person ("1 Jan to 7 Oct 2026 (this year so far; UTC)"). A reply that used them says so.
 */
export type DatesRead = { words: string; reads_as: string }
export type ScopeResult =
  | { status: 'resolved'; scope: ResolvedScope; assumed?: AssumedDate; dates?: DatesRead }
  | { status: 'need_more_detail'; issues: ScopeIssue[] }
const unique = (values: string[]) => [...new Set(values)].sort()

const nonValueWords = new Set(
  'a an and as at before between by during for from in last next of on over per since the this through to until up with within'.split(
    ' ',
  ),
)

/**
 * What a reply says when Heed read a question at today because it gave no dates: the day, its
 * time zone and why, as data, with a sentence for the person (`note`); for the check report,
 * which items a day gives and how to ask about another period (`statement`); and the instruction
 * to say it.
 */
export function assumedDate(assumed: AssumedDate) {
  const day = dayWords(assumed.date)
  // The words an agent says to the person, so they read as a person says them (voice.md).
  const sentence = `I assumed today, ${fullDayWords(assumed.date)}. Tell me if you meant a different period.`
  return {
    note: { ...assumed, sentence },
    instruction: `The question gave no dates, so today was assumed (assumed_date). Say so in your answer: "${sentence}"`,
    statement: `No dates were given, so today was assumed, ${day} (UTC), with the items that apply on that day: an item that starts after it or ended before it is not given. For another period, call again with window.`,
  }
}

/** A name or a period found in a question, by where it is in the words as written. */
export type Span = DateSpan & { keys?: string[]; dates?: true }

/**
 * The vocabulary terms a text names by whole, longest phrases (FR-107: names and other names
 * count as the term), with where each is in the words as written (`spans`). `use` says which kinds
 * to keep: a structured field the caller gave wins over the words. A phrase that names several
 * terms is ambiguous: it chooses none, and `ambiguous` says which it could be. A source member name
 * counts only when its view is one a term points at, or when it is the whole text (CON-517).
 */
export function termsInText(
  question: string,
  terms: readonly Term[],
  use: { metrics: boolean; dimensions: boolean } = { metrics: true, dimensions: true },
) {
  const metrics: string[] = []
  const filters: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  const ambiguous: ScopeIssue[] = []
  const spans: Span[] = []
  const { text, at } = normalizeWithMap(question)
  // A place in the normalised text as a place in the words as written.
  const written = ({ start, end }: DateSpan): DateSpan => {
    const last = at[end - 1]!
    return { start: at[start]!, end: last + (question.codePointAt(last)! > 0xffff ? 2 : 1) }
  }
  const names = new Map<string, Term[]>()
  for (const term of terms) {
    for (const name of namesOf(term)) {
      const matches = names.get(name) ?? []
      if (!matches.some((match) => match.key === term.key)) matches.push(term)
      names.set(name, matches)
    }
  }
  const occupied = new Set<number>()
  // A source member name no term points at ("traffic.sessions") is not read as the names in it
  // ("sessions"): that would answer for another metric without saying so. It asks instead.
  const kinds = (term: Term) =>
    term.kind === 'dimension_value' || term.kind === 'dimension' ? use.dimensions : use.metrics
  for (const member of memberTokens(text, terms)) {
    if (names.has(member.name) || (!use.metrics && !use.dimensions)) continue
    for (let i = member.start; i < member.end; i++) occupied.add(i)
    const options = suggestTerms(
      member.name,
      terms.filter((term) => term.kind !== 'dimension_value' && kinds(term)),
    )
    ambiguous.push({
      field: 'scope',
      input: member.name,
      options,
      message: unknownName(member.name, ['metric', 'dimension'], options, terms),
    })
  }
  for (const { name, start, end } of phrasesIn(text, names.keys(), occupied).found) {
    const relevant = names.get(name)!.filter(kinds)
    if (!relevant.length) continue
    spans.push({ ...written({ start, end }), keys: relevant.map((term) => term.key).sort() })
    if (relevant.length > 1)
      ambiguous.push({
        field: 'scope',
        input: name,
        options: relevant.map((term) => term.key).sort(),
      })
    else {
      const term = relevant[0]!
      if (term.kind === 'dimension_value') (filters[term.parentKey!] ??= []).push(term.key)
      else if (term.kind === 'dimension') filters[term.key] ??= []
      else metrics.push(term.key)
    }
  }
  return { text, occupied, metrics, filters, ambiguous, spans, written }
}

/**
 * The names and the period of a question, read once for every reader: get_facts, find_facts,
 * report_gap, improve_question and Try it. The dates are read in the words the names did not take
 * (`readDates`).
 */
function readWords(
  question: string,
  terms: readonly Term[],
  today: string,
  use?: { metrics: boolean; dimensions: boolean },
) {
  const found = termsInText(question, terms, use)
  let dates: ReturnType<typeof readDates>
  try {
    dates = readDates(found.text, today, { taken: found.occupied })
  } catch {
    dates = {
      status: 'unreadable',
      spans: [],
      message: `The dates in the question cannot be read. ${whatHeedReads(today)}`,
    }
  }
  const dated = dates.status === 'none' ? [] : dates.spans
  const words = dated.map((span) => found.written(span))
  return {
    ...found,
    dates,
    dated: new Set(
      dated.flatMap(({ start, end }) => Array.from({ length: end - start }, (_, i) => start + i)),
    ),
    datesWords: words.map(({ start, end }) => question.slice(start, end)).join(', '),
    spans: [...found.spans, ...words.map((span) => ({ ...span, dates: true as const }))].sort(
      (a, b) => a.start - b.start,
    ),
  }
}

const kindWords: Record<Term['kind'], string> = {
  metric: 'metric',
  metric_group: 'metric group',
  dimension: 'dimension',
  dimension_value: 'value',
}
/**
 * A name Heed does not know, in words, with the closest names it does: "No metric in Heed has
 * the member traffic.sessions as its definition. Did you mean Sessions (metric:sessions)?"
 */
export function unknownName(
  input: string,
  kinds: readonly Term['kind'][],
  suggestions: readonly string[],
  terms: readonly Term[],
): string {
  const what = [...new Set(kinds.map((kind) => kindWords[kind]))].join(' or ')
  const near = suggestions.slice(0, 3).map((key) => {
    const term = terms.find((t) => t.key === key)
    return term ? `${term.name} (${key})` : key
  })
  const words =
    near.length < 2 ? near.join('') : `${near.slice(0, -1).join(', ')} or ${near.at(-1)}`
  return `${
    isMemberName(input)
      ? `No ${what} has the member ${input} as its definition.`
      : `There is no ${what} named '${input}'.`
  }${near.length ? ` Did you mean ${words}?` : ''}`
}

/**
 * Structured fields take precedence. Text extraction uses whole, longest vocabulary phrases, and
 * the dates in the words are read by `readDates`, which says how it read them (`dates`). Dates the
 * words give are never replaced: words Heed cannot read as dates ask for them, and say what Heed
 * reads. A question that gives no dates is read at today, and the result says so (`assumed`),
 * unless `datesRequired` asks for dates, as improve_question does to coach a question (FR-307).
 */
export function extractScope(
  question: string,
  terms: readonly Term[],
  today: string,
  structured: ScopeInput = {},
  { datesRequired = false }: { datesRequired?: boolean } = {},
): ScopeResult {
  calendarDateSchema.parse(today)
  const issues: ScopeIssue[] = []
  const metrics: string[] = []
  const filters: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  const resolve = (value: string, kinds: Term['kind'][], field: string, parent?: string) => {
    const result = resolveTerm(value, terms, kinds, parent)
    if (result.status === 'resolved') return result.key
    const suggestions = suggestTerms(
      value,
      terms.filter(
        (term) => kinds.includes(term.kind) && (parent === undefined || term.parentKey === parent),
      ),
    )
    issues.push({
      field,
      input: value,
      options: suggestions.length ? suggestions : result.options,
      message: unknownName(value, kinds, suggestions, terms),
    })
    return undefined
  }
  for (const value of structured.metrics ?? []) {
    const key = resolve(value, ['metric', 'metric_group'], 'metrics')
    if (key) metrics.push(key)
  }
  for (const [dimension, values] of Object.entries(structured.filters ?? {})) {
    const key = resolve(dimension, ['dimension'], 'filters')
    if (!key) continue
    filters[key] = []
    for (const value of values) {
      const valueKey = resolve(value, ['dimension_value'], key, key)
      if (valueKey) filters[key].push(valueKey)
    }
  }
  const found = readWords(question, terms, today, {
    metrics: structured.metrics === undefined,
    dimensions: structured.filters === undefined,
  })
  const { text, occupied, dated } = found
  issues.push(...found.ambiguous)
  metrics.push(...found.metrics)
  for (const [dimension, values] of Object.entries(found.filters))
    (filters[dimension] ??= []).push(...values)
  // Explicit "dimension: value" and "dimension value" forms expose unknown values.
  if (structured.filters === undefined)
    for (const dimension of terms.filter((term) => term.kind === 'dimension')) {
      for (const alias of [dimension.name, ...dimension.aliases]) {
        const escaped = normalizeName(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        for (const match of text.matchAll(
          new RegExp(`\\b${escaped}\\s*:?\\s+([\\p{L}\\p{N}_-]+)`, 'gu'),
        )) {
          const value = match[1]!
          const valueStart = match.index + match[0].lastIndexOf(value)
          if (
            !occupied.has(valueStart) &&
            !dated.has(valueStart) &&
            value !== 'all' &&
            !nonValueWords.has(value)
          )
            resolve(value, ['dimension_value'], dimension.key, dimension.key)
        }
      }
    }
  let window: DateWindow | null = structured.window ?? null
  let assumed: AssumedDate | undefined
  let dates: DatesRead | undefined
  if (structured.window === undefined) {
    const read = found.dates
    if (read.status === 'read') {
      window = read.window
      dates = { words: found.datesWords, reads_as: read.readsAs }
    } else if (read.status === 'unreadable')
      issues.push({ field: 'dates', input: found.datesWords, options: [], message: read.message })
    else if (datesRequired)
      issues.push({
        field: 'dates',
        input: question,
        options: [],
        message: `The question gives no dates. ${whatHeedReads(today)}`,
      })
    else {
      window = { start: today, end: shiftDate(today, 1) }
      assumed = { date: today, time_zone: 'UTC', reason: 'no date given' }
    }
  } else if (!dateWindowSchema.safeParse(window).success || window?.end === null)
    issues.push({ field: 'dates', input: question, options: [] })
  // A named dimension is scope on its own: an item about that dimension with any value applies.
  if (!metrics.length && !Object.keys(filters).length)
    issues.push({
      field: 'scope',
      input: question,
      options: terms
        .filter((term) => term.kind === 'metric')
        .map((term) => term.key)
        .sort(),
    })
  if (issues.length) return { status: 'need_more_detail', issues }
  return {
    status: 'resolved',
    scope: {
      metrics: unique(metrics),
      filters: Object.fromEntries(
        Object.entries(filters)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, values]) => [key, unique(values)]),
      ),
      window: window!,
    },
    ...(assumed ? { assumed } : {}),
    ...(dates ? { dates } : {}),
  }
}

/**
 * A question read as a scope, so Try it opens on what was asked (FR-602: the question is read in
 * memory and never kept). The metrics, dimensions and values come from the same whole, longest
 * phrases get_facts reads, and a phrase that names several terms chooses none and is said
 * (`issues`). The dates are get_facts's own (`readDates`), with how they were read (`dates`).
 * Unlike get_facts, a question that names only part of a scope still gives that part: the person
 * sees it and completes it. `spans` says where each name and the dates are in the question.
 */
export function readQuestion(
  question: string,
  terms: readonly Term[],
  today: string,
): {
  terms: Term[]
  window: DateWindow | null
  dates: DatesRead | null
  issues: ScopeIssue[]
  spans: Span[]
} {
  calendarDateSchema.parse(today)
  const found = readWords(question, terms, today)
  const keys = [
    ...unique(found.metrics),
    ...Object.entries(found.filters)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([dimension, values]) => (values.length ? unique(values) : [dimension])),
  ]
  const byKey = new Map(terms.map((term) => [term.key, term]))
  const { dates } = found
  return {
    terms: keys.flatMap((key) => byKey.get(key) ?? []),
    window: dates.status === 'read' ? dates.window : null,
    dates: dates.status === 'read' ? { words: found.datesWords, reads_as: dates.readsAs } : null,
    issues: [
      ...found.ambiguous,
      ...(dates.status === 'unreadable'
        ? [{ field: 'dates', input: found.datesWords, options: [], message: dates.message }]
        : []),
    ],
    spans: found.spans,
  }
}

const definitionWords =
  /^(what is|what are|what s)\b|\b(mean|means|meaning|measures?|measured|defined?|defines|definitions?|stands? for|refers? to|counts? as|calculated?|calculates|calculation|worked out|formula)\b/
/**
 * Whether a question asks what a metric is, how it is worked out or where its definition comes
 * from ("What does net revenue mean?", "What counts as an active customer?"), not only about its
 * data. A question that only starts "What is" counts too: the definition does no harm there.
 */
export function asksDefinition(question: string): boolean {
  return definitionWords.test(
    normalizeName(question)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim(),
  )
}
