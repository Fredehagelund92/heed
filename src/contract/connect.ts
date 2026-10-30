import * as z from 'zod/mini'
import { calendarDateSchema } from '../domain/validity.ts'

/**
 * Connect your AI (FR-404): what any signed-in person needs to point their own AI client at the
 * MCP server. The administrators' fields (each client's tools, rate and size limits, and the
 * clients switched off) stay with `tools.list` and `clients.list`.
 */
export const connectInfoSchema = z.object({
  /** The MCP server's public address; null when this service does not serve MCP. */
  address: z.nullable(z.string()),
  /**
   * Every tool an agent can be given (FR-407), by name, so a person sees the whole list: whether
   * it is switched on for every client, and whether only a person a login server signed in may
   * call it (FR-121).
   */
  tools: z.array(z.object({ tool: z.string(), enabled: z.boolean(), personOnly: z.boolean() })),
  /**
   * The clients that may connect today: switched on, by label and name. The evaluation runner is
   * not a person's client and is left out.
   */
  clients: z.array(z.object({ label: z.string(), name: z.string() })),
  /**
   * Whether a person's own client can sign in as them (FR-403): the login server is on. Such a
   * client needs no token from the data platform team, and the person sees it among their
   * connected agents.
   */
  signIn: z.boolean(),
})
export type ConnectInfo = z.infer<typeof connectInfoSchema>

const term = z.string().check(z.minLength(1), z.maxLength(160))

/**
 * What an agent would get (Try it): a typed scope and nothing else. There is no question, so no
 * question text can be stored (FR-602), and no audience, so the reply is always the caller's own.
 * The dates are inclusive, as in get_facts.
 */
export const tryItInputSchema = z.strictObject({
  metrics: z.optional(z.array(term).check(z.maxLength(10))),
  dimension_filters: z.optional(
    z
      .array(
        z.strictObject({
          dimension: term,
          // No values names the dimension without choosing one ("orders by market").
          values: z.array(term).check(z.maxLength(50)),
        }),
      )
      .check(z.maxLength(10)),
  ),
  window: z.optional(
    z
      .strictObject({ from: calendarDateSchema, to: calendarDateSchema })
      .check(z.refine((window) => window.from <= window.to, 'Window ends before it starts')),
  ),
})

/**
 * A question read as a scope, so Try it opens on what was asked (Home's "Try it"). The question
 * is read in memory and answered with the scope only: it is never stored, logged or put in an
 * address (FR-602). Sent in a POST body for that reason.
 */
export const tryItReadInputSchema = z.strictObject({
  question: z.string().check(z.minLength(1), z.maxLength(2000)),
})
export type TryItReadInput = z.infer<typeof tryItReadInputSchema>

const readTermSchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.enum(['metric', 'metric_group', 'dimension', 'dimension_value']),
  /** A value's dimension, by name; null for anything else. */
  dimension: z.nullable(z.string()),
})

/**
 * The scope the question names, as far as it resolves, read as get_facts reads it (Home's Try
 * it, and the Ask composer's "Heed reads" line): its terms by key and name, metrics first, and both
 * days included, or null when it names no dates; how Heed read the dates; the words that name
 * more than one term, with the terms they could be; words that name dates Heed cannot read; the
 * day a question without dates is read at; and where each name and the dates are in the words.
 */
export const tryItReadingSchema = z.object({
  about: z.array(readTermSchema),
  from: z.nullable(calendarDateSchema),
  to: z.nullable(calendarDateSchema),
  dates: z.nullable(
    z.object({ words: z.string(), reads_as: z.string(), note: z.nullable(z.string()) }),
  ),
  ambiguous: z.array(z.object({ words: z.string(), options: z.array(readTermSchema) })),
  dates_problem: z.nullable(z.object({ words: z.string(), message: z.string() })),
  today: calendarDateSchema,
  /**
   * Where each name and the dates are in the question (UTF-16 offsets, end exclusive): the terms a
   * name could be, or `dates` for the words that name the period. The composer offers each as a
   * chip in the sentence.
   */
  spans: z.array(
    z.object({ start: z.number(), end: z.number(), keys: z.array(z.string()), dates: z.boolean() }),
  ),
})
export type TryItReading = z.infer<typeof tryItReadingSchema>
