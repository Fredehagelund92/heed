import * as z from 'zod/mini'

/**
 * Live updates, the inbox and the activity feed. Events say that something changed, never what
 * it said: they carry ids and states, and the reader fetches the record it is allowed to see.
 */

const pageLimit = z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100)))

/** What an event is about, for example `{ type: 'proposal', id: <uuid> }`. */
export const subjectSchema = z.object({ type: z.string(), id: z.string() })
const actorSchema = z.nullable(z.object({ id: z.string(), name: z.string() }))

/**
 * One message on the live stream. `id` is also the message's SSE id: reconnecting with it as
 * `Last-Event-ID` replays exactly the events after it. Two topics come from the stream itself:
 * `stream.ready` opens a stream that has nothing to replay and carries the position to resume
 * from, and `stream.reset` says the events since `Last-Event-ID` are no longer kept, so the
 * reader should refetch what it shows.
 */
export const streamEventSchema = z.object({
  id: z.number().check(z.int(), z.minimum(0)),
  topic: z.string(),
  at: z.string(),
  areaId: z.nullable(z.string()),
  subject: z.nullable(subjectSchema),
  /** Ids and states only, for example `{ id, state, revision }` for a proposal. */
  payload: z.record(z.string(), z.unknown()),
  /** The same event also put an item in the reader's inbox. */
  inbox: z.boolean(),
})
export type StreamEvent = z.infer<typeof streamEventSchema>

export const inboxFilters = ['unread', 'all', 'archived'] as const
export const inboxListSchema = z.strictObject({
  /** `all` is everything not archived; the default. */
  filter: z.optional(z.enum(inboxFilters)),
  limit: pageLimit,
  /** The `nextBefore` of the previous page. */
  before: z.optional(z.string().check(z.uuid())),
})
export const inboxItemSchema = z.object({
  id: z.string(),
  /** The event's topic, for example `proposal.commented`. */
  kind: z.string(),
  at: z.string(),
  areaId: z.nullable(z.string()),
  subject: subjectSchema,
  /** The subject's state when it happened, when the event records one. */
  state: z.nullable(z.string()),
  /** The subject's title, when the reader may still see the subject. */
  title: z.nullable(z.string()),
  actor: actorSchema,
  /**
   * What the reviewer wrote with a request for changes or a rejection, as the proposal's activity
   * shows it, when the reader may still read it. Only in the inbox: events carry no text.
   */
  note: z.nullable(z.string()),
  readAt: z.nullable(z.string()),
  archivedAt: z.nullable(z.string()),
})
export const inboxPageSchema = z.object({
  items: z.array(inboxItemSchema),
  /** Unread and not archived, across the whole inbox. */
  unread: z.number().check(z.int(), z.minimum(0)),
  nextBefore: z.nullable(z.string()),
})
export const inboxIdsSchema = z.strictObject({
  ids: z.array(z.string().check(z.uuid())).check(z.minLength(1), z.maxLength(100)),
})
export const inboxChangeSchema = z.object({
  changed: z.number().check(z.int(), z.minimum(0)),
  unread: z.number().check(z.int(), z.minimum(0)),
})

export const activityListSchema = z.strictObject({
  areaId: z.optional(z.string()),
  limit: pageLimit,
  /** The `nextBefore` of the previous page. */
  before: z.optional(z.number().check(z.int(), z.minimum(1))),
})
export const activityEntrySchema = z.object({
  /** The same number as the event's id on the live stream. */
  id: z.number(),
  topic: z.string(),
  at: z.string(),
  areaId: z.nullable(z.string()),
  subject: subjectSchema,
  state: z.nullable(z.string()),
  title: z.nullable(z.string()),
  actor: actorSchema,
})
export const activityPageSchema = z.object({
  entries: z.array(activityEntrySchema),
  nextBefore: z.nullable(z.number()),
})
export type InboxItem = z.infer<typeof inboxItemSchema>
export type ActivityEntry = z.infer<typeof activityEntrySchema>
