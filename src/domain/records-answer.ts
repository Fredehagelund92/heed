import * as z from 'zod/mini'

/*
  The shape of a records answer (src/domain/records.ts), apart from the reader and the reads, so
  the API's contract, which the web app loads first, carries the shape and not the patterns.
*/

/**
 * The questions Records answers, by a stable id. A usage count keeps only these ids. The last two
 * are about the vocabulary itself: its metrics and dimensions (`terms`), and a dimension's values.
 */
export const recordsIntents = [
  'created',
  'changed',
  'due',
  'archived',
  'owner',
  'count',
  'asked_nothing',
  'terms',
  'values',
] as const
export type RecordsIntent = (typeof recordsIntents)[number]

/** The kinds the Context list shows. An item of the fifth, `example`, is not counted. */
export const recordsKinds = ['event', 'issue', 'note', 'guide'] as const
export type RecordsKind = (typeof recordsKinds)[number]

/** A period, as read from the words: its start and end (ISO instants, UTC) and how it is said. */
const periodSchema = z.object({
  start: z.string(),
  end: z.string(),
  /** How the sentence says it: "in the last 24 hours", "this week". */
  words: z.string(),
  /** The instants, in UTC: "29 Oct 15:30 to 30 Oct 15:30, UTC". */
  label: z.string(),
  /** True when the words named no period and the answer took the last 7 days. */
  assumed: z.boolean(),
})
export type RecordsPeriod = z.infer<typeof periodSchema>

const rowSchema = z.union([
  /** A context item; it opens in the right panel. */
  z.object({
    type: z.literal('item'),
    id: z.string(),
    kind: z.enum(recordsKinds),
    title: z.string(),
    areaId: z.string(),
    cells: z.array(z.string()),
  }),
  /** A domain, with its owners or its counts. */
  z.object({
    type: z.literal('area'),
    id: z.string(),
    name: z.string(),
    cells: z.array(z.string()),
  }),
  /** A topic agents asked about, with the Not found card open on it for those who manage it. */
  z.object({
    type: z.literal('topic'),
    title: z.string(),
    cells: z.array(z.string()),
    gap: z.nullable(z.object({ card: z.string(), draft: z.nullable(z.string()) })),
  }),
  /** A metric, a dimension or a dimension's value; it opens its page in Definitions (`page`). */
  z.object({
    type: z.literal('term'),
    key: z.string(),
    kind: z.enum(['metric', 'dimension', 'value']),
    name: z.string(),
    /** The name of the Definitions page it opens: its own, or its dimension's for a value. */
    page: z.string(),
    cells: z.array(z.string()),
  }),
  /** A kind's counts, or all kinds together (`kind` null). */
  z.object({
    type: z.literal('kind'),
    kind: z.nullable(z.enum(recordsKinds)),
    label: z.string(),
    cells: z.array(z.string()),
  }),
])
export type RecordsRow = z.infer<typeof rowSchema>

/**
 * A records answer, as Ask shows it: what it was understood as, what was read, one plain sentence,
 * and at most five rows with links, or a small table of counts. Or a question Ask does not answer:
 * one about a person's own work, which no read here filters by.
 */
export const recordsAnswerSchema = z.union([
  z.object({
    refused: z.literal(false),
    intent: z.enum(recordsIntents),
    /** What the question was read as: "Context created, last 24 hours". */
    understood: z.string(),
    period: z.nullable(periodSchema),
    domain: z.nullable(z.object({ id: z.string(), name: z.string() })),
    /** What was read to answer it: "Read 1,500 context items". */
    read: z.string(),
    /** The answer, in one sentence, from a template. */
    sentence: z.string(),
    /** One more sentence that says what the answer is measured against, when there is one. */
    detail: z.nullable(z.string()),
    /** The context item the detail names, as a link at its end. */
    detailItem: z.nullable(z.object({ id: z.string(), title: z.string() })),
    /** The rows' column names, the first naming the rows themselves. */
    columns: z.array(z.string()),
    rows: z.array(rowSchema),
    /** What the rows are taken from, exactly: "Show all 45" counts it. */
    total: z.number(),
    /** Which rows are shown when not all are: "Showing the 5 oldest". */
    shown: z.nullable(z.string()),
    /** Where the full list lives: Context or Definitions with a filter, or the domain's page. */
    more: z.nullable(
      z.object({
        label: z.string(),
        to: z.enum(['context', 'definitions', 'domain']),
        domain: z.nullable(z.string()),
        status: z.nullable(z.enum(['due', 'archived'])),
        /** One Definitions page by its name, such as a dimension with all its values. */
        page: z.optional(z.string()),
      }),
    ),
    /** What a word in the answer means, when it needs saying: "Created means first published." */
    note: z.nullable(z.string()),
  }),
  z.object({
    refused: z.literal(true),
    reason: z.literal('person'),
    sentence: z.string(),
    detail: z.string(),
    offers: z.array(z.string()),
  }),
])
export type RecordsAnswer = z.infer<typeof recordsAnswerSchema>
export type RecordsFound = Extract<RecordsAnswer, { refused: false }>
