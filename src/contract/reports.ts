import * as z from 'zod/mini'

/**
 * Named reports (FR-622): a person tells the owner from Ask that an answer is wrong. It keeps what
 * they sent on purpose, with their name: the question, the part that is wrong (one context item of
 * the answer, or the answer itself, filed on its first item), what is wrong and, optionally, the
 * correct version and a link. Nothing else of the chat is kept. It reaches the owners of the item's
 * domain as a Reported card, and its sender sees what they did with it back in the chat. Agents
 * never read reports.
 */

const words = z.string().check(z.trim(), z.minLength(1), z.maxLength(2000))
const itemRef = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))

export const reportParts = ['item', 'answer', 'figure'] as const

/**
 * Who a figure report goes to: the owners of the item's domain, the integration's data contact,
 * or both.
 */
export const figureRoutes = ['owners', 'contact', 'both'] as const

/**
 * The figure a report says doesn't fit its context item (FR-716): the integration it came from,
 * the metric, the values and the days, as Ask read it. Never the figure itself.
 */
export const reportFigureSchema = z.strictObject({
  source: z.string().check(z.regex(/^[a-z][a-z0-9_-]{1,39}$/)),
  metric: z.string().check(z.regex(/^metric:[a-z0-9_]+$/)),
  values: z.array(z.string().check(z.regex(/^val:[a-z0-9_]+\/[a-z0-9_]+$/))).check(z.maxLength(20)),
  from: z.iso.date(),
  to: z.iso.date(),
  route: z.enum(figureRoutes),
})
export type ReportFigure = z.infer<typeof reportFigureSchema>

export const createReportSchema = z
  .strictObject({
    /** The question as the person asked it. */
    question: words,
    /** The context item the report is about: the wrong one, or the answer's first for the answer itself. */
    itemId: itemRef,
    part: z.enum(reportParts),
    what: words,
    correction: z.optional(words),
    link: z.optional(z.string().check(z.trim(), z.maxLength(2000), z.regex(/^https?:\/\/\S+$/))),
    /** For a figure that doesn't fit the item: the figure's scope and who hears. */
    figure: z.optional(reportFigureSchema),
  })
  .check(
    z.refine((report) => (report.part === 'figure') === (report.figure !== undefined), {
      message: 'A figure report names its figure, and only a figure report does.',
      path: ['figure'],
    }),
  )
export type CreateReport = z.infer<typeof createReportSchema>

/**
 * A report as sent: its id and when. It does not say the words back, so a retry's stored answer
 * never keeps them: the words are only in the report.
 */
export const sentReportSchema = z.object({ id: z.string(), at: z.string() })
export type SentReport = z.infer<typeof sentReportSchema>

/** What the owners did after a report, the first of them, and when. */
export const reportOutcomes = ['not_a_problem', 'checked', 'changed', 'archived'] as const
export type ReportOutcome = (typeof reportOutcomes)[number]

export const reportSchema = z.object({
  id: z.string(),
  question: z.string(),
  itemId: z.string(),
  part: z.enum(reportParts),
  at: z.string(),
  outcome: z.nullable(z.object({ kind: z.enum(reportOutcomes), at: z.string() })),
})
export type Report = z.infer<typeof reportSchema>

/** The person's own reports of the last 90 days, newest first, each with its outcome. */
export const myReportsSchema = z.object({ reports: z.array(reportSchema) })
export type MyReports = z.infer<typeof myReportsSchema>
