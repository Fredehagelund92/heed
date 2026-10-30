/**
 * Comments, reactions and mentions on the API (FR-817; docs/product.md, sections 4 and 9; design
 * contract, sections 5.6 and 5.7). A thread hangs on a suggestion ("review:<id>") or a context item
 * ("context:<id>"); its comments are the comment box's small document, checked on the server
 * (src/domain/comments.ts). Anyone who may read what a thread hangs on may comment there and react
 * with one of the five reactions; people edit and delete only their own words. A mention of a
 * person puts a "Mentioned you" card in their Inbox until they read it. The person who suggested
 * archiving a context item may mark a comment of theirs on it as taking the suggestion back, while it
 * waits: its owners then close it or archive anyway. On a suggestion, a thread may hang on a line
 * of its text or on a field of its Fields table, read against the two versions the review compared,
 * and anyone who may read it resolves or reopens it; resolved or open, it never holds Publish.
 * Agents never read any of it.
 */
import * as z from 'zod/mini'
import {
  anchorFields,
  anchorMaxLine,
  cleanComment,
  reactionEmoji,
  subjectPattern,
} from '../domain/comments.ts'

/** What a thread hangs on, as the app names it. */
export const subjectSchema = z.string().check(z.regex(subjectPattern))

/** A comment's words: the comment box's document, as Tiptap writes it. */
export const commentBodySchema = z.record(z.string(), z.unknown())

/** A comment's words as the person sends them: checked whole before anything is kept. */
export const commentInputBodySchema = commentBodySchema.check(
  z.refine((body) => 'doc' in cleanComment(body), {
    message:
      'A comment holds up to 2,000 characters of paragraphs, lists, bold, italic, code and mentions of people.',
  }),
)

export const reactionEmojiSchema = z.enum(reactionEmoji)

const person = z.object({ personId: z.string(), name: z.nullable(z.string()) })

const anchorVersions = {
  /** The version agents got when it was written; null for a new item. */
  before: z.nullable(z.string().check(z.uuid())),
  /** The suggested version it was read on; null for a suggestion to archive. */
  after: z.nullable(z.string().check(z.uuid())),
}

/**
 * Where on a suggestion's source a thread hangs: a field of the Fields table by its name, or a
 * line of the text on the side it was read on (`before`, the text agents get now; `after`, the
 * suggested one), with the two versions the review compared.
 */
export const commentAnchorSchema = z.union([
  z.strictObject({ ...anchorVersions, field: z.enum(anchorFields) }),
  z.strictObject({
    ...anchorVersions,
    side: z.enum(['before', 'after']),
    line: z.number().check(z.int(), z.minimum(1), z.maximum(anchorMaxLine)),
  }),
])
export type CommentAnchorInput = z.infer<typeof commentAnchorSchema>

/** Who resolved a thread, or opened it again, and when: the last time each. */
const resolutionSchema = z.nullable(z.object({ by: person, at: z.string() }))

/** One reaction and who gave it, in order. */
export const reactionSchema = z.object({ emoji: reactionEmojiSchema, by: z.array(person) })

const commentFields = {
  id: z.string(),
  author: person,
  /** A return with a note writes its note as a comment with this mark. */
  returned: z.boolean(),
  /** Its writer takes back their suggestion to archive with it: the review quotes it. */
  withdrew: z.boolean(),
  /** The words; an empty document once deleted. */
  body: commentBodySchema,
  at: z.string(),
  editedAt: z.nullable(z.string()),
  /** Deleted with replies under it: the place stays, the words go. */
  deleted: z.boolean(),
  reactions: z.array(reactionSchema),
}
export const replySchema = z.object(commentFields)
export const commentSchema = z.object({
  ...commentFields,
  replies: z.array(replySchema),
  /** The line or field of a suggestion's source it hangs on; null for the whole thing. */
  anchor: z.nullable(commentAnchorSchema),
  /** A thread on a line or a field: resolved, by whom and when; null while it is open. */
  resolved: resolutionSchema,
  /** The last time it was opened again after being resolved. */
  reopened: resolutionSchema,
})
export type Comment = z.infer<typeof commentSchema>

/** One thread: its comments oldest first, the reactions on its subject, and what is new to the reader. */
export const threadSchema = z.object({
  subject: subjectSchema,
  comments: z.array(commentSchema),
  reactions: z.array(reactionSchema),
  /**
   * The reader may take back with one of their comments here what it hangs on: they suggested
   * archiving a context item, and it waits for a decision.
   */
  withdrawable: z.boolean(),
  /** The newest reply since the reader last opened it, in a thread they take part in. */
  newReply: z.nullable(
    z.object({ commentId: z.string(), from: person, at: z.string(), excerpt: z.string() }),
  ),
  /** The comments here that mention the reader and that they haven't read, oldest first. */
  mentions: z.array(
    z.object({ commentId: z.string(), from: person, at: z.string(), excerpt: z.string() }),
  ),
})
export type Thread = z.infer<typeof threadSchema>

export const listCommentsInputSchema = z.object({
  /** One thread; left out, every thread the person may read that holds a comment or a reaction. */
  subject: z.optional(subjectSchema),
})
export const commentThreadsSchema = z.object({ threads: z.array(threadSchema) })

export const createCommentSchema = z.strictObject({
  subject: subjectSchema,
  body: commentInputBodySchema,
  /** The comment it answers, on the same subject. */
  parentId: z.optional(z.string().check(z.uuid())),
  /** On a suggestion, the line or field of its source a new thread hangs on. */
  anchor: z.optional(commentAnchorSchema),
})

/** Resolves a thread on a line or a field of a suggestion, or opens it again. */
export const resolveCommentSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  resolved: z.boolean(),
})

export const editCommentSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  body: commentInputBodySchema,
})

export const commentIdSchema = z.object({ id: z.string().check(z.uuid()) })

/** Marks one's own comment as taking back the suggestion to archive it hangs on, or takes the mark back. */
export const withdrawCommentSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  withdrew: z.boolean(),
})

export const removeCommentResultSchema = z.object({
  /** Gone, or kept in its place without its words because something answers it. */
  removed: z.enum(['gone', 'kept']),
})

export const toggleReactionSchema = z.strictObject({
  subject: subjectSchema,
  /** A comment of that subject; left out, the reaction is on the subject itself. */
  commentId: z.optional(z.string().check(z.uuid())),
  emoji: reactionEmojiSchema,
})
export const toggleReactionResultSchema = z.object({
  /** Whether the person's reaction is there now. */
  on: z.boolean(),
})

export const threadInputSchema = z.strictObject({ subject: subjectSchema })
