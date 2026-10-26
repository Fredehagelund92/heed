// The Source view's diff: lines first, removed before added (as reviewers read a change: what
// went, then what came), and inside a changed line only the words that differ are marked, so
// "312 to 340" marks the number and not the whole sentence.

export type Word = { text: string; changed: boolean }
export type Row = { t: ' ' | '-' | '+'; line: string; words?: Word[] }

/** Longest common subsequence table, for lines or words. */
function lcs<T>(a: T[], b: T[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  return dp
}

/** Words, spaces and single marks, so a link's address diffs by its parts. */
const tokens = (s: string) => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []

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
      left.push({ text: a[i++], changed: false })
      right.push({ text: b[j++], changed: false })
    } else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1]))
      left.push({ text: a[i++], changed: true })
    else right.push({ text: b[j++], changed: true })
  }
  return [runs(left), runs(right)]
}

export function lineDiff(before: string, after: string): Row[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const dp = lcs(a, b)
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ t: ' ', line: a[i++] })
      j++
    } else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1]))
      rows.push({ t: '-', line: a[i++] })
    else rows.push({ t: '+', line: b[j++] })
  }
  // A run of removed lines followed by a run of added ones: pair them up and mark the words.
  for (let k = 0; k < rows.length; k++) {
    if (rows[k].t !== '-') continue
    let del = k
    while (del < rows.length && rows[del].t === '-') del++
    let add = del
    while (add < rows.length && rows[add].t === '+') add++
    for (let p = 0; p < Math.min(del - k, add - del); p++) {
      const [l, r] = wordDiff(rows[k + p].line, rows[del + p].line)
      rows[k + p].words = l
      rows[del + p].words = r
    }
    k = add - 1
  }
  return rows
}
