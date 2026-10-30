import type { JSONContent } from '@tiptap/core'
import type {
  CommentItem,
  CommentReaction,
  ReactionEmoji,
} from '@/components/templates/comment-box/types'
import {
  createId,
  mapThread,
  REACTIONS,
  toggleReaction,
} from '@/components/templates/comment-box/utils'
import { ApiError } from '../errors'
import { mentionNotesOf, type CommentAnchor, type Comments, type Subject } from '@/model/comments'
import { newReplies, seedComments, seedReactions } from './data/comments'

// The mock's comments and reactions, kept in memory until the page reloads. Anyone signed in can
// comment and react; people edit and delete only their own words. Nothing here sends anything: a
// reply only brings a card back to "Needs you" in the owner's Inbox, and an @ of a person puts a
// quiet marker in theirs, in the app only. On a suggestion, a thread may hang on a line or a field
// of its source, and anyone resolves it or opens it again. Agents never read any of it, mentions
// included.

type State = {
  comments: Partial<Record<Subject, CommentItem[]>>
  reactions: Partial<Record<Subject, CommentReaction[]>>
  seen: Partial<Record<Subject, boolean>>
  mentionSeen: Partial<Record<string, boolean>>
}

export function createComments() {
  let state: State = {
    comments: { ...seedComments },
    reactions: { ...seedReactions },
    seen: {},
    mentionSeen: {},
  }

  const at = (subject: Subject, f: (list: CommentItem[]) => CommentItem[]) => {
    state = {
      ...state,
      comments: { ...state.comments, [subject]: f(state.comments[subject] ?? []) },
    }
  }

  const find = (subject: Subject, id: string) =>
    (state.comments[subject] ?? [])
      .flatMap((c) => [c, ...(c.replies ?? [])])
      .find((c) => c.id === id)

  /** A reaction is one of the five, as the service keeps it. */
  const fiveOnly = (emoji: string) => {
    if (!REACTIONS.some((r) => r.emoji === emoji))
      throw new ApiError('invalid', 'A reaction is one of the five.')
  }

  /** The comment, if `who` wrote it and it still has its words; the service's refusals otherwise. */
  const own = (subject: Subject, id: string, who: string) => {
    const comment = find(subject, id)
    if (!comment) throw new ApiError('not-found', "We couldn't find this comment.")
    if (comment.author !== who)
      throw new ApiError('forbidden', 'Only its author changes or deletes a comment.')
    if (comment.deleted) throw new ApiError('conflict', 'This comment was deleted.')
    return comment
  }

  /** A comment something answers keeps its place, so the answers still read; one nobody answered goes. */
  const drop = (subject: Subject, id: string) => {
    const gone = { deleted: true, reactions: [] }
    at(subject, (list) =>
      list.flatMap((c) => {
        if (c.id === id) return c.replies?.some((r) => !r.deleted) ? [{ ...c, ...gone }] : []
        const i = c.replies?.findIndex((r) => r.id === id) ?? -1
        if (i < 0 || !c.replies) return [c]
        const later = c.replies.slice(i + 1).some((r) => !r.deleted)
        return [
          {
            ...c,
            replies: later
              ? c.replies.map((r) => (r.id === id ? { ...r, ...gone } : r))
              : c.replies.filter((r) => r.id !== id),
          },
        ]
      }),
    )
  }

  /** The threads, with where the reader may take back what a thread hangs on: the caller knows. */
  const read = (withdrawable: Comments['withdrawable'] = {}): Comments => ({
    threads: state.comments,
    reactions: state.reactions,
    newReplies: Object.fromEntries(
      Object.entries(newReplies).filter(([subject]) => !state.seen[subject as Subject]),
    ),
    mentionSeen: state.mentionSeen,
    withdrawable,
  })

  const seenMention = (subject: Subject, person: string) => {
    const key = `${subject}|${person}`
    if (!state.mentionSeen[key])
      state = { ...state, mentionSeen: { ...state.mentionSeen, [key]: true } }
  }

  return {
    read,

    /** Posts a comment and gives back its id, so a decision's Undo can take a returned note away again. */
    post(
      subject: Subject,
      author: string,
      content: JSONContent,
      opts: { parentId?: string; returned?: boolean; anchor?: CommentAnchor } = {},
    ): string {
      if (opts.anchor && (opts.parentId || opts.returned || !subject.startsWith('review:')))
        throw new ApiError(
          'invalid',
          'A comment on a line or a field starts a thread on a suggestion.',
        )
      const comment: CommentItem = {
        id: createId(),
        author,
        when: 'Just now',
        content,
        returned: opts.returned,
        ...(opts.anchor ? { anchor: opts.anchor } : {}),
      }
      if (opts.parentId) {
        const parent = (state.comments[subject] ?? []).find((c) => c.id === opts.parentId)
        if (!parent || parent.deleted)
          throw new ApiError('invalid', 'That comment is not in this thread any more.')
      }
      // Answering in the thread is reading it.
      seenMention(subject, author)
      at(subject, (list) =>
        opts.parentId
          ? list.map((c) =>
              c.id === opts.parentId ? { ...c, replies: [...(c.replies ?? []), comment] } : c,
            )
          : [...list, comment],
      )
      return comment.id
    },
    react(subject: Subject, id: string, emoji: ReactionEmoji, who: string) {
      fiveOnly(emoji)
      if (find(subject, id)?.deleted) throw new ApiError('conflict', 'This comment was deleted.')
      at(subject, (list) =>
        mapThread(list, id, (c) => ({ ...c, reactions: toggleReaction(c.reactions, emoji, who) })),
      )
    },
    reactToSubject(subject: Subject, emoji: ReactionEmoji, who: string) {
      fiveOnly(emoji)
      state = {
        ...state,
        reactions: {
          ...state.reactions,
          [subject]: toggleReaction(state.reactions[subject], emoji, who),
        },
      }
    },
    /** Only its author changes a comment, and only while it has its words. */
    edit(subject: Subject, id: string, content: JSONContent, who: string) {
      own(subject, id, who)
      at(subject, (list) => mapThread(list, id, (c) => ({ ...c, content, edited: true })))
    },
    /** Only its author deletes a comment. */
    remove(subject: Subject, id: string, who: string) {
      own(subject, id, who)
      drop(subject, id)
    },
    /**
     * Marks the writer's own comment as taking back what the thread hangs on, or takes the mark
     * back. One comment of a thread holds it: marking another moves it there.
     */
    withdraw(subject: Subject, id: string, who: string, withdrew: boolean) {
      own(subject, id, who)
      at(subject, (list) =>
        list.map((c) => {
          const mark = (x: CommentItem) =>
            x.id === id ? { ...x, withdrew } : withdrew ? { ...x, withdrew: false } : x
          return { ...mark(c), replies: c.replies?.map(mark) }
        }),
      )
    },
    /**
     * Resolves a thread on a line or a field, or opens it again: anyone may, and the thread says
     * who and when. Asking for the state it is in changes nothing.
     */
    resolve(subject: Subject, id: string, who: string, resolved: boolean) {
      const thread = (state.comments[subject] ?? []).find((c) => c.id === id)
      if (!thread?.anchor)
        throw new ApiError(
          'conflict',
          'Only a thread on a line or a field of a suggestion is resolved.',
        )
      if (resolved === !!thread.resolved) return
      const by = { by: who, when: 'Just now' }
      at(subject, (list) =>
        list.map((c) => {
          if (c.id !== id) return c
          const { resolved: _, ...open } = c
          return resolved ? { ...c, resolved: by } : { ...open, reopened: by }
        }),
      )
    },
    /** The comment that took back what the thread hangs on, by the person who sent it. */
    withdrawal(subject: Subject, sender: string) {
      return (state.comments[subject] ?? [])
        .flatMap((c) => [c, ...(c.replies ?? [])])
        .find((c) => c.withdrew && !c.deleted && c.author === sender)
    },
    /** Undoing a return takes its note away, unless it is gone already. */
    unpost(subject: Subject, id: string) {
      if (find(subject, id) && !find(subject, id)?.deleted) drop(subject, id)
    },
    seen(subject: Subject) {
      if (!state.seen[subject]) state = { ...state, seen: { ...state.seen, [subject]: true } }
    },
    seenMention,
    /** A scenario from the address: a normal week has its mentions unread, all done has them read. */
    scenario(mode: 'week' | 'done', person: string) {
      if (mode === 'week') {
        state = { ...state, mentionSeen: {} }
        return
      }
      const marks = (mentionNotesOf(read()).get(person) ?? []).map((n): [string, boolean] => [
        `${n.subject}|${person}`,
        true,
      ])
      if (marks.length)
        state = { ...state, mentionSeen: { ...state.mentionSeen, ...Object.fromEntries(marks) } }
    },
  }
}

export type MockComments = ReturnType<typeof createComments>
