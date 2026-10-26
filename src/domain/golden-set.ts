/**
 * The golden set (output test plan, section 2): cases that say what reaches an agent (L1, checked
 * by code with no model) and what a good answer does (L2, checked by code and a judge). It extends
 * the open test-question format (golden-question.ts, FR-504) with the fields the plan adds, all in
 * one file versioned with the library it is about (db/seed/golden-set.yml). `toQuestion` gives a
 * case in the open format, which drops the new fields, so a case can be imported as it is.
 * Pure definitions and checks: no input or output.
 */
import * as z from 'zod/mini'
import {
  questionIdSchema,
  questionScopeSchema,
  wordingSchema,
  type GoldenQuestionInput,
} from './golden-question.ts'
import { isCalendarDate } from './validity.ts'

/**
 * The plan's twelve behaviour types, then the two the captain added (definitions and
 * conversations), then the agent contract's: an agent that hands over the member names it queried
 * in the data tool (`handoff`), a concise reply that keeps what the answer needs (`concise`), and
 * telling an absence from a scope Heed could not read (`absence`).
 */
export const caseTypes = [
  'baseline',
  'stale',
  'superseded',
  'conflict',
  'ambiguous',
  'missing',
  'injection',
  'personal_data',
  'out_of_remit',
  'date',
  'alias',
  'two_items',
  'definition',
  'conversation',
  'handoff',
  'concise',
  'absence',
] as const
export type CaseType = (typeof caseTypes)[number]

/** What a good answer does with what it was given. */
export const behaviours = ['answer', 'clarify', 'no_context', 'decline'] as const

/**
 * get_facts's statuses a case can expect (the resolver's, without check_failed).
 * `area_not_live` is no reply any more (every domain is served since 14 Oct 2026); it stays only
 * so a sealed case that still expects it reads, and fails until its holder edits it.
 */
export const replyStatuses = [
  'matched',
  'conflict',
  'no_match',
  'need_more_detail',
  'area_not_live',
] as const

const date = z.string().check(z.refine(isCalendarDate, 'Expected a calendar date'))
const itemId = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/, 'Expected an item id'))
const text = z.string().check(z.minLength(3), z.maxLength(500))
const ids = z.array(itemId).check(z.maxLength(20))

/**
 * What get_facts must give for the case's scope at its as-of date (L1). `rank_max` is the
 * lowest place a must-deliver item may take (default 5, L1.4); `versions` the version each named
 * item must be served at (L1.5); `unverified` the items that must come flagged as not verified
 * (L1.6); `text` phrases that must be in what is delivered (L1.7: a caveat the answer needs, or a
 * fixture's canary); `source_refs` the definition refs the reply's links must name. A reply must
 * not be cut (L1.10) unless `cut` says it is, as for a broad question.
 */
export const deliverySchema = z.object({
  status: z.optional(z.enum(replyStatuses)),
  must_deliver: z._default(ids, []),
  must_not_deliver: z._default(ids, []),
  rank_max: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(50))),
  versions: z.optional(z.record(itemId, z.number().check(z.int(), z.minimum(1)))),
  unverified: z.optional(ids),
  text: z.optional(z.array(text).check(z.maxLength(10))),
  source_refs: z.optional(z.array(z.string().check(z.minLength(3))).check(z.maxLength(10))),
  cut: z.optional(z.boolean()),
  /** The most characters the reply's JSON may have: what a concise reply promises (FR-342). */
  size_max: z.optional(z.number().check(z.int(), z.minimum(500))),
})
export type Delivery = z.infer<typeof deliverySchema>

/**
 * What a good answer does (L2), set from L1 alone. `caveat` is a must-keep caveat (strict over
 * tries, FR-515); `forbidden_phrases` and `canaries` must not appear in the answer, nor canaries
 * in any tool input; the booleans are what the judge is asked.
 */
export const answerSchema = z.object({
  must_cite: z._default(ids, []),
  must_not_cite: z._default(ids, []),
  caveat: z.optional(text),
  forbidden_phrases: z._default(z.array(text).check(z.maxLength(10)), []),
  canaries: z._default(z.array(z.string().check(z.minLength(6))).check(z.maxLength(5)), []),
  no_cause_claim: z._default(z.boolean(), true),
  clarifying_question: z._default(z.boolean(), false),
  states_no_context: z._default(z.boolean(), false),
  declines_out_of_remit: z._default(z.boolean(), false),
  flags_unverified: z._default(z.boolean(), false),
  mentions_conflict: z._default(z.boolean(), false),
  names_definition_source: z._default(z.boolean(), false),
})
export type Answer = z.infer<typeof answerSchema>

/**
 * The definition a definition-first case is about: the vocabulary term and the Cube member it
 * points at, or `term: null` when the name is no metric at all and nothing may be invented.
 * `described` says whether Cube gives the member a description.
 */
export const definitionSchema = z.object({
  term: z.nullable(z.string().check(z.regex(/^(metric|dim):[a-z0-9_]+$/))),
  ref: z.optional(z.string().check(z.regex(/^cube:[a-z_]+\.[a-z0-9_]+$/))),
  described: z.optional(z.boolean()),
})

const rubrics = z._default(
  z.array(z.string().check(z.minLength(3), z.maxLength(300))).check(z.maxLength(10)),
  [],
)

/** A follow-up the person sends after the first answer, with what it must get on its own. */
export const turnSchema = z.object({
  text: z.string().check(z.minLength(2), z.maxLength(2000)),
  /** The scope a good agent asks get_facts for at this turn; none when it needs no call. */
  scope: z.optional(questionScopeSchema),
  behaviour: z.enum(behaviours),
  delivery: z.optional(deliverySchema),
  answer: z.optional(answerSchema),
  rubrics,
})
export type Turn = z.infer<typeof turnSchema>

export const goldenCaseSchema = z
  .object({
    id: questionIdSchema,
    area: z.string().check(z.regex(/^area_[a-z_]+$/)),
    type: z.enum(caseTypes),
    behaviour: z.enum(behaviours),
    split: z._default(z.enum(['development', 'held_out']), 'development'),
    /** The day the case is asked on: relative dates count from it (R16). */
    as_of: date,
    // Strict: a wording with a comma and no quotes reads in YAML as a cut text and a stray key.
    wordings: z.array(z.strictObject(wordingSchema.shape)).check(z.minLength(2), z.maxLength(6)),
    /**
     * The scope a good agent asks get_facts for; none when no call is right (out of remit).
     * Metric and dimension names may be the data tool's member names, as an agent that just
     * queried it passes them (CON-517).
     */
    scope: z.optional(questionScopeSchema),
    /** How much get_facts says (FR-342): full when left out, as for an MCP client. */
    response_format: z.optional(z.enum(['concise', 'full'])),
    /** L1: what get_facts gives for the case's scope. */
    delivery: z._default(deliverySchema, { must_deliver: [], must_not_deliver: [] }),
    answer: z._default(answerSchema, {
      must_cite: [],
      must_not_cite: [],
      forbidden_phrases: [],
      canaries: [],
      no_cause_claim: true,
      clarifying_question: false,
      states_no_context: false,
      declines_out_of_remit: false,
      flags_unverified: false,
      mentions_conflict: false,
      names_definition_source: false,
    }),
    definition: z.optional(definitionSchema),
    turns: z.optional(z.array(turnSchema).check(z.minLength(1), z.maxLength(5))),
    rubrics,
    risk: z._default(z.enum(['low', 'normal', 'high']), 'normal'),
    /** How the case was picked: the selection query, or why it was written by hand. */
    source: z.string().check(z.minLength(1), z.maxLength(300)),
    /** What a reader needs to know: a known product gap, or a recorded revision and why. */
    notes: z.optional(z.string().check(z.maxLength(600))),
    /**
     * L1 checks that fail today because of a known product gap (named in `notes`), as
     * `served/check` (`served/source_refs`). The pass fails when one of them starts to hold, so
     * the case is updated when the product is. `as_if_live/check` names the second pass that ran
     * while domains could be not live; it never matches now, and stays only so a sealed case that
     * still names it reads, and fails until its holder edits it.
     */
    known_failures: z.optional(
      z.array(z.string().check(z.regex(/^(served|as_if_live)\/[a-z_]+$/))),
    ),
  })
  .check(
    z.refine(
      (c) =>
        c.wordings.some((w) => w.kind === 'natural') &&
        c.wordings.some((w) => w.kind === 'precise'),
      { message: 'Give at least one natural and one precise wording', path: ['wordings'] },
    ),
    z.refine(
      (c) => !c.delivery.must_deliver.some((id) => c.delivery.must_not_deliver.includes(id)),
      { message: 'An item cannot be both expected and forbidden', path: ['delivery'] },
    ),
    z.refine((c) => c.type !== 'conversation' || (c.turns?.length ?? 0) > 0, {
      message: 'A conversation has follow-up turns',
      path: ['turns'],
    }),
    z.refine((c) => c.type !== 'definition' || c.definition !== undefined, {
      message: 'A definition case names its definition',
      path: ['definition'],
    }),
    z.refine((c) => !c.known_failures?.length || Boolean(c.notes), {
      message: 'Name the product gap behind a known failure in notes',
      path: ['notes'],
    }),
  )
export type GoldenCase = z.infer<typeof goldenCaseSchema>

/** What one assistant turn must and must not do (FR-702 to FR-709). */
export const assistantExpectSchema = z.object({
  /** At least one of these tools is called. */
  tools_any: z.optional(z.array(z.string()).check(z.minLength(1))),
  tools_none: z.optional(z.array(z.string()).check(z.minLength(1))),
  /** The person is asked to confirm this tool, and nothing is saved meanwhile. */
  confirmation: z.optional(z.string()),
  /** Either a confirmation of this tool, or a question or request back for the facts it lacks. */
  confirmation_or_question: z.optional(z.string()),
  cites: z.optional(ids),
  cites_any: z._default(z.boolean(), false),
  canaries: z._default(z.array(z.string().check(z.minLength(6))).check(z.maxLength(5)), []),
  forbidden_phrases: z._default(z.array(text).check(z.maxLength(10)), []),
  asks_no_identity: z._default(z.boolean(), false),
  /** The answer never asks which metric, market or dates the person means. */
  asks_no_scope: z._default(z.boolean(), false),
  /**
   * The answer links at least one of these pages of Heed, by path, such as `/docs/mcp`: a link to
   * one of its headings counts.
   */
  links_any: z.optional(
    z.array(z.string().check(z.regex(/^\/[a-z][a-z0-9/-]*$/))).check(z.minLength(1)),
  ),
  /** No accepted item, decision, edition, role or saved draft changes. */
  unchanged: z._default(z.boolean(), true),
})

export const assistantCaseSchema = z.object({
  id: questionIdSchema,
  /** A case the runner already has (src/server/modules/assistant/cases.ts), or a new one. */
  origin: z.enum(['existing', 'new']),
  /**
   * `companion`: a turn the companion review saw fail, where it must reason and know the person.
   * `meta`: a message about the assistant itself (a greeting, thanks, what it can do) or outside
   * Heed, answered at once and never with a question about the scope.
   * `industry`: a question whose answer depends on what the business is and the words it uses,
   * which About our business tells the assistant; run with `--about-business on` and `off` to
   * compare what that background adds.
   * `pilot`: a conversation the captain's pilot saw go wrong, kept visible so anyone may tune
   * against it, such as a domain named by another spelling that holds nothing yet.
   * `help`: a question about how Heed itself works, answered from Heed's help pages (docs/help)
   * with a link to the page, as the Docs area and agents over MCP answer it.
   */
  type: z.enum([...caseTypes, 'assistant_task', 'companion', 'meta', 'industry', 'pilot', 'help']),
  split: z._default(z.enum(['development', 'held_out']), 'development'),
  as_of: date,
  turns: z
    .array(
      z.object({
        say: z.string().check(z.minLength(2), z.maxLength(2000)),
        expect: assistantExpectSchema,
        rubrics,
      }),
    )
    .check(z.minLength(1), z.maxLength(5)),
  source: z.string().check(z.minLength(1), z.maxLength(300)),
  notes: z.optional(z.string().check(z.maxLength(600))),
})
export type AssistantGoldenCase = z.infer<typeof assistantCaseSchema>

export const goldenSetSchema = z.object({
  /** Bumped with every change to a case after a real run, with the reason in the case's notes. */
  version: z.number().check(z.int(), z.minimum(1)),
  /** The library the cases are about: the generator's seed and size, and the fixtures. */
  library: z.object({
    seed: z.number(),
    items: z.number(),
    fixtures: z.string(),
  }),
  cases: z.array(goldenCaseSchema),
  assistant: z.array(assistantCaseSchema),
})
export type GoldenSet = z.infer<typeof goldenSetSchema>

/** A case in the open format (FR-504): what can be imported as a test question today. */
export function toQuestion(c: GoldenCase): GoldenQuestionInput {
  const status = c.delivery.status
  return {
    id: c.id,
    area: c.area,
    wordings: c.wordings,
    scope: c.scope ?? {},
    expected: {
      must_deliver: c.delivery.must_deliver,
      must_not_deliver: c.delivery.must_not_deliver,
      ...(status === 'matched' || status === 'no_match' || status === 'need_more_detail'
        ? { status }
        : {}),
      ...(c.answer.caveat ? { caveat: c.answer.caveat } : {}),
      no_cause_claim: c.answer.no_cause_claim,
      clarifying_question: c.answer.clarifying_question,
    },
    rubrics: c.rubrics,
    risk: c.risk,
    source: c.source,
    split: c.split,
    as_of: c.as_of,
  }
}

/** One delivered item as get_facts's reply has it, with what L1 reads. */
export type DeliveredItem = {
  id: string
  version?: number
  freshness?: string
  links?: { target: { source_ref?: string } }[]
}
export type DeliveryReply = {
  say?: string
  status?: string
  items?: DeliveredItem[]
  check_report?: { cut?: boolean }
}

/** The L1 checks of one reply: each true when it holds; absent when the case does not ask. */
export type DeliveryChecks = Record<string, boolean>

/**
 * L1 for one reply (L1.1 to L1.7 and L1.10): code alone, no model. `serialized` is the reply as
 * the agent reads it, for the phrases that must be in it. Every reply must also carry its
 * sentence (`say`, FR-344), whatever its status.
 */
export function deliveryChecks(
  expected: Delivery,
  reply: DeliveryReply,
  serialized: string,
): DeliveryChecks {
  const items = reply.items ?? []
  const delivered = items.map((i) => i.id)
  const checks: DeliveryChecks = {
    served: reply.status !== undefined && reply.status !== 'check_failed',
    delivered: expected.must_deliver.every((id) => delivered.includes(id)),
    not_delivered: !expected.must_not_deliver.some((id) => delivered.includes(id)),
    cut: (reply.check_report?.cut === true) === (expected.cut ?? false),
    say: typeof reply.say === 'string' && reply.say.length > 0,
  }
  if (expected.status) checks.status = reply.status === expected.status
  if (expected.must_deliver.length) {
    const max = expected.rank_max ?? 5
    checks.rank = expected.must_deliver.every((id) => {
      const at = delivered.indexOf(id)
      return at >= 0 && at < max
    })
  }
  if (expected.versions)
    checks.version = Object.entries(expected.versions).every(
      ([id, version]) => items.find((i) => i.id === id)?.version === version,
    )
  if (expected.unverified)
    checks.unverified = expected.unverified.every(
      (id) => items.find((i) => i.id === id)?.freshness === 'unverified',
    )
  if (expected.text) checks.text = expected.text.every((phrase) => serialized.includes(phrase))
  if (expected.size_max !== undefined) checks.size = serialized.length <= expected.size_max
  if (expected.source_refs) {
    const refs = new Set(items.flatMap((i) => (i.links ?? []).map((l) => l.target.source_ref)))
    checks.source_refs = expected.source_refs.every((ref) => refs.has(ref))
  }
  return checks
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Words too common, or too much about dates, to make a shared phrase a leak on their own. */
const filler = new Set([
  ...'a an and are as at be before by can do does for from has have how i in is it its of on or our since so than that the their this to was we what when which who why will with'.split(
    ' ',
  ),
  ...'day days week weeks month months year years last first latest today yesterday'.split(' '),
  ...'january february march april may june july august september october november december'.split(
    ' ',
  ),
])
const isContent = (word: string, allowed: ReadonlySet<string>) =>
  !filler.has(word) && !allowed.has(word) && !/^\d+$/.test(word)

/**
 * The leakage lint (plan, "No leakage"): the phrases a wording shares with an expected item's
 * title, summary or caveat, so a model cannot keep a caveat by echoing the question. A phrase is
 * three words in a row with at least one content word, or two content words in a row ("test
 * accounts"). Filler, dates and the case's own scope names (a metric, a market), which a question
 * must be able to say, are not content.
 */
export function sharedPhrases(
  wording: string,
  sources: readonly string[],
  scopeNames: readonly string[] = [],
): string[] {
  const allowed = new Set(scopeNames.flatMap(words))
  const grams = (s: string, n: number) => {
    const w = words(s)
    return w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n))
  }
  const leaks = (n: number, enough: (gram: string[]) => boolean) => {
    const theirs = new Set(sources.flatMap((s) => grams(s, n).map((g) => g.join(' '))))
    return grams(wording, n)
      .filter(enough)
      .map((g) => g.join(' '))
      .filter((g) => theirs.has(g))
  }
  return [
    ...new Set([
      ...leaks(3, (g) => g.some((w) => isContent(w, allowed))),
      ...leaks(2, (g) => g.every((w) => isContent(w, allowed))),
    ]),
  ]
}
