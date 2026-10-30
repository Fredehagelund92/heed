/*
  Comparing two sequences, of lines, blocks or words: the steps that turn one into the other,
  keeping their longest common subsequence. The review's difference (doc-diff.ts) and the Source
  view (source-diff.ts) both build on it. Long inputs stay cheap: past `LCS_CELLS` the middle is
  given as one removed and one added run. Pure: no clock, no input or output.
*/

/** A comparison of more pairs than this gives its middle as one removed and one added run. */
export const LCS_CELLS = 1_000_000

export type Op =
  { op: 'same'; a: number; b: number } | { op: 'del'; a: number } | { op: 'add'; b: number }

/**
 * The steps that turn `a` into `b`, keeping the longest common subsequence. Where both a removal
 * and an addition keep it as long, the removal comes first, so a changed line reads as what went,
 * then what came. `prefer: 'add'` takes the addition first instead, so of two blocks that swapped
 * places the one that moved up is the one that moved. `weight` makes some matches worth more
 * than others, so a long word kept outweighs a short one ("Compare" over "a").
 */
export function sequenceDiff<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
  prefer: 'del' | 'add' = 'del',
  weight: (x: T) => number = () => 1,
): Op[] {
  let start = 0
  while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
    endA--
    endB--
  }
  const ops: Op[] = []
  for (let i = 0; i < start; i++) ops.push({ op: 'same', a: i, b: i })
  const n = endA - start
  const m = endB - start
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= LCS_CELLS) {
    const width = m + 1
    const dp = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * width + j] = same(a[start + i]!, b[start + j]!)
          ? dp[(i + 1) * width + j + 1]! + weight(a[start + i]!)
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!)
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && same(a[start + i]!, b[start + j]!)) {
        ops.push({ op: 'same', a: start + i++, b: start + j++ })
      } else if (
        i < n &&
        (j === m ||
          (prefer === 'del'
            ? dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!
            : dp[(i + 1) * width + j]! > dp[i * width + j + 1]!))
      ) {
        ops.push({ op: 'del', a: start + i++ })
      } else ops.push({ op: 'add', b: start + j++ })
    }
  } else {
    for (let i = start; i < endA; i++) ops.push({ op: 'del', a: i })
    for (let j = start; j < endB; j++) ops.push({ op: 'add', b: j })
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ op: 'same', a: endA + k, b: endB + k })
  return slideDown(ops, a, b, same)
}

/**
 * Moves each run of only additions (or only removals) as late as it can go, past an unchanged
 * element equal to its first one. Taking the common end off first can match an element early that
 * a whole comparison matches late; this puts the change where the whole comparison does, so
 * "webshop. From 1 October ... as well." marks " From ... as well." and keeps the full stop.
 */
function slideDown<T>(
  ops: Op[],
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): Op[] {
  const out = [...ops]
  for (let i = 0; i < out.length; i++) {
    const kind = out[i]!.op
    if (kind === 'same') continue
    for (;;) {
      let j = i
      while (j < out.length && out[j]!.op === kind) j++
      const next = out[j]
      if (!next || next.op !== 'same') break
      const first = out[i]!
      if (first.op === 'add' && same(b[first.b]!, b[next.b]!)) {
        out[i] = { op: 'same', a: next.a, b: first.b }
        out.splice(j, 1)
        out.splice(i + 1, 0, ...out.splice(i + 1, j - i - 1), { op: 'add', b: next.b })
      } else if (first.op === 'del' && same(a[first.a]!, a[next.a]!)) {
        out[i] = { op: 'same', a: first.a, b: next.b }
        out.splice(j, 1)
        out.splice(i + 1, 0, ...out.splice(i + 1, j - i - 1), { op: 'del', a: next.a })
      } else break
      i++
    }
  }
  return out
}
