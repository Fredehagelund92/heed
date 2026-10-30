// The Text diff of the review: the stored text line by line, removed before added (as reviewers
// read a change: what went, then what came), each line with its number on its own side. A run of
// removed lines and the added lines after it are one block, its words compared across the lines,
// so a paragraph split in two, joined or reworded marks only the words that changed, and a word
// that moved to another line stays plain. Words are marked only when at least half of the block's
// shorter side stays: a rewrite reads as whole lines out and whole lines in. A block too long to
// compare reads as whole lines too, and says so. A mention (`[@ id="..." label="..."]`) is one
// word, so it is never split. Unchanged stretches fold, keeping three lines around each change.

import { blockWords, sourceDiff, wordsFit } from '@domain/source-diff'

export type Word = { text: string; changed: boolean }
export type Row = {
  t: ' ' | '-' | '+'
  line: string
  words?: Word[]
  /** The line's number in the text before; unchanged and removed lines have one. */
  a?: number
  /** The line's number in the text after; unchanged and added lines have one. */
  b?: number
  /** Its block is too long to compare word by word. */
  long?: boolean
}

/**
 * Mentions whole, then words, spaces and single marks (an underscore too, as Markdown's italic),
 * so a link's address diffs by its parts and `_never_` keeps its word.
 */
const tokens = (s: string) => s.match(/\[@ [^\]]*\]|[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]/gu) ?? []

/** Which words of each side the other side doesn't have, as runs of unchanged and changed text. */
export function wordDiff(before: string, after: string): [Word[], Word[]] {
  const words = blockWords([before], [after], tokens, 0)
  return words
    ? [words.before[0]!, words.after[0]!]
    : [[{ text: before, changed: true }], [{ text: after, changed: true }]]
}

export function lineDiff(before: string, after: string): Row[] {
  const rows: Row[] = sourceDiff(before, after, tokens)
  let a = 0
  let b = 0
  for (const row of rows) {
    if (row.t !== '+') row.a = ++a
    if (row.t !== '-') row.b = ++b
  }
  // A block with both sides and no marked words is a rewrite, or too long to compare.
  for (const part of hunks(rows)) {
    if (part.t !== 'change' || part.rows.some((r) => r.words)) continue
    const side = (t: Row['t']) => part.rows.filter((r) => r.t === t).map((r) => r.line)
    const [removed, added] = [side('-'), side('+')]
    if (removed.length && added.length && !wordsFit(removed, added, tokens))
      part.rows.forEach((r) => (r.long = true))
  }
  return rows
}

/**
 * The diff in parts, as the Text diff draws it: each change (a run of removed and added lines,
 * numbered from 0 for N and P), the unchanged lines kept around it, and the folds between. A fold
 * hides at least two lines; one line alone is simply shown.
 */
export type Part =
  { t: 'change'; n: number; rows: Row[] } | { t: 'same'; rows: Row[] } | { t: 'fold'; rows: Row[] }

export function hunks(rows: Row[], context = 3): Part[] {
  const parts: Part[] = []
  let n = 0
  let k = 0
  while (k < rows.length) {
    const start = k
    if (rows[k]!.t !== ' ') {
      while (k < rows.length && rows[k]!.t !== ' ') k++
      parts.push({ t: 'change', n: n++, rows: rows.slice(start, k) })
      continue
    }
    while (k < rows.length && rows[k]!.t === ' ') k++
    const same = rows.slice(start, k)
    // Lines kept after the change before it and before the change after it; the rest fold.
    const head = start === 0 ? 0 : context
    const tail = k === rows.length ? 0 : context
    if (same.length - head - tail < 2) {
      parts.push({ t: 'same', rows: same })
      continue
    }
    if (head) parts.push({ t: 'same', rows: same.slice(0, head) })
    parts.push({ t: 'fold', rows: same.slice(head, same.length - tail) })
    if (tail) parts.push({ t: 'same', rows: same.slice(same.length - tail) })
  }
  return parts
}

/** A line with no words: in a change, it only starts or joins a paragraph. */
export const isBreak = (row: Row) => row.t !== ' ' && !row.line.trim()

/** Each sentence of a line, as where it starts and ends; a line without an end mark is one. */
function sentences(line: string): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  for (const m of line.matchAll(/[.!?]+(?=\s|$)/g)) {
    const end = m.index + m[0].length
    if (line.slice(start, end).trim()) out.push([start, end])
    start = end
  }
  if (line.slice(start).trim()) out.push([start, line.length])
  return out
}

/**
 * The sentences on one side of a change: those changed whole (added or removed) and those with
 * only some of their words or marks changed.
 */
function sentencesOf(rows: Row[]) {
  let whole = 0
  let some = 0
  for (const row of rows) {
    // Which characters of the line are marked; a line without marks is changed whole.
    const marked: boolean[] = row.words
      ? row.words.flatMap((w) => [...w.text].map(() => w.changed))
      : [...row.line].map(() => true)
    const chars = [...row.line]
    for (const [start, end] of sentences(row.line)) {
      const at = (i: number) => /[\p{L}\p{N}]/u.test(chars[i]!)
      let words = 0
      let changed = 0
      let any = false
      for (let i = start; i < end; i++) {
        if (at(i)) words++
        if (at(i) && marked[i]) changed++
        if (marked[i] && chars[i]!.trim()) any = true
      }
      if (words && changed === words) whole++
      else if (any) some++
    }
  }
  return { whole, some }
}

/**
 * How many sentences a change touches: each one added or removed whole, and each one reworded
 * counted once, though it shows on both sides. A rewrite counts the longer side's sentences.
 */
function sentencesChanged(rows: Row[]): number {
  const before = rows.filter((r) => r.t === '-')
  const after = rows.filter((r) => r.t === '+')
  if (before.length && after.length && !rows.some((r) => r.words)) {
    const count = (side: Row[]) => side.reduce((n, r) => n + sentences(r.line).length, 0)
    return Math.max(count(before), count(after))
  }
  const was = sentencesOf(before)
  const now = sentencesOf(after)
  return was.whole + now.whole + Math.max(was.some, now.some)
}

/** How much a diff changes: the sentences it touches, and in how many places. */
export function diffStats(rows: Row[]) {
  const changes = hunks(rows).filter((p) => p.t === 'change')
  return {
    sentences: changes.reduce((n, p) => n + sentencesChanged(p.rows), 0),
    changes: changes.length,
  }
}

/** "2 sentences changed", or "Spacing changed" when no word or mark did: a diff in words. */
export function changeWords({ sentences }: { sentences: number }) {
  if (!sentences) return 'Spacing changed'
  return `${sentences} ${sentences === 1 ? 'sentence' : 'sentences'} changed`
}
