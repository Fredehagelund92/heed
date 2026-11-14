import * as z from 'zod/mini'
import {
  gapHistoryActions,
  gapNoteSources,
  gapOrigins,
  gapStatuses,
  gapTypes,
} from '../domain/gaps.ts'

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
   * report calls, people's reports and negative feedback. Hidden below the minimum for readers
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
  /** The suggestions written for it (`proposals.source_gap_id`) that were not deleted. */
  proposals: z.array(z.string()),
  /** Whether the signed-in person may set it aside or open it again, and read its notes. */
  canManage: z.boolean(),
})
export const gapNoteSchema = z.object({
  id: z.string(),
  source: z.enum(gapNoteSources),
  note: z.string(),
  createdHour: z.string(),
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
   * The live edition when the gap was covered (FR-610): the one that carries the context published
   * for it. Null while it is not covered, and for a gap covered before Heed recorded the edition:
   * unknown stays unknown.
   */
  resolvedEdition: z.nullable(z.string()),
  /** The gap's moves, oldest first, for the same readers as the notes; null for anyone else. */
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
export type GapHistoryEntry = z.infer<typeof gapHistoryEntrySchema>
export type TopicCounts = z.infer<typeof topicCountsSchema>
