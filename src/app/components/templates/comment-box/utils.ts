import type { JSONContent } from '@tiptap/core'
import type { CommentItem, CommentReaction, CommentReply, ReactionEmoji } from './types'

// From the editorcn Comment Box, adapted (and kept free of Tiptap itself, so the Inbox can use it): five reactions with plain meanings instead of six free
// ones, reactions toggled per person, times written as the Inbox writes them (the template's
// browser-language "3 hours ago" is gone), and a soft delete that keeps a thread's shape.

/** The five reactions, each with a plain meaning. No picker for anything else. */
export const REACTIONS: { emoji: ReactionEmoji; label: string }[] = [
  { emoji: '👍', label: 'Agree' },
  { emoji: '👀', label: 'Looking' },
  { emoji: '✅', label: 'Done' },
  { emoji: '🤔', label: 'Not sure' },
  { emoji: '🙏', label: 'Thanks' },
]

export const reactionLabel = (emoji: ReactionEmoji) =>
  REACTIONS.find((r) => r.emoji === emoji)?.label ?? emoji

/** Inline runs with **bold**, `code` and @[Name] mentions of people, as a comment's text. */
function inline(s: string): JSONContent[] {
  return s
    .split(/(\*\*[^*]+\*\*|`[^`]+`|@\[[^\]]+\])/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**')
        ? { type: 'text', text: part.slice(2, -2), marks: [{ type: 'bold' }] }
        : part.startsWith('`')
          ? { type: 'text', text: part.slice(1, -1), marks: [{ type: 'code' }] }
          : part.startsWith('@[')
            ? {
                type: 'mention',
                attrs: { id: `person:${part.slice(2, -1)}`, label: part.slice(2, -1) },
              }
            : { type: 'text', text: part },
    )
}

/** A comment as one line of plain words, mentions as "@Name": for the Inbox's excerpt. */
export function plainOf(content: JSONContent): string {
  if (content.type === 'text') return content.text ?? ''
  if (content.type === 'mention') return `@${content.attrs?.label ?? ''}`
  return (content.content ?? [])
    .map(plainOf)
    .join(content.type === 'doc' || content.type === 'bulletList' ? ' ' : '')
}

/** The people a comment mentions. */
export function peopleIn(content: JSONContent): string[] {
  const own =
    content.type === 'mention' && String(content.attrs?.id ?? '').startsWith('person:')
      ? [String(content.attrs?.label)]
      : []
  return [...own, ...(content.content ?? []).flatMap(peopleIn)]
}

/** A comment from plain text: one paragraph per blank-line block, "- " lines as a list. */
export function text(s: string): JSONContent {
  const para = (t: string): JSONContent =>
    t ? { type: 'paragraph', content: inline(t) } : { type: 'paragraph' }
  const blocks = s.split(/\n{2,}/).map((block): JSONContent => {
    const lines = block.split('\n')
    if (lines.every((l) => l.startsWith('- ')))
      return {
        type: 'bulletList',
        content: lines.map((l) => ({ type: 'listItem', content: [para(l.slice(2))] })),
      }
    return para(block)
  })
  return { type: 'doc', content: blocks }
}

/** Toggles one person's reaction. A reaction nobody gives any more disappears. */
export function toggleReaction(
  reactions: CommentReaction[] = [],
  emoji: ReactionEmoji,
  who: string,
): CommentReaction[] {
  const has = reactions.find((r) => r.emoji === emoji)
  if (!has) return [...reactions, { emoji, by: [who] }]
  const by = has.by.includes(who) ? has.by.filter((n) => n !== who) : [...has.by, who]
  return reactions.map((r) => (r.emoji === emoji ? { ...r, by } : r)).filter((r) => r.by.length > 0)
}

/** "You, Tomas Eriksen and Noor Haddad", "Ines Duarte and 3 others". */
export function names(by: string[], me: string) {
  const list = by.map((n) => (n === me ? 'You' : n))
  const shown = list.slice(0, 3)
  const rest = list.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`
  if (shown.length > 1) return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  return shown[0]
}

export const createId = () =>
  `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Applies a change to one comment, wherever it sits; null removes it. */
export function mapThread(
  list: CommentItem[],
  id: string,
  update: (c: CommentReply) => CommentReply | null,
): CommentItem[] {
  return list.flatMap((c) => {
    if (c.id === id) {
      const next = update(c)
      return next ? [{ ...c, ...next }] : []
    }
    if (!c.replies) return [c]
    return [
      {
        ...c,
        replies: c.replies.flatMap((r) => {
          if (r.id !== id) return [r]
          const next = update(r)
          return next ? [next] : []
        }),
      },
    ]
  })
}

/** Comments in a thread, replies included, not counting deleted ones. */
export const countComments = (list: CommentItem[]) =>
  list.reduce(
    (n, c) => n + (c.deleted ? 0 : 1) + (c.replies?.filter((r) => !r.deleted).length ?? 0),
    0,
  )
