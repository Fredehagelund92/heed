/**
 * The answer engine on the API (src/domain/answer.ts): what agents get for a question, a typed
 * scope or a topic, on the live edition, the edition before it, or with a draft in it, with its
 * state, its items, what was left out and why, its sentence and its timed steps. No model runs.
 * Ask looks up a question (`ask.lookup`, step by step), Ask shows what agents asked this week
 * (`ask.asked`), Try it runs on a draft (`tryIt.run`), the answer panel replays a topic
 * (`obs.replay`), and the editor and the review count who would get a draft (`engine.reach`).
 */
import * as z from 'zod/mini'
import { answerStates, leftOutReasons } from '../domain/answer.ts'
import { itemKinds } from '../domain/item.ts'
import { tryItInputSchema, tryItSchema } from './connect.ts'

/** The resolver's status, as get_context gives it. */
const statusSchema = z.enum(['matched', 'conflict', 'no_match', 'need_more_detail', 'check_failed'])
const windowSchema = z.object({ start: z.string(), end: z.nullable(z.string()) })
/** A scope as read: metric keys, each dimension's value keys (none for "by dimension"), the days. */
export const readScopeSchema = z.object({
  metrics: z.array(z.string()),
  filters: z.record(z.string(), z.array(z.string())),
  window: windowSchema,
})
const issueSchema = z.object({
  field: z.string(),
  input: z.string(),
  options: z.array(z.string()),
  message: z.optional(z.string()),
})
const datesSchema = z.object({ words: z.string(), reads_as: z.string() })
const assumedSchema = z.object({
  date: z.string(),
  time_zone: z.literal('UTC'),
  reason: z.literal('no date given'),
})

export const answerItemSchema = z.object({
  id: z.string(),
  version: z.number(),
  areaId: z.string(),
  kind: z.enum(itemKinds),
  title: z.string(),
  summary: z.string(),
  validity: windowSchema,
  match: z.enum(['exact', 'partial']),
  unverified: z.boolean(),
  unverifiedReason: z.nullable(z.enum(['needs_check', 'source_missing', 'past_review_date'])),
  restrictions: z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })),
  conflictsWith: z.array(z.string()),
  /** The line its owner copied from its first source; null when none was copied. */
  quote: z.nullable(z.string()),
  /** What not to conclude from it, when its writer said; null for the default. */
  notToConclude: z.nullable(z.string()),
})
export const leftOutSchema = z.object({
  id: z.string(),
  reason: z.enum(leftOutReasons),
  kind: z.enum(itemKinds),
  title: z.string(),
  replacedBy: z.nullable(z.string()),
})
const uncoveredSchema = z.object({ metrics: z.array(z.string()), values: z.array(z.string()) })
export const answerStateSchema = z.enum(answerStates)

const timed = { ms: z.number() }
/** One step of an answer, as it was done, and how long it took in milliseconds. */
export const answerStepSchema = z.union([
  z.object({
    step: z.literal('read_scope'),
    ...timed,
    scope: z.nullable(readScopeSchema),
    dates: z.nullable(datesSchema),
    assumed: z.nullable(assumedSchema),
    issues: z.array(issueSchema),
  }),
  z.object({
    step: z.literal('looked_up'),
    ...timed,
    status: statusSchema,
    items: z.array(answerItemSchema),
  }),
  z.object({
    step: z.literal('left_out'),
    ...timed,
    leftOut: z.array(leftOutSchema),
    more: z.number(),
    forAnotherGroup: z.number(),
  }),
  z.object({
    step: z.literal('checked'),
    ...timed,
    state: answerStateSchema,
    uncovered: uncoveredSchema,
  }),
  z.object({ step: z.literal('said'), ...timed, say: z.string(), next: z.nullable(z.string()) }),
])

/**
 * What it was answered on: the live edition, a past one (`edition`), or the live edition with a
 * draft in it, where `item` is the draft's item. A draft's answer is never called Checked: it says
 * "Based on this draft".
 */
export const answerTargetSchema = z.union([
  z.object({ kind: z.literal('live') }),
  z.object({ kind: z.literal('edition') }),
  z.object({ kind: z.literal('draft'), proposal: z.string(), item: z.string() }),
])

export const answerSchema = z.object({
  target: answerTargetSchema,
  /** The edition's label, such as 2026-10-20.3. */
  edition: z.string(),
  /** The resolver's status, as get_context gives it. */
  status: statusSchema,
  /** One of the six answer states (FR-349). */
  state: answerStateSchema,
  scope: z.nullable(readScopeSchema),
  dates: z.nullable(datesSchema),
  assumed: z.nullable(assumedSchema),
  issues: z.array(issueSchema),
  items: z.array(answerItemSchema),
  leftOut: z.array(leftOutSchema),
  /** Near misses past the first ten, counted only. */
  leftOutMore: z.number(),
  /** Items that apply but are for another group: counted, never named. */
  forAnotherGroup: z.number(),
  /** The asked metrics and values no item covers in full: what makes an answer Partial. */
  uncovered: uncoveredSchema,
  /** What a person hears, as get_context says it (FR-344). */
  say: z.string(),
  /** What an agent is told to do next. */
  next: z.nullable(z.string()),
  steps: z.array(answerStepSchema),
  /** The steps' time together, in milliseconds. */
  ms: z.number(),
})
export type AnswerResult = z.infer<typeof answerSchema>

/**
 * A question for Ask: its words, and the names a person picked beside them (the @ chips), read as
 * get_context reads an agent's. The words are read in memory and never stored or logged (FR-602);
 * sent in a POST body for that reason.
 */
export const lookupInputSchema = z.strictObject({
  question: z.string().check(z.minLength(1), z.maxLength(2000)),
  ...tryItInputSchema.shape,
})
export type LookupInput = z.infer<typeof lookupInputSchema>
/**
 * A look-up as it runs: each step when it is done, then the answer, then, when the service runs
 * with a real model, the words the model wrote from the answer's items (each sentence that uses
 * an item ending with its number, [1] for the first). The words never change the state, the items
 * or what agents are told; without them, Ask writes its own from the items.
 */
export const lookupEventSchema = z.union([
  z.object({ type: z.literal('step'), step: answerStepSchema }),
  z.object({ type: z.literal('answer'), answer: answerSchema }),
  z.object({ type: z.literal('words'), text: z.string() }),
])
export type LookupEvent = z.infer<typeof lookupEventSchema>

/**
 * Asked this week: the topics agents asked about most this week (a metric, a market and the
 * dimensions named, its months joined), each with the state Ask gives it now for its latest
 * month, as counts only. A count under the minimum is never shown (FR-614): `count` is null when
 * a small month could be worked out from it, and `atLeast` is what the shown months add up to.
 */
export const askedSchema = z.object({
  /** The first day of the week counted (Monday, UTC). */
  week: z.string(),
  rows: z.array(
    z.object({
      /** The topic in words, as get_context says a scope: "Orders in Norway". */
      title: z.string(),
      area: z.nullable(z.string()),
      /** The scope a click asks about: the topic at its latest month. */
      scope: readScopeSchema,
      months: z.array(z.string()),
      count: z.nullable(z.number()),
      atLeast: z.number(),
      state: answerStateSchema,
      /** How many items the answer gives. */
      items: z.number(),
      /**
       * For the owners of the topic's domains and administrators: the Not found card open on it,
       * and its draft when one waits. Null for anyone else, and when nothing is open.
       */
      gap: z.nullable(z.object({ card: z.string(), draft: z.nullable(z.string()) })),
    }),
  ),
  /** Calls about topics not listed, themselves hidden under the minimum. */
  hidden: z.nullable(z.number()),
  /**
   * Every call this week; null under the minimum, and when what it adds over the rows' counts
   * would give a small month away (FR-614). `askedAtLeast` is what the rows show together.
   */
  asked: z.nullable(z.number()),
  askedAtLeast: z.number(),
  /**
   * A workspace's first questions, made from what it has written: the scopes of its live context
   * items, then the metrics of its vocabulary, at most four, each with the scope a click asks.
   */
  starters: z.array(z.object({ title: z.string(), scope: readScopeSchema })),
})
export type Asked = z.infer<typeof askedSchema>

/**
 * Try it on a draft: what an agent would get once the draft (a proposal) is published, beside
 * what it gets now. Without `draft`, Try it runs on the live edition, as before.
 */
export const tryItRunInputSchema = z.strictObject({
  ...tryItInputSchema.shape,
  draft: z.optional(z.string().check(z.uuid())),
})
export const tryItRunSchema = z.object({
  ...tryItSchema.shape,
  /** The answer engine's answer for the same scope: its state, items, left out and steps. */
  answer: z.optional(answerSchema),
})
export type TryItRun = z.infer<typeof tryItRunSchema>

/** The answer panel's replay: a topic answered now, or before the last publish. */
export const replayInputSchema = z.strictObject({
  topic: z.string().check(z.uuid()),
  when: z._default(z.enum(['now', 'before']), 'now'),
})
export const replaySchema = z.object({
  when: z.enum(['now', 'before']),
  answer: answerSchema,
})
export type Replay = z.infer<typeof replaySchema>

/** How many questions agents asked this week would get a draft ("12 questions would get it"). */
export const reachInputSchema = z.strictObject({ draft: z.string().check(z.uuid()) })
export const reachSchema = z.object({
  /** Questions about topics asked at least the minimum times this week whose answer gives it. */
  questions: z.number(),
  week: z.string(),
})
export type Reach = z.infer<typeof reachSchema>
