import * as z from 'zod/mini'

/*
  The shape of a records answer (src/domain/records.ts), apart from the reader and the reads, so
  the API's contract, which the web app loads first, carries the shape and not the patterns.
*/

/**
 * The questions Records answers, by a stable id. A usage count keeps only these ids. `terms` and
 * `values` are about the vocabulary itself: its metrics and dimensions, and a dimension's values.
 * `conflicts` is the pairs of context items an owner said disagree, as Context's Conflicts lists them.
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
  'conflicts',
  'audit',
  'queue',
  'glossary',
] as const
export type RecordsIntent = (typeof recordsIntents)[number]

/** What an analysis can look at (FR-720): one read, a closed list. */
export const auditFacets = [
  'no_context',
  'no_words',
  'no_domain',
  'unlinked',
  'source_changed',
  'asked_nothing',
  'asked_most',
  'due',
  'conflicts',
  'duplicates',
  'overlaps',
  'review',
] as const
export type AuditFacet = (typeof auditFacets)[number]

/** The limits a plan may choose: what a question reaches for beyond what is written (FR-720). */
export const planLimits = ['advice', 'forecast', 'outside', 'numbers'] as const
export type PlanLimit = (typeof planLimits)[number]

/**
 * Why Ask leads with a limit sentence, then what is written (FR-720). Beside a plan's limits, two
 * that code says: `partly`, a question no read plainly answers when nothing could read it, and
 * `general`, a name nothing is written about, when what was read applies to everything.
 */
export const limitReasons = [...planLimits, 'partly', 'general'] as const
export type LimitReason = (typeof limitReasons)[number]

/**
 * Why Ask reads nothing and says so in a fixed sentence (FR-720). `unread` is what a question gets
 * when the planner was asked and gave no plan: never "needs a metric or a market".
 */
export const cannotReasons = ['numbers', 'source', 'write', 'person', 'not_yet', 'unread'] as const
export type CannotReason = (typeof cannotReasons)[number]

/** The sentence a limit leads with. */
export const limitSchema = z.object({ reason: z.enum(limitReasons), sentence: z.string() })
export type AnswerLimit = z.infer<typeof limitSchema>

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

/** Where a full list lives: Context or Definitions with a filter, a domain's page, or the Inbox. */
const moreSchema = z.object({
  label: z.string(),
  to: z.enum(['context', 'definitions', 'domain', 'inbox']),
  domain: z.nullable(z.string()),
  /** Context's own filter: due for a check, archived, or only the items in a conflict. */
  status: z.nullable(z.enum(['due', 'archived', 'conflicts'])),
  /** One Definitions page by its name, such as a dimension with all its values. */
  page: z.optional(z.string()),
})

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
  /** A conflict: two context items an owner said disagree; it opens the pair's own page (`key`). */
  z.object({
    type: z.literal('conflict'),
    /** `holderId.otherId`, the pair's address. */
    key: z.string(),
    holder: z.object({ id: z.string(), title: z.string() }),
    other: z.object({ id: z.string(), title: z.string() }),
    cells: z.array(z.string()),
  }),
  /** A kind's counts, or all kinds together (`kind` null). */
  z.object({
    type: z.literal('kind'),
    kind: z.nullable(z.enum(recordsKinds)),
    label: z.string(),
    cells: z.array(z.string()),
  }),
  /** Two context items an analysis found together; each opens in the right panel. */
  z.object({
    type: z.literal('pair'),
    holder: z.object({ id: z.string(), title: z.string() }),
    other: z.object({ id: z.string(), title: z.string() }),
    cells: z.array(z.string()),
  }),
  /** A member the source lists that no term of Definitions names yet. */
  z.object({ type: z.literal('member'), name: z.string(), cells: z.array(z.string()) }),
  /** One line of a review or of the Inbox: what it counts, and where that list lives. */
  z.object({
    type: z.literal('line'),
    label: z.string(),
    cells: z.array(z.string()),
    more: z.nullable(moreSchema),
  }),
])
export type RecordsRow = z.infer<typeof rowSchema>

/** One part of an analysis: what it counts with its denominator, and up to five rows. */
const sectionSchema = z.object({
  /** "No context written". */
  title: z.string(),
  /** With its denominator: "13 of 22 metrics". */
  count: z.string(),
  columns: z.array(z.string()),
  rows: z.array(rowSchema),
  shown: z.nullable(z.string()),
  more: z.nullable(moreSchema),
})
export type RecordsSection = z.infer<typeof sectionSchema>

/**
 * What every answer owes the reader, in one place (src/domain/answer-footer.ts): what a count is out
 * of, what the read could not see, and what in it may be out of date.
 */
export const footerSchema = z.object({
  denominator: z.nullable(z.string()),
  notSeen: z.nullable(z.string()),
  stale: z.nullable(z.string()),
})
export type AnswerFooter = z.infer<typeof footerSchema>

/** What a records read is narrowed to: the metrics and values the question names, by key. */
export const recordsAboutSchema = z.object({
  metrics: z.array(z.string()),
  values: z.array(z.string()),
  /** The same, as the answer says it: "Orders in Norway". */
  words: z.string(),
})
export type RecordsAbout = z.infer<typeof recordsAboutSchema>

/** An analysis as it was read, so a follow-up can carry it (FR-719, FR-720). */
export const auditReadSchema = z.object({
  facets: z.array(z.enum(auditFacets)),
  /** What is counted: metrics, dimensions, or both. Null for metrics. */
  of: z.nullable(z.enum(['metric', 'dimension', 'definition'])),
  /** One kind of context item, for what has none of it. */
  kind: z.nullable(z.enum(recordsKinds)),
  /** One dimension value, by key, for what agents asked about it. */
  value: z.nullable(z.string()),
  /** A ranking of domains the best first, when the question asks for the best covered. */
  best: z.optional(z.boolean()),
  /** What the question narrowed it to. */
  about: z.optional(recordsAboutSchema),
})
export type AuditRead = z.infer<typeof auditReadSchema>

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
    /** Where the full list lives. */
    more: z.nullable(moreSchema),
    /** What a word in the answer means, when it needs saying: "Created means first published." */
    note: z.nullable(z.string()),
    /** An analysis of more than one part: up to four sections, instead of the rows above. */
    sections: z.optional(z.array(sectionSchema)),
    /** What came up empty, each in a sentence. */
    clear: z.optional(z.array(z.string())),
    /** The rule behind a ranking, in words: "Look first at Orders in Spain: ...". */
    ranked: z.optional(z.nullable(z.string())),
    /** What it is out of, what the read cannot see, and what in it may be out of date. */
    footer: z.optional(footerSchema),
    /** The domain a ranking of domains puts first, alone: what "that one" means next. */
    top: z.optional(z.nullable(z.object({ id: z.string(), name: z.string() }))),
    /** The sentence it leads with when the question reaches beyond what is written. */
    limit: z.optional(z.nullable(limitSchema)),
    /** The analysis it was read as, for the next question to carry. */
    audit: z.optional(z.nullable(auditReadSchema)),
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
