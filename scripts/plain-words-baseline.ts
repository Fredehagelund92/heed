/** Each file's words to change: how many times each word is found, by the word in lower case. */
export type WordCounts = Record<string, Record<string, number>>

/** The word a finding counts under: lower case, a plural with its base word. */
export const wordKey = (found: string): string => {
  const word = found.toLowerCase()
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

export function countWords(findings: readonly { path: string; found: string }[]): WordCounts {
  const counts: WordCounts = {}
  for (const { path, found } of findings) {
    const words = (counts[path] ??= {})
    const key = wordKey(found)
    words[key] = (words[key] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, words]) => [
        path,
        Object.fromEntries(Object.entries(words).sort(([a], [b]) => (a < b ? -1 : 1))),
      ]),
  )
}

export type Comparison = {
  /** Files with a word more often than the baseline allows (or a new file with hits). */
  more: { path: string; word: string; count: number; allowed: number }[]
  /** Notes on words that are found less often than the baseline counts. */
  notes: string[]
}

/** Only a rise fails. A fall is a note: the baseline goes down whenever someone updates it. */
export function compareToBaseline(counts: WordCounts, baseline: WordCounts): Comparison {
  const more: Comparison['more'] = []
  const fewerByPath: Record<string, number> = {}
  for (const path of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
    const now = counts[path] ?? {}
    const allowed = baseline[path] ?? {}
    for (const word of new Set([...Object.keys(now), ...Object.keys(allowed)])) {
      const count = now[word] ?? 0
      const limit = allowed[word] ?? 0
      if (count > limit) more.push({ path, word, count, allowed: limit })
      else if (count < limit) fewerByPath[path] = (fewerByPath[path] ?? 0) + limit - count
    }
  }
  const notes = Object.entries(fewerByPath)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([path, fewer]) =>
        `${fewer} fewer hits in ${path}; run \`npm run lint:words -- --update\` when convenient to lower the baseline.`,
    )
  return { more: more.sort((a, b) => (a.path + a.word < b.path + b.word ? -1 : 1)), notes }
}
