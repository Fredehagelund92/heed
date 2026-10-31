import type { CommentAnchor } from '@domain/comments'
import type { CommentItem, CommentReaction } from '@/components/templates/comment-box/types'
import { peopleIn, plainOf } from '@/components/templates/comment-box/utils'

// Comments and reactions as the app reads them (src/web/api), keyed by what they hang on: a
// suggestion in the review ("review:<id>") or a context item ("context:<id>"). They are kept
// apart from the context on purpose: nothing an agent reads is built from them.

export type Subject = `review:${string}` | `context:${string}`

// A thread on a line or a field of a review's source names where it hangs (model/source-places.ts).
export type { CommentAnchor }

/** A reply the owner hasn't opened yet: the Inbox's quiet marker. */
export type NewReply = { from: string; when: string; excerpt: string }

export type Comments = {
  threads: Partial<Record<Subject, CommentItem[]>>
  /** Reactions on the suggestion or the context item itself, apart from its comments. */
  reactions: Partial<Record<Subject, CommentReaction[]>>
  /** Replies nobody has opened yet, by thread. */
  newReplies: Partial<Record<Subject, NewReply>>
  /** `${subject}|${person}`: the person has read the comments that mention them there. */
  mentionSeen: Partial<Record<string, boolean>>
  /**
   * The threads where the person may take back what they hang on with a comment of theirs: a
   * suggestion to archive they sent, while it waits.
   */
  withdrawable: Partial<Record<Subject, boolean>>
}

/** A comment that mentions someone, as their Inbox shows it. */
export type MentionNote = {
  subject: Subject
  id: string
  from: string
  when: string
  excerpt: string
}

/** Who is mentioned where and hasn't read it yet, worked out from the comments themselves. */
export function mentionNotesOf(comments: Comments): Map<string, MentionNote[]> {
  const byPerson = new Map<string, MentionNote[]>()
  for (const [subject, list] of Object.entries(comments.threads) as [Subject, CommentItem[]][])
    for (const c of list.flatMap((x) => [x, ...(x.replies ?? [])])) {
      if (c.deleted) continue
      for (const who of new Set(peopleIn(c.content))) {
        if (who === c.author || comments.mentionSeen[`${subject}|${who}`]) continue
        byPerson.set(who, [
          ...(byPerson.get(who) ?? []),
          { subject, id: c.id, from: c.author, when: c.when, excerpt: plainOf(c.content) },
        ])
      }
    }
  return byPerson
}
