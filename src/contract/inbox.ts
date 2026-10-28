/**
 * The Inbox of Heed v1 on the API (docs/product.md, section 5): one read that joins what needs the
 * person, grouped by need as the mockup groups it (`inbox.feed`), which cards they opened
 * (`cards.markRead`), the one decision a card offers (`cards.decide`), and the setup checklist of a
 * new workspace (`setup.state`). Every count from agents is a count only, and a count under the
 * minimum reads as hidden (FR-614).
 */
import * as z from 'zod/mini'
import { alertCardRules } from '../domain/alerts.ts'
import { cardGroups, cardActions, setupSteps } from '../domain/inbox.ts'
import { raiseSubjectSchema } from './alerts.ts'
import { proposalActions } from '../domain/proposal.ts'
import { syncedSchema, undoTokenSchema } from './review-path.ts'

/** A count from agents: null when it is above zero and under the minimum (FR-614). */
const shownCount = z.nullable(z.number())

const cardBase = {
  /** The card's own name, stable across reads: "proposal:<id>", "gap:<id>", "feedback:<id>", "check:<item>", "look:<domain>", "alert:<raise>". */
  id: z.string(),
  areaId: z.string(),
  /** When what it shows happened. */
  at: z.string(),
  opened: z.boolean(),
  /** Decided or closed, with how and when; null while it needs someone. */
  done: z.nullable(z.object({ outcome: z.string(), at: z.string() })),
}

/**
 * One card, by what happened (the mockup's groups: Not found, Reported, Saved questions, Alerts,
 * Mentioned you, Due for a check, Suggestions).
 */
export const cardSchema = z.union([
  z.object({
    ...cardBase,
    group: z.literal('suggestion'),
    proposalId: z.string(),
    number: z.number(),
    title: z.string(),
    action: z.enum(proposalActions),
    itemId: z.nullable(z.string()),
    /** Who sent it; null when a content source's read made it, which `synced` names. */
    from: z.nullable(z.object({ personId: z.string(), name: z.nullable(z.string()) })),
    writtenBy: z.nullable(z.enum(['agent', 'assistant', 'source'])),
    synced: z.nullable(syncedSchema),
    /** The person read the version under review: it may go out with the others they read (FR-226). */
    read: z.boolean(),
    /** What needs care before publishing: claims to check, and whether it clashes with live context. */
    care: z.object({ claims: z.number(), clash: z.boolean() }),
  }),
  z.object({
    ...cardBase,
    group: z.literal('gap'),
    gapId: z.string(),
    ref: z.string(),
    /** What agents asked about, in words: never their words, which are not kept. */
    title: z.string(),
    scope: z.object({
      metrics: z.array(z.string()),
      values: z.array(z.string()),
      dimensions: z.array(z.string()),
      month: z.nullable(z.string()),
    }),
    /** How often agents found nothing for it this week. */
    times: shownCount,
    /** The draft started from it, if any. */
    draft: z.nullable(z.string()),
  }),
  z.object({
    ...cardBase,
    group: z.literal('flag'),
    /** What it was sent as: an agent's anonymous feedback, or a person's named report from Ask. */
    source: z.enum(['agent', 'ask']),
    /** The record behind it: the feedback's id, or the named report's. */
    feedbackId: z.string(),
    verdict: z.enum(['wrong', 'unclear']),
    note: z.nullable(z.string()),
    /** Who sent a named report; null for an agent's feedback, which keeps nobody. */
    by: z.nullable(z.string()),
    /** A named report's question, correct version and link, as its sender wrote them. */
    question: z.nullable(z.string()),
    correction: z.nullable(z.string()),
    link: z.nullable(z.string()),
    /** The context the reported answer gave, as agents got it, first first; empty when unknown. */
    items: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  z.object({
    ...cardBase,
    group: z.literal('mention'),
    /** The thread, as the app names it: "review:<suggestion id>" or "context:<item id>". */
    subject: z.string(),
    /** What the thread hangs on: the suggestion's or the item's title. */
    title: z.string(),
    /** The newest comment there that mentions the person and that they haven't read. */
    commentId: z.string(),
    from: z.object({ personId: z.string(), name: z.nullable(z.string()) }),
    excerpt: z.string(),
  }),
  z.object({
    ...cardBase,
    group: z.literal('look'),
    /** The domain's saved questions that need a look now, the newest to need one first (FR-526). */
    questions: z.array(z.object({ id: z.string(), question: z.string() })),
  }),
  z.object({
    ...cardBase,
    group: z.literal('alert'),
    /** The raise behind it, and the rule that raised it. */
    raiseId: z.string(),
    rule: z.enum(alertCardRules),
    /** What the rule found, in counts and scopes only (FR-614). */
    title: z.string(),
    /** Where its one action goes: a topic's answer panel, a page, or an integration. */
    subject: raiseSubjectSchema,
  }),
  z.object({
    ...cardBase,
    group: z.literal('check'),
    itemId: z.string(),
    title: z.string(),
    /** Its check date passed, or a definition it relies on changed at its source. */
    reason: z.enum(['date', 'source']),
    lastChecked: z.object({ on: z.nullable(z.string()), by: z.nullable(z.string()) }),
  }),
])
export type Card = z.infer<typeof cardSchema>

/** A suggestion the person sent that waits on an owner. */
export const waitingSchema = z.object({
  proposalId: z.string(),
  title: z.string(),
  areaId: z.nullable(z.string()),
  sentAt: z.nullable(z.string()),
  waitingFor: z.array(z.string()),
})

export const feedInputSchema = z.object({
  /** Needs me (the default), or All: also what waits on others and what is done. */
  tab: z.optional(z.enum(['needs', 'all'])),
})
export const feedSchema = z.object({
  /** This week's questions from agents, counts only: no words, no names. */
  week: z.object({
    asked: shownCount,
    found: shownCount,
    nothing: shownCount,
    /** What most questions that found nothing were about, in words; null when under the minimum. */
    mostAbout: z.nullable(z.string()),
  }),
  groups: z.array(z.object({ group: z.enum(cardGroups), count: z.number() })),
  cards: z.array(cardSchema),
  waiting: z.array(waitingSchema),
})
export type Feed = z.infer<typeof feedSchema>

export const cardIdSchema = z.string().check(z.regex(/^[a-z]+:[A-Za-z0-9_.:-]{1,80}$/))
export const markCardsReadSchema = z.strictObject({
  cards: z.array(cardIdSchema).check(z.minLength(1), z.maxLength(100)),
})

export const decideCardSchema = z.strictObject({
  card: cardIdSchema,
  action: z.enum(cardActions),
  reason: z.optional(z.string().check(z.minLength(1), z.maxLength(500))),
})
export const decideCardResultSchema = z.object({
  /** The edition the decision published, if it published one (Still true, Archive). */
  edition: z.nullable(z.string()),
  undo: undoTokenSchema,
})

export const setupSchema = z.object({
  steps: z.array(z.object({ id: z.enum(setupSteps), done: z.boolean() })),
  done: z.boolean(),
})
