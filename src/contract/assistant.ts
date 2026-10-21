import * as z from 'zod/mini'
import { toolInputLimits } from '../domain/proposal-rules.ts'
import { calendarDateSchema } from '../domain/validity.ts'

/**
 * The assistant's chat (FR-701). The client holds the conversation as AI SDK UI messages and
 * sends it every turn; the server keeps none of it (FR-603). The answer streams back as UI
 * message chunks (server-sent events), which the front end's chat reads as they come.
 */

export const ASSISTANT_MAX_MESSAGES = 60

const part = z.looseObject({ type: z.string().check(z.minLength(1), z.maxLength(100)) })
const message = z.looseObject({
  id: z.string().check(z.maxLength(200)),
  role: z.enum(['user', 'assistant']),
  parts: z.array(part).check(z.maxLength(200)),
})
export const chatInputSchema = z.strictObject({
  messages: z.array(message).check(z.minLength(1), z.maxLength(ASSISTANT_MAX_MESSAGES)),
  /**
   * The person's IANA time zone (`Europe/Copenhagen`), from their browser: the assistant counts
   * "today" and "last week" in it. Left out or unknown, it counts in UTC.
   */
  timeZone: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
})
/**
 * One UI message chunk: text, tool calls and their results, a confirmation request, and the data
 * parts `data-citations` (what the answer cites and what the citation check removed),
 * `data-limit` (a spending limit stopped the turn), `data-refusal` and `data-evidence` (the seal
 * of one tool result, which the client keeps and sends back so a later turn may cite it).
 */
export const chatChunkSchema = z.looseObject({ type: z.string() })

/**
 * A person's rating of one answer (FR-712): thumbs up (`helpful`) or down (`wrong`), and the
 * metrics of the scope the answer was about, from which the service takes the answer's domain.
 * Nothing else: no question, no answer, no note. Only the verdict, the domain and the hour are
 * stored, never who rated.
 */
export const assistantVerdicts = ['helpful', 'wrong'] as const
export const ratingInputSchema = z.strictObject({
  verdict: z.enum(assistantVerdicts),
  metrics: z.optional(
    z.array(z.string().check(z.minLength(1), z.maxLength(160))).check(z.maxLength(10)),
  ),
})
export type RatingInput = z.infer<typeof ratingInputSchema>
/** The rating was counted. It has no id: nothing can find it again. */
export const ratingSchema = z.object({ counted: z.literal(true) })
export type Rating = z.infer<typeof ratingSchema>

/**
 * How the Ask tab tells the model the scope of a question: a line after the question, this
 * prefix and then get_facts's own fields as JSON (`metrics`, `dimension_filters`, `window`),
 * so a model passes them on as given instead of reading dates and names from words.
 */
export const SCOPE_LINE = 'Scope picked for this question, as get_facts fields:'

const termKey = z
  .string()
  .check(
    z.maxLength(toolInputLimits.name),
    z.regex(/^(metric|group|dim|val):[a-z0-9_]+(\/[a-z0-9_]+)?$/),
  )

/** An accepted item or a domain a question names with a chip: `item:itm_...` or `area:...`. */
const aboutKey = z
  .string()
  .check(z.maxLength(80), z.regex(/^(item:itm_[a-z0-9]{8,16}|area:[a-z][a-z0-9_-]*)$/))

/** The data part a person's question carries its scope in, beside its words. */
export const QUESTION_SCOPE_PART = 'data-scope'
/**
 * The scope of one question, as the composer's "Heed reads" line showed it before it was sent:
 * get_facts's own fields, by key (`metrics`, `dimension_filters`, `window`, both days
 * included), where the dates came from (the words, the scope picker, the last question, or none,
 * so today is assumed and `window` is left out; or words that name dates Heed cannot read, so a
 * call asks for dates), what was carried from the last question (keys,
 * and `window` for its dates), and words that name more than one term the person did not choose
 * between, and the accepted items and domains its chips name (`about`), which get_facts has no
 * field for. The service binds the turn's get_facts and explain_item calls to it
 * (`boundFields`), so a call reads exactly what the person saw, and tells the model what each
 * item and domain is, so "this" is never a question back.
 */
export const questionScopeSchema = z.strictObject({
  // get_facts's own limits, so a bound call is always one it takes.
  metrics: z.array(termKey).check(z.maxLength(toolInputLimits.names)),
  dimension_filters: z
    .array(
      z.strictObject({
        dimension: termKey,
        values: z.array(termKey).check(z.maxLength(toolInputLimits.values)),
      }),
    )
    .check(z.maxLength(toolInputLimits.names)),
  window: z.optional(
    z
      .strictObject({ from: calendarDateSchema, to: calendarDateSchema })
      .check(z.refine((window) => window.from <= window.to, 'Window ends before it starts')),
  ),
  window_source: z.enum(['typed', 'picked', 'carried', 'assumed', 'unreadable']),
  carried: z.array(z.union([termKey, z.literal('window')])).check(z.maxLength(60)),
  unresolved: z
    .array(
      z.strictObject({
        words: z.string().check(z.minLength(1), z.maxLength(200)),
        options: z.array(termKey).check(z.maxLength(20)),
      }),
    )
    .check(z.maxLength(10)),
  about: z.optional(z.array(aboutKey).check(z.maxLength(20))),
})
export type QuestionScope = z.infer<typeof questionScopeSchema>

/**
 * What a bound call reads, from a question's scope: with any term, exactly its metrics, dimension
 * filters and dates (none when today is assumed) and the person's own words, so nothing the model
 * adds or rewords changes the scope; with dates only, the dates; with neither, nothing is bound.
 */
export function boundFields(
  scope: QuestionScope,
  question: string,
):
  | {
      question: string
      metrics: string[]
      dimension_filters: QuestionScope['dimension_filters']
      window: QuestionScope['window']
    }
  | { window: NonNullable<QuestionScope['window']> }
  | null {
  if (scope.metrics.length || scope.dimension_filters.length)
    return {
      question,
      metrics: scope.metrics,
      dimension_filters: scope.dimension_filters,
      window: scope.window,
    }
  return scope.window ? { window: scope.window } : null
}

/**
 * What replaces a statement the citation check removed, in the answer's text, so the person sees
 * that something was left out and why. The panel shows each one as a notice.
 */
export const removedNotice = {
  unknown_item: "(I removed a sentence that named a fact I hadn't read.)",
  unverified_quote: "(I removed a quote I couldn't find in the facts I read.)",
} as const

/**
 * `data-citations`, the last part of every answer: the item ids the answer cites (each one read
 * by a tool in this conversation), the statements the citation check removed and why, how many
 * quotations it shows that matched a source word for word, and how many cited items were read in
 * an earlier answer rather than this one. Types only: the chunk schema above leaves data parts
 * open, and the service writes them.
 */
export type CitationReport = {
  cited: string[]
  removed: { reason: 'unknown_item' | 'unverified_quote'; ids: string[] }[]
  quoted?: number
  earlier?: number
}

/**
 * `data-limit`: a spending limit stopped the turn. `kind` says which (all model spending this
 * month, the assistant's this month, or the person's today), `resets` the day it resets (null for
 * the daily limit, which resets within 24 hours).
 */
export type AssistantLimit = {
  kind: 'monthly' | 'feature' | 'person_day'
  message: string
  resets: string | null
}
