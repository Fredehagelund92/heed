/**
 * Observability on the API (FR-620): what agents asked and what they got, as topics and counts,
 * never the words of a question and never who asked (FR-602, FR-613). Overview and Questions read
 * `obs.agents`, Feedback `obs.feedback`, Usage `obs.usage` (administrators only), and the views
 * people save on Questions belong to the workspace (`obs.views`). Administrators see every domain;
 * an owner sees the domains they own. A count from one to just under the minimum is null, and no
 * count is given when a hidden one could be worked out from it by subtraction (FR-614,
 * src/domain/observability.ts).
 */
import * as z from 'zod/mini'
import { appFamilies } from '../domain/app-family.ts'
import { shownStates } from '../domain/observability.ts'

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
/** The days a view counts back from the last full day: a week, a month, a quarter. */
const range = z._default(
  z.number().check(
    z.int(),
    z.refine((n) => n === 7 || n === 30 || n === 90, 'A range is 7, 30 or 90 days.'),
  ),
  7,
)
const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))
/** A count a reader may see, or null when it is hidden (FR-614). */
const shown = z.nullable(z.number())
/** Calls by the answer state their reply gave (FR-349); a failed check is counted on Usage. */
const shownCounts = z.object({
  grounded: shown,
  partial: shown,
  conflict: shown,
  stale: shown,
  missing: shown,
})

export const obsAgentsInputSchema = z.strictObject({
  range,
  /** One domain: the numbers and the chart count only its topics. */
  areaId: z.optional(areaId),
  /** One kind of agent (FR-410), for administrators. */
  agent: z.optional(z.enum(appFamilies)),
})

/** Whether a topic's questions found nothing written down, and what waits for it in the Inbox. */
export const obsGapSchema = z.object({
  id: z.string(),
  /** A draft waits (written from the gap), a suggestion waits for its owner, or nothing yet. */
  state: z.enum(['draft', 'suggestion', 'none']),
  proposalId: z.nullable(z.string()),
})

export const obsTopicSchema = z.object({
  /** The topic's id, which the answer panel replays (`obs.replay`). */
  id: z.string(),
  areaId: z.nullable(areaId),
  /** The scope without the month: the months of one subject read as one row. */
  subject: z.string(),
  /** The metrics, as the definitions name them; empty when no metric was named. */
  metric: z.string(),
  /** How the metric was named: one metric, a metric group, or none. */
  named: z.enum(['metric', 'group', 'none']),
  /** The markets, events or other values asked about, as named; empty for every market. */
  values: z.array(z.string()),
  /** The dimension the values belong to, when there is one: `market` for a market. */
  dimension: z.nullable(z.string()),
  /** The calendar month the question's dates start in: `2026-10`. */
  month: z.string(),
  total: shown,
  /** What its shown counts add up to, when the total is hidden. */
  atLeast: z.number(),
  counts: shownCounts,
  /** Which of Questions' views it is in. */
  in: z.object({
    /** Its subject found nothing at least the minimum times in the range. */
    notFound: z.boolean(),
    /** Someone reported an answer about it in the range. */
    reported: z.boolean(),
    /**
     * How it was answered, as far as the counts shown say: each answer state whose count on it, or
     * for a month of a subject over several, on its subject, shows as more than 0 or is hidden.
     */
    answers: z.array(z.enum(shownStates)),
  }),
  gap: z.nullable(obsGapSchema),
})

export const obsSubjectSchema = z.object({
  key: z.string(),
  areaId: z.nullable(areaId),
  /** Its topics, one per month. */
  topics: z.array(z.string()),
  total: shown,
  atLeast: z.number(),
  counts: shownCounts,
})

export const obsAgentsSchema = z.object({
  /** Nothing asked yet; fewer than the minimum in the range (no counts at all); or counted. */
  state: z.enum(['empty', 'quiet', 'normal']),
  range: z.number(),
  /** The last day counted (yesterday): a view runs back from it. */
  last: day,
  minimumCount: z.number(),
  /** What was asked in the range by answer state, and in the range before it. */
  numbers: z.object({
    asked: shown,
    counts: shownCounts,
    before: z.object({ asked: shown, missing: shown }),
  }),
  /** The chart: a bar a day for 7 and 30 days, a week a bar for 90, oldest first. */
  bars: z.array(z.object({ start: day, days: z.number(), counts: shownCounts })),
  topics: z.array(obsTopicSchema),
  subjects: z.array(obsSubjectSchema),
  domains: z.array(z.object({ areaId: z.nullable(areaId), total: shown, atLeast: z.number() })),
  /**
   * What found nothing at least the minimum times in the last 7 days, whatever the range, its
   * months counted together (FR-606 case 1): subjects, with their counts over those 7 days.
   */
  notFound: z.array(obsSubjectSchema),
  /** The topics of those 7 days, for the subjects above. */
  notFoundTopics: z.array(obsTopicSchema),
  /** Calls that could not be read: no metric and no value, so no topic and no domain. */
  couldNotRead: shown,
  publishes: z.array(
    z.object({
      at: z.string(),
      itemId: z.string(),
      title: z.string(),
      areaId: z.nullable(areaId),
      by: z.nullable(z.string()),
    }),
  ),
  /** The kinds of agent that asked in the range, by FR-410's fixed list. */
  agents: z.array(z.object({ family: z.enum(appFamilies), count: shown })),
})

export const obsFeedbackInputSchema = z.strictObject({ range, areaId: z.optional(areaId) })

export const obsFeedbackSchema = z.object({
  state: z.enum(['empty', 'normal']),
  minimumCount: z.number(),
  /**
   * What agents and people reported about answers in the range, newest first. An agent's report
   * carries its kind, never a name; a person's report from Try it or the assistant is anonymous;
   * a named report from Ask carries who sent it, as they sent it on purpose (FR-622).
   */
  reports: z.array(
    z.object({
      id: z.string(),
      /** The Inbox card it is, while it waits there. */
      card: z.nullable(z.string()),
      /** An agent's verdict, a gap reported, or a person's named report from Ask (FR-622). */
      kind: z.enum(['helpful', 'wrong', 'missing', 'unclear', 'gap', 'named']),
      areaId: z.nullable(areaId),
      /** What it is about: the item an answer gave, or the topic it reports. */
      about: z.string(),
      itemId: z.nullable(z.string()),
      topicId: z.nullable(z.string()),
      note: z.nullable(z.string()),
      /** Who sent it: an agent by its kind, or a person through Heed, never named. */
      from: z.enum(['agent', 'person']),
      agent: z.nullable(z.string()),
      /** Who sent a named report: it is sent on purpose, with a name (FR-622). */
      by: z.nullable(z.string()),
      at: z.string(),
      state: z.enum(['inbox', 'looked', 'fine']),
    }),
  ),
  /** Answers people marked good in the assistant, each week of the last 14, oldest first. */
  goodByWeek: z.array(z.object({ week: day, count: shown })),
  week: z.object({ good: shown, goodBefore: shown, wrong: shown }),
})

export const obsUsageInputSchema = z.strictObject({ range })

export const obsUsageSchema = z.object({
  state: z.enum(['empty', 'normal']),
  minimumCount: z.number(),
  last: day,
  /** Tool calls in the range before, to compare with. */
  callsBefore: z.number(),
  /** Each tool agents called in the range, and how its calls ended. */
  tools: z.array(
    z.object({
      tool: z.string(),
      calls: z.number(),
      answered: z.number(),
      detail: z.number(),
      nothing: z.number(),
      failed: z.number(),
    }),
  ),
  /** Calls by kind of agent (FR-410), each with the hour of its last call. */
  agents: z.array(
    z.object({ family: z.enum(appFamilies), calls: shown, lastAt: z.nullable(z.string()) }),
  ),
  /** How long a reply took, in milliseconds: per day for 7 days, per week otherwise. */
  speed: z.array(
    z.object({ start: day, median: z.nullable(z.number()), p95: z.nullable(z.number()) }),
  ),
  /** Model spend this month, by feature, against the caps that stop it (NFR-062). */
  spend: z.object({
    month: day,
    totalMicros: z.number(),
    features: z.array(z.object({ feature: z.string(), micros: z.number() })),
    caps: z.object({
      monthlyMicros: z.number(),
      featureMicros: z.record(z.string(), z.number()),
      dailyPersonMicros: z.number(),
      /** The most one person spent today. */
      personTodayMicros: z.number(),
    }),
  }),
})

const viewFilters = z.object({
  answer: z.optional(z.array(z.enum(shownStates))),
  domain: z.optional(areaId),
  agent: z.optional(z.string().check(z.maxLength(40))),
  gap: z.optional(z.array(z.enum(['draft', 'suggestion', 'none']))),
  month: z.optional(z.string().check(z.regex(/^\d{4}-\d{2}$/))),
})

export const obsViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  filters: viewFilters,
  by: z.string(),
  mine: z.boolean(),
})
export const obsViewSaveInputSchema = z.strictObject({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(60)),
  filters: viewFilters,
})
export const obsViewRemoveInputSchema = z.strictObject({ id: z.string().check(z.uuid()) })

export type ObsAgentsInput = z.infer<typeof obsAgentsInputSchema>
export type ObsAgents = z.infer<typeof obsAgentsSchema>
export type ObsTopic = z.infer<typeof obsTopicSchema>
export type ObsSubject = z.infer<typeof obsSubjectSchema>
export type ObsFeedback = z.infer<typeof obsFeedbackSchema>
export type ObsUsage = z.infer<typeof obsUsageSchema>
export type ObsView = z.infer<typeof obsViewSchema>
export type ObsViewFilters = z.infer<typeof viewFilters>
