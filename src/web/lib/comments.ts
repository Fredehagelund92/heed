import * as React from 'react'
import type { JSONContent } from '@tiptap/core'
import type {
  CommentItem,
  CommentReaction,
  ReactionEmoji,
} from '@/components/templates/comment-box/types'
import { useComments as useAllComments, useWrite } from '@/api/queries'
import {
  mentionNotesOf,
  type CommentAnchor,
  type MentionNote,
  type Subject,
} from '@/model/comments'

// Comments and reactions as the screens use them, from the shared comments read (src/web/api).
// Agents never read any of it, mentions included.

export type { MentionNote }

const EMPTY: CommentItem[] = []
const NONE: CommentReaction[] = []
const NO_NOTES: MentionNote[] = []

export const useComments = (subject: Subject) => useAllComments().threads[subject] ?? EMPTY

export const useSubjectReactions = (subject: Subject) => useAllComments().reactions[subject] ?? NONE

/** Whether the person may take back what the thread hangs on with a comment of theirs. */
export const useWithdrawable = (subject: Subject) => !!useAllComments().withdrawable[subject]

/** A reply the owner hasn't opened yet: the Inbox's quiet marker. */
export const useNewReply = (subject: Subject) => useAllComments().newReplies[subject]

/** The comments that mention this person and that they haven't read, oldest first. */
export function useMentionsOf(person: string) {
  const comments = useAllComments()
  const notes = React.useMemo(() => mentionNotesOf(comments), [comments])
  return notes.get(person) ?? NO_NOTES
}

/** What a person does to comments: post, react, edit, delete, and read them. */
export function useCommentActions() {
  const write = useWrite()
  return {
    /** Posts a comment and gives back its id, so a decision's Undo can take a returned note away again. */
    post: async (
      subject: Subject,
      content: JSONContent,
      opts: { parentId?: string; returned?: boolean; anchor?: CommentAnchor } = {},
    ) => (await write('postComment', { subject, content, ...opts })).id,
    react: (subject: Subject, id: string, emoji: ReactionEmoji) =>
      write('reactToComment', { subject, id, emoji }),
    reactToSubject: (subject: Subject, emoji: ReactionEmoji) =>
      write('reactToSubject', { subject, emoji }),
    edit: (subject: Subject, id: string, content: JSONContent) =>
      write('editComment', { subject, id, content }),
    remove: (subject: Subject, id: string) => write('removeComment', { subject, id }),
    /** Takes back what the thread hangs on with this comment of theirs, or takes the mark back. */
    withdraw: (subject: Subject, id: string, withdrew: boolean) =>
      write('withdrawWithComment', { subject, id, withdrew }),
    /** Resolves a thread on a line or a field, or opens it again. */
    resolve: (subject: Subject, id: string, resolved: boolean) =>
      write('resolveComment', { subject, id, resolved }),
    /** The person opened the thread: a new reply's marker goes. */
    seen: (subject: Subject) => write('markThreadSeen', { subject }),
    /** The person has read the comments that mention them here: their Inbox marker goes. */
    seenMention: (subject: Subject) => write('markMentionSeen', { subject }),
  }
}
