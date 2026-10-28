import * as z from 'zod/mini'

/**
 * Figures in Ask on the API (FR-716, CON-612; docs/product.md, sections 9 and 12). A definitions
 * integration whose connector reads figures (Cube first) has figures settings: one switch, "Show
 * figures in Ask", off by default; the data endpoint and its token, which an administrator sets
 * (the token is kept in the secret store and never read back); and a data contact, the one person
 * who hears about a figure that looks wrong. `figures.list` says what each such integration has,
 * the endpoint only to administrators; `figures.set` changes it; `figures.read` reads one figure
 * for an answer, from the integration the metric's definition comes from, within 4 seconds, and
 * keeps it nowhere. No person's identity is passed to the integration.
 */

const sourceId = z.string().check(z.regex(/^[a-z][a-z0-9_-]{1,39}$/))
const day = z.iso.date()
const words = z.string().check(z.trim(), z.minLength(1), z.maxLength(500))

/** An integration that reads figures, as an answer names it. */
export const figureSourceRefSchema = z.object({
  id: z.string(),
  /** The connector's id: `cube`. */
  type: z.string(),
  /** The tool every word on screen names: "Cube". */
  tool: z.string(),
  name: z.string(),
})
export type FigureSourceRef = z.infer<typeof figureSourceRefSchema>

export const dataContactSchema = z.object({ personId: z.string(), name: z.string() })
export type DataContact = z.infer<typeof dataContactSchema>

export const figureSourceSchema = z.object({
  ...figureSourceRefSchema.shape,
  /** Show figures in Ask: off until an administrator switches it on. */
  enabled: z.boolean(),
  dataContact: z.nullable(dataContactSchema),
  /**
   * Where figures are read, for administrators only: the data endpoint, the host it is the only
   * one called (its declared host), and whether a token is set. Never the token, nor any of it.
   */
  connection: z.nullable(
    z.object({
      endpoint: z.nullable(z.string()),
      declaredHost: z.nullable(z.string()),
      tokenSet: z.boolean(),
    }),
  ),
})
export type FigureSource = z.infer<typeof figureSourceSchema>

export const figureSourcesSchema = z.object({ sources: z.array(figureSourceSchema) })
export type FigureSources = z.infer<typeof figureSourcesSchema>

export const setFiguresInputSchema = z.strictObject({
  id: sourceId,
  /** Show figures in Ask. On needs an endpoint and a token. */
  enabled: z.optional(z.boolean()),
  /** The data contact, a person in the workspace; null for none. */
  dataContactId: z.optional(z.nullable(z.uuid())),
  /** The data endpoint: the address of the tool's query API, such as Cube's `/v1/load`. */
  endpoint: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(2000))),
  /**
   * A new token for the endpoint, kept in the secret store and sent only to the endpoint's origin.
   * A new scheme, host or port needs its token again.
   */
  token: z.optional(z.string().check(z.minLength(8), z.maxLength(8000))),
  reason: words,
})
export type SetFiguresInput = z.infer<typeof setFiguresInputSchema>

export const readFigureInputSchema = z.strictObject({
  /** The metric the answer is about, by its key in Definitions. */
  metric: z.string().check(z.regex(/^metric:[a-z0-9_]+$/)),
  /** The dimension values it names, such as a market: `val:market/norway`. */
  values: z.array(z.string().check(z.regex(/^val:[a-z0-9_]+\/[a-z0-9_]+$/))).check(z.maxLength(20)),
  /** The days, both included. */
  from: day,
  to: day,
  /**
   * The answer's context items: of the items someone said the figure doesn't fit, one the answer
   * cites shows first.
   */
  items: z.optional(
    z.array(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))).check(z.maxLength(20)),
  ),
})
export type ReadFigureInput = z.infer<typeof readFigureInputSchema>

/** Why an answer shows no figure. */
export const noFigureReasons = [
  /** No connected integration defines the metric. */
  'undefined',
  /** More than one integration defines it, so none is picked. */
  'ambiguous',
  /** The integration has no single date for it. */
  'no_date',
  /** The integration can't split it by a value the question names. */
  'no_split',
  /** The integration returned nothing for those days and values. */
  'no_value',
  /** The integration could not be read just now. */
  'failed',
] as const
export type NoFigureReason = (typeof noFigureReasons)[number]

/** Why a read of the integration failed, a code only. */
export const figureFailures = [
  'unauthorized',
  'not_found',
  'rate_limited',
  'unreachable',
  'timed_out',
  'private_address',
  'invalid_output',
  'not_set_up',
] as const

export const figureFormatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('currency'), currency: z.string() }),
  z.object({ kind: z.literal('percent') }),
  z.object({ kind: z.literal('number') }),
])

export const figureReadSchema = z.discriminatedUnion('state', [
  /** Figures are off for the integration: an answer links into the tool instead, when it can. */
  z.object({
    state: z.literal('off'),
    source: figureSourceRefSchema,
    /** The tool's own address, from its data endpoint; null when none is set. */
    link: z.nullable(z.string()),
  }),
  z.object({
    state: z.literal('none'),
    reason: z.enum(noFigureReasons),
    source: z.nullable(figureSourceRefSchema),
    failure: z.optional(z.enum(figureFailures)),
  }),
  z.object({
    state: z.literal('figure'),
    source: figureSourceRefSchema,
    value: z.number(),
    format: figureFormatSchema,
    from: day,
    to: day,
    /** The same measure for the days just before, to compare; its value null when there is none. */
    comparison: z.nullable(z.object({ value: z.nullable(z.number()), from: day, to: day })),
    /** When the tool last refreshed its data, or when the figure was read if it doesn't say. */
    asOf: z.string(),
    /** The query, in words first. */
    queryInWords: z.string(),
    dataContact: z.nullable(dataContactSchema),
    /** A context item someone said this figure doesn't fit, while their report is open. */
    against: z.nullable(z.object({ itemId: z.string() })),
  }),
])
export type FigureRead = z.infer<typeof figureReadSchema>
