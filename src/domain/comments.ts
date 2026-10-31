/*
  Comments and reactions (FR-817, docs/product.md): people talk about a suggestion or a context
  item, in the comment box's small document (paragraphs, lists, bold, italic, inline code, and
  mentions of people), and react with one of five reactions, each with one meaning. On a
  suggestion, a thread may hang on a line of its text or on one of its fields, and be resolved.
  Agents never read any of it. Pure: the service stores what these rules accept.
*/

/** The five reactions, each with one meaning. Nothing else is a reaction (docs/design/copy.md). */
export const reactionEmoji = ['👍', '👀', '✅', '🤔', '🙏'] as const
export type ReactionEmoji = (typeof reactionEmoji)[number]

export const reactionMeaning: Record<ReactionEmoji, string> = {
  '👍': 'Agree',
  '👀': 'Looking',
  '✅': 'Done',
  '🤔': 'Not sure',
  '🙏': 'Thanks',
}

export const commentLimits = {
  /** Characters of plain words, mentions counted as "@Name". */
  chars: 2000,
  /** People one comment mentions. */
  mentions: 20,
  /** Nodes in one comment's document, and how deep lists nest. */
  nodes: 600,
  depth: 8,
  /** A mention's label, as the author saw the name. */
  label: 120,
} as const

/** A node of a comment's document, as the comment box writes it (Tiptap's JSON). */
export type CommentNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string }[]
  content?: CommentNode[]
}

/** What a comment hangs on: a suggestion in the review, or a context item. */
export type CommentSubject = { kind: 'proposal'; id: string } | { kind: 'item'; id: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const itemId = /^itm_[0-9a-z]{8,16}$/

/**
 * A subject as the app names it: "review:<suggestion id>" or "context:<item id>". Null for a name
 * that is neither.
 */
export function parseSubject(subject: string): CommentSubject | null {
  const at = subject.indexOf(':')
  const [kind, id] = [subject.slice(0, at), subject.slice(at + 1)]
  if (kind === 'review' && uuid.test(id)) return { kind: 'proposal', id }
  if (kind === 'context' && itemId.test(id)) return { kind: 'item', id }
  return null
}

export const subjectName = (subject: CommentSubject) =>
  subject.kind === 'proposal' ? `review:${subject.id}` : `context:${subject.id}`

/**
 * The fields of a review's Fields table a comment may hang on, by name: every field of a context
 * item but its text, which is commented on by the line.
 */
export const anchorFields = [
  'title',
  'kind',
  'domain',
  'owner',
  'scope',
  'validity',
  'reviewDate',
  'sources',
  'dontConclude',
] as const
export type AnchorField = (typeof anchorFields)[number]

/** The most lines a stored text has: 20,000 characters, each a line at the most. */
export const anchorMaxLine = 20000

/**
 * Where on a suggestion's source a thread hangs: a field by its name, or a line of the text on the
 * side it was read on (`before`, the text agents get now; `after`, the suggested one). It names
 * the two versions it was read against, so it reads the same after a reload, and a later version
 * shows it as written on an earlier one.
 */
export type CommentAnchor = { before: string | null; after: string | null } & (
  { field: AnchorField } | { side: 'before' | 'after'; line: number }
)

/** The pattern of a subject's name, for the contract. */
export const subjectPattern =
  /^(review:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|context:itm_[0-9a-z]{8,16})$/

/** A mention of a person, as stored: their id, and their name as the author saw it. */
export const personMention = (id: string) => `person:${id}`
const personOf = (mentionId: unknown) =>
  typeof mentionId === 'string' && mentionId.startsWith('person:') ? mentionId.slice(7) : null

const blocks = new Set(['paragraph', 'bulletList', 'orderedList', 'listItem'])
const inlines = new Set(['text', 'mention', 'hardBreak'])
const marks = new Set(['bold', 'italic', 'code'])

/**
 * A comment's document, checked and cleaned: only the nodes and marks the comment box offers,
 * attributes it does not use left out, a mention only of a person by id, and some words within
 * the limit. Answers the clean document, or what is wrong with it in plain words.
 */
export function cleanComment(body: unknown): { doc: CommentNode } | { problem: string } {
  let nodes = 0
  let problem: string | null = null
  const fail = (message: string) => {
    problem ??= message
    return null
  }
  const clean = (value: unknown, depth: number, root: boolean): CommentNode | null => {
    if (++nodes > commentLimits.nodes) return fail('This comment is too long.')
    if (depth > commentLimits.depth) return fail('This comment nests too deeply.')
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return fail('This comment is not a document.')
    const node = value as Record<string, unknown>
    const type = node.type
    if (root) {
      if (type !== 'doc') return fail('This comment is not a document.')
    } else if (typeof type !== 'string' || (!blocks.has(type) && !inlines.has(type)))
      return fail('A comment holds paragraphs, lists, bold, italic, code and mentions of people.')
    if (type === 'text') {
      if (typeof node.text !== 'string' || node.text === '') return fail('A text node is empty.')
      const kept = Array.isArray(node.marks)
        ? node.marks.map((m: unknown) =>
            typeof m === 'object' && m !== null ? (m as { type?: unknown }).type : m,
          )
        : []
      if (kept.some((m) => typeof m !== 'string' || !marks.has(m)))
        return fail('A comment takes bold, italic and code only.')
      const unique = [...new Set(kept as string[])]
      return {
        type,
        text: node.text,
        ...(unique.length ? { marks: unique.map((m) => ({ type: m })) } : {}),
      }
    }
    if (type === 'mention') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      const person = personOf(attrs.id)
      const label = attrs.label
      if (!person || !uuid.test(person)) return fail('A comment mentions people only.')
      if (typeof label !== 'string' || !label.trim() || [...label].length > commentLimits.label)
        return fail('A mention needs the name of the person it mentions.')
      return { type, attrs: { id: personMention(person), label } }
    }
    if (type === 'hardBreak') return { type }
    const children = node.content
    if (children !== undefined && !Array.isArray(children))
      return fail('This comment is not a document.')
    const content: CommentNode[] = []
    for (const child of (children as unknown[] | undefined) ?? []) {
      const kept = clean(child, depth + 1, false)
      if (!kept) return null
      content.push(kept)
    }
    const start = (node.attrs as { start?: unknown } | undefined)?.start
    return {
      type,
      ...(type === 'orderedList' && Number.isInteger(start) && (start as number) > 1
        ? { attrs: { start } }
        : {}),
      ...(content.length ? { content } : {}),
    }
  }
  const doc = clean(body, 0, true)
  if (!doc || problem) return { problem: problem ?? 'This comment is not a document.' }
  const words = plainOf(doc).trim()
  if (!words) return { problem: 'Write a comment.' }
  if ([...words].length > commentLimits.chars)
    return { problem: `A comment has at most ${commentLimits.chars} characters.` }
  if (new Set(mentionedPeople(doc)).size > commentLimits.mentions)
    return { problem: `A comment mentions at most ${commentLimits.mentions} people.` }
  return { doc }
}

/** A comment as one line of plain words, mentions as "@Name": the Inbox's excerpt. */
export function plainOf(node: CommentNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'mention')
    return `@${typeof node.attrs?.label === 'string' ? node.attrs.label : ''}`
  if (node.type === 'hardBreak') return ' '
  return (node.content ?? []).map(plainOf).join(node.type === 'paragraph' ? '' : ' ')
}

/** The people a comment mentions, by id, each once, in order. */
export function mentionedPeople(node: CommentNode): string[] {
  const own = node.type === 'mention' ? [personOf(node.attrs?.id)].filter((p) => p !== null) : []
  return [...new Set([...own, ...(node.content ?? []).flatMap(mentionedPeople)])]
}

/** A comment made of plain words: a paragraph for each block of lines. */
export function commentFromText(text: string): CommentNode {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): CommentNode => {
      const lines = block.split('\n')
      const content: CommentNode[] = lines.flatMap((line, i): CommentNode[] => [
        ...(i ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ])
      return { type: 'paragraph', content }
    })
  return { type: 'doc', content: paragraphs }
}

/** A comment in a thread, as the new-reply rule needs it: `at` is an ISO 8601 time. */
export type ThreadEntry = { authorId: string; at: string; deleted: boolean }

/**
 * The reply a person hasn't seen yet in a thread, if any: the newest comment by someone else since
 * they last opened it or wrote in it, in a thread they take part in (they wrote in it, or it is a
 * suggestion they sent). A reply brings the card back to Needs you (docs/design/design-contract.md,
 * 5.7).
 */
export function unseenReply<T extends ThreadEntry>(
  entries: readonly T[],
  person: string,
  { seenAt, sender }: { seenAt: string | null; sender: boolean },
): T | null {
  const mine = entries.filter((e) => e.authorId === person)
  if (!sender && !mine.length) return null
  const time = (at: string) => Date.parse(at)
  const since = Math.max(
    -Infinity,
    ...[seenAt, ...mine.map((e) => e.at)].filter((at) => at !== null).map(time),
  )
  const newer = entries
    .filter((e) => e.authorId !== person && !e.deleted && time(e.at) > since)
    .sort((a, b) => time(b.at) - time(a.at))
  return newer[0] ?? null
}
