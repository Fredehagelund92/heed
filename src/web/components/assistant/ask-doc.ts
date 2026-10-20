import { Fragment, Schema, Slice, type Node } from 'prosemirror-model'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { closeHistory, history } from 'prosemirror-history'
import { mentionTargetSchema, type MentionPart } from '@domain/mentions'
import type { TryItReading } from '@/api'
import { CHIP_MARK, datesOf, datesTarget, type AskDraft } from '@/lib/ask-draft'
import { mentionWords } from '@/lib/mention-markup'

/*
  The Ask composer's question as a ProseMirror document (Heed composer, stage 2): one paragraph
  of words, line breaks and chips. A chip is an atom that stands for a term of the vocabulary, an
  accepted item, a domain or the question's dates, and keeps the words it stands for, so the question still reads as a
  sentence (`docText`). Everything here is pure (no view, no DOM), so the round trip, the offers,
  paste and undo are unit tested without a browser. Making, removing or unmaking a chip and a
  paste are each one undo step of their own (closeHistory), as in the summary field
  (summary-doc.ts), so undo takes back exactly that and not the typing around it.
*/

export const askSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph' },
    paragraph: {
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    // Shift+Enter: a line of its own in the question, as the plain box allowed.
    hard_break: {
      group: 'inline',
      inline: true,
      selectable: false,
      leafText: () => '\n',
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    chip: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: { target: {}, label: {} },
      // Copying a chip as plain text gives its words.
      leafText: (node) => String(node.attrs.label),
      parseDOM: [
        {
          tag: 'span[data-chip]',
          getAttrs: (dom) => ({ target: dom.dataset.chip ?? '', label: dom.textContent ?? '' }),
        },
      ],
      toDOM: (node) => [
        'span',
        { 'data-chip': String(node.attrs.target) },
        String(node.attrs.label),
      ],
    },
  },
})

const { paragraph, chip, hard_break: hardBreak } = askSchema.nodes

/** Words as nodes: a line break in them is a node of its own. */
function textNodes(text: string): Node[] {
  return text
    .split('\n')
    .flatMap((line, index) => [
      ...(index > 0 ? [hardBreak.create()] : []),
      ...(line ? [askSchema.text(line)] : []),
    ])
}

function partsToInline(parts: AskDraft): Node[] {
  return parts.flatMap((part) =>
    part.kind === 'mention'
      ? [chip.create({ target: part.target, label: part.label })]
      : textNodes(part.text.replace(/\r\n?/g, '\n')),
  )
}

export function draftToDoc(draft: AskDraft): Node {
  return askSchema.node('doc', null, [paragraph.create(null, partsToInline(draft))])
}

/** The parts of a document or a slice of it: words (a line break as `\n`) and chips, in order. */
export function fragmentDraft(fragment: Fragment): MentionPart[] {
  const parts: MentionPart[] = []
  const words = (text: string) => {
    const last = parts.at(-1)
    if (last?.kind === 'text') last.text += text
    else parts.push({ kind: 'text', text })
  }
  fragment.descendants((node) => {
    if (node.isText) words(node.text ?? '')
    else if (node.type === hardBreak) words('\n')
    else if (node.type === chip)
      parts.push({
        kind: 'mention',
        target: String(node.attrs.target),
        label: String(node.attrs.label),
      })
    return true
  })
  return parts
}

export const docDraft = (doc: Node): AskDraft => fragmentDraft(doc.content)

export function createAskState(draft: AskDraft): EditorState {
  return EditorState.create({ doc: draftToDoc(draft), plugins: [history()] })
}

/** Where the paragraph's words start: a place in `draftReading` plus this is a place in the doc. */
const START = 1

/**
 * A chip at the caret's place, replacing `range` (the @ and its words): a space after it, and one
 * before it when it would otherwise touch the word before.
 */
export function insertChip(
  state: EditorState,
  range: { from: number; to: number },
  target: string,
  label: string,
): Transaction {
  const node = chip.create({ target, label: mentionWords(label) })
  const before = state.doc.resolve(range.from).nodeBefore
  const glued = before?.isText ? /[^\s([{"'“‘]$/.test(before.text ?? '') : before?.type === chip
  const after = state.doc.resolve(range.to).nodeAfter
  const spaced = after?.isText && /^[\s.,;:!?)]/.test(after.text ?? '')
  const content = [
    ...(glued ? [askSchema.text(' ')] : []),
    node,
    ...(spaced ? [] : [askSchema.text(' ')]),
  ]
  const tr = closeHistory(state.tr).replaceWith(range.from, range.to, content)
  const end = range.from + (glued ? 1 : 0) + (spaced ? 1 : 2)
  return tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView()
}

/** Removes the chip at `pos` whole, words and all (Backspace after a chip or on a selected one). */
export function removeChip(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (!node || node.type !== chip) return null
  return closeHistory(state.tr)
    .delete(pos, pos + 1)
    .scrollIntoView()
}

/** Turns a chip back into its words, the caret after them (Delete on a chip). */
export function chipToText(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (!node || node.type !== chip) return null
  const label = String(node.attrs.label)
  const tr = closeHistory(state.tr).replaceWith(pos, pos + 1, askSchema.text(label))
  return tr.setSelection(TextSelection.create(tr.doc, pos + label.length)).scrollIntoView()
}

/** The chips of the question, with where each is. */
export function chipsOf(doc: Node): { pos: number; target: string; label: string }[] {
  const found: { pos: number; target: string; label: string }[] = []
  doc.descendants((node, pos) => {
    if (node.type === chip)
      found.push({ pos, target: String(node.attrs.target), label: String(node.attrs.label) })
    return true
  })
  return found
}

/** Where the question's dates chip is, if it has one: a question has one period. */
export const datesChipOf = (doc: Node) =>
  chipsOf(doc).find((found) => datesOf(found.target) !== null) ?? null

/**
 * Words Heed read as a name or as the question's dates, which the composer offers to make a chip
 * (it never makes one by itself): where they are, the terms they could be (one, or several when
 * the words are ambiguous), or the days they name.
 */
export type Offer = {
  from: number
  to: number
  words: string
  keys: string[]
  dates: { from: string; to: string } | null
}

/**
 * The offers of a reading of `read` (`draftReading` of the doc it was read for): its names and
 * its dates, each where it is in the doc. The service reads the words trimmed, so the places move
 * by the spaces before them. Words a chip took are never offered, nor dates Heed cannot read.
 */
export function offersOf(doc: Node, reading: TryItReading, read: string): Offer[] {
  const lead = read.length - read.trimStart().length
  const words = read.trim()
  const offers: Offer[] = []
  for (const span of reading.spans) {
    const said = words.slice(span.start, span.end)
    if (!said || said.includes(CHIP_MARK)) continue
    const from = START + lead + span.start
    const to = START + lead + span.end
    if (to > doc.content.size - 1 || doc.textBetween(from, to, '\n', CHIP_MARK) !== said) continue
    const dates =
      span.dates && reading.from ? { from: reading.from, to: reading.to ?? reading.from } : null
    if (!dates && !span.keys.length) continue
    offers.push({ from, to, words: said, keys: span.dates ? [] : span.keys, dates })
  }
  return offers
}

/**
 * The offers after an edit: each moves with the words around it, and goes once its own words were
 * touched, since what they say may have changed. A fresh reading replaces them.
 */
export function mapOffers(
  doc: Node,
  offers: readonly Offer[],
  mapping: Transaction['mapping'],
): Offer[] {
  return offers.flatMap((offer) => {
    const from = mapping.mapResult(offer.from, 1)
    const to = mapping.mapResult(offer.to, -1)
    if (from.deletedAfter || to.deletedBefore || to.pos - from.pos !== offer.to - offer.from)
      return []
    if (doc.textBetween(from.pos, to.pos, '\n', CHIP_MARK) !== offer.words) return []
    return [{ ...offer, from: from.pos, to: to.pos }]
  })
}

/**
 * Makes offered words a chip that keeps them: a term's (`key`, one of the offer's) or the
 * question's dates. A question has one period, so a dates chip already elsewhere goes back to
 * its words. The caret stays where it was. One undo step.
 */
export function acceptOffer(state: EditorState, offer: Offer, key?: string): Transaction | null {
  const target = offer.dates ? datesTarget(offer.dates.from, offer.dates.to) : key
  if (!target) return null
  const tr = closeHistory(state.tr)
  const node = chip.create({ target, label: mentionWords(offer.words) })
  tr.replaceWith(offer.from, offer.to, node)
  const old = offer.dates ? datesChipOf(state.doc) : null
  if (old) {
    const at = tr.mapping.map(old.pos)
    tr.replaceWith(at, at + 1, askSchema.text(old.label))
  }
  // The caret stays where the person is typing: the selection moves with the words.
  return tr.scrollIntoView()
}

/**
 * Sets the question's dates. With `pos`, the dates chip there takes the new days, and its words
 * become the days' words when the days changed; without, a dates chip is put at the caret (with a
 * space after it), or the one the question has takes them. One undo step.
 */
export function setDates(
  state: EditorState,
  days: { from: string; to: string },
  words: string,
  pos: number | null,
): Transaction {
  const at = pos ?? datesChipOf(state.doc)?.pos ?? null
  const target = datesTarget(days.from, days.to)
  const node = at === null ? null : state.doc.nodeAt(at)
  if (at === null || node?.type !== chip) {
    const { from, to } = state.selection
    return insertChip(state, { from, to }, target, words)
  }
  const label = node.attrs.target === target ? String(node.attrs.label) : mentionWords(words)
  const tr = closeHistory(state.tr).setNodeMarkup(at, undefined, { target, label })
  return tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView()
}

/** The question's dates go: the dates chip at `pos` and its words. One undo step. */
export const removeDates = (state: EditorState, pos: number) => removeChip(state, pos)

/** The words of the selection, each chip as its words: what a copy pastes elsewhere. */
export const selectionDraft = (state: EditorState): AskDraft =>
  fragmentDraft(state.selection.content().content)

/**
 * A paste. Paste is plain: text from anywhere arrives as words, with its line breaks, and no
 * formatting. Only a copy from the composer carries its chips (`draftFromHtml`), so a cut and
 * paste inside the question loses no chip.
 */
export function pasteTransaction(
  state: EditorState,
  { text, draft }: { text: string; draft?: AskDraft },
): Transaction {
  const inline = draft ? partsToInline(draft) : textNodes(text.replace(/\r\n?/g, '\n'))
  const tr = closeHistory(state.tr).replaceSelection(new Slice(Fragment.from(inline), 0, 0))
  return tr.scrollIntoView().setMeta('uiEvent', 'paste')
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The HTML a copy writes: the words, with the chips in an attribute. Browsers keep HTML on the
 * clipboard where they drop a type of their own, so this is what carries chips through a paste.
 */
export function clipboardHtml(text: string, draft: AskDraft): string {
  return `<span data-heed-ask="${escapeHtml(JSON.stringify(draft))}">${escapeHtml(text)}</span>`
}

/** What a chip may stand for: anything text can mention, a metric group, or the dates. */
const validTarget = (target: string) =>
  mentionTargetSchema.safeParse(target).success ||
  /^group:[a-z0-9_]+$/.test(target) ||
  datesOf(target) !== null

/** The chips a copy from the composer left in clipboard HTML, if any; anything else is words. */
export function draftFromHtml(html: string): AskDraft | undefined {
  if (!html.includes('data-heed-ask')) return undefined
  const found = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('[data-heed-ask]')
    ?.getAttribute('data-heed-ask')
  if (!found) return undefined
  try {
    const parts: unknown = JSON.parse(found)
    if (!Array.isArray(parts)) return undefined
    return parts.flatMap((part: unknown): MentionPart[] => {
      if (typeof part !== 'object' || part === null) return []
      const { kind, text, target, label } = part as Record<string, unknown>
      if (kind === 'text' && typeof text === 'string') return [{ kind, text }]
      if (
        kind === 'mention' &&
        typeof target === 'string' &&
        typeof label === 'string' &&
        validTarget(target) &&
        label.trim()
      )
        return [{ kind, target, label: mentionWords(label) }]
      return []
    })
  } catch {
    return undefined
  }
}
