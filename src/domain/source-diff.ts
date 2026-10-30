/*
  The Source view of the review (J19): the stored Markdown line by line, removed lines before
  added ones. A run of removed lines and the added lines after it are one block, its words
  compared across the lines, so a paragraph split in two, joined or reworded marks only the words
  that changed, and a word that moved to another line stays plain. Its own module, apart from
  doc-diff.ts, so the web app loads it with the review alone. Pure: no clock, no input or output.
*/
import { wordTokens } from './doc-diff.ts'
import { LCS_CELLS, sequenceDiff } from './sequence-diff.ts'

/** One line of the stored Markdown, unchanged, removed or added, with its changed words. */
export type SourceRow = {
  t: ' ' | '-' | '+'
  line: string
  words?: { text: string; changed: boolean }[]
}

type Words = { text: string; changed: boolean }[]

/** One run per changed stretch: a space between two changed words is changed too, and runs join. */
export const wordRuns = (words: Words): Words =>
  words
    .map((w, i) => ({
      ...w,
      changed: w.changed || (!w.text.trim() && !!words[i - 1]?.changed && !!words[i + 1]?.changed),
    }))
    .reduce<Words>((out, w) => {
      const last = out.at(-1)
      if (last && last.changed === w.changed) last.text += w.text
      else out.push({ ...w })
      return out
    }, [])

/** A changed block's words are marked only when at least this share of its shorter side stays. */
export const WORD_MARKS_FROM = 0.5

/** The end of a line inside a block: it never matches, so words compare across lines. */
const BREAK = '\n'
const isWord = (token: string) => /[\p{L}\p{N}]/u.test(token)

const blockTokens = (lines: readonly string[], tokens: (line: string) => string[]) =>
  lines.flatMap((line, i) => (i ? [BREAK, ...tokens(line)] : tokens(line)))

/** Whether a block is short enough to compare word by word, within `LCS_CELLS`. */
export const wordsFit = (
  removed: readonly string[],
  added: readonly string[],
  tokens: (line: string) => string[] = wordTokens,
) =>
  (blockTokens(removed, tokens).length + 1) * (blockTokens(added, tokens).length + 1) <= LCS_CELLS

/**
 * The words of a changed block, its removed lines against its added lines as one text: a
 * paragraph split, joined or reworded marks only the words that really changed, and a word that
 * moved to another line stays plain. Each side comes back line by line, as runs of unchanged and
 * changed text. Null when the block is too long to compare, or when less than `marksFrom` of the
 * shorter side's words stay: a rewrite reads as whole lines out and whole lines in.
 */
export function blockWords(
  removed: readonly string[],
  added: readonly string[],
  tokens: (line: string) => string[] = wordTokens,
  marksFrom = WORD_MARKS_FROM,
): { before: Words[]; after: Words[] } | null {
  if (!wordsFit(removed, added, tokens)) return null
  // Words and marks are compared, spaces are not: a space is changed only between changed words.
  const a = blockTokens(removed, tokens)
  const b = blockTokens(added, tokens)
  const solid = (xs: string[]) => xs.flatMap((x, i) => (x.trim() || x === BREAK ? [i] : []))
  const sa = solid(a)
  const sb = solid(b)
  const changedA = new Set(sa)
  const changedB = new Set(sb)
  let shared = 0
  const ops = sequenceDiff(
    sa.map((i) => a[i]!),
    sb.map((i) => b[i]!),
    (x, y) => x === y && x !== BREAK,
    'del',
    (x) => [...x].length,
  )
  for (const op of ops)
    if (op.op === 'same') {
      changedA.delete(sa[op.a]!)
      changedB.delete(sb[op.b]!)
      if (isWord(a[sa[op.a]!]!)) shared++
    }
  const shorter = Math.min(a.filter(isWord).length, b.filter(isWord).length)
  if (shorter && shared / shorter < marksFrom) return null
  const lines = (xs: string[], changed: Set<number>) =>
    xs
      .reduce<Words[]>(
        (out, text, i) => {
          if (text === BREAK) out.push([])
          else out.at(-1)!.push({ text, changed: changed.has(i) })
          return out
        },
        [[]],
      )
      .map(wordRuns)
  return { before: lines(a, changedA), after: lines(b, changedB) }
}

/**
 * The stored Markdown line by line: removed lines before added ones, and each changed block's
 * words marked across its lines (J19). `tokens` splits a line into words, spaces and marks.
 */
export function sourceDiff(
  before: string,
  after: string,
  tokens: (line: string) => string[] = wordTokens,
): SourceRow[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const rows: SourceRow[] = sequenceDiff(a, b, (x, y) => x === y).map((op) =>
    op.op === 'same'
      ? { t: ' ', line: a[op.a]! }
      : op.op === 'del'
        ? { t: '-', line: a[op.a]! }
        : { t: '+', line: b[op.b]! },
  )
  // A run of removed lines followed by a run of added ones is one block, its words compared whole.
  for (let k = 0; k < rows.length; k++) {
    if (rows[k]!.t !== '-') continue
    let del = k
    while (del < rows.length && rows[del]!.t === '-') del++
    let add = del
    while (add < rows.length && rows[add]!.t === '+') add++
    const removed = rows.slice(k, del)
    const added = rows.slice(del, add)
    const words = added.length
      ? blockWords(
          removed.map((r) => r.line),
          added.map((r) => r.line),
          tokens,
        )
      : null
    if (words) {
      removed.forEach((r, i) => (r.words = words.before[i]))
      added.forEach((r, i) => (r.words = words.after[i]))
    }
    k = add - 1
  }
  return rows
}
