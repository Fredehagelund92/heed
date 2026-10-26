import * as React from 'react'
import type { JSONContent } from '@tiptap/core'
import type {
  CommentItem,
  CommentReaction,
  ReactionEmoji,
} from '@/components/templates/comment-box/types'
import {
  createId,
  mapThread,
  peopleIn,
  plainOf,
  toggleReaction,
} from '@/components/templates/comment-box/utils'
import { newReplies, seedComments, seedReactions, type Subject } from '@/data/comments'

// Comments and reactions, kept in memory until the page reloads. Anyone signed in can comment and
// react; people edit and delete only their own words. Nothing here sends anything: a reply only
// brings a card back to "Needs you" in the owner's Inbox, and an @ of a person puts a quiet marker
// in theirs, in the app only. Agents never read any of it, mentions included.

type State = {
  comments: Partial<Record<Subject, CommentItem[]>>
  reactions: Partial<Record<Subject, CommentReaction[]>>
  seen: Partial<Record<Subject, boolean>>
  /** `${subject}|${person}`: the person has read the comments that mention them there. */
  mentionSeen: Partial<Record<string, boolean>>
}

let state: State = {
  comments: { ...seedComments },
  reactions: { ...seedReactions },
  seen: {},
  mentionSeen: {},
}
const listeners = new Set<() => void>()
const set = (next: State) => {
  state = next
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const EMPTY: CommentItem[] = []
const NONE: CommentReaction[] = []

export function useComments(subject: Subject) {
  return React.useSyncExternalStore(subscribe, () => state.comments[subject] ?? EMPTY)
}

export function useSubjectReactions(subject: Subject) {
  return React.useSyncExternalStore(subscribe, () => state.reactions[subject] ?? NONE)
}

/** A reply the owner hasn't opened yet: the Inbox's quiet marker. */
export function useNewReply(subject: Subject) {
  return React.useSyncExternalStore(subscribe, () =>
    state.seen[subject] ? undefined : newReplies[subject],
  )
}

/** A comment that mentions someone, as their Inbox shows it. */
export type MentionNote = {
  subject: Subject
  id: string
  from: string
  when: string
  excerpt: string
}

// Who is mentioned where and hasn't read it yet, worked out from the comments themselves, again only when they change.
let notes: { from: State; byPerson: Map<string, MentionNote[]> } | undefined
function mentionNotes() {
  if (
    notes &&
    notes.from.comments === state.comments &&
    notes.from.mentionSeen === state.mentionSeen
  )
    return notes.byPerson
  const byPerson = new Map<string, MentionNote[]>()
  for (const [subject, list] of Object.entries(state.comments) as [Subject, CommentItem[]][])
    for (const c of list.flatMap((x) => [x, ...(x.replies ?? [])])) {
      if (c.deleted) continue
      for (const who of new Set(peopleIn(c.content))) {
        if (who === c.author || state.mentionSeen[`${subject}|${who}`]) continue
        byPerson.set(who, [
          ...(byPerson.get(who) ?? []),
          { subject, id: c.id, from: c.author, when: c.when, excerpt: plainOf(c.content) },
        ])
      }
    }
  notes = { from: state, byPerson }
  return byPerson
}

const NO_NOTES: MentionNote[] = []

/** The comments that mention this person and that they haven't read, oldest first. */
export function useMentionsOf(person: string) {
  return React.useSyncExternalStore(subscribe, () => mentionNotes().get(person) ?? NO_NOTES)
}

const at = (subject: Subject, f: (list: CommentItem[]) => CommentItem[]) =>
  set({ ...state, comments: { ...state.comments, [subject]: f(state.comments[subject] ?? []) } })

export const commentActions = {
  /** Posts a comment and gives back its id, so a decision's Undo can take a returned note away again. */
  post(
    subject: Subject,
    author: string,
    content: JSONContent,
    opts: { parentId?: string; returned?: boolean } = {},
  ): string {
    const comment: CommentItem = {
      id: createId(),
      author,
      when: 'Just now',
      content,
      returned: opts.returned,
    }
    // Answering in the thread is reading it.
    commentActions.seenMention(subject, author)
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
    at(subject, (list) =>
      mapThread(list, id, (c) => ({ ...c, reactions: toggleReaction(c.reactions, emoji, who) })),
    )
  },
  reactToSubject(subject: Subject, emoji: ReactionEmoji, who: string) {
    set({
      ...state,
      reactions: {
        ...state.reactions,
        [subject]: toggleReaction(state.reactions[subject], emoji, who),
      },
    })
  },
  edit(subject: Subject, id: string, content: JSONContent) {
    at(subject, (list) => mapThread(list, id, (c) => ({ ...c, content, edited: true })))
  },
  /** A comment something answers keeps its place, so the answers still read; one nobody answered goes. */
  remove(subject: Subject, id: string) {
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
  },
  seen(subject: Subject) {
    if (!state.seen[subject]) set({ ...state, seen: { ...state.seen, [subject]: true } })
  },
  /** A scenario from the address: a normal week has its mentions unread, all done has them read. */
  scenario(mode: 'week' | 'done', person: string) {
    if (mode === 'week') return set({ ...state, mentionSeen: {} })
    const read = (mentionNotes().get(person) ?? []).map((n) => [`${n.subject}|${person}`, true])
    if (read.length)
      set({ ...state, mentionSeen: { ...state.mentionSeen, ...Object.fromEntries(read) } })
  },
  /** The person has read the comments that mention them here: their Inbox marker goes. */
  seenMention(subject: Subject, person: string) {
    const key = `${subject}|${person}`
    if (!state.mentionSeen[key])
      set({ ...state, mentionSeen: { ...state.mentionSeen, [key]: true } })
  },
}
