import { wordDiff, type Word } from "@/lib/line-diff"

// How two statements of a conflict are shown side by side. Only the app's own comparison, never a
// model and never a search for meaningful words: near copies get the Differs mark on the words that
// differ (at most three places); statements written apart get the words they share greyed, so the
// words where they part keep full ink; and when neither helps, the plain text and one line that says so.

/** A block is marked in at most this many places; past it, the marks stop meaning anything. */
export const MOST_MARKS = 3
/** A shared stretch is at least this many words in a row: one shared "and" says nothing. */
export const SHARED_FROM = 2

const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t)
const tokens = (s: string) => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []
const norm = (t: string) => t.toLocaleLowerCase("en-GB")

/** A run of a statement: plain, in both texts (grey), or differing (marked). */
export type Run = { text: string; shared?: boolean; differs?: boolean }

/** Split a marked run so the spaces and marks around its words stay plain. */
function trimmed(text: string, flag: "shared" | "differs"): Run[] {
  const m = /^([^\p{L}\p{N}]*)([\s\S]*?[\p{L}\p{N}])?([^\p{L}\p{N}]*)$/u.exec(text)
  if (!m?.[2]) return [{ text }]
  return [{ text: m[1] }, { text: m[2], [flag]: true }, { text: m[3] }].filter((r) => r.text)
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
 * The words of `text` that `other` does not have, for a near copy: null when nothing clear differs
 * (the same text, under half the shorter text's words in common, or more than MOST_MARKS places).
 */
export function differingWords(text: string, other: string): Run[] | null {
  if (text === other) return null
  const words: Word[] = wordDiff(other, text)[1]
  const all = (s: string) => tokens(s).filter(isWord).length
  const kept = words.filter((w) => !w.changed).flatMap((w) => tokens(w.text).filter(isWord)).length
  const shorter = Math.min(all(text), all(other))
  if (!shorter || kept / shorter < 0.5) return null
  const runs = words.flatMap((w) => (w.changed && isWord(w.text) ? trimmed(w.text, "differs") : [{ text: w.text }]))
  const marks = runs.filter((r) => r.differs).length
  return marks > 0 && marks <= MOST_MARKS ? joined(runs) : null
}

/**
 * The stretches of `text` that `other` also has, word for word (case aside), at least SHARED_FROM
 * words long. Null when there is none, or when the whole text is shared (then nothing is left to read).
 */
export function sharedRuns(text: string, other: string): Run[] | null {
  const a = tokens(text)
  const aw = a.flatMap((t, i) => (isWord(t) ? [i] : []))
  const bw = tokens(other).filter(isWord).map(norm)
  const shared = new Set<number>()
  // The longest common stretch ending at each pair of words; any stretch long enough is greyed.
  let prev = new Array<number>(bw.length + 1).fill(0)
  for (let i = 0; i < aw.length; i++) {
    const row = new Array<number>(bw.length + 1).fill(0)
    for (let j = 0; j < bw.length; j++) {
      if (norm(a[aw[i]]) !== bw[j]) continue
      row[j + 1] = prev[j] + 1
      if (row[j + 1] >= SHARED_FROM) for (let k = i - row[j + 1] + 1; k <= i; k++) shared.add(aw[k])
    }
    prev = row
  }
  if (!shared.size || shared.size === aw.length) return null
  // A space or a mark between two shared words is shared too, so a stretch reads as one run.
  const flags = a.map((t, i) => {
    if (isWord(t)) return shared.has(i)
    const before = aw.filter((w) => w < i).at(-1)
    const after = aw.find((w) => w > i)
    return before !== undefined && after !== undefined && shared.has(before) && shared.has(after) && after === aw[aw.indexOf(before) + 1]
  })
  const runs = joined(a.map((text, i) => ({ text, shared: flags[i] || undefined })))
  return joined(runs.flatMap((r) => (r.shared ? trimmed(r.text, "shared") : [r])))
}

/** How a statement is shown against the other one, and the words in both for a screen reader. */
export type Compared = { how: "differs" | "shared" | "plain"; runs: Run[]; inBoth: string[] }

/**
 * Both sides of a pair, read the same way: a near copy only when both sides find their marks, so one
 * side is never marked while the other is greyed.
 */
export function comparePair(a: string, b: string): [Compared, Compared] {
  const da = differingWords(a, b)
  const db = differingWords(b, a)
  if (da && db) return [{ how: "differs", runs: da, inBoth: [] }, { how: "differs", runs: db, inBoth: [] }]
  const sa = sharedRuns(a, b)
  const sb = sharedRuns(b, a)
  if (sa && sb)
    return [
      { how: "shared", runs: sa, inBoth: sa.filter((r) => r.shared).map((r) => r.text) },
      { how: "shared", runs: sb, inBoth: sb.filter((r) => r.shared).map((r) => r.text) },
    ]
  return [
    { how: "plain", runs: [{ text: a }], inBoth: [] },
    { how: "plain", runs: [{ text: b }], inBoth: [] },
  ]
}

/** How many words two texts share in stretches: the review orders its overlaps by it, most first. */
export function sharedWords(a: string, b: string): number {
  const marked = differingWords(a, b)
  const runs = marked ?? sharedRuns(a, b) ?? []
  return runs.filter((r) => (marked ? !r.differs : r.shared)).reduce((n, r) => n + tokens(r.text).filter(isWord).length, 0)
}
