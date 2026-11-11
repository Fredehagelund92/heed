import { dayWords, fullDayWords, readDates, whatHeedReads, type DateSpan } from './dates.ts'
import { calendarDateSchema, dateWindowSchema, shiftDate, type DateWindow } from './validity.ts'
import {
  isMemberName,
  memberTokens,
  namesOf,
  normalizeName,
  normalizeWithMap,
  phrasesIn,
  refView,
  resolveTerm,
  suggestTerms,
  type ContestedWord,
  type Term,
  type WordMeaning,
} from './vocabulary.ts'
import { DEFAULT_PRODUCT_NAME } from './brand.ts'
import { everydayWords, isEverydayWord, saysHow } from './everyday-words.ts'

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
  /** Read the words' dates as a person writes them (`readDates`): Ask's, never an agent's. */
  loose?: boolean
}
/**
 * A part of the scope Heed could not read. `message`, for a name it does not know, says so and
 * names the closest it does, so the caller can recover without guessing (FR-341). A word with
 * more than one meaning says how a person writes it (`word`) and each meaning (`meanings`): Heed
 * never chooses one.
 */
export type ScopeIssue = {
  field: string
  input: string
  options: string[]
  message?: string
  word?: string
  meanings?: WordMeaning[]
}
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
/** The rest of a question that stopped at a word: its names and dates, null when it gave none. */
export type HeldScope = Omit<ResolvedScope, 'window'> & { window: DateWindow | null }
export type ScopeResult =
  | { status: 'resolved'; scope: ResolvedScope; assumed?: AssumedDate; dates?: DatesRead }
  | { status: 'need_more_detail'; issues: ScopeIssue[]; held?: HeldScope }
const unique = (values: string[]) => [...new Set(values)].sort()

/** The words of a term as a person writes them, the one that reads as `name` first. */
const writtenAs = (term: Term, name: string) =>
  [term.name, ...term.aliases].find((n) => normalizeName(n) === name) ?? name

/**
 * A phrase with more than one meaning, as a question reads it, or null when it has one: the
 * meanings `servedWords` found for the word, or the names several terms share. `relevant` are the
 * terms the caller still leaves open: a metric it names itself wins over the words.
 */
function contestedPhrase(name: string, relevant: readonly Term[]): ContestedWord | null {
  const claim = relevant.flatMap((term) => term.contested ?? []).find((c) => c.word === name)
  const meanings =
    claim?.meanings.filter(
      (m) => m.key.startsWith('term:') || relevant.some((term) => term.key === m.key),
    ) ??
    relevant
      .map((term) => ({ key: term.key, name: term.name }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
  if (meanings.length < 2) return null
  return { word: name, said: claim?.said ?? writtenAs(relevant[0]!, name), meanings }
}

const nonValueWords = new Set(
  'a an and as at before between by during for from in last next of on over per since the this through to until up with within'.split(
    ' ',
  ),
)
/**
 * The dimensions a value word Heed does not know could be a value of: those with values that the
 * metrics can be split by, or every dimension with values when no metric says.
 */
function valueDimensions(terms: readonly Term[], metrics: readonly string[]): Term[] {
  const valued = terms.filter(
    (term) => term.kind === 'dimension' && terms.some((value) => value.parentKey === term.key),
  )
  const sliced = valued.filter(splitsOf(terms, metrics))
  return sliced.length ? sliced : valued
}

/** Whether two words are one typo apart: a letter added, left out, changed or swapped. */
function oneTypoApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    )
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** The words after which a value goes: "orders in Jordan", "orders from the Nordics". */
const valuePlaces = new Set(['in', 'for', 'from', 'to', 'at', 'across'])

/** A word Heed does not know where a value goes, and what is beside it. */
type UnknownValue = DateSpan & {
  /** The dimension whose name is right after it ("the jordan market"), else null. */
  dimension: string | null
  /** The values it is one typo from ("norwy"), or the short code it is written as ("uk"). */
  near: string[]
}

/**
 * The words of a question that sit where a value goes and name nothing Heed knows (L4): after in,
 * for, from, to, at or across, with or without "the" ("orders from jordan", "orders in the
 * nordics"); right before a metric ("jordan orders"); or right before a dimension's name ("the
 * jordan market"), which then says which dimension. Each is a value Heed does not have, said and
 * never dropped: one word, or a run of words in Title case ("New York"). None is an everyday word
 * ("orders in total", "revenue in gbp"), a number, a word in capitals ("GBP", "YTD"), a plural
 * right after the place word ("orders in stores"), another form of a name Heed knows ("markets"),
 * nor the name of the product or of a tool a definition comes from ("cube"). A short code written
 * in lowercase ("orders in uk") is said with the value it would be. Before a metric, only a word
 * that starts what is asked counts ("jordan orders", not "who owns orders"); after "to" that
 * follows an everyday word, a lowercase word is a verb ("going to recover"); and right before a
 * metric, a lowercase word ending in -ed is a participle ("cancelled orders"). Places in the
 * normalised text.
 *
 * These rules by place are kept deliberately small: this is their fourth narrowing, and each one
 * trades a missed unknown word for fewer false alarms. The principled fix is value linking V2:
 * one index of every value name, with near-miss asking, so that a value word is known by the
 * list, not guessed from where it sits.
 */
function unknownValuesByPlace(
  found: Pick<
    ReturnType<typeof readWords>,
    'text' | 'occupied' | 'dated' | 'named' | 'codes' | 'names'
  > & {
    written: (span: DateSpan) => DateSpan
  },
  question: string,
  terms: readonly Term[],
  values: readonly Term[],
): UnknownValue[] {
  const { text, occupied, dated, named, codes } = found
  const words = [...text.matchAll(/[\p{L}\p{N}_'-]+/gu)].map((match) => {
    const start = match.index
    const end = start + match[0].length
    const at = found.written({ start, end })
    const free = !Array.from({ length: end - start }, (_, i) => start + i).some(
      (i) => occupied.has(i) || dated.has(i),
    )
    return { word: match[0], start, end, free, as: question.slice(at.start, at.end) }
  })
  const titled = (i: number) => /^\p{Lu}\p{Ll}+$/u.test(words[i]?.as ?? '')
  const known = found.names
  const tools = new Set([
    normalizeName(DEFAULT_PRODUCT_NAME),
    ...terms.flatMap((t) => t.definitionRefs.map((ref) => normalizeName(ref.split(':')[0]!))),
  ])
  const nameAt = (i: number) => named.find((n) => n.start === words[i]?.start)
  const unknown: UnknownValue[] = []
  for (let i = 0; i < words.length; i++) {
    if (!words[i]!.free) continue
    // A run of words in Title case is one name ("New York"); other words count one by one.
    let j = i
    while (
      titled(i) &&
      j - i < 2 &&
      words[j + 1]?.free &&
      titled(j + 1) &&
      !nonValueWords.has(words[j + 1]!.word)
    )
      j++
    const run = words.slice(i, j + 1)
    const code = codes.find((c) => c.start === words[i]!.start && c.end === words[j]!.end)
    const word = run.map((w) => w.word).join(' ')
    const value =
      run.every((w) => /^\p{L}[\p{L}'-]*$/u.test(w.word) && !/^\p{Lu}{2,}$/u.test(w.as)) &&
      (code
        ? !everydayWords.has(word)
        : run.some((w) => !isEverydayWord(w.word)) &&
          (run.length > 1 || word.length >= 3) &&
          !tools.has(word) &&
          !known.has(word.replace(/'s$/, '')) &&
          !known.has(word.replace(/e?s$/, '')))
    const p = words[i - 1]?.word === 'the' ? i - 2 : i - 1
    // After "to" that follows an everyday word, a lowercase word is a verb: "going to recover".
    const infinitive =
      words[p]?.word === 'to' &&
      !titled(i) &&
      p > 0 &&
      words[p - 1]!.free &&
      isEverydayWord(words[p - 1]!.word)
    const after = p >= 0 && words[p]!.free && valuePlaces.has(words[p]!.word) && !infinitive
    // Before a name, a word after another word that is no everyday word, no place word and no
    // value's name is part of what it names, not a value: "store credit orders", "gift card orders".
    const before = words[i - 1]
    const compound =
      before !== undefined &&
      !valuePlaces.has(before.word) &&
      !isEverydayWord(before.word) &&
      !saysHow(before.word, titled(i - 1)) &&
      !named.find((n) => n.end === before.end)?.keys.every((k) => k.startsWith('val:'))
    const next = compound ? undefined : nameAt(j + 1)
    // Before a metric, only a word that starts what is asked counts: "jordan orders", "the jordan
    // orders", never one after a question word or a verb ("who owns orders", "how do i read sales").
    const opens =
      i === 0 || ['the', 'and', 'or'].includes(before!.word) || valuePlaces.has(before!.word)
    // Right before a metric, a lowercase word ending in -ed is a participle: "cancelled orders".
    const participle = run.length === 1 && /ed$/.test(word) && !titled(i)
    const beforeMetric =
      opens &&
      !participle &&
      !!next?.keys.some((k) => k.startsWith('metric:') || k.startsWith('group:'))
    const dimension =
      next?.keys.length === 1 && next.keys[0]!.startsWith('dim:') ? next.keys[0]! : null
    // A word before a day's name is part of that day's name: "black friday week", "boxing day".
    if (/^(?:mon|tues|wednes|thurs|fri|satur|sun)?day$/.test(words[j + 1]?.word ?? '')) {
      i = j
      continue
    }
    // "orders in stores" says how, "orders in the Nordics" which: a plural needs "the" or a name.
    const plural =
      run.length === 1 && /[^siu]s$/.test(word) && p === i - 1 && !beforeMetric && !dimension
    if (value && (after || beforeMetric || dimension) && !plural) {
      const near = code
        ? code.keys
        : run.length === 1 && word.length >= 4
          ? values
              .filter(
                (v) =>
                  (!dimension || v.parentKey === dimension) &&
                  namesOf(v).some((n) => oneTypoApart(word, n)),
              )
              .map((v) => v.key)
          : []
      unknown.push({ start: words[i]!.start, end: words[j]!.end, dimension, near })
    }
    i = j
  }
  return unknown
}

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

/** A name of 3 letters or fewer its owner wrote in capitals: "NO", "UK", "BF". */
const isCode = (name: string) => /^\p{Lu}{1,3}$/u.test(name)
/** Two names side by side, with a colon or "the" between them at most: "the Alder brand". */
const beside = (text: string, a: DateSpan, b: DateSpan) => {
  const [first, second] = a.start < b.start ? [a, b] : [b, a]
  return /^ ?:? ?(?:the )?$/.test(text.slice(first.end, second.start))
}
/** The dimensions whose views a metric is in: the dimensions it can be split by. */
function splitsOf(terms: readonly Term[], metrics: readonly string[]) {
  const views = new Set(
    terms
      .filter((term) => metrics.includes(term.key))
      .flatMap((term) => term.definitionRefs.map(refView))
      .filter((view) => view !== null),
  )
  return (dimension: Term) => dimension.definitionRefs.some((ref) => views.has(refView(ref) ?? ''))
}

/**
 * The vocabulary terms a text names by whole, longest phrases (FR-107: names and other names
 * count as the term), with where each is in the words as written (`spans`). `use` says which kinds
 * to keep: a structured field the caller gave wins over the words. A phrase that names several
 * terms is ambiguous: it chooses none, and `ambiguous` says which it could be. A source member name
 * counts only when its view is one a term points at, or when it is the whole text (CON-517).
 *
 * A value word with several meanings is first narrowed, never guessed: a dimension's name beside
 * it keeps that dimension's value ("the Alder brand", "brand Alder"), and is then no split by that
 * dimension; else the metrics the question names, and those the caller `given`, keep the values of
 * dimensions they can be split by. In Ask (`loose`), a short code ("NO", "UK") is read only when
 * written in capitals or beside its dimension's name, so "no" and "it" stay everyday words; agents
 * read it in any case, as before.
 */
export function termsInText(
  question: string,
  terms: readonly Term[],
  use: { metrics: boolean; dimensions: boolean } = { metrics: true, dimensions: true },
  given: readonly string[] = [],
  loose = false,
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
  const byKey = new Map(terms.map((term) => [term.key, term]))
  const isDimension = (keys: readonly Term[], key: string) =>
    keys.length === 1 && keys[0]!.kind === 'dimension' && keys[0]!.key === key
  const read = phrasesIn(text, names.keys(), occupied)
    .found.map((phrase) => ({ ...phrase, relevant: names.get(phrase.name)!.filter(kinds) }))
    .filter((phrase) => phrase.relevant.length)
  // Short codes written as everyday words, with the values they would be: "uk" for UK.
  const codes: (DateSpan & { keys: string[] })[] = []
  for (const phrase of read) {
    const asWritten = question.slice(written(phrase).start, written(phrase).end)
    const all = phrase.relevant
    phrase.relevant = phrase.relevant.filter((term) => {
      // Agents read a short code in any case, as before; Ask reads it only in capitals.
      if (term.kind !== 'dimension_value' || !loose) return true
      const as = [term.name, ...term.aliases].filter((n) => normalizeName(n) === phrase.name)
      return (
        !as.length ||
        !as.every(isCode) ||
        isCode(asWritten) ||
        read.some(
          (other) => isDimension(other.relevant, term.parentKey!) && beside(text, phrase, other),
        )
      )
    })
    // A short code written as an everyday word ("no") is no name here: its words stay free.
    if (!phrase.relevant.length) {
      for (let i = phrase.start; i < phrase.end; i++) occupied.delete(i)
      codes.push({ start: phrase.start, end: phrase.end, keys: all.map((term) => term.key) })
    }
  }
  const named = read.filter((phrase) => phrase.relevant.length)
  const splits = splitsOf(terms, [
    ...given,
    ...named.flatMap((p) =>
      p.relevant.length === 1 && p.relevant[0]!.kind === 'metric' ? [p.relevant[0]!.key] : [],
    ),
  ])
  const hints = new Set<(typeof named)[number]>()
  for (const phrase of named) {
    if (!phrase.relevant.every((term) => term.kind === 'dimension_value')) continue
    const hint = named.find(
      (other) =>
        other.relevant.length === 1 &&
        phrase.relevant.some((term) => isDimension(other.relevant, term.parentKey!)) &&
        beside(text, phrase, other),
    )
    if (hint) {
      hints.add(hint)
      phrase.relevant = phrase.relevant.filter((term) => term.parentKey === hint.relevant[0]!.key)
      continue
    }
    const inData = phrase.relevant.filter((term) => {
      const dimension = byKey.get(term.parentKey!)
      return dimension !== undefined && splits(dimension)
    })
    if (inData.length) phrase.relevant = inData
  }
  for (const phrase of named) {
    const { name, start, end, relevant } = phrase
    spans.push({ ...written({ start, end }), keys: relevant.map((term) => term.key).sort() })
    if (hints.has(phrase)) continue
    const contested = contestedPhrase(name, relevant)
    if (contested)
      ambiguous.push({
        field: 'scope',
        input: name,
        options: contested.meanings.map((m) => m.key).sort(),
        word: contested.said,
        meanings: contested.meanings,
      })
    else {
      const term = relevant[0]!
      if (term.kind === 'dimension_value') (filters[term.parentKey!] ??= []).push(term.key)
      else if (term.kind === 'dimension') filters[term.key] ??= []
      else metrics.push(term.key)
    }
  }
  return {
    text,
    occupied,
    metrics,
    filters,
    ambiguous,
    spans,
    written,
    names,
    named: named.map(({ start, end, relevant }) => ({
      start,
      end,
      keys: relevant.map((term) => term.key),
    })),
    codes,
  }
}

/**
 * The names and the period of a question, read once for every reader: get_context, find_context,
 * report and Ask. The dates are read in the words the names did not take
 * (`readDates`).
 */
function readWords(
  question: string,
  terms: readonly Term[],
  today: string,
  use?: { metrics: boolean; dimensions: boolean },
  loose = false,
  given: readonly string[] = [],
) {
  const found = termsInText(question, terms, use, given, loose)
  let dates: ReturnType<typeof readDates>
  try {
    dates = readDates(found.text, today, { taken: found.occupied, loose })
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
 * A value word Heed does not know, in words, with the dimensions it could be a value of and the
 * closest values: "There is no value of Market named 'Jordan'."
 */
export function unknownValue(
  input: string,
  dimensions: readonly Term[],
  suggestions: readonly string[],
  terms: readonly Term[],
): string {
  const names = dimensions.map((d) => d.name)
  const of =
    names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
  const near = suggestions.slice(0, 3).map((key) => terms.find((t) => t.key === key)?.name ?? key)
  const words =
    near.length < 2 ? near.join('') : `${near.slice(0, -1).join(', ')} or ${near.at(-1)}`
  return `There is no value of ${of} named '${input}'.${near.length ? ` Did you mean ${words}?` : ''}`
}

/**
 * Structured fields take precedence. Text extraction uses whole, longest vocabulary phrases, and
 * the dates in the words are read by `readDates`, which says how it read them (`dates`). Dates the
 * words give are never replaced: words Heed cannot read as dates ask for them, and say what Heed
 * reads. A question that gives no dates is read at today, and the result says so (`assumed`).
 */
export function extractScope(
  question: string,
  terms: readonly Term[],
  today: string,
  structured: ScopeInput = {},
): ScopeResult {
  calendarDateSchema.parse(today)
  const issues: ScopeIssue[] = []
  const metrics: string[] = []
  const filters: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  const resolve = (value: string, kinds: Term['kind'][], field: string, parent?: string) => {
    const result = resolveTerm(value, terms, kinds, parent)
    if (result.status === 'resolved') return result.key
    const contested = result.named
      ? contestedPhrase(
          normalizeName(value),
          terms.filter((t) => result.options.includes(t.key)),
        )
      : null
    if (contested) {
      issues.push({
        field,
        input: value,
        options: result.options,
        word: contested.said,
        meanings: contested.meanings,
      })
      return undefined
    }
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
  const found = readWords(
    question,
    terms,
    today,
    { metrics: structured.metrics === undefined, dimensions: structured.filters === undefined },
    structured.loose,
    metrics,
  )
  const { text, occupied, dated } = found
  issues.push(...found.ambiguous)
  metrics.push(...found.metrics)
  for (const [dimension, values] of Object.entries(found.filters))
    (filters[dimension] ??= []).push(...values)
  // Explicit "dimension: value" and "dimension value" forms expose unknown values; an everyday
  // word after a dimension's name says how, not which ("how is the mobile team doing").
  if (structured.filters === undefined)
    for (const dimension of terms.filter((term) => term.kind === 'dimension')) {
      for (const alias of [dimension.name, ...dimension.aliases]) {
        const escaped = normalizeName(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        for (const match of text.matchAll(
          new RegExp(`\\b${escaped}\\s*:?\\s+([\\p{L}\\p{N}_-]+)`, 'gu'),
        )) {
          const value = match[1]!
          const valueStart = match.index + match[0].lastIndexOf(value)
          if (!occupied.has(valueStart) && !dated.has(valueStart) && !isEverydayWord(value))
            resolve(value, ['dimension_value'], dimension.key, dimension.key)
        }
      }
    }
  const dimensions = valueDimensions(terms, metrics)
  const valuesOf = (dimension: Term) =>
    terms.filter((term) => term.kind === 'dimension_value' && term.parentKey === dimension.key)
  // A value word Heed does not know, where a value goes, is said, never dropped: Ask's rule only
  // (`loose`), on a question that names something to look up; agents read as before.
  if (
    structured.loose &&
    structured.filters === undefined &&
    dimensions.length &&
    (metrics.length || Object.keys(filters).length)
  )
    for (const span of unknownValuesByPlace(found, question, terms, dimensions.flatMap(valuesOf))) {
      const of = span.dimension ? terms.filter((t) => t.key === span.dimension) : dimensions
      const values = of.flatMap(valuesOf)
      // The words as the person wrote them: "Jordan", not "jordan".
      const written = found.written(span)
      const value = question.slice(written.start, written.end)
      issues.push({
        field: of.length === 1 ? of[0]!.key : 'values',
        input: value,
        options: span.near.length
          ? span.near
          : values
              .map((term) => term.key)
              .sort()
              .slice(0, 25),
        message: unknownValue(value, of, span.near, terms),
      })
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
    else {
      window = { start: today, end: shiftDate(today, 1) }
      assumed = { date: today, time_zone: 'UTC', reason: 'no date given' }
    }
  } else if (!dateWindowSchema.safeParse(window).success || window?.end === null)
    issues.push({ field: 'dates', input: question, options: [] })
  // A named dimension is scope on its own: an item about that dimension with any value applies.
  // A word with two meanings is the one thing to settle: it needs no list of other metrics.
  const contested = issues.some((issue) => issue.meanings)
  if (!metrics.length && !Object.keys(filters).length && !contested)
    issues.push({
      field: 'scope',
      input: question,
      options: terms
        .filter((term) => term.kind === 'metric')
        .map((term) => term.key)
        .sort(),
    })
  const read = {
    metrics: unique(metrics),
    filters: Object.fromEntries(
      Object.entries(filters)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, values]) => [key, unique(values)]),
    ),
  }
  if (issues.length)
    return {
      status: 'need_more_detail',
      issues,
      ...(contested ? { held: { ...read, window: assumed ? null : window } } : {}),
    }
  return {
    status: 'resolved',
    scope: { ...read, window: window! },
    ...(assumed ? { assumed } : {}),
    ...(dates ? { dates } : {}),
  }
}

/**
 * A question read as a scope, so Try it opens on what was asked (FR-602: the question is read in
 * memory and never kept). The metrics, dimensions and values come from the same whole, longest
 * phrases get_context reads, and a phrase that names several terms chooses none and is said
 * (`issues`). The dates are get_context's own (`readDates`), with how they were read (`dates`).
 * Unlike get_context, a question that names only part of a scope still gives that part: the person
 * sees it and completes it. `spans` says where each name and the dates are in the question.
 */
export function readQuestion(
  question: string,
  terms: readonly Term[],
  today: string,
  { loose = false }: { loose?: boolean } = {},
): {
  terms: Term[]
  window: DateWindow | null
  dates: DatesRead | null
  /** With `loose`: words that name dates Heed could not place, so every date was read. */
  unplaced?: string[]
  issues: ScopeIssue[]
  spans: Span[]
} {
  calendarDateSchema.parse(today)
  const found = readWords(question, terms, today, undefined, loose)
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
    ...(dates.status === 'read' && dates.unplaced ? { unplaced: dates.unplaced } : {}),
    issues: [
      ...found.ambiguous,
      ...(dates.status === 'unreadable'
        ? [{ field: 'dates', input: found.datesWords, options: [], message: dates.message }]
        : []),
    ],
    spans: found.spans,
  }
}

const whatIsWords = /^(what is|what are|what s)\b/
const meaningWords =
  /\b(mean|means|meaning|measures?|measured|defined?|defines|definitions?|stands? for|refers? to|counts? as|calculated?|calculates|calculation|worked out|formula)\b/
const wordsOf = (question: string) =>
  normalizeName(question)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()

/**
 * Whether a question asks what a metric is, how it is worked out or where its definition comes
 * from ("What does net revenue mean?", "What counts as an active customer?"), not only about its
 * data. A question that only starts "What is" counts too: the definition does no harm there.
 */
export function asksDefinition(question: string): boolean {
  const t = wordsOf(question)
  return whatIsWords.test(t) || meaningWords.test(t)
}

/**
 * Whether Ask shows the definitions of what a question names: when it asks what they are, and when
 * it asks how two differ, which their definitions say. Agents get them as `asksDefinition` says.
 */
export const asksDefinitionInAsk = (question: string) =>
  asksDefinition(question) || /\bdifference between\b/.test(wordsOf(question))

/**
 * Whether a question asks what a metric is or means, so that in Ask its definition is the answer
 * and comes first ("What is discount cost?", "What does churn rate mean?"). Words about meaning
 * always count; a question that only starts "What is" counts when it names no market and no
 * dates, since "What is churn rate in Norway this month?" asks for the data. Agents get the
 * definition as `asksDefinition` says, whatever this says.
 */
export function asksWhatItIs(question: string, read: { values: boolean; dates: boolean }) {
  const t = wordsOf(question)
  return meaningWords.test(t) || (whatIsWords.test(t) && !read.values && !read.dates)
}
