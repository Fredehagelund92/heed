/**
 * The review of Heed v1 on the API (docs/product.md, section 4; design contract, section 5.3): one
 * read for the review page (`review.sheet`), and its decisions. The sheet holds the suggestion's
 * difference by kind (src/domain/doc-diff.ts), its claims against the copied sentence
 * (claim-check.ts), a clash with live context, what agents say before and after (the answer
 * engine), and the Ready line (readiness.ts). Publish takes the whole change; a clash waits for the
 * owner's answer (FR-225); "Publish the N you've read" takes only plain changes that were read
 * (FR-226); every decision can be undone by its maker within a short window (FR-227).
 */
import * as z from 'zod/mini'
import { answerStates } from '../domain/answer.ts'
import { claimVerdicts } from '../domain/claim-check.ts'
import { changeKinds, docFields, marks } from '../domain/doc-diff.ts'
import { itemKinds } from '../domain/item.ts'
import { clashRelations, readinessStates } from '../domain/readiness.ts'
import { reachSchema } from './answer.ts'
import { commentInputBodySchema } from './comments.ts'
import { editionSchema, reviewProposalSchema } from './review.ts'
import { savedDraftSchema } from './saved-questions.ts'

const markSchema = z.enum(marks)
const textField = z.enum(['title', 'text', 'notToConclude', 'quote'])
const span = z.object({ from: z.nullable(z.string()), until: z.nullable(z.string()) })

/** A run of text in a change. */
export const runSchema = z.union([
  z.strictObject({ t: z.enum(['same', 'add', 'del']), text: z.string() }),
  z.strictObject({
    t: z.literal('fmt'),
    text: z.string(),
    added: z.array(markSchema),
    removed: z.array(markSchema),
  }),
])
const blockShape = z.union([
  z.strictObject({ type: z.enum(['paragraph', 'quote', 'rule']) }),
  z.strictObject({ type: z.literal('heading'), level: z.number() }),
  z.strictObject({ type: z.enum(['bullet', 'number']), depth: z.number() }),
])
const listType = z.enum(['bullet', 'number'])

/** One change under its kind label (FR-224). */
export const changeBlockSchema = z.union([
  z.strictObject({
    kind: z.literal('wording'),
    field: textField,
    runs: z.array(runSchema),
    changes: z.number(),
    rewrite: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('wording'),
    field: z.literal('kind'),
    before: z.string(),
    after: z.string(),
  }),
  z.strictObject({ kind: z.enum(['added', 'removed']), field: textField, text: z.string() }),
  z.strictObject({
    kind: z.enum(['added', 'removed']),
    field: z.literal('where'),
    parts: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal('added'),
    field: z.literal('when'),
    from: z.string(),
    until: z.nullable(z.string()),
  }),
  z.strictObject({
    kind: z.enum(['added', 'removed']),
    field: z.literal('sources'),
    url: z.string(),
    quote: z.nullable(z.string()),
  }),
  z.strictObject({
    kind: z.literal('formatting'),
    field: z.literal('text'),
    change: z.strictObject({ what: z.literal('list'), was: listType, now: listType }),
    items: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal('formatting'),
    field: z.literal('text'),
    change: z.union([
      z.strictObject({
        what: z.literal('marks'),
        added: z.array(markSchema),
        removed: z.array(markSchema),
      }),
      z.strictObject({ what: z.literal('list'), was: listType, now: listType }),
      z.strictObject({ what: z.literal('block'), was: blockShape, now: blockShape }),
    ]),
    runs: z.array(runSchema),
  }),
  z.strictObject({
    kind: z.literal('link'),
    field: z.enum(['text', 'sources']),
    text: z.string(),
    before: z.nullable(z.string()),
    after: z.nullable(z.string()),
  }),
  z.strictObject({
    kind: z.literal('link'),
    field: z.literal('text'),
    mention: z.strictObject({
      target: z.string(),
      label: z.string(),
      change: z.enum(['added', 'removed']),
    }),
  }),
  z.strictObject({
    kind: z.literal('order'),
    field: z.literal('text'),
    steps: z.array(z.strictObject({ text: z.string(), from: z.nullable(z.number()) })),
    moved: z.number(),
  }),
  z.strictObject({
    kind: z.literal('dates'),
    field: z.enum(['when', 'checkDate']),
    before: span,
    after: span,
  }),
])

/** The whole difference of a suggestion, the same every time for the same versions. */
export const docDiffSchema = z.object({
  mode: z.enum(['new', 'edit', 'retire']),
  blocks: z.array(changeBlockSchema),
  counts: z.array(z.object({ kind: z.enum(changeKinds), n: z.number() })),
  unchanged: z.array(z.enum(docFields)),
  values: z.array(
    z.object({
      what: z.enum(['number', 'date', 'source']),
      field: z.union([z.enum(docFields), z.literal('quote')]),
      before: z.nullable(z.string()),
      after: z.nullable(z.string()),
    }),
  ),
  only: z.nullable(z.enum(changeKinds)),
})

/** One line of the stored Markdown in the Source view. */
export const sourceRowSchema = z.object({
  t: z.enum([' ', '-', '+']),
  line: z.string(),
  words: z.optional(z.array(z.object({ text: z.string(), changed: z.boolean() }))),
})

export const claimRowSchema = z.object({
  claim: z.string(),
  source: z.nullable(z.string()),
  verdict: z.enum(claimVerdicts),
})

/** The Ready line, with the publish rules it decides and its words. */
export const readinessSchema = z.object({
  state: z.enum(readinessStates),
  ok: z.boolean(),
  bulk: z.boolean(),
  publishable: z.boolean(),
  claimsToCheck: z.number(),
  unsourced: z.array(z.string()),
  relation: z.nullable(z.enum(clashRelations)),
  title: z.string(),
  text: z.string(),
})

/** What agents say for the suggestion's own question: the answer line, the sentence and its items. */
export const answerBriefSchema = z.object({
  state: z.enum(answerStates),
  say: z.string(),
  items: z.array(z.object({ id: z.string(), title: z.string(), kind: z.enum(itemKinds) })),
})

/** A live item agents would get in the same answer as the suggestion (FR-225), and the owner's answer. */
export const clashSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  /** What the live item says, beside what the suggestion says. */
  summary: z.string(),
  relation: z.nullable(z.enum(clashRelations)),
})

export const reviewIdInputSchema = z.object({ id: z.string().check(z.uuid()) })

/**
 * Where a suggestion a content source's read made comes from (CON-603, CON-611): the source and
 * the tool it reads, the scope and document, the read that made it, and the document's quote. A
 * suggestion a person sent has none.
 */
export const syncedSchema = z.object({
  source: z.object({ id: z.string(), name: z.string(), tool: z.string() }),
  /** The scope the document is in, as the source names it (a folder). */
  scope: z.string(),
  document: z.object({ title: z.string(), link: z.string() }),
  read: z.object({ id: z.string(), at: z.string() }),
  /** At most 500 characters of the document: all the core keeps of it (CON-605). */
  quote: z.string(),
})
export type Synced = z.infer<typeof syncedSchema>

/** The review page's one read. */
export const reviewSheetSchema = z.object({
  proposal: reviewProposalSchema,
  mode: z.enum(['new', 'edit', 'retire']),
  /**
   * Who sent it, by name, and whether an AI agent or the assistant wrote it for them; null when
   * a content source's read made it, which `synced` names.
   */
  from: z.nullable(z.object({ personId: z.string(), name: z.nullable(z.string()) })),
  writtenBy: z.nullable(z.enum(['agent', 'assistant', 'source'])),
  synced: z.nullable(syncedSchema),
  /** Started from a Not found card, by the card's gap. */
  gapId: z.nullable(z.string()),
  /** The reason the sender gave, if any. */
  note: z.nullable(z.string()),
  diff: docDiffSchema,
  source: z.object({ before: z.string(), after: z.string(), rows: z.array(sourceRowSchema) }),
  /** The claims against the sentence copied from the source, when an agent or the assistant wrote it. */
  claims: z.nullable(z.object({ sentence: z.string(), rows: z.array(claimRowSchema) })),
  clashes: z.array(clashSchema),
  /** Live items whose scope and dates overlap, for information; only a clash holds Publish. */
  overlaps: z.array(z.object({ id: z.string(), title: z.string(), kind: z.enum(itemKinds) })),
  readiness: readinessSchema,
  /** How long its change must be on screen before it counts as read, in milliseconds. */
  readMs: z.number(),
  read: z.object({ opened: z.boolean(), read: z.boolean() }),
  /** What agents say for its own question, now and with it published (no model). */
  tryIt: z.object({ question: z.string(), before: answerBriefSchema, after: answerBriefSchema }),
  reach: z.nullable(reachSchema),
  /**
   * The saved questions the person manages that answer from its item, checked against the draft
   * (FR-526): shown before Publish, never kept, and never a reason Publish waits.
   */
  saved: z.array(savedDraftSchema),
  /** Whether the person may publish it now, and why not when they may not. */
  canPublish: z.boolean(),
  whyNot: z.nullable(z.string()),
})
export type ReviewSheet = z.infer<typeof reviewSheetSchema>

/** A token that takes one decision, or one step of several, back (FR-227). */
export const undoTokenSchema = z.string().check(z.regex(/^[a-z]+:[A-Za-z0-9_.:,-]{1,4000}$/))

export const publishInputSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  revision: z.number().check(z.int(), z.minimum(1)),
  /** How it relates to each live item it clashes with; Publish waits for every one (FR-225). */
  relations: z.optional(
    z
      .array(
        z.strictObject({
          itemId: z.string().check(z.minLength(1), z.maxLength(64)),
          relation: z.enum(clashRelations),
        }),
      )
      .check(z.maxLength(20)),
  ),
  reason: z.optional(z.string().check(z.minLength(1), z.maxLength(500))),
})
export const publishResultSchema = z.object({
  proposal: reviewProposalSchema,
  edition: z.nullable(editionSchema),
  undo: undoTokenSchema,
})

export const returnInputSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  revision: z.number().check(z.int(), z.minimum(1)),
  /** The note for the sender: it becomes the first comment of the suggestion's discussion. */
  note: z.string().check(z.trim(), z.minLength(1), z.maxLength(2000)),
  /** The note as the comment box wrote it, with its mentions; left out, the comment is its words. */
  body: z.optional(commentInputBodySchema),
})
export const returnResultSchema = z.object({
  proposal: reviewProposalSchema,
  undo: undoTokenSchema,
})

export const markReadInputSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  /** The suggested version that was read: a read counts for it only. */
  itemVersionId: z.string().check(z.uuid()),
})

export const publishReadInputSchema = z.strictObject({
  ids: z.array(z.string().check(z.uuid())).check(z.minLength(1), z.maxLength(50)),
})
/** Why "Publish the N you've read" left one out (FR-226). */
export const publishSkipCodes = [
  'not_read',
  'needs_care',
  'not_waiting',
  'not_allowed',
  'refused',
] as const
export const publishReadResultSchema = z.object({
  published: z.array(z.object({ id: z.string(), edition: z.nullable(z.string()) })),
  skipped: z.array(
    z.object({ id: z.string(), code: z.enum(publishSkipCodes), message: z.string() }),
  ),
  /** Takes back every one published, together; null when none was. */
  undo: z.nullable(undoTokenSchema),
})

export const undoInputSchema = z.strictObject({ token: undoTokenSchema })
export const undoResultSchema = z.object({
  /** The edition that served again what was taken back; null when nothing had been published. */
  edition: z.nullable(z.string()),
})
