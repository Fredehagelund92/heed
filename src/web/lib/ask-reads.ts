import type { Scope } from '@domain/item'
import type { QuestionScope } from '../../contract/assistant.ts'
import type { TryItReading } from '@/api'
import { datesOf, type AskDraft } from '@/lib/ask-draft'
import { addToScope, scopeKeys } from '@/lib/mention-targets'
import { emptyScope, type TryItScope } from '@/lib/try-it'

/*
  What Heed reads for the question being typed (Ask composer, the "Heed reads" line): the chips in
  the question (stage 2), the terms its other words name, what was picked with the scope picker
  for this question, and what is carried from the last question, with one period. The question
  owns its scope: the chips, the words and the picker win over what is carried, kind by kind (a
  metric typed replaces the metrics carried, a market typed the markets carried), and the dates
  come from a dates chip, then the words, then the picker, then the last question, else today is
  assumed. The line shows exactly this, and the question is sent with it
  (`wire`), so the assistant's tool calls read what the person saw. Chips of accepted items and
  domains go with the question too (`about`): get_context has no field for them, so they are not
  on the line, and the assistant is told what each one is. They belong to that question alone and
  are never carried. Pure, so the line, the send, the stories and the tests read a question the
  same way.
*/

/** Where a term on the line comes from: a chip in the question, its other words, the picker, the last question. */
export type ReadSource = 'tagged' | 'typed' | 'picked' | 'carried'
/**
 * Where the dates come from: the line's date chip says which. A dates chip in the question is
 * `tagged`; it goes to the service as `typed`, since the chip stands in the question's words.
 */
export type WindowSource = QuestionScope['window_source'] | 'tagged'

export type ReadTerm = { key: string; source: ReadSource }

export type Reads = {
  /** The terms of the question, in the order the line shows them: typed, picked, carried. */
  terms: ReadTerm[]
  /** Words that name more than one term, which the person has not chosen between. */
  undecided: TryItReading['ambiguous']
  /** The question's days, both included; null when today is assumed or the words cannot be read. */
  window: { from: string; to: string } | null
  windowSource: WindowSource
  /** What the period is in words, for dates read in the words ("this year so far"). */
  datesNote: string | null
  /** Words that name dates Heed cannot read. */
  datesProblem: TryItReading['dates_problem']
  /** The day a question without dates is read at. */
  today: string | null
  /** The question's scope as chips: what it is asked about, and what the next one carries. */
  scope: TryItScope
  /** The accepted items and domains the question's chips name, by key, in order. */
  about: string[]
  /** The question's scope as get_context's fields, sent with it and binding its tool calls. */
  wire: QuestionScope
}

/** The dimension a key is about: `val:market/north` and `dim:market` are `dim:market`. */
export function dimensionOf(key: string): string | null {
  if (key.startsWith('dim:')) return key
  if (key.startsWith('val:')) return `dim:${key.slice(4).split('/')[0]}`
  return null
}
const isMetric = (key: string) => key.startsWith('metric:') || key.startsWith('group:')

/** A term added to a scope: a metric group stands with the metrics, as get_context reads it. */
function add(scope: Scope, key: string): Scope {
  if (key.startsWith('group:'))
    return scope.metrics.includes(key) ? scope : { ...scope, metrics: [...scope.metrics, key] }
  return addToScope(scope, key)
}

/** get_context's fields for a scope's terms: metrics, and each dimension with its values. */
function fieldsOf(scope: Scope): Pick<QuestionScope, 'metrics' | 'dimension_filters'> {
  const values = new Map<string, string[]>()
  for (const dimension of scope.dimensions) values.set(dimension, [])
  for (const { dimension, value } of scope.dimensionValues)
    values.set(dimension, [...(values.get(dimension) ?? []), value])
  return {
    metrics: scope.metrics.slice(0, 10),
    dimension_filters: [...values]
      .slice(0, 10)
      .map(([dimension, list]) => ({ dimension, values: list.slice(0, 50) })),
  }
}

/** What the chips of a question name: get_context's scope, and the items and domains beside it. */
export type TaggedScope = TryItScope & { about: string[] }

/** Whether a chip names an accepted item or a domain, which get_context has no field for. */
const isAbout = (key: string) => key.startsWith('item:') || key.startsWith('area:')

/**
 * The scope the chips name: their terms, the days of the last dates chip, and the items and
 * domains. Null when there is no chip.
 */
export function draftTagged(draft: AskDraft): TaggedScope | null {
  let scope = emptyScope
  let days: { from: string; to: string } | null = null
  const about: string[] = []
  let any = false
  for (const part of draft) {
    if (part.kind !== 'mention') continue
    any = true
    const dates = datesOf(part.target)
    if (dates) days = dates
    else if (isAbout(part.target)) {
      if (!about.includes(part.target)) about.push(part.target)
    }
    // A metric group stands with the metrics, as get_context reads it.
    else if (part.target.startsWith('group:'))
      scope = scope.metrics.includes(part.target)
        ? scope
        : { ...scope, metrics: [...scope.metrics, part.target] }
    else scope = addToScope(scope, part.target)
  }
  return any ? { scope, from: days?.from ?? null, to: days?.to ?? null, about } : null
}

export function readsOf({
  reading,
  tagged = null,
  picked,
  carried,
  dropped,
  today,
}: {
  /** How the service read the words; null before they are read, or with no words. */
  reading: TryItReading | null
  /** What the chips in the question name (`draftTagged`). */
  tagged?: TaggedScope | null
  /** What was picked with the scope picker for this question. */
  picked: TryItScope | null
  /** The last question's scope, its dates only when they were not assumed. */
  carried: TryItScope | null
  /** Carried terms the person took off this question, by key, and `window` for the dates. */
  dropped: ReadonlySet<string>
  /** The service's day, when the reading has not given it. */
  today: string | null
}): Reads {
  const inChips = tagged ? scopeKeys(tagged.scope) : []
  const typed = (reading?.about.map((term) => term.key) ?? []).filter(
    (key) => !inChips.includes(key),
  )
  const chosen = picked ? scopeKeys(picked.scope) : []
  const explicit = [...new Set([...inChips, ...typed, ...chosen])]
  const hasMetric = explicit.some(isMetric)
  const dimensions = new Set(explicit.flatMap((key) => dimensionOf(key) ?? []))
  const kept = (carried ? scopeKeys(carried.scope) : []).filter((key) => {
    if (dropped.has(key) || explicit.includes(key)) return false
    if (isMetric(key)) return !hasMetric
    const dimension = dimensionOf(key)
    return !dimension || !dimensions.has(dimension)
  })
  // The chips win over the words, the words over the picker, and all over what is carried, when
  // two terms clash.
  const scope = [...kept, ...chosen, ...typed, ...inChips].reduce(add, emptyScope)
  const inScope = new Set(scopeKeys(scope))
  const terms: ReadTerm[] = [
    ...inChips.filter((key) => inScope.has(key)).map((key) => ({ key, source: 'tagged' as const })),
    ...typed.filter((key) => inScope.has(key)).map((key) => ({ key, source: 'typed' as const })),
    ...chosen
      .filter((key) => inScope.has(key) && !typed.includes(key) && !inChips.includes(key))
      .map((key) => ({ key, source: 'picked' as const })),
    ...kept.filter((key) => inScope.has(key)).map((key) => ({ key, source: 'carried' as const })),
  ]

  const datesProblem = tagged?.from || reading?.from ? null : (reading?.dates_problem ?? null)
  let window: Reads['window'] = null
  let windowSource: WindowSource = 'assumed'
  if (tagged?.from) {
    window = { from: tagged.from, to: tagged.to ?? tagged.from }
    windowSource = 'tagged'
  } else if (reading?.from) {
    window = { from: reading.from, to: reading.to ?? reading.from }
    windowSource = 'typed'
  } else if (picked?.from) {
    window = {
      from: picked.from,
      to: picked.to && picked.to >= picked.from ? picked.to : picked.from,
    }
    windowSource = 'picked'
  } else if (datesProblem) windowSource = 'unreadable'
  else if (carried?.from && !dropped.has('window')) {
    window = { from: carried.from, to: carried.to ?? carried.from }
    windowSource = 'carried'
  }

  const about = tagged?.about.slice(0, 20) ?? []
  const undecided = (reading?.ambiguous ?? []).filter(
    (words) => !words.options.some((option) => inScope.has(option.key)),
  )
  return {
    terms,
    undecided,
    window,
    windowSource,
    datesNote: windowSource === 'typed' ? (reading?.dates?.note ?? null) : null,
    datesProblem,
    today: reading?.today ?? today,
    scope: { scope, from: window?.from ?? null, to: window?.to ?? null },
    about,
    wire: {
      ...fieldsOf(scope),
      ...(window ? { window } : {}),
      window_source: windowSource === 'tagged' ? 'typed' : windowSource,
      carried: [
        ...terms.filter((term) => term.source === 'carried').map((term) => term.key),
        ...(windowSource === 'carried' ? ['window' as const] : []),
      ],
      unresolved: undecided.slice(0, 10).map((words) => ({
        words: words.words.slice(0, 200),
        options: words.options.map((option) => option.key).slice(0, 20),
      })),
      ...(about.length ? { about } : {}),
    },
  }
}

/**
 * Whether the question has a scope to send: a term, chosen or carried dates, words to decide, or
 * an item or a domain.
 */
export const readsSomething = (reads: Reads) =>
  reads.terms.length > 0 ||
  reads.windowSource !== 'assumed' ||
  reads.undecided.length > 0 ||
  reads.about.length > 0
