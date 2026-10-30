import { ORPCError } from '@orpc/client'
import type { Comment, CommentAnchorInput, Thread } from '../../../contract/comments.ts'
import {
  cleanComment,
  commentFromText,
  mentionedPeople,
  parseSubject,
  plainOf,
  reactionEmoji,
  subjectName,
  unseenReply,
  type AnchorField,
  type CommentNode,
  type CommentSubject,
  type ReactionEmoji,
} from '../../../domain/comments.ts'
import type { Queryable } from '../../db/database.ts'
import { proposalEvent } from '../proposals/index.ts'

/*
  Comments, reactions and mentions (FR-817; docs/product.md, sections 4 and 9). A thread hangs on
  a suggestion or a context item; whoever may read that reads its thread and may write in it, and
  row security says the same (db/migrations/0007_comments.sql). People change and delete only their
  own words. A mention of a person is kept beside the comment, so their Inbox shows it until they
  read it; a reply since someone last opened a thread they take part in is new to them.

  The person who suggested archiving a context item may mark a comment of theirs on it as taking
  the suggestion back, while it waits (db/migrations/0028_withdrawn_in_comments.sql). It stays with
  its owners, whose review quotes the comment, until they close it or archive anyway.

  On a suggestion, a thread may hang on a line of its text or on a field, read against the two
  versions the review compared; anyone who may read it resolves or reopens it, and the database
  keeps who and when (db/migrations/0031_anchored_comments.sql).

  Agents never read any of this: the MCP read path has no grant on these tables, and nothing an
  edition holds is built from them.
*/

/** Times as ISO 8601, so the app and the new-reply rule read them alike. */
const iso = (column: string) => `to_json(${column})#>>'{}'`

type Row = {
  id: string
  item: string | null
  proposal: string | null
  parent: string | null
  authorId: string
  authorName: string | null
  kind: 'comment' | 'returned'
  body: CommentNode
  at: string
  editedAt: string | null
  deletedAt: string | null
  withdrewAt: string | null
  anchorBefore: string | null
  anchorAfter: string | null
  anchorField: string | null
  anchorSide: 'before' | 'after' | null
  anchorLine: number | null
  resolvedAt: string | null
  resolvedById: string | null
  resolvedByName: string | null
  reopenedAt: string | null
  reopenedById: string | null
  reopenedByName: string | null
}

type ReactionRow = {
  comment: string | null
  item: string | null
  proposal: string | null
  emoji: ReactionEmoji
  personId: string
  name: string | null
}

const columns = `c.id::text, c.item_id as item, c.proposal_id::text as proposal, c.parent_id::text as parent,
  c.author_id::text as "authorId", (select display_name from people where id=c.author_id) as "authorName",
  c.kind, c.body, ${iso('c.created_at')} as at, ${iso('c.edited_at')} as "editedAt",
  ${iso('c.deleted_at')} as "deletedAt", ${iso('c.withdrew_at')} as "withdrewAt",
  c.anchor_before::text as "anchorBefore", c.anchor_after::text as "anchorAfter",
  c.anchor_field as "anchorField", c.anchor_side as "anchorSide", c.anchor_line as "anchorLine",
  ${iso('c.resolved_at')} as "resolvedAt", c.resolved_by::text as "resolvedById",
  (select display_name from people where id=c.resolved_by) as "resolvedByName",
  ${iso('c.reopened_at')} as "reopenedAt", c.reopened_by::text as "reopenedById",
  (select display_name from people where id=c.reopened_by) as "reopenedByName"`

/** The line or field a thread hangs on, as the contract says it. */
function anchorOf(row: Row): CommentAnchorInput | null {
  const versions = { before: row.anchorBefore, after: row.anchorAfter }
  if (row.anchorField) return { ...versions, field: row.anchorField as AnchorField }
  if (row.anchorLine !== null && row.anchorSide)
    return { ...versions, side: row.anchorSide, line: row.anchorLine }
  return null
}

const byWhom = (id: string | null, name: string | null, at: string | null) =>
  id && at ? { by: { personId: id, name }, at } : null

const subjectOfRow = (row: { item: string | null; proposal: string | null }): CommentSubject =>
  row.item ? { kind: 'item', id: row.item } : { kind: 'proposal', id: row.proposal! }

const sameSubject = (a: CommentSubject, b: CommentSubject) => a.kind === b.kind && a.id === b.id

/** A problem with what was sent, in the words the comment box shows. */
const invalid = (message: string) => new ORPCError('UNPROCESSABLE_CONTENT', { message })

/** What a database refusal means to the person: a rule the guard or row security keeps. */
function refusal(error: unknown): never {
  const code = (error as { code?: string }).code
  if (code === '23514' || code === '23503')
    throw invalid("This comment can't be saved there. Open the thread again, then try again.")
  if (code === '42501') throw new ORPCError('NOT_FOUND')
  throw error
}

export function createCommentsService(tx: Queryable) {
  /** A subject by its name, if the person may read it; not found otherwise. */
  async function openSubject(name: string): Promise<CommentSubject> {
    const subject = parseSubject(name)
    if (!subject) throw new ORPCError('NOT_FOUND')
    const [row] = await tx.query<{ open: boolean }>(
      'select cl_comment_subject_open($1,$2::uuid) as open',
      subject.kind === 'item' ? [subject.id, null] : [null, subject.id],
    )
    if (!row?.open) throw new ORPCError('NOT_FOUND')
    return subject
  }

  const subjectParams = (subject: CommentSubject) =>
    subject.kind === 'item' ? [subject.id, null] : [null, subject.id]

  async function loadComment(id: string): Promise<Row> {
    const [row] = await tx.query<Row>(`select ${columns} from comments c where c.id=$1`, [id])
    if (!row) throw new ORPCError('NOT_FOUND')
    return row
  }

  async function me(): Promise<string> {
    const [row] = await tx.query<{ id: string }>('select cl_person()::text as id')
    if (!row?.id) throw new ORPCError('UNAUTHORIZED')
    return row.id
  }

  /** The words, checked: only what the comment box writes, mentioning people of the workspace. */
  async function checked(body: unknown): Promise<{ doc: CommentNode; mentions: string[] }> {
    const clean = cleanComment(body)
    if ('problem' in clean) throw invalid(clean.problem)
    const mentions = mentionedPeople(clean.doc)
    if (mentions.length) {
      const known = await tx.query<{ id: string }>(
        `select id::text from people where id=any($1::uuid[]) and deactivated_at is null and erased_at is null`,
        [mentions],
      )
      if (known.length !== mentions.length)
        throw invalid('A comment mentions only people in the workspace.')
    }
    return { doc: clean.doc, mentions }
  }

  /** Keeps the people a comment mentions, apart from its author, in step with its words. */
  async function keepMentions(comment: string, author: string, mentions: readonly string[]) {
    const others = mentions.filter((p) => p !== author)
    await tx.query(
      'delete from comment_mentions where comment_id=$1 and not (person_id=any($2::uuid[]))',
      [comment, others],
    )
    if (others.length)
      await tx.query(
        `insert into comment_mentions (comment_id,person_id) select $1, unnest($2::uuid[])
         on conflict (comment_id,person_id) do nothing`,
        [comment, others],
      )
  }

  /** Writing in a thread is reading it. */
  async function seen(subject: CommentSubject): Promise<string> {
    const [row] = await tx.query<{ at: string }>(
      subject.kind === 'item'
        ? `insert into thread_reads (person_id,item_id) values (cl_person(),$1)
           on conflict (person_id,item_id) where item_id is not null do update set seen_at=now()
           returning ${iso('seen_at')} as at`
        : `insert into thread_reads (person_id,proposal_id) values (cl_person(),$1::uuid)
           on conflict (person_id,proposal_id) where proposal_id is not null do update set seen_at=now()
           returning ${iso('seen_at')} as at`,
      [subject.id],
    )
    return row!.at
  }

  /** The history log names who did what to which comment, never its words (FR-807). */
  async function audit(action: string, row: Pick<Row, 'id' | 'item' | 'proposal'>) {
    const subject = subjectOfRow(row)
    const [area] = await tx.query<{ id: string | null }>(
      subject.kind === 'item'
        ? `select v.area_id as id from item_versions v where v.item_id=$1
            order by v.created_at desc limit 1`
        : 'select area_id as id from proposals where id=$1',
      [subject.id],
    )
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person',$1,$2,'comment',$3,$4)`,
      [action, area?.id ?? null, row.id, JSON.stringify({ subject: subjectName(subject) })],
    )
  }

  /** The threads of these subjects (every readable one with a comment or a reaction when null). */
  async function threads(only: CommentSubject | null): Promise<Thread[]> {
    const person = await me()
    const where = only ? (only.kind === 'item' ? 'c.item_id=$1' : 'c.proposal_id=$1::uuid') : 'true'
    const params = only ? [only.id] : []
    const rows = await tx.query<Row>(
      `select ${columns} from comments c where ${where} order by c.created_at, c.id`,
      params,
    )
    const reactionWhere = only
      ? only.kind === 'item'
        ? `(r.item_id=$1 or r.comment_id in (select id from comments where item_id=$1))`
        : `(r.proposal_id=$1::uuid or r.comment_id in (select id from comments where proposal_id=$1::uuid))`
      : 'true'
    const reactions = await tx.query<ReactionRow>(
      `select r.comment_id::text as comment, r.item_id as item, r.proposal_id::text as proposal,
              r.emoji, r.person_id::text as "personId",
              (select display_name from people where id=r.person_id) as name
         from reactions r where ${reactionWhere} order by r.created_at, r.id`,
      params,
    )
    const reads = await tx.query<{ item: string | null; proposal: string | null; at: string }>(
      `select item_id as item, proposal_id::text as proposal, ${iso('seen_at')} as at
         from thread_reads where person_id=cl_person()`,
    )
    const mentions = await tx.query<{ comment: string }>(
      `select comment_id::text as comment from comment_mentions where person_id=cl_person() and seen_at is null`,
    )
    const unread = new Set(mentions.map((m) => m.comment))
    const proposals = [...new Set(rows.flatMap((r) => (r.proposal ? [r.proposal] : [])))]
    const own = await tx.query<{ id: string; withdrawable: boolean }>(
      `select id::text, (action='retire' and state in ('submitted','in_review')) as withdrawable
         from proposals where id=any($1::uuid[]) and proposer_id=cl_person()`,
      [[...new Set([...proposals, ...(only?.kind === 'proposal' ? [only.id] : [])])]],
    )
    const sent = new Set(own.map((r) => r.id))
    const withdrawable = new Set(own.filter((r) => r.withdrawable).map((r) => r.id))

    const key = (s: CommentSubject) => subjectName(s)
    const bySubject = new Map<string, { subject: CommentSubject; rows: Row[] }>()
    const add = (subject: CommentSubject) => {
      const name = key(subject)
      if (!bySubject.has(name)) bySubject.set(name, { subject, rows: [] })
      return bySubject.get(name)!
    }
    if (only) add(only)
    for (const row of rows) add(subjectOfRow(row)).rows.push(row)
    for (const r of reactions) if (!r.comment) add(subjectOfRow(r))

    const gathered = (list: ReactionRow[]) => {
      const out: { emoji: ReactionEmoji; by: { personId: string; name: string | null }[] }[] = []
      for (const emoji of reactionEmoji) {
        const by = list.filter((r) => r.emoji === emoji)
        if (by.length)
          out.push({ emoji, by: by.map((r) => ({ personId: r.personId, name: r.name })) })
      }
      return out
    }
    const reactionsOf = new Map<string, ReactionRow[]>()
    for (const r of reactions) {
      const at = r.comment ?? `subject:${r.item ? `context:${r.item}` : `review:${r.proposal}`}`
      reactionsOf.set(at, [...(reactionsOf.get(at) ?? []), r])
    }
    const shape = (row: Row) => ({
      id: row.id,
      author: { personId: row.authorId, name: row.authorName },
      returned: row.kind === 'returned',
      withdrew: row.withdrewAt !== null,
      body: row.body as Record<string, unknown>,
      at: row.at,
      editedAt: row.editedAt,
      deleted: row.deletedAt !== null,
      reactions: row.deletedAt ? [] : gathered(reactionsOf.get(row.id) ?? []),
    })
    const note = (row: Row) => ({
      commentId: row.id,
      from: { personId: row.authorId, name: row.authorName },
      at: row.at,
      excerpt: plainOf(row.body),
    })

    return [...bySubject.values()].map(({ subject, rows: list }) => {
      const replies = new Map<string, Row[]>()
      for (const row of list)
        if (row.parent) replies.set(row.parent, [...(replies.get(row.parent) ?? []), row])
      const comments = list
        .filter((row) => !row.parent)
        .map((row) => ({
          ...shape(row),
          replies: (replies.get(row.id) ?? []).map(shape),
          anchor: anchorOf(row),
          resolved: byWhom(row.resolvedById, row.resolvedByName, row.resolvedAt),
          reopened: byWhom(row.reopenedById, row.reopenedByName, row.reopenedAt),
        }))
      const read = reads.find((r) => sameSubject(subjectOfRow(r), subject))
      const reply = unseenReply(
        list.map((row) => ({ ...row, deleted: row.deletedAt !== null })),
        person,
        { seenAt: read?.at ?? null, sender: subject.kind === 'proposal' && sent.has(subject.id) },
      )
      return {
        subject: key(subject),
        comments,
        reactions: gathered(reactionsOf.get(`subject:${key(subject)}`) ?? []),
        withdrawable: subject.kind === 'proposal' && withdrawable.has(subject.id),
        newReply: reply ? note(reply) : null,
        mentions: list.filter((row) => unread.has(row.id) && !row.deletedAt).map(note),
      }
    })
  }

  async function shaped(id: string): Promise<Comment> {
    const row = await loadComment(id)
    const [thread] = await threads(subjectOfRow(row))
    const top = thread!.comments.find((c) => c.id === (row.parent ?? row.id))!
    return row.parent
      ? {
          ...top.replies.find((r) => r.id === id)!,
          replies: [],
          anchor: null,
          resolved: null,
          reopened: null,
        }
      : top
  }

  async function insert(
    subject: CommentSubject,
    doc: CommentNode,
    extra: {
      parentId?: string | undefined
      kind?: 'returned'
      decisionId?: string
      anchor?: CommentAnchorInput | undefined
    } = {},
  ): Promise<string> {
    const anchor = extra.anchor
    const [row] = await tx
      .query<{ id: string }>(
        `insert into comments (item_id,proposal_id,parent_id,author_id,kind,decision_id,body,
                               anchor_before,anchor_after,anchor_field,anchor_side,anchor_line)
         values ($1,$2::uuid,$3::uuid,cl_person(),$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10,$11)
         returning id::text`,
        [
          ...subjectParams(subject),
          extra.parentId ?? null,
          extra.kind ?? 'comment',
          extra.decisionId ?? null,
          JSON.stringify(doc),
          anchor?.before ?? null,
          anchor?.after ?? null,
          anchor && 'field' in anchor ? anchor.field : null,
          anchor && 'side' in anchor ? anchor.side : null,
          anchor && 'line' in anchor ? anchor.line : null,
        ],
      )
      .catch(refusal)
    return row!.id
  }

  return {
    async list(input: { subject?: string | undefined }) {
      const only = input.subject ? await openSubject(input.subject) : null
      return { threads: await threads(only) }
    },

    async create(input: {
      subject: string
      body: unknown
      parentId?: string | undefined
      anchor?: CommentAnchorInput | undefined
    }) {
      const subject = await openSubject(input.subject)
      const { doc, mentions } = await checked(input.body)
      if (input.parentId) {
        const parent = await loadComment(input.parentId).catch(() => null)
        if (!parent || !sameSubject(subjectOfRow(parent), subject))
          throw invalid('That comment is not in this thread any more.')
      }
      if (input.anchor && (input.parentId || subject.kind !== 'proposal'))
        throw invalid('A comment on a line or a field starts a thread on a suggestion.')
      if (input.anchor) await anchoredOn(subject.id, input.anchor)
      const id = await insert(subject, doc, { parentId: input.parentId, anchor: input.anchor })
      await keepMentions(id, await me(), mentions)
      await seen(subject)
      await audit('comment.created', { id, ...rowSubject(subject) })
      return shaped(id)
    },

    async edit(input: { id: string; body: unknown }) {
      const row = await loadComment(input.id)
      const person = await me()
      if (row.authorId !== person)
        throw new ORPCError('FORBIDDEN', { message: 'Only its author changes a comment.' })
      if (row.deletedAt) throw new ORPCError('CONFLICT', { message: 'This comment was deleted.' })
      const { doc, mentions } = await checked(input.body)
      await tx
        .query('update comments set body=$2 where id=$1', [row.id, JSON.stringify(doc)])
        .catch(refusal)
      await keepMentions(row.id, person, mentions)
      await audit('comment.edited', row)
      return shaped(row.id)
    },

    /** Deletes a comment: it keeps its place without its words while a later comment answers it. */
    async remove(input: { id: string }): Promise<{ removed: 'gone' | 'kept' }> {
      const row = await loadComment(input.id)
      if (row.authorId !== (await me()))
        throw new ORPCError('FORBIDDEN', { message: 'Only its author deletes a comment.' })
      if (row.deletedAt) throw new ORPCError('CONFLICT', { message: 'This comment was deleted.' })
      const removed = await removeRow(row)
      await audit('comment.deleted', row)
      return { removed }
    },

    /**
     * Marks the person's own comment on their suggestion to archive, while it waits, as taking it
     * back, or takes the mark back. One comment of a suggestion holds the mark: marking another
     * moves it there. The suggestion's timeline and the history log say who did which.
     */
    async withdraw(input: { id: string; withdrew: boolean }) {
      const row = await loadComment(input.id)
      if (row.authorId !== (await me()))
        throw new ORPCError('FORBIDDEN', {
          message: 'Only its author takes a suggestion back with a comment.',
        })
      if (row.deletedAt) throw new ORPCError('CONFLICT', { message: 'This comment was deleted.' })
      const [p] = row.proposal
        ? await tx.query<{
            id: string
            areaId: string | null
            state: 'submitted' | 'in_review'
            revision: number
          }>(
            `select id::text, area_id as "areaId", state::text, revision from proposals
              where id=$1 and proposer_id=cl_person() and action='retire'
                and state in ('submitted','in_review') for update`,
            [row.proposal],
          )
        : []
      if (!p || row.kind !== 'comment')
        throw new ORPCError('CONFLICT', {
          message:
            'Only the person who suggested archiving it takes it back here, while it waits for a decision.',
        })
      if (input.withdrew === (row.withdrewAt !== null)) return shaped(row.id)
      if (input.withdrew)
        await tx
          .query(
            'update comments set withdrew_at=null where proposal_id=$1 and withdrew_at is not null',
            [p.id],
          )
          .catch(refusal)
      await tx
        .query(`update comments set withdrew_at=case when $2 then now() end where id=$1`, [
          row.id,
          input.withdrew,
        ])
        .catch(refusal)
      await proposalEvent(
        tx,
        p,
        input.withdrew ? 'withdrawn_in_comments' : 'withdrawal_taken_back',
        { commentId: row.id },
        input.withdrew ? 'proposal.withdrawn' : 'proposal.withdrawal_taken_back',
      )
      return shaped(row.id)
    },

    /**
     * Resolves a thread on a line or a field of a suggestion, or opens it again: anyone who may
     * read the suggestion may, and the thread says who did and when. Asking for the state it is in
     * changes nothing.
     */
    async resolve(input: { id: string; resolved: boolean }) {
      const row = await loadComment(input.id)
      if (row.parent || !anchorOf(row))
        throw new ORPCError('CONFLICT', {
          message: 'Only a thread on a line or a field of a suggestion is resolved.',
        })
      if (input.resolved === (row.resolvedAt !== null)) return shaped(row.id)
      await tx
        .query(`update comments set resolved_at=case when $2 then now() end where id=$1`, [
          row.id,
          input.resolved,
        ])
        .catch(refusal)
      await audit(input.resolved ? 'comment.resolved' : 'comment.reopened', row)
      return shaped(row.id)
    },

    /**
     * The comment with which the sender of a suggestion to archive took it back, if they did: who,
     * when and its words, for the review.
     */
    async withdrawal(proposalId: string) {
      const [row] = await tx.query<Row>(
        `select ${columns} from comments c
          where c.proposal_id=$1 and c.withdrew_at is not null and c.deleted_at is null
            and c.author_id=(select proposer_id from proposals where id=$1)`,
        [proposalId],
      )
      if (!row) return null
      return {
        commentId: row.id,
        by: { personId: row.authorId, name: row.authorName },
        at: row.withdrewAt!,
        quote: plainOf(row.body),
      }
    },

    async toggleReaction(input: {
      subject: string
      commentId?: string | undefined
      emoji: ReactionEmoji
    }) {
      const subject = await openSubject(input.subject)
      if (input.commentId) {
        const comment = await loadComment(input.commentId).catch(() => null)
        if (!comment || !sameSubject(subjectOfRow(comment), subject))
          throw new ORPCError('NOT_FOUND')
        if (comment.deletedAt)
          throw new ORPCError('CONFLICT', { message: 'This comment was deleted.' })
      }
      const target = input.commentId
        ? { column: 'comment_id', cast: '::uuid', value: input.commentId }
        : subject.kind === 'item'
          ? { column: 'item_id', cast: '', value: subject.id }
          : { column: 'proposal_id', cast: '::uuid', value: subject.id }
      const taken = await tx.query(
        `delete from reactions where ${target.column}=$1${target.cast} and person_id=cl_person() and emoji=$2 returning 1`,
        [target.value, input.emoji],
      )
      if (taken.length) return { on: false }
      await tx
        .query(
          `insert into reactions (person_id,emoji,${target.column}) values (cl_person(),$2,$1${target.cast})`,
          [target.value, input.emoji],
        )
        .catch(refusal)
      return { on: true }
    },

    async markThreadRead(input: { subject: string }) {
      return { seenAt: await seen(await openSubject(input.subject)) }
    },

    async markMentionsRead(input: { subject: string }) {
      const subject = await openSubject(input.subject)
      const marked = await tx.query(
        `update comment_mentions m set seen_at=now() from comments c
          where c.id=m.comment_id and m.person_id=cl_person() and m.seen_at is null
            and ${subject.kind === 'item' ? 'c.item_id=$1' : 'c.proposal_id=$1::uuid'}
        returning 1`,
        [subject.id],
      )
      return { marked: marked.length }
    },

    /**
     * The Inbox's "Mentioned you" cards: for each thread with comments that mention the person and
     * that they haven't read, the newest of them, with what the thread hangs on.
     */
    async mentionCards() {
      const rows = await tx.query<{
        subject: string
        area: string | null
        title: string | null
        commentId: string
        at: string
        authorId: string
        authorName: string | null
        body: CommentNode
      }>(
        `select distinct on (coalesce(c.item_id, c.proposal_id::text))
                case when c.item_id is not null then 'context:'||c.item_id else 'review:'||c.proposal_id::text end as subject,
                coalesce(p.area_id, iv.area_id) as area,
                coalesce(pv.title, p.draft->>'title', iv.title) as title,
                c.id::text as "commentId", ${iso('c.created_at')} as at,
                c.author_id::text as "authorId",
                (select display_name from people where id=c.author_id) as "authorName", c.body
           from comment_mentions m join comments c on c.id=m.comment_id
           left join proposals p on p.id=c.proposal_id
           left join item_versions pv on pv.id=p.item_version_id
           left join lateral (select v.area_id, v.title from item_versions v where v.item_id=c.item_id
                               order by v.created_at desc limit 1) iv on c.item_id is not null
          where m.person_id=cl_person() and m.seen_at is null and c.deleted_at is null
          order by coalesce(c.item_id, c.proposal_id::text), c.created_at desc, c.id desc`,
      )
      return rows.map((row) => ({
        subject: row.subject,
        areaId: row.area ?? '',
        title: row.title ?? 'A comment',
        commentId: row.commentId,
        at: row.at,
        from: { personId: row.authorId, name: row.authorName },
        excerpt: plainOf(row.body),
      }))
    },

    /**
     * "Return with a note" (review.return): its note as the suggestion's first comment of its kind,
     * marked returned and tied to the decision, so undoing the decision takes it away.
     */
    async returned(proposalId: string, decisionId: string, note: string, body?: unknown) {
      const subject: CommentSubject = { kind: 'proposal', id: proposalId }
      const { doc, mentions } =
        body !== undefined ? await checked(body) : { doc: commentFromText(note), mentions: [] }
      const id = await insert(subject, doc, { kind: 'returned', decisionId })
      await keepMentions(id, await me(), mentions)
      await seen(subject)
      await audit('comment.created', { id, ...rowSubject(subject) })
      return id
    },

    /** Undoing a return takes its note away, as the person who returned it. */
    async unreturn(decisionId: string) {
      const [row] = await tx.query<Row>(
        `select ${columns} from comments c where c.decision_id=$1 and c.deleted_at is null`,
        [decisionId],
      )
      if (!row) return
      await removeRow(row)
      await audit('comment.deleted', row)
    },
  }

  /**
   * An anchor names versions of the item the suggestion changes: otherwise the thread would hang
   * on a line nobody can open.
   */
  async function anchoredOn(proposal: string, anchor: CommentAnchorInput) {
    const versions = [anchor.before, anchor.after].filter((v) => v !== null)
    const [row] = await tx.query<{ ok: boolean }>(
      `select count(*) = cardinality($2::uuid[]) as ok from item_versions v
         join proposals p on p.item_id=v.item_id where p.id=$1 and v.id=any($2::uuid[])`,
      [proposal, versions],
    )
    const side = 'side' in anchor ? anchor[anchor.side] : true
    if (!versions.length || !row?.ok || !side)
      throw invalid('That line or field is not in this suggestion any more. Open it again.')
  }

  async function removeRow(row: Row): Promise<'gone' | 'kept'> {
    // A comment a later one answers keeps its place, so the answers still read.
    const [answered] = await tx.query<{ answered: boolean }>(
      row.parent
        ? `select exists(select 1 from comments r where r.parent_id=$2 and r.deleted_at is null
                          and (r.created_at, r.id) > (select created_at, id from comments where id=$1)) as answered`
        : 'select exists(select 1 from comments r where r.parent_id=$1 and r.deleted_at is null) as answered',
      row.parent ? [row.id, row.parent] : [row.id],
    )
    if (answered?.answered) {
      await tx
        .query(`update comments set body='{"type":"doc"}', deleted_at=now() where id=$1`, [row.id])
        .catch(refusal)
      return 'kept'
    }
    await tx.query('delete from comments where id=$1', [row.id]).catch(refusal)
    return 'gone'
  }
}

const rowSubject = (subject: CommentSubject) =>
  subject.kind === 'item'
    ? { item: subject.id, proposal: null }
    : { item: null, proposal: subject.id }

export type CommentsService = ReturnType<typeof createCommentsService>
