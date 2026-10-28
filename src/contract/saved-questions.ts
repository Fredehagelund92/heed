/**
 * Saved questions on the API (FR-526): a domain's owners and administrators save a question with
 * the items it should answer from (`savedQuestions.create`), and every saved question is checked
 * again for free, with no model, after each change agents get and on Check now
 * (`savedQuestions.check`). Each one's result is Same, Changed or Needs a look, with what it said
 * when saved and what it says now; `savedQuestions.keep` makes the new answer the saved one.
 * `savedQuestions.status` says how far the last run got and how many answered as saved each week.
 * Agents never read any of it. The rules are in src/domain/saved-check.ts.
 */
import * as z from 'zod/mini'
import { answerStates } from '../domain/answer-state.ts'
import { checkTriggers, savedReasons, savedResults } from '../domain/saved-check.ts'

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const itemId = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))

/** An answer as the check keeps it: its state, the items it gave and what a person hears. */
export const savedAnswerSchema = z.object({
  state: z.enum(answerStates),
  say: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      unverified: z.nullable(z.enum(['needs_check', 'source_missing', 'past_review_date'])),
    }),
  ),
})

export const savedQuestionSchema = z.object({
  id: z.string(),
  areaId: z.string(),
  question: z.string(),
  origin: z.enum(['ask', 'gap', 'typed']),
  savedBy: z.object({ personId: z.string(), name: z.nullable(z.string()) }),
  savedAt: z.string(),
  /** The items it should answer from; a person may leave some of the answer's items out. */
  expectItems: z.array(z.string()),
  /** What it should keep getting. */
  saved: savedAnswerSchema,
  /** Its last check: the result, why, what it gets now, when, and what started it. */
  result: z.object({
    result: z.enum(savedResults),
    reason: z.enum(savedReasons),
    now: savedAnswerSchema,
    checkedAt: z.string(),
    trigger: z.enum(checkTriggers),
  }),
})
export type SavedQuestionRecord = z.infer<typeof savedQuestionSchema>

export const savedListInputSchema = z.strictObject({ areaId: z.optional(areaId) })

export const savedCreateInputSchema = z.strictObject({
  areaId,
  question: z.string().check(z.trim(), z.minLength(1), z.maxLength(500)),
  origin: z.enum(['ask', 'gap', 'typed']),
  /** The items it should answer from; left out, every item the answer gives now. */
  expectItems: z.optional(z.array(itemId).check(z.maxLength(20))),
})

export const savedIdInputSchema = z.strictObject({ id: z.string().check(z.uuid()) })

/** A change to a saved question that Undo takes back: `saved:<question id>` or `kept:<baseline id>`. */
export const savedChangeSchema = z.object({
  question: savedQuestionSchema,
  undo: z.string(),
})

export const savedCheckInputSchema = z.strictObject({
  /** One domain's saved questions; left out, every one the person manages. */
  areaId: z.optional(areaId),
})

/** A check run: what started it, how far it got, and how it ended. */
export const checkRunSchema = z.object({
  id: z.string(),
  trigger: z.enum(checkTriggers),
  areaId: z.nullable(z.string()),
  state: z.enum(['running', 'done', 'failed']),
  checked: z.number(),
  total: z.number(),
  startedAt: z.string(),
  endedAt: z.nullable(z.string()),
})
export type CheckRun = z.infer<typeof checkRunSchema>

export const savedCheckResultSchema = z.object({
  run: checkRunSchema,
  same: z.number(),
  changed: z.number(),
  look: z.number(),
})

export const savedStatusInputSchema = z.strictObject({ areaId: z.optional(areaId) })

export const savedStatusSchema = z.object({
  /** The newest run over the saved questions the person reads: Check now's, or the check job's. */
  run: z.nullable(checkRunSchema),
  /** When the person's saved questions were last checked. */
  checkedAt: z.nullable(z.string()),
  /**
   * The last eight weeks, Monday first: how many saved questions answered as saved at the end of
   * each week (the current week: now), of how many there were.
   */
  weeks: z.array(z.object({ week: z.string(), same: z.number(), total: z.number() })),
})
export type SavedStatus = z.infer<typeof savedStatusSchema>

/**
 * A saved question that answers from the item a suggestion changes, checked before Publish (the
 * review's line): what it gets with the draft beside what it gets now, so the result is what this
 * change does to it. Shown, never stored, and never a reason Publish waits.
 */
export const savedDraftSchema = z.object({
  id: z.string(),
  question: z.string(),
  result: z.enum(savedResults),
  reason: z.enum(savedReasons),
  live: savedAnswerSchema,
  draft: savedAnswerSchema,
  /** The items it should answer from that it answers from now. */
  expectItems: z.array(z.string()),
})
export type SavedDraft = z.infer<typeof savedDraftSchema>
