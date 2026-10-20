import { mentionLabelSchema, serializeMentions } from '@domain/mentions'

/*
  The @ trigger and the markup token, shared by the summary chip input and the Markdown body,
  where mentions are tokens in the text (contract 9.6). Pure, so both fields behave the same.
*/

/** What stands in for a chip in text handed to `triggerBefore`. */
export const OBJECT_REPLACEMENT = '￼'

const triggerPattern = /(?:^|[\s([{"'“‘])([@#])([^@#\n￼]{0,40})$/

/** An @ (any target) or # (dimension values) being typed: where it starts and the words after it. */
export type TextTrigger = { offset: number; char: '@' | '#'; query: string }

/**
 * The trigger at the end of `before`, the text up to the caret: `@` or `#` at the start or after
 * a space or an opening bracket, then at most 40 characters and four words on one line. A space
 * right after the sign, or two spaces in a row, ends it, so a lone @ in a sentence closes the
 * list as the sentence goes on. An email address never triggers (the sign follows a letter).
 */
export function triggerBefore(before: string): TextTrigger | null {
  const match = triggerPattern.exec(before)
  if (!match) return null
  const query = match[2] ?? ''
  if (query.startsWith(' ') || /\s{2}$/.test(query) || query.split(' ').length > 4) return null
  return {
    offset: before.length - query.length - 1,
    char: match[1] as '@' | '#',
    query,
  }
}

/** Text cannot hold a line break where a mention or the summary goes: it becomes a space. */
export const flatten = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ')

/** Words a mention can hold: no `]`, no line break, at most 120 characters. */
export function mentionWords(name: string): string {
  const words = [...flatten(name).replace(/\]/g, '').trim()].slice(0, 120).join('')
  return mentionLabelSchema.safeParse(words).success ? words : '…'
}

/** The token for a mention, `@[words](target)`. */
export function mentionToken(words: string, target: string): string {
  return serializeMentions([{ kind: 'mention', label: mentionWords(words), target }])
}

/**
 * Replaces `text[from, to)` with a mention token and a space (unless one follows), returning the
 * new text and the caret after it. For a plain text field such as the Markdown body.
 */
export function insertToken(
  text: string,
  { from, to }: { from: number; to: number },
  words: string,
  target: string,
): { text: string; caret: number } {
  const after = text.slice(to)
  const insert = mentionToken(words, target) + (/^[\s.,;:!?)]/.test(after) ? '' : ' ')
  return { text: text.slice(0, from) + insert + after, caret: from + insert.length }
}
