import type { JSONContent } from '@tiptap/core'
import type { CommentAnchor } from '@domain/comments'

// From the editorcn Comment Box (registry `comment-box`, MIT), adapted: a reaction lists who gave
// it, a comment can be a return with a note, edited or deleted, and authors are people's names.

export type ReactionEmoji = '👍' | '👀' | '✅' | '🤔' | '🙏'

export interface CommentReaction {
  emoji: ReactionEmoji
  /** Who gave it, in order. The count is the length; a tooltip names them. */
  by: string[]
}

export interface CommentReply {
  id: string
  author: string
  /** As the Inbox writes times: "Today, 09:40", "Yesterday, 14:20", "21 Oct". */
  when: string
  content: JSONContent
  reactions?: CommentReaction[]
  edited?: boolean
  /** Deleted with replies under it: the place stays, the words go. */
  deleted?: boolean
  /** "Return with a note" posts the note as a comment with this mark. */
  returned?: boolean
  /** Its writer took back their suggestion to archive with it. */
  withdrew?: boolean
}

/** Who resolved a thread, or opened it again, and when, as the Inbox writes times. */
export interface Resolution {
  by: string
  when: string
}

export interface CommentItem extends CommentReply {
  replies?: CommentReply[]
  /**
   * On a suggestion, the line or field of its source the thread hangs on, with the two versions
   * it was read against.
   */
  anchor?: CommentAnchor
  /** A thread on a line or a field, resolved: by whom and when. */
  resolved?: Resolution
  /** Opened again after it was resolved, the last time. */
  reopened?: Resolution
}
