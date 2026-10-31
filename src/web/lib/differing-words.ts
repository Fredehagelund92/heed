import { blockWords } from '@domain/source-diff'
import type { Word } from '@/lib/line-diff'

// Which words of two texts differ clearly enough to mark (components/heed/differing-words.tsx
// draws them with the Differs mark).

/** A block is marked in at most this many places; past it, the marks stop meaning anything. */
export const MOST_MARKS = 3

/**
 * The words of `text` that `other` does not have, as runs of plain and differing text, or null when
 * nothing clear differs: the same words, a rewrite (under half the shorter text's words stay), or more than
 * MOST_MARKS places. A run of marks alone (a full stop) differs too, but is never marked.
 */
export function differingWords(text: string, other: string): Word[] | null {
  const block = text === other ? null : blockWords([other], [text])
  if (!block) return null
  // A run is marked from its first word to its last: the spaces and marks around it stay plain.
  const words = block.after[0]!.flatMap((w): Word[] => {
    const m = /^([^\p{L}\p{N}]*)([\s\S]*?[\p{L}\p{N}])?([^\p{L}\p{N}]*)$/u.exec(w.text)
    if (!w.changed || !m?.[2]) return [{ text: w.text, changed: false }]
    return [
      { text: m[1]!, changed: false },
      { text: m[2], changed: true },
      { text: m[3]!, changed: false },
    ].filter((x) => x.text)
  })
  const marks = words.filter((w) => w.changed).length
  return marks > 0 && marks <= MOST_MARKS ? words : null
}

// Two statements of a conflict, side by side. Only the app's own comparison, never a model and
// never a search for meaningful words: near copies get the Differs mark where they differ;
// statements written apart get the stretches they share greyed, so where they part keeps full ink;
// when neither helps, the plain text and one line that says so.

/** A shared stretch is at least this many words in a row: one shared "and" says nothing. */
export const SHARED_FROM = 2

const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t)
const runTokens = (s: string) => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []
const norm = (t: string) => t.toLocaleLowerCase('en-GB')

/** A run of a statement: plain, in both texts (grey), or differing (marked). */
export type Run = { text: string; shared?: boolean; differs?: boolean }

/** Splits a marked run so the spaces and marks around its words stay plain. */
function trimmed(text: string, flag: 'shared' | 'differs'): Run[] {
  const m = /^([^\p{L}\p{N}]*)([\s\S]*?[\p{L}\p{N}])?([^\p{L}\p{N}]*)$/u.exec(text)
  if (!m?.[2]) return [{ text }]
  return [{ text: m[1]! }, { text: m[2], [flag]: true }, { text: m[3]! }].filter((r) => r.text)
}

function joined(runs: Run[]): Run[] {
  return runs.reduce<Run[]>((out, r) => {
    const last = out.at(-1)
    if (last && !!last.shared === !!r.shared && !!last.differs === !!r.differs) last.text += r.text
    else out.push({ ...r })
    return out
  }, [])
}

/**
 * The stretches of `text` that `other` also has, word for word (case aside), at least SHARED_FROM
 * words long. Null when there is none, or when the whole text is shared.
 */
export function sharedRuns(text: string, other: string): Run[] | null {
  const a = runTokens(text)
  const aw = a.flatMap((t, i) => (isWord(t) ? [i] : []))
  const bw = runTokens(other).filter(isWord).map(norm)
  const shared = new Set<number>()
  // The longest common stretch ending at each pair of words; any stretch long enough is greyed.
  let prev = new Array<number>(bw.length + 1).fill(0)
  for (let i = 0; i < aw.length; i++) {
    const row = new Array<number>(bw.length + 1).fill(0)
    for (let j = 0; j < bw.length; j++) {
      if (norm(a[aw[i]!]!) !== bw[j]) continue
      const n = prev[j]! + 1
      row[j + 1] = n
      if (n >= SHARED_FROM) for (let k = i - n + 1; k <= i; k++) shared.add(aw[k]!)
    }
    prev = row
  }
  if (!shared.size || shared.size === aw.length) return null
  // A space or a mark between two shared words is shared too, so a stretch reads as one run.
  const flags = a.map((t, i) => {
    if (isWord(t)) return shared.has(i)
    const at = aw.findIndex((w) => w > i)
    const before = at > 0 ? aw[at - 1] : undefined
    const after = at >= 0 ? aw[at] : undefined
    return before !== undefined && after !== undefined && shared.has(before) && shared.has(after)
  })
  const runs = joined(a.map((t, i) => ({ text: t, shared: flags[i] || undefined })))
  return joined(runs.flatMap((r) => (r.shared ? trimmed(r.text, 'shared') : [r])))
}

/** How a statement is shown against the other one, and the words in both for a screen reader. */
export type Compared = { how: 'differs' | 'shared' | 'plain'; runs: Run[]; inBoth: string[] }

const asRuns = (words: Word[]): Run[] =>
  joined(words.map((w) => (w.changed ? { text: w.text, differs: true } : { text: w.text })))

/**
 * Both sides of a pair, read the same way: Differs marks only when both sides find theirs, then
 * the shared stretches greyed when both have some, else plain text.
 */
export function comparePair(a: string, b: string): [Compared, Compared] {
  const da = differingWords(a, b)
  const db = differingWords(b, a)
  if (da && db)
    return [
      { how: 'differs', runs: asRuns(da), inBoth: [] },
      { how: 'differs', runs: asRuns(db), inBoth: [] },
    ]
  const sa = sharedRuns(a, b)
  const sb = sharedRuns(b, a)
  if (sa && sb)
    return [
      { how: 'shared', runs: sa, inBoth: sa.filter((r) => r.shared).map((r) => r.text) },
      { how: 'shared', runs: sb, inBoth: sb.filter((r) => r.shared).map((r) => r.text) },
    ]
  return [
    { how: 'plain', runs: [{ text: a }], inBoth: [] },
    { how: 'plain', runs: [{ text: b }], inBoth: [] },
  ]
}

/** How many words two texts share in stretches: the review orders its overlaps by it, most first. */
export function sharedWords(a: string, b: string): number {
  const marked = differingWords(a, b)
  const runs = marked ? asRuns(marked) : (sharedRuns(a, b) ?? [])
  return runs
    .filter((r) => (marked ? !r.differs : r.shared))
    .reduce((n, r) => n + runTokens(r.text).filter(isWord).length, 0)
}
