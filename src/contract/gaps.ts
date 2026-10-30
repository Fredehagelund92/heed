import * as z from 'zod/mini'
import {
  gapHistoryActions,
  gapNoteSources,
  gapOrigins,
  gapStatuses,
  gapTypes,
} from '../domain/gaps.ts'
import { questionSplits } from '../domain/golden-question.ts'

const gapId = z.string().check(z.uuid())
/** A count below the minimum is null: hidden (FR-614). */
const shownCount = z.nullable(z.number())

/** What a topic is about. Built only from the scope used; never question text (FR-604). */
export const topicSchema = z.object({
  areaId: z.nullable(z.string()),
  /**
   * The domains of the topic: its area, or for a topic without one the domains its metrics have in
   * the live edition, sorted. Two or more when the topic spans domains; the owners of each see it.
   */
  areaIds: z._default(z.array(z.string()), []),
  metrics: z.array(z.string()),
  /** Dimensions the questions named without a value ("orders by market"). */
  dimensions: z._default(z.array(z.string()), []),
  dimensionValues: z.array(z.object({ dimension: z.string(), value: z.string() })),
  month: z.string(),
})
export const gapSchema = z.object({
  id: z.string(),
  ref: z.string(),
  topic: topicSchema,
  type: z.enum(gapTypes),
  status: z.enum(gapStatuses),
  severity: z.number(),
  openedBy: z.enum(gapOrigins),
  firstSeen: z.string(),
  lastSeen: z.string(),
  statusSince: z.string(),
  /**
   * report_gap calls, people's reports and negative feedback. Hidden below the minimum for readers
   * who cannot manage the gap.
   */
  reports: shownCount,
  /**
   * The part of `reports` that people made from Try it or the assistant (case 5). Only for readers
   * who manage the gap: anyone may add to it, so for anyone else it is always null, and left out
   * of `reports` and of which weeks show, so a reader cannot uncover a hidden count by adding to it.
   */
  personReports: shownCount,
  /** Agent calls about the topic that found nothing, since the gap was first seen. Hidden likewise. */
  noItemCalls: shownCount,
  weeks: z.array(
    z.object({
      week: z.string(),
      reports: shownCount,
      personReports: shownCount,
      noItemCalls: shownCount,
    }),
  ),
  proposals: z.array(z.string()),
  /** Whether the signed-in person may change its status and read and add notes. */
  canManage: z.boolean(),
})
export const gapNoteSchema = z.object({
  id: z.string(),
  source: z.enum(gapNoteSources),
  note: z.string(),
  createdHour: z.string(),
})
/**
 * A test question linked to a gap (FR-610). Its first pass on the resolving edition or a later one,
 * and its newest result, so the gap's record shows where verification stands.
 */
export const gapTestSchema = z.object({
  question: z.string(),
  split: z.enum(questionSplits),
  /** Only an active question counts towards verification; a retired or saturated one is set aside. */
  active: z.boolean(),
  linkedHour: z.string(),
  /** The failing run that led to the link, if one was named. */
  evidenceRun: z.nullable(z.string()),
  /** Its first pass in a weekly or full run on the resolving edition or a later one; null until then. */
  passed: z.nullable(
    z.object({ run: z.string(), edition: z.string(), revision: z.number(), hour: z.string() }),
  ),
  /** Its result in the newest finished weekly or full run of its area that tested it. */
  latest: z.nullable(
    z.object({
      run: z.string(),
      kind: z.enum(['scheduled', 'full']),
      edition: z.string(),
      finishedAt: z.string(),
      verdict: z.nullable(z.enum(['pass', 'fail', 'no_answer'])),
    }),
  ),
})
/** One step of a gap's lifecycle from the history log: what happened and the hour, never who. */
export const gapHistoryEntrySchema = z.object({
  action: z.enum(gapHistoryActions),
  hour: z.string(),
  details: z.record(z.string(), z.unknown()),
})
export const gapDetailSchema = z.extend(gapSchema, {
  /** Only owners of the area and administrators read notes (FR-611); null for anyone else. */
  notes: z.nullable(z.array(gapNoteSchema)),
  /**
   * The live edition when an owner resolved the gap (FR-610). Null while it is not resolved, and
   * for a gap resolved before Heed recorded the edition: unknown stays unknown.
   */
  resolvedEdition: z.nullable(z.string()),
  /**
   * Verified by test (FR-610): the hour and the edition on which every linked, active test had
   * passed. It sits beside `resolved`, never instead of it, and every reader sees it.
   */
  verifiedAt: z.nullable(z.string()),
  verifiedEdition: z.nullable(z.string()),
  /** The linked tests, for owners of the area and administrators; null for anyone else. */
  tests: z.nullable(z.array(gapTestSchema)),
  /** The gap's lifecycle, oldest first, for the same readers as the tests; null for anyone else. */
  history: z.nullable(z.array(gapHistoryEntrySchema)),
})
export const gapIdInputSchema = z.strictObject({ id: gapId })
/** Topic detail only for weeks a topic reaches the minimum count (FR-614). */
export const topicCountsSchema = z.object({
  minimumCount: z.number(),
  rows: z.array(
    z.object({
      topic: topicSchema,
      week: z.string(),
      calls: z.number(),
      noItemCalls: shownCount,
      noItemShare: z.nullable(z.number()),
    }),
  ),
  /** Topic weeks below the minimum, counted but not shown. */
  hiddenTopicWeeks: z.number(),
})

export type Gap = z.infer<typeof gapSchema>
export type GapDetail = z.infer<typeof gapDetailSchema>
export type GapTest = z.infer<typeof gapTestSchema>
export type GapHistoryEntry = z.infer<typeof gapHistoryEntrySchema>
export type TopicCounts = z.infer<typeof topicCountsSchema>
