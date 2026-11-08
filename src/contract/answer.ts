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
import {
  CHAT_HELD_KEYS,
  CHAT_LINE,
  CHAT_SOURCES,
  CHAT_TURNS,
  HELD_MEANINGS,
  LOOP_READS,
  LOOP_REPLY,
} from '../domain/ask-chat.ts'
import { itemKinds } from '../domain/item.ts'
import {
  auditReadSchema,
  cannotReasons,
  limitSchema,
  recordsAnswerSchema,
  footerSchema,
} from '../domain/records-answer.ts'
import { tryItInputSchema } from './connect.ts'

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
  /** A word with more than one meaning: how a person writes it. */
  word: z.optional(z.string()),
  /** Each meaning, in the order the question says them. */
  meanings: z.optional(z.array(z.object({ key: z.string(), name: z.string() }))),
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

const followedRelSchema = z.enum(['replaces', 'conflicts_with', 'mentions'])
/**
 * What get_related follows from an answer's items, as an agent would (FR-332): one step from each
 * item, to another item or a term written in Definitions it did not get already, never a link
 * from a link, and never changing which items the answer has. `on` is the get_related switch
 * (FR-407): while it is off, nothing is followed. A retired or replaced item, or a term no longer
 * there, is listed and not followed, with the author's words only (FR-333).
 */
export const followedLinksSchema = z.object({
  on: z.boolean(),
  followed: z.array(
    z.object({
      /** The answer's item the link is on. */
      from: z.string(),
      rel: followedRelSchema,
      to: z.object({
        type: z.enum(['item', 'term']),
        /** An item's id, or a term's as `term:<id>`. */
        id: z.string(),
        label: z.string(),
        areaId: z.nullable(z.string()),
        /** What the agent read there: the item's summary, or what the term means; null for a synonym. */
        read: z.nullable(z.string()),
        /** What a synonym is another name for: a metric's or a dimension's key, or `term:<id>`. */
        sameAs: z.nullable(z.string()),
      }),
    }),
  ),
  notFollowed: z.array(
    z.object({
      from: z.string(),
      rel: followedRelSchema,
      to: z.object({
        type: z.enum(['item', 'term']),
        id: z.string(),
        label: z.string(),
        status: z.string(),
      }),
    }),
  ),
})
export type FollowedLinks = z.infer<typeof followedLinksSchema>

/**
 * What a definition source says a metric means, and where that comes from, as get_context gives
 * an agent for a question about what it means (FR-338): the source's own words, never a
 * calculation (CON-207).
 */
export const askDefinitionSchema = z.object({
  /** The metric's key: `metric:churn_rate`. */
  key: z.string(),
  name: z.string(),
  /** The source's description, at most 500 characters; null when it gives none. */
  words: z.nullable(z.string()),
  /** The words were shortened to fit. */
  shortened: z.boolean(),
  /** The tool the source reads, as people say it: "Cube". */
  tool: z.string(),
  /** The source's name in Sources. */
  source: z.string(),
  /** The definition's id in the source: `cube:customers.churn_rate`. */
  ref: z.string(),
})
export type AskDefinition = z.infer<typeof askDefinitionSchema>

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
  /** What get_related follows from the items, in Ask's look-up only. */
  links: z.optional(followedLinksSchema),
  /**
   * In Ask's look-up only, for a question about what a metric means ("What is churn rate?"): its
   * definition, from the definition source. It changes neither the state nor the items.
   */
  definitions: z.optional(z.array(askDefinitionSchema)),
  /**
   * In Ask's look-up only, for a question that names values, such as a market, and no metric, and
   * found nothing: the metrics that context about all those values is written for, by key, most
   * items first, at most three. Context about a market is mostly about a metric in it.
   */
  valueMetrics: z.optional(z.array(z.string())),
  /**
   * In Ask's look-up only, when its planner read the question (FR-719): how it was read, in words,
   * the names and dates carried from the last question, and where the dates came from. The model
   * chose the reads; the state, the items and what agents are told are the reads' own.
   */
  reading: z.optional(
    z.object({
      words: z.string(),
      carried: z.array(z.string()),
      period: z.nullable(z.enum(['asked', 'carried', 'today', 'recent', 'any'])),
      /** The question as it reads alone, as the model restated it, when the chat matters. */
      standalone: z.optional(z.string()),
      /** The part of the question these reads do not answer, as a short question (FR-720). */
      left: z.optional(z.string()),
      /** What the records say about what was read, in fixed sentences: its owners, its check dates. */
      facts: z.optional(z.array(z.string())),
      /**
       * The person said which meaning of a word they meant and the fixed rules read it, with no
       * model; `also` names the meanings left ("Sales can also mean Gross sales.").
       */
      settled: z.optional(z.object({ also: z.nullable(z.string()) })),
    }),
  ),
  /**
   * In Ask's look-up only, when the question reaches beyond what is written (FR-720): the fixed
   * sentence it leads with. It changes neither the state nor the items.
   */
  limit: z.optional(limitSchema),
  /** In Ask's look-up only: what a count is out of, what was not seen, and what may be out of date. */
  footer: z.optional(footerSchema),
})
export type AnswerResult = z.infer<typeof answerSchema>

/** A word Ask asks about, and its meanings in the order the question says them. */
const heldWordSchema = z.strictObject({
  word: z.string().check(z.minLength(1), z.maxLength(200)),
  meanings: z
    .array(
      z.strictObject({
        key: z.string().check(z.maxLength(200)),
        name: z.string().check(z.maxLength(200)),
      }),
    )
    .check(z.minLength(2), z.maxLength(HELD_MEANINGS)),
})

/**
 * What the turn that asks which meaning of a word keeps of its question: the word, its meanings,
 * the rest of the reading as keys, the days it named (null when it named none) and any other word
 * still to ask about. Heed's own question comes from these, so the service checks them against
 * the edition. Never stored.
 */
export const heldReadingSchema = z.strictObject({
  ...heldWordSchema.shape,
  metrics: z.array(z.string().check(z.maxLength(200))).check(z.maxLength(CHAT_HELD_KEYS)),
  filters: z.record(
    z.string().check(z.maxLength(200)),
    z.array(z.string().check(z.maxLength(200))).check(z.maxLength(CHAT_HELD_KEYS)),
  ),
  window: z.nullable(windowSchema),
  more: z.optional(z.array(heldWordSchema).check(z.maxLength(CHAT_HELD_KEYS))),
  why: z.optional(z.boolean()),
  defines: z.optional(z.boolean()),
})

/** One read of Ask's loop: the tool, by its name, and its input, as the model gave it. */
export const loopReadSchema = z.strictObject({
  tool: z.string().check(z.minLength(1), z.maxLength(40)),
  input: z.record(z.string().check(z.maxLength(40)), z.unknown()),
})
export type LoopRead = z.infer<typeof loopReadSchema>

/**
 * A turn of Ask's loop once it is done (FR-719, FR-720): the model's words, or one question back
 * with the readings it sees as choices, or a fixed sentence when the turn stopped at a limit or
 * its model failed. Everything else is written by code from the reads: the sources (the context
 * items its words cite, by id, [n] for the nth), the state (FR-720.4), the footer (FR-720.5),
 * what was read (FR-720.9), the definitions it named, and the reads the next turn sends back.
 */
export const loopTurnSchema = z.object({
  kind: z.enum(['answer', 'question', 'stopped']),
  text: z.string(),
  sources: z.array(z.string()),
  state: z.nullable(answerStateSchema),
  footer: footerSchema,
  read: z.array(z.string()),
  /** Context items about the same names that do not apply, under Not found: named, not used. */
  nearby: z.array(z.string()),
  /** Under Conflict, two of its sources that disagree, by id, as the reads mark them. */
  conflict: z.array(z.string()),
  definitions: z.array(
    z.object({ name: z.string(), words: z.nullable(z.string()), tool: z.string() }),
  ),
  choices: z.array(z.string()),
  reads: z.array(loopReadSchema),
  /** Why a turn stopped: its step or time limit, the spending limits, or its model failed. */
  stopped: z.nullable(z.enum(['steps', 'time', 'spending', 'model'])),
})
export type LoopTurn = z.infer<typeof loopTurnSchema>

/**
 * One turn of the chat, sent from the browser with each question so Ask can carry what it asked
 * (FR-713, FR-719): its question, how it was read, in words and as keys, its answer state and one
 * sentence from a template, its sources by id, and the question Ask asked back, when it did. Never
 * the answer's words or a data value, and never stored on the service, like the question (FR-602,
 * FR-717).
 */
export const chatTurnSchema = z.strictObject({
  question: z.string().check(z.minLength(1), z.maxLength(2000)),
  scope: z.optional(z.nullable(readScopeSchema)),
  sources: z.array(z.string().check(z.maxLength(64))).check(z.maxLength(CHAT_SOURCES)),
  asked: z.optional(z.string().check(z.maxLength(2000))),
  held: z.optional(heldReadingSchema),
  understood: z.optional(z.nullable(z.string().check(z.maxLength(CHAT_LINE)))),
  domain: z.optional(z.nullable(z.string().check(z.maxLength(64)))),
  period: z.optional(z.nullable(z.string().check(z.maxLength(64)))),
  dated: z.optional(z.boolean()),
  state: z.optional(z.nullable(answerStateSchema)),
  headline: z.optional(z.nullable(z.string().check(z.maxLength(CHAT_LINE)))),
  audit: z.optional(z.nullable(auditReadSchema)),
  rows: z.optional(z.array(z.string().check(z.maxLength(120))).check(z.maxLength(CHAT_SOURCES))),
  /**
   * Ask's loop (FR-719.1): what Ask said, as the person read it, and the reads it made, by tool
   * and input. The service reads each again as the person before the model sees its result, so a
   * result is never taken from the browser (FR-718.3).
   */
  reply: z.optional(z.string().check(z.maxLength(LOOP_REPLY))),
  reads: z.optional(z.array(loopReadSchema).check(z.maxLength(LOOP_READS))),
})
export type ChatTurnInput = z.infer<typeof chatTurnSchema>

/**
 * A question for Ask: its words, and the names a person picked beside them (the @ chips), read as
 * get_context reads an agent's, and the chat's last turns, oldest first. The words are read in
 * memory and never stored or logged (FR-602); sent in a POST body for that reason.
 */
export const lookupInputSchema = z.strictObject({
  question: z.string().check(z.minLength(1), z.maxLength(2000)),
  ...tryItInputSchema.shape,
  turns: z.optional(z.array(chatTurnSchema).check(z.maxLength(CHAT_TURNS))),
})
export type LookupInput = z.infer<typeof lookupInputSchema>
/**
 * A look-up as it runs: each step when it is done, then the answer, then, when the service runs
 * with a real model and the answer gives items, the words the model writes from them, a sentence
 * at a time as each passes the check (each sentence that uses an item ending with its number, [1]
 * for the first), and `words-end` when they are done. A sentence that fails the check ends the
 * words there. The words never change the state, the items or what agents are told; with no
 * sentence, Ask writes its own words from the items.
 *
 * A question about the context's own records ("what was created in the last 24 hours", "who owns
 * Sales") is not looked up: its one event is the records answer (src/domain/records.ts), counted
 * from what the person may see, with no answer state. Agents never read it.
 *
 * When Ask's planner reads the question (FR-719), `plan` comes first, saying what is looked up so
 * the working line can say it; then the reads' steps and answer as above, or one `reply`: a short
 * question back, the sentence for a question off topic, or the sentence for a message that asks
 * nothing, with nothing looked up and no state.
 *
 * When the service runs Ask's loop instead (FR-718 to FR-720, `HEED_ASK_LOOP`), a `progress` line
 * comes as each read starts, written by code from what it reads, then one `turn`.
 */
export const lookupEventSchema = z.union([
  z.object({ type: z.literal('progress'), working: z.string() }),
  z.object({ type: z.literal('turn'), turn: loopTurnSchema }),
  z.object({
    type: z.literal('plan'),
    plan: z.object({
      kind: z.enum(['reads', 'records', 'clarify', 'off_topic', 'cannot']),
      /** What the working line says while the reads run: "Looking for events and guides…". */
      working: z.string(),
    }),
  }),
  z.object({
    type: z.literal('reply'),
    reply: z.object({
      kind: z.enum(['clarify', 'off_topic', 'nothing_asked', 'cannot']),
      text: z.string(),
      /** For `cannot` (FR-720): why, what a definition says, and what a draft would start from. */
      reason: z.optional(z.enum(cannotReasons)),
      definitions: z.optional(z.array(askDefinitionSchema)),
      write: z.optional(
        z.object({ metric: z.nullable(z.string()), market: z.nullable(z.string()) }),
      ),
      /** Ask asked which meaning of a word: what the next turn sends back with the answer. */
      held: z.optional(heldReadingSchema),
    }),
  }),
  z.object({ type: z.literal('step'), step: answerStepSchema }),
  z.object({ type: z.literal('answer'), answer: answerSchema }),
  z.object({ type: z.literal('sentence'), text: z.string() }),
  z.object({ type: z.literal('words-end') }),
  z.object({
    type: z.literal('records'),
    records: recordsAnswerSchema,
    /** When Ask's planner chose it: what it carried, and the question as it reads alone. */
    reading: z.optional(
      z.object({ carried: z.array(z.string()), standalone: z.optional(z.string()) }),
    ),
  }),
])
export type RecordsAnswer = z.infer<typeof recordsAnswerSchema>
export type LookupEvent = z.infer<typeof lookupEventSchema>

/**
 * Asked this week: the topics agents asked about most this week (a metric, a market and the
 * dimensions named, its months joined), each with the state Ask gives it now for its latest
 * month, as counts only. A count under the minimum is never shown (FR-614): `count` is null when
 * a small month could be worked out from it, and `atLeast` is what the shown months add up to.
 */
export const askedSchema = z.object({
  /** The first of the 7 full days counted, as Observability counts them (UTC). */
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
       * How many of this week's calls delivered no item, what agents found, not what the topic
       * reads as now; null under the minimum (FR-614).
       */
      nothing: z.nullable(z.number()),
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
export const reachSchema = z.object({
  /** Questions about topics asked at least the minimum times this week whose answer gives it. */
  questions: z.number(),
  week: z.string(),
})
export type Reach = z.infer<typeof reachSchema>
