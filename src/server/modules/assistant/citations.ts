import { removedNotice } from '../../../contract/assistant.ts'

/**
 * The citation validator (FR-707, plan section 8.4). The assistant's answer reaches the person one
 * sentence at a time, and only after this check: every item id a sentence names must appear in a
 * tool result of this conversation, and every quotation must appear word for word in one (or in
 * the person's own text). A sentence that fails is replaced with a plain notice, so an unsupported
 * claim never reaches the person as a statement. A result counts when this service produced it:
 * in this request, or in an earlier turn of the same conversation under a seal that still
 * verifies (seals.ts). A result the client sends back without a valid seal is not evidence.
 */

const itemIds = /\bitm_[a-z0-9]{8,16}\b/gi
// A quotation long enough to be a claim about a source, not a name or a term.
const MIN_QUOTATION = 20
const normal = (text: string) =>
  text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()

export type Removal = { reason: 'unknown_item' | 'unverified_quote'; ids: string[] }
/**
 * What the check let through and what it removed: the item ids the answer cites, the statements
 * removed and why, how many quotations it shows that matched a source word for word, and how many
 * of the cited items were read in an earlier turn of the conversation, not this one.
 */
export type CitationReport = {
  cited: string[]
  removed: Removal[]
  quoted: number
  earlier: number
}

export { removedNotice }

/** What the conversation's tool results (and the person's own text) support. */
export class Evidence {
  readonly #ids = new Set<string>()
  /** Items read only in an earlier turn: citing them is fine, and the report counts them. */
  readonly #earlier = new Set<string>()
  readonly #texts: string[] = []

  /** Adds one tool result of this turn: every `id` it holds, at any depth, and every text in it. */
  addResult(output: unknown) {
    this.#add(output, this.#ids)
    for (const id of this.#ids) this.#earlier.delete(id)
  }

  /** Adds one result an earlier turn of this conversation read, under a seal that verified. */
  addEarlierResult(output: unknown) {
    const ids = new Set<string>()
    this.#add(output, ids)
    for (const id of ids) if (!this.#ids.has(id)) this.#earlier.add(id)
  }

  #add(output: unknown, ids: Set<string>) {
    const walk = (value: unknown, key?: string) => {
      if (typeof value === 'string') {
        this.#texts.push(normal(value))
        if (key === 'id' && /^itm_[a-z0-9]{8,16}$/.test(value)) ids.add(value)
      } else if (Array.isArray(value)) for (const entry of value) walk(entry)
      else if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) walk(v, k)
    }
    walk(output)
  }

  /** The person's own text may be quoted back (a draft from pasted text), but cites no item. */
  addPersonText(text: string) {
    this.#texts.push(normal(text))
  }

  /** Text from Heed's records the model was given (an attached term's definition): quotable, cites no item. */
  addHeedText(text: string) {
    this.#texts.push(normal(text))
  }

  supports(id: string) {
    return this.#ids.has(id) || this.#earlier.has(id)
  }

  /** Whether an item was read only in an earlier turn. */
  earlier(id: string) {
    return this.#earlier.has(id)
  }

  quoted(quotation: string) {
    const wanted = normal(quotation)
    return this.#texts.some((text) => text.includes(wanted))
  }
}

/** Checks one sentence: the sentence as it may be shown, the ids it cites, and what was removed. */
export function checkSentence(
  sentence: string,
  evidence: Evidence,
): { text: string; cited: string[]; removed: Removal | null } {
  const ids = [...new Set([...sentence.matchAll(itemIds)].map((m) => m[0]))]
  const unknown = ids.filter((id) => !evidence.supports(id))
  const trailing = /\s*$/.exec(sentence)![0]
  if (unknown.length)
    return {
      text: removedNotice.unknown_item + trailing,
      cited: [],
      removed: { reason: 'unknown_item', ids: unknown },
    }
  if (quotationsIn(sentence).some((quotation) => !evidence.quoted(quotation)))
    return {
      text: removedNotice.unverified_quote + trailing,
      cited: [],
      removed: { reason: 'unverified_quote', ids },
    }
  return { text: sentence, cited: ids, removed: null }
}

const letter = /[\p{L}\p{N}]/u
type Span = { open: number; close: number | null }

/**
 * The quotations in `text`, found by position. A double quote pairs with the next double quote
 * (or “ with ”). A single quote opens after the start, a space or an opening bracket or dash and
 * before a non-space; it closes after a non-space and before the end, a space or punctuation; an
 * apostrophe inside a word is neither. A quotation may run across sentences and lines. A span
 * left open at the end of the text has `close` null.
 */
function quoteSpans(text: string): Span[] {
  const spans: Span[] = []
  const at = (i: number) => text[i] ?? ''
  const apostrophe = (i: number) => letter.test(at(i - 1)) && letter.test(at(i + 1))
  const opens = (i: number) =>
    !apostrophe(i) &&
    (i === 0 || /[\s([{"“—-]/.test(at(i - 1))) &&
    at(i + 1) !== '' &&
    !/\s/.test(at(i + 1))
  const closes = (i: number) =>
    !apostrophe(i) &&
    at(i - 1) !== '' &&
    !/\s/.test(at(i - 1)) &&
    (i + 1 >= text.length || /[\s.,;:!?)\]}"”—-]/.test(at(i + 1)))
  let current: { open: number; closer: string } | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (current) {
      const single = current.closer === "'"
      if (single ? (c === "'" || c === '’') && closes(i) : c === current.closer) {
        spans.push({ open: current.open, close: i })
        current = null
      } else if (single && (c === "'" || c === '‘') && opens(i)) current = { open: i, closer: "'" }
    } else if (c === '"') current = { open: i, closer: '"' }
    else if (c === '“') current = { open: i, closer: '”' }
    else if ((c === "'" || c === '‘') && opens(i)) current = { open: i, closer: "'" }
  }
  if (current) spans.push({ open: current.open, close: null })
  return spans
}

/** The text of each quotation in `text` long enough to be a claim about a source. */
function quotationsIn(text: string): string[] {
  return quoteSpans(text)
    .filter((span) => span.close !== null && span.close - span.open - 1 >= MIN_QUOTATION)
    .map((span) => text.slice(span.open + 1, span.close!))
}

/**
 * Where the complete sentences in `text` end, each after its trailing space. A full stop or line
 * break inside a quotation, or after one still open, does not end a sentence, so a quotation is
 * always checked whole.
 */
function sentenceEnds(text: string): number[] {
  const spans = quoteSpans(text)
  const inside = (i: number) =>
    spans.some((span) => i > span.open && (span.close === null || i < span.close))
  const ends: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inside(i) || !(c === '\n' || (/[.!?]/.test(c) && /\s/.test(text[i + 1] ?? '')))) continue
    let end = i + 1
    while (end < text.length && /\s/.test(text[end]!)) end++
    ends.push(end)
    i = end - 1
  }
  return ends
}

/**
 * Holds each text part's deltas until a sentence is complete, then lets the checked sentence out.
 * `flush` lets out what is left when the part ends.
 */
export function createCitationFilter(evidence: Evidence) {
  const buffers = new Map<string, string>()
  const cited = new Set<string>()
  const removed: Removal[] = []
  let quoted = 0
  const check = (text: string) => {
    if (!text) return ''
    const result = checkSentence(text, evidence)
    for (const id of result.cited) cited.add(id)
    if (result.removed) removed.push(result.removed)
    else quoted += quotationsIn(text).length
    return result.text
  }
  const checkAll = (text: string) => {
    let from = 0
    let out = ''
    for (const end of [...sentenceEnds(text), text.length]) {
      out += check(text.slice(from, end))
      from = end
    }
    return out
  }
  return {
    push(id: string, delta: string): string {
      const buffer = (buffers.get(id) ?? '') + delta
      const end = sentenceEnds(buffer).at(-1) ?? 0
      buffers.set(id, buffer.slice(end))
      return checkAll(buffer.slice(0, end))
    },
    flush(id: string): string {
      const rest = buffers.get(id) ?? ''
      buffers.delete(id)
      return checkAll(rest)
    },
    report(): CitationReport {
      return {
        cited: [...cited].sort(),
        removed,
        quoted,
        earlier: [...cited].filter((id) => evidence.earlier(id)).length,
      }
    },
  }
}
