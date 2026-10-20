import { readQuestion } from './scope.ts'
import { shiftDate } from './validity.ts'
import type { Term } from './vocabulary.ts'

/*
  A question read for a person, as the composer's "Heed reads" line and Home's Try it show it:
  the terms its words name, with their names, the dates and how Heed read them, the words that
  name more than one term, and words that name dates Heed cannot read. It is the reader
  get_context uses (`readQuestion`), so what the line shows is what a call reads. Pure, so the
  service and the mock read a question the same way.
*/

/** A term the words name, with what a chip needs: its name, kind and a value's dimension. */
export type ReadTerm = {
  key: string
  name: string
  kind: Term['kind']
  /** A value's dimension, by name; null for anything else. */
  dimension: string | null
}

export type QuestionReading = {
  /** The terms the words name, metrics first. */
  about: ReadTerm[]
  /** The first and last day the words name, both included; null when they name none. */
  from: string | null
  to: string | null
  /**
   * The dates as written, how Heed read them ("1 Jan to 31 Dec 2026 (the whole year, ...; UTC)"),
   * and what the period is in words without the time zone ("the whole year, including the days
   * after today").
   */
  dates: { words: string; reads_as: string; note: string | null } | null
  /** Words that name more than one term, or a name Heed does not know, and the terms they could be. */
  ambiguous: { words: string; options: ReadTerm[] }[]
  /** Words that name dates Heed cannot read, and what it reads instead. */
  dates_problem: { words: string; message: string } | null
  /** The day a question without dates is read at. */
  today: string
  /**
   * Where each name and the dates are in the question as written (UTF-16 offsets, end exclusive):
   * the terms a name could be (one when it names one, several when it is ambiguous), or `dates`
   * for words that name the period. The composer offers to make each a chip in the sentence.
   */
  spans: ReadSpan[]
}

/** A name or the dates, by where they are in the question. */
export type ReadSpan = { start: number; end: number; keys: string[]; dates: boolean }

/** "1 Jan to 31 Dec 2026 (the whole year; UTC)" to "the whole year": the words in brackets, less the time zone. */
function noteOf(readsAs: string): string | null {
  const inside = /\(([^()]*)\)$/.exec(readsAs)?.[1]
  if (!inside) return null
  const parts = inside.split('; ').slice(0, -1)
  return parts.length ? parts.join('; ') : null
}

export function questionReading(
  question: string,
  terms: readonly Term[],
  today: string,
): QuestionReading {
  const reading = readQuestion(question, terms, today)
  const byKey = new Map(terms.map((term) => [term.key, term]))
  const view = (term: Term): ReadTerm => ({
    key: term.key,
    name: term.name,
    kind: term.kind,
    dimension:
      term.kind === 'dimension_value' && term.parentKey
        ? (byKey.get(term.parentKey)?.name ?? null)
        : null,
  })
  const dates = reading.issues.find((issue) => issue.field === 'dates')
  return {
    about: reading.terms.map(view),
    from: reading.window?.start ?? null,
    to: reading.window?.end ? shiftDate(reading.window.end, -1) : null,
    dates: reading.dates ? { ...reading.dates, note: noteOf(reading.dates.reads_as) } : null,
    ambiguous: reading.issues
      .filter((issue) => issue.field === 'scope')
      .map((issue) => ({
        words: issue.input,
        options: issue.options.flatMap((key) => {
          const term = byKey.get(key)
          return term ? [view(term)] : []
        }),
      })),
    dates_problem: dates ? { words: dates.input, message: dates.message ?? '' } : null,
    today,
    spans: reading.spans.map((span) => ({
      start: span.start,
      end: span.end,
      keys: span.keys ?? [],
      dates: span.dates === true,
    })),
  }
}
