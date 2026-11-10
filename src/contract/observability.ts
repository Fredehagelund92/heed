/**
 * Observability on the API (FR-620): what agents asked and what they got, as topics and counts,
 * never the words of a question and never who asked (FR-602, FR-613). Overview and Questions read
 * `obs.agents`, Feedback `obs.feedback`, Usage `obs.usage` (administrators only), Summary
 * `obs.summary` and its monthly snapshots `obs.snapshots`, and the views people save on Questions
 * belong to the workspace (`obs.views`). Administrators see every domain;
 * an owner sees the domains they own. A count from one to just under the minimum is null, and no
 * count is given when a hidden one could be worked out from it by subtraction (FR-614,
 * src/domain/observability.ts).
 */
import * as z from 'zod/mini'
import { appFamilies } from '../domain/app-family.ts'
import { shownStates } from '../domain/observability.ts'
import { filterFits, isDimensionKey, obsFilterFields, searchable } from '../domain/obs-filters.ts'
import { summaryPeriods } from '../domain/obs-summary.ts'

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

const dimensionKey = z.string().check(z.regex(/^dim:[a-z0-9_]+$/))

/**
 * One filter, as a chip says it: a dimension (`dim:channel`) with the keys of its own values
 * (`val:channel/webshop`) or `*` for any value, or a fixed field with values of its own: `metric`
 * (`metric:orders`, `group:payments`), `domain`, `month` (`2026-10`), `answer` (an answer state),
 * `gap` (`draft`, `suggestion`, `none`) or `reported` (`yes`, `no`). `not` leaves the values out.
 */
export const obsFilterSchema = z
  .strictObject({
    key: z
      .string()
      .check(
        z.refine(
          (key) => isDimensionKey(key) || (obsFilterFields as readonly string[]).includes(key),
          'A filter is on a dimension (dim:channel) or on metric, domain, month, answer, gap or reported.',
        ),
      ),
    not: z.optional(z.boolean()),
    values: z
      .array(z.string().check(z.minLength(1), z.maxLength(200)))
      .check(z.minLength(1), z.maxLength(50)),
  })
  .check(
    z.refine(
      filterFits,
      "A filter's values are the keys of its dimension's own values or *, or what its field takes.",
    ),
  )

/** The filters a view is narrowed by, each field or dimension once. */
const filters = z.optional(
  z.array(obsFilterSchema).check(
    z.maxLength(20),
    z.refine(
      (list) => new Set(list.map((f) => f.key)).size === list.length,
      'Each field or dimension is filtered once.',
    ),
  ),
)

/** A view of what agents asked: its days, and the domain and kind of agent it counts. */
const viewInput = {
  range,
  /** One domain: the numbers and the chart count only its topics. */
  areaId: z.optional(areaId),
  /** One kind of agent (FR-410), for administrators. */
  agent: z.optional(z.enum(appFamilies)),
}

export const obsAgentsInputSchema = z.strictObject({
  ...viewInput,
  /** Only the topics that pass every filter, and what they add up to (`narrowed`). */
  filters,
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
  /** The keys of those metrics or metric groups (`metric:orders`, `group:payments`), as a filter takes them. */
  metrics: z.array(z.string()),
  /** How the metric was named: one metric, a metric group, or none. */
  named: z.enum(['metric', 'group', 'none']),
  /** The values asked about, each with its dimension, as the definitions name them; empty for none. */
  values: z.array(z.object({ dimension: z.string(), value: z.string(), name: z.string() })),
  /** The dimensions named with no value, as the definitions name them: "Orders by channel". */
  dimensions: z.array(z.object({ dimension: z.string(), name: z.string() })),
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

/** A count as a reader may have it: null when hidden, and what its shown parts add up to ("13+"). */
const shownSum = z.object({ total: shown, atLeast: z.number() })
/** How many topics, and what was asked about them, from the topics' shown counts alone (FR-614). */
const topicSum = z.extend(shownSum, { topics: z.number() })

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
    /** The range before: what was checked is kept only with everything asked. */
    before: z.object({ asked: shown, missing: shown, grounded: shown }),
  }),
  /** The chart: a bar a day for 7 and 30 days, a week a bar for 90, oldest first. */
  bars: z.array(z.object({ start: day, days: z.number(), counts: shownCounts })),
  /** The topics of the range in the domains the reader sees, those that pass the filters. */
  topics: z.array(obsTopicSchema),
  /**
   * The subjects of those topics, each counted over all its months. With filters a kept subject
   * still names the topics of all its months, some of which are not in `topics`: read a filtered
   * view's sums from `narrowed`, never add them up from `topics`.
   */
  subjects: z.array(obsSubjectSchema),
  domains: z.array(z.object({ areaId: z.nullable(areaId), total: shown, atLeast: z.number() })),
  /**
   * With filters: what the topics that pass them add up to, from shown counts alone (a whole
   * domain's total, a whole subject's, else each topic's), never a count of its own. It is where a
   * filtered view's sums are read; adding up `topics` with whole totals would count too much.
   */
  narrowed: z.nullable(
    z.object({
      asked: topicSum,
      counts: z.object({
        grounded: shownSum,
        partial: shownSum,
        conflict: shownSum,
        stale: shownSum,
        missing: shownSum,
      }),
    }),
  ),
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

export const obsDimensionsInputSchema = z.strictObject({ ...viewInput, filters })

const viewHead = {
  /** Nothing asked yet; fewer than the minimum in the range (no counts at all); or counted. */
  state: z.enum(['empty', 'quiet', 'normal']),
  range: z.number(),
  last: day,
  minimumCount: z.number(),
}

export const obsDimensionsSchema = z.object({
  ...viewHead,
  /**
   * Every dimension of the definitions and any other a topic of the range names, the most asked
   * about in the range first, then A to Z: how many values it has, the definitions' and any other
   * a topic names (none: "any value" alone), and the topics that name it and pass every
   * filter but its own, with what was asked about them; null unless the range is counted.
   */
  dimensions: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      values: z.number(),
      asked: z.nullable(topicSum),
    }),
  ),
})

export const obsValuesInputSchema = z
  .strictObject({
    ...viewInput,
    filters,
    /** One dimension's values, a page at a time; without it, `q` searches every dimension. */
    dimension: z.optional(dimensionKey),
    /** The words a value's name, or another name of it, starts with. */
    q: z._default(z.string().check(z.maxLength(200)), ''),
    /** Where the page starts, from the last page's `nextCursor`. */
    cursor: z.optional(z.string().check(z.regex(/^\d{1,6}$/))),
    /** The most asked about in the range first, or A to Z. */
    sort: z._default(z.enum(['asked', 'name']), 'asked'),
  })
  .check(
    z.refine(
      (input) => input.dimension !== undefined || searchable(input.q),
      'Choose a dimension, or type at least 2 letters to search every dimension.',
    ),
  )

const valueGroup = z.object({
  dimension: z.object({ key: z.string(), name: z.string() }),
  /** Any value: the topics that name the dimension and pass every filter but its own. */
  asked: topicSum,
  /** The values asked about in the range that match the words, each counted so. */
  values: z.array(z.object({ key: z.string(), name: z.string(), asked: topicSum })),
  /** How many values asked about in the range match, on every page. */
  matched: z.number(),
  /** How many values of the definitions match but were not asked about in the range. */
  notAsked: z.number(),
  /** Where its next page of values starts (`dimension` and `cursor`). */
  nextCursor: z.nullable(z.string()),
})

export const obsValuesSchema = z.object({
  ...viewHead,
  sort: z.enum(['asked', 'name']),
  /**
   * With `dimension`: that dimension, a page of 50 values. Without: each dimension with a value
   * asked about that matches the words, with its first 3, a page of 50 dimensions. Empty unless
   * the range is counted.
   */
  groups: z.array(valueGroup),
  /** Matching values not asked about in the range, in every dimension searched. */
  notAsked: z.number(),
  /** Where the next page of dimensions starts, without `dimension`. */
  nextCursor: z.nullable(z.string()),
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

export const obsSummaryInputSchema = z.strictObject({
  /** The last whole calendar month, or quarter. */
  period: z._default(z.enum(summaryPeriods), 'month'),
  /** One domain: every number counts only its topics. */
  areaId: z.optional(areaId),
})

/** Days from `start` up to, not including, `end`. */
const span = z.object({ start: day, end: day })

/**
 * What was caught in the period besides the answers with a warning (`numbers.warned`), each a line
 * of its own and never added up (db/migrations/0033_obs_caught.sql): how many times a saved
 * question's answer changed after a change, in all and by kind of change; and the alerts that
 * asked an owner for a decision, and how many an owner acted on within 14 days.
 */
const caughtSchema = z.object({
  saved: z.object({
    total: shown,
    /** By the change it came after: the check run's trigger (`caughtTriggers`). */
    triggers: z.object({
      publish: shown,
      archive: shown,
      restore: shown,
      sync: shown,
      check_date: shown,
    }),
  }),
  alerts: z.object({ raised: shown, acted: shown }),
})

export const obsSummarySchema = z.object({
  /** Nothing asked yet; fewer than the minimum in the period (no counts at all); or counted. */
  state: z.enum(['empty', 'quiet', 'normal']),
  period: z.enum(summaryPeriods),
  minimumCount: z.number(),
  /** The last day counted (yesterday): the numbers are as of its end. */
  last: day,
  now: span,
  before: span,
  /** The first day agents asked anything in the domains read, or null before they ever have. */
  since: z.nullable(day),
  /** Whether every day of the period is still counted, by the delivery records or the weekly counts. */
  complete: z.boolean(),
  /** What was asked in the period, and how it was answered: checked, with a warning, not found. */
  numbers: z.object({ asked: shown, checked: shown, warned: shown, missing: shown }),
  /** The same in the period before, or null when it is not compared (`notCompared` says why). */
  previous: z.nullable(z.object({ asked: shown, checked: shown, missing: shown })),
  /** Agents first asked after the period before began, or its days are no longer all counted. */
  notCompared: z.nullable(z.enum(['started', 'not_kept'])),
  /** The trend: what was checked each week, from the weekly counts, oldest first. */
  weeks: z.array(
    z.object({
      start: day,
      /** False for a week before agents first asked, or no longer counted: nothing to draw. */
      counted: z.boolean(),
      checked: shown,
    }),
  ),
  /** Topics whose questions found nothing and that are still open, the biggest first. */
  open: z.object({
    total: z.number(),
    spots: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        areaId: z.nullable(areaId),
        /** The first day its questions found nothing. */
        firstSeen: day,
        /** What found nothing about it in the period. */
        missing: shown,
        state: z.enum(['draft', 'suggestion', 'none']),
        proposalId: z.nullable(z.string()),
      }),
    ),
  }),
  /** Changes published after review in the period, the latest five, and how many in the one before: hidden under the minimum. */
  changes: z.object({
    total: shown,
    before: shown,
    latest: z.array(
      z.object({
        at: z.string(),
        itemId: z.string(),
        title: z.string(),
        areaId: z.nullable(areaId),
        /** Who approved it. */
        by: z.nullable(z.string()),
      }),
    ),
  }),
  caught: caughtSchema,
  /** How many numbers on the page are hidden: under the minimum, or keeping one under it safe. */
  hidden: z.number(),
})

/**
 * What a monthly snapshot keeps of a Summary: its counts as they were shown, every one already
 * through the disclosure pass (a hidden count is null, never its value), and nothing else. What
 * is still open and what changed are kept as counts: no topic, no item and nobody who approved.
 */
export const obsSnapshotSummarySchema = z.extend(
  z.omit(obsSummarySchema, { open: true, changes: true, caught: true }),
  {
    open: z.object({ total: z.number() }),
    changes: z.object({ total: shown, before: shown }),
    /** What was caught; a snapshot taken before it was counted has none. */
    caught: z.optional(caughtSchema),
  },
)

/** The sentences a snapshot keeps, said by fixed templates over its counts when it was taken. */
export const obsSnapshotWordsSchema = z.object({
  sentences: z.array(z.string()),
  caught: z.array(
    z.object({ key: z.string(), title: z.string(), text: z.string(), measured: z.boolean() }),
  ),
  notes: z.array(z.string()),
})

/** A snapshot as a list says it: which month and scope, when it was taken, and its state. */
export const obsSnapshotItemSchema = z.object({
  id: z.string(),
  period: z.enum(['month']),
  /** The domain it counts, or null for every domain. */
  areaId: z.nullable(areaId),
  now: span,
  /** The day it was taken. */
  takenOn: day,
  state: z.enum(['empty', 'quiet', 'normal']),
})

export const obsSnapshotSchema = z.extend(obsSnapshotItemSchema, {
  summary: obsSnapshotSummarySchema,
  words: obsSnapshotWordsSchema,
})

export const obsSnapshotsInputSchema = z.strictObject({
  /** One domain's snapshots; without it, every domain's (administrators) or an owner's own. */
  areaId: z.optional(areaId),
})

export const obsSnapshotInputSchema = z.strictObject({ id: z.string().check(z.uuid()) })

export const obsSnapshotTakeSchema = z.object({
  /** The month taken: the last whole one. */
  now: span,
  /** How many scopes had no snapshot of it yet and have one now. */
  taken: z.number(),
})

/**
 * A filter of a saved view, as Overview's filter bar draws it: a field or a dimension
 * (`dim:store`, with its values' keys or `*`), whether it leaves its values out, and the values,
 * in the order the chips were put in. `market` is the old "Value" field, by name. Never a question's words: a
 * topic's are the words a reader searched its name for.
 */
const viewChip = z
  .object({
    key: z.union([
      z.enum([
        'answer',
        'domain',
        'agent',
        'market',
        'metric',
        'month',
        'gap',
        'reported',
        'topic',
      ]),
      dimensionKey,
    ]),
    not: z.optional(z.boolean()),
    values: z.array(z.string().check(z.minLength(1), z.maxLength(200))).check(z.maxLength(50)),
  })
  .check(
    z.refine(
      (c) => !isDimensionKey(c.key) || filterFits(c),
      "A dimension's chip keeps the keys of its own values (val:store/alder_row), or * for any value.",
    ),
  )

const viewFilters = z.object({
  /** The chips, in order; a view saved before them keeps the fields below. */
  chips: z.optional(
    z.array(viewChip).check(
      z.maxLength(20),
      z.refine(
        (list) => new Set(list.map((c) => c.key)).size === list.length,
        'Each field or dimension is a chip once.',
      ),
    ),
  ),
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
export type ObsFilterInput = z.infer<typeof obsFilterSchema>
export type ObsDimensionsInput = z.infer<typeof obsDimensionsInputSchema>
export type ObsDimensions = z.infer<typeof obsDimensionsSchema>
export type ObsValuesInput = z.infer<typeof obsValuesInputSchema>
export type ObsValues = z.infer<typeof obsValuesSchema>
export type ObsAgents = z.infer<typeof obsAgentsSchema>
export type ObsTopic = z.infer<typeof obsTopicSchema>
export type ObsSubject = z.infer<typeof obsSubjectSchema>
export type ObsFeedback = z.infer<typeof obsFeedbackSchema>
export type ObsUsage = z.infer<typeof obsUsageSchema>
export type ObsSummaryInput = z.infer<typeof obsSummaryInputSchema>
export type ObsSummary = z.infer<typeof obsSummarySchema>
export type ObsSnapshotSummary = z.infer<typeof obsSnapshotSummarySchema>
export type ObsSnapshotWords = z.infer<typeof obsSnapshotWordsSchema>
export type ObsSnapshotItem = z.infer<typeof obsSnapshotItemSchema>
export type ObsSnapshot = z.infer<typeof obsSnapshotSchema>
export type ObsSnapshotTake = z.infer<typeof obsSnapshotTakeSchema>
export type ObsView = z.infer<typeof obsViewSchema>
export type ObsViewFilters = z.infer<typeof viewFilters>
