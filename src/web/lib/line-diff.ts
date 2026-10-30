// The Text diff of the review: the stored text line by line, removed before added (as reviewers
// read a change: what went, then what came), each line with its number on its own side. Inside a
// changed line only the words that differ are marked ("312 to 340" marks the number, not the
// sentence), but only when at least half of the words are shared: a line that was rewritten reads
// as a whole line out and a whole line in. A mention (`[@ id="..." label="..."]`) is one word, so
// it is never split. Unchanged stretches fold, keeping three lines around each change.

export type Word = { text: string; changed: boolean }
export type Row = {
  t: ' ' | '-' | '+'
  line: string
  words?: Word[]
  /** The line's number in the text before; unchanged and removed lines have one. */
  a?: number
  /** The line's number in the text after; unchanged and added lines have one. */
  b?: number
}

/** Longest common subsequence table, for lines or words: `at(i, j)` reads it, zero past either end. */
function lcs<T>(a: T[], b: T[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const at = (i: number, j: number) => dp[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  return at
}

/**
 * Mentions whole, then words, spaces and single marks (an underscore too, as Markdown's italic),
 * so a link's address diffs by its parts and `_never_` keeps its word.
 */
const tokens = (s: string) => s.match(/\[@ [^\]]*\]|[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]/gu) ?? []

/** One run per changed stretch: a space between two changed words is changed too, and runs join. */
function runs(words: Word[]): Word[] {
  const marked = words.map((w, i) => ({
    ...w,
    changed: w.changed || (!w.text.trim() && !!words[i - 1]?.changed && !!words[i + 1]?.changed),
  }))
  return marked.reduce<Word[]>((out, w) => {
    const last = out[out.length - 1]
    if (last && last.changed === w.changed) last.text += w.text
    else out.push({ ...w })
    return out
  }, [])
}

/** Which words of each side the other side doesn't have, as runs of unchanged and changed text. */
export function wordDiff(before: string, after: string): [Word[], Word[]] {
  const a = tokens(before)
  const b = tokens(after)
  const dp = lcs(a, b)
  const left: Word[] = []
  const right: Word[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      left.push({ text: a[i++]!, changed: false })
      right.push({ text: b[j++]!, changed: false })
    } else if (i < a.length && (j === b.length || dp(i + 1, j) >= dp(i, j + 1)))
      left.push({ text: a[i++]!, changed: true })
    else right.push({ text: b[j++]!, changed: true })
  }
  return [runs(left), runs(right)]
}

/**
 * The share of words two lines have in common, from 0 to 1: the shared words over the words of
 * the longer line. Spaces and marks don't count.
 */
export function sharedWords(before: string, after: string): number {
  const words = (s: string) => tokens(s).filter((t) => /[\p{L}\p{N}]/u.test(t))
  const a = words(before)
  const b = words(after)
  const longer = Math.max(a.length, b.length)
  return longer ? lcs(a, b)(0, 0) / longer : 1
}

/** Words are marked inside a changed line only when at least this share of them is shared. */
export const WORD_MARKS_FROM = 0.5

export function lineDiff(before: string, after: string): Row[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const dp = lcs(a, b)
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ t: ' ', line: a[i]!, a: ++i, b: ++j })
    } else if (i < a.length && (j === b.length || dp(i + 1, j) >= dp(i, j + 1)))
      rows.push({ t: '-', line: a[i]!, a: ++i })
    else rows.push({ t: '+', line: b[j]!, b: ++j })
  }
  // A run of removed lines followed by a run of added ones: pair them up and mark the words of a
  // pair that is mostly the same.
  const row = (n: number) => rows[n]!
  for (let k = 0; k < rows.length; k++) {
    if (row(k).t !== '-') continue
    let del = k
    while (del < rows.length && row(del).t === '-') del++
    let add = del
    while (add < rows.length && row(add).t === '+') add++
    for (let p = 0; p < Math.min(del - k, add - del); p++) {
      const was = row(k + p).line
      const now = row(del + p).line
      if (sharedWords(was, now) < WORD_MARKS_FROM) continue
      const [l, r] = wordDiff(was, now)
      row(k + p).words = l
      row(del + p).words = r
    }
    k = add - 1
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

/** "2 lines added and 1 removed", "1 line removed": what a diff does to the lines, in words. */
export function linesWords({ added, removed }: { added: number; removed: number }) {
  const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`
  if (added && removed) return `${lines(added)} added and ${removed} removed`
  if (added) return `${lines(added)} added`
  if (removed) return `${lines(removed)} removed`
  return 'No line changed'
}

/** How much a diff changes: lines added and removed, and in how many places. */
export function diffStats(rows: Row[]) {
  return {
    added: rows.filter((r) => r.t === '+').length,
    removed: rows.filter((r) => r.t === '-').length,
    changes: hunks(rows).filter((p) => p.t === 'change').length,
  }
}
