import { Fragment, Schema, Slice, type Node } from 'prosemirror-model'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { closeHistory, history } from 'prosemirror-history'
import { parseMentions, serializeMentions, type MentionPart } from '@domain/mentions'
import { flatten, mentionWords, OBJECT_REPLACEMENT, triggerBefore } from '@/lib/mention-markup'
import type { MentionOption } from '@/lib/mention-targets'

/*
  The summary as a ProseMirror document: one paragraph of text and mention atoms. Everything here
  is pure (no view, no DOM), so the round trip, the @ trigger, paste and undo are unit tested
  without a browser. Picking, removing or unpicking a chip and a paste are each one undo step of
  their own (closeHistory), so undo takes back exactly that and not the typing around it. The stored form is the markup of src/domain/mentions.ts, `@[words](target)`;
  this module only converts to and from it, so the editor can be replaced (contract 9.6).
*/

/** The most mentions one field may hold (src/domain/mentions.ts, validateMentionTargets). */
export const MENTIONS_MAX = 50

export const summarySchema = new Schema({
  nodes: {
    doc: { content: 'paragraph' },
    paragraph: {
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    mention: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: { target: {}, label: {} },
      // Copying a chip as plain text gives its words.
      leafText: (node) => String(node.attrs.label),
      parseDOM: [
        {
          tag: 'span[data-mention]',
          getAttrs: (dom) => ({
            target: dom.dataset.mention ?? '',
            label: dom.textContent ?? '',
          }),
        },
      ],
      toDOM: (node) => [
        'span',
        { 'data-mention': String(node.attrs.target) },
        String(node.attrs.label),
      ],
    },
  },
})

const { paragraph, mention } = summarySchema.nodes

function partsToInline(parts: readonly MentionPart[]): Node[] {
  return parts.flatMap((part) =>
    part.kind === 'mention'
      ? [mention.create({ target: part.target, label: part.label })]
      : part.text
        ? [summarySchema.text(flatten(part.text))]
        : [],
  )
}

/** The document for stored markup. Malformed tokens stay as the text they were written as. */
export function markupToDoc(markup: string): Node {
  return summarySchema.node('doc', null, [
    paragraph.create(null, partsToInline(parseMentions(markup).parts)),
  ])
}

/** The parts of a document or a slice of it, adjacent text merged. */
export function fragmentParts(fragment: Fragment): MentionPart[] {
  const parts: MentionPart[] = []
  fragment.descendants((node) => {
    if (node.isText) {
      const last = parts[parts.length - 1]
      if (last?.kind === 'text') last.text += node.text ?? ''
      else parts.push({ kind: 'text', text: node.text ?? '' })
    } else if (node.type === mention) {
      parts.push({
        kind: 'mention',
        target: String(node.attrs.target),
        label: String(node.attrs.label),
      })
    }
    return true
  })
  return parts
}

export function docToMarkup(doc: Node): string {
  return serializeMentions(fragmentParts(doc.content))
}

/** What people and agents read: the words, with each mention as its words. */
export function docText(doc: Node): string {
  return fragmentParts(doc.content)
    .map((part) => (part.kind === 'text' ? part.text : part.label))
    .join('')
}

export function mentionCount(doc: Node): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type === mention) count++
  })
  return count
}

export function createSummaryState(markup: string): EditorState {
  return EditorState.create({ doc: markupToDoc(markup), plugins: [history()] })
}

/** An @ (any target) or # (dimension values) being typed, with the words after it. */
export type Trigger = { from: number; to: number; char: '@' | '#'; query: string }

/** The trigger before the caret, if the person is typing one (mention-markup.ts, triggerBefore). */
export function findTrigger(state: EditorState): Trigger | null {
  const { selection } = state
  if (!selection.empty) return null
  const $from = selection.$from
  const start = Math.max(0, $from.parentOffset - 60)
  const before = $from.parent.textBetween(start, $from.parentOffset, undefined, OBJECT_REPLACEMENT)
  const found = triggerBefore(before)
  if (!found) return null
  return {
    from: $from.pos - (before.length - found.offset),
    to: $from.pos,
    char: found.char,
    query: found.query,
  }
}

/**
 * Replaces the trigger with a mention chip and a space after it (unless one follows already), and
 * leaves the caret after the space. The chip shows the target's name as the author's words.
 */
export function insertMention(
  state: EditorState,
  trigger: Pick<Trigger, 'from' | 'to'>,
  option: Pick<MentionOption, 'key' | 'name'>,
): Transaction {
  const node = mention.create({ target: option.key, label: mentionWords(option.name) })
  const after = state.doc.resolve(trigger.to).nodeAfter
  const spaced = after?.isText && /^[\s.,;:!?)]/.test(after.text ?? '')
  const content = spaced ? [node] : [node, summarySchema.text(' ')]
  const tr = closeHistory(state.tr).replaceWith(trigger.from, trigger.to, content)
  return tr
    .setSelection(TextSelection.create(tr.doc, trigger.from + (spaced ? 1 : 2)))
    .scrollIntoView()
}

/** Removes the chip at `pos` whole (Backspace after a chip or on a selected one). */
export function removeMention(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (!node || node.type !== mention) return null
  return closeHistory(state.tr)
    .delete(pos, pos + 1)
    .scrollIntoView()
}

/** Turns a chip back into its words, the caret after them (Delete on a chip, sheet A3). */
export function mentionToText(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (!node || node.type !== mention) return null
  const label = String(node.attrs.label)
  const tr = closeHistory(state.tr).replaceWith(pos, pos + 1, summarySchema.text(label))
  return tr.setSelection(TextSelection.create(tr.doc, pos + label.length)).scrollIntoView()
}

/** The words a recognised word would become: an unmentioned name of a metric, value or domain. */
export type Suggestion = { from: number; to: number; option: MentionOption; words: string }

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Words in the text that are the name or another name of a metric, a value, a dimension or a
 * domain and are not yet mentions. They are only suggestions (contract 9.6): the field underlines
 * them and asks, it never turns one into a mention by itself. Longest names win, so "Net revenue"
 * is one suggestion, not "revenue". Item titles are left out: they are sentences, not words.
 */
export function findSuggestions(doc: Node, options: readonly MentionOption[]): Suggestion[] {
  const names = new Map<string, MentionOption>()
  for (const option of options) {
    if (option.type === 'item' || option.status === 'retired') continue
    for (const name of [option.name, ...option.aliases])
      if ([...name].length >= 3 && !names.has(name.toLocaleLowerCase('en')))
        names.set(name.toLocaleLowerCase('en'), option)
  }
  if (names.size === 0) return []
  const alternatives = [...names.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapePattern)
    .join('|')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}@#])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'giu')
  const found: Suggestion[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const match of (node.text ?? '').matchAll(pattern)) {
      const option = names.get(match[0].toLocaleLowerCase('en'))
      if (option)
        found.push({
          from: pos + match.index,
          to: pos + match.index + match[0].length,
          option,
          words: match[0],
        })
    }
    return false
  })
  return found
}

/** Turns a suggested word into a mention that keeps the author's words. */
export function acceptSuggestion(state: EditorState, suggestion: Suggestion): Transaction {
  const node = mention.create({
    target: suggestion.option.key,
    label: mentionWords(suggestion.words),
  })
  return closeHistory(state.tr).replaceWith(suggestion.from, suggestion.to, node).scrollIntoView()
}

/** The words of the selection, each mention as its words: what a copy pastes elsewhere. */
export function selectionText(state: EditorState): string {
  return fragmentParts(state.selection.content().content)
    .map((part) => (part.kind === 'text' ? part.text : part.label))
    .join('')
}

/** The markup of the selection, for a copy that pastes back as chips in this field. */
export function selectionMarkup(state: EditorState): string {
  return serializeMentions(fragmentParts(state.selection.content().content))
}

/**
 * A paste. Paste is plain (contract 9.6): text from anywhere arrives as text, line breaks become
 * spaces, and a token typed in it stays text. Only a copy from a summary field carries its chips,
 * as markup in a type of its own, so a cut and paste inside the field loses no mention.
 */
export function pasteTransaction(
  state: EditorState,
  { text, markup }: { text: string; markup?: string },
): Transaction {
  const inline = markup
    ? partsToInline(parseMentions(flatten(markup)).parts)
    : text
      ? [summarySchema.text(flatten(text))]
      : []
  const tr = closeHistory(state.tr).replaceSelection(new Slice(Fragment.from(inline), 0, 0))
  return tr.scrollIntoView().setMeta('uiEvent', 'paste')
}

/** The markup's type on the clipboard, so a paste can tell a copy from a summary field. */
export const MARKUP_MIME = 'application/x-heed-markup'

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The HTML a copy writes: the words, with the markup in an attribute. Browsers keep HTML on the
 * clipboard where they drop a type of their own, so this is what carries chips through a paste.
 */
export function clipboardHtml(text: string, markup: string): string {
  return `<span data-heed-markup="${escapeHtml(markup)}">${escapeHtml(text)}</span>`
}

/** The markup a copy from a summary field left in clipboard HTML, if any. */
export function markupFromHtml(html: string): string | undefined {
  if (!html.includes('data-heed-markup')) return undefined
  const found = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('[data-heed-markup]')
    ?.getAttribute('data-heed-markup')
  return found ?? undefined
}

const visible = (text: string) => [...flatten(text).trim()].length

/**
 * Where a paste that does not fit the summary splits (the editor design, section 3): the head
 * stays in the summary, ending at a paragraph break or a sentence end, and the rest moves to the
 * body, so a long paste is never refused. Without such an end in reach it splits between words.
 * Null when the paste fits as it is.
 */
export function splitPaste(text: string, room: number): { head: string; rest: string } | null {
  if (visible(text) <= room) return null
  const ends = [
    ...[...text.matchAll(/[.!?]["'”’)\]]*(?=\s|$)/g)].map((match) => match.index + match[0].length),
    ...[...text.matchAll(/\n\s*\n/g)].map((match) => match.index),
  ]
  const fits = (end: number) => visible(text.slice(0, end)) <= room
  let end = Math.max(0, ...ends.filter(fits))
  if (end === 0)
    end = Math.max(0, ...[...text.matchAll(/\s+/g)].map((match) => match.index).filter(fits))
  return { head: flatten(text.slice(0, end)).trim(), rest: text.slice(end).trim() }
}
