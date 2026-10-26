// Show me where it says that: an answer's sentences, each with the sources it cites, and the exact
// phrases a sentence, its context item and the item's source line share. Only exact runs of three
// words or more are marked, so the marking never claims more than it shows; words with no match
// are the owner's own wording and stay unmarked.

export type Sentence = { text: string; cites: number[] }

/** The answer as sentences, each with its [n] markers taken off and kept as numbers. */
export function sentencesOf(text: string): Sentence[] {
  const normal = text
    .replace(/\s+(\[\d+\])/g, '$1')
    .replace(/(\[\d+\])([.,;:])/g, '$2$1')
    .trim()
  if (!normal) return []
  return normal
    .split(/(?<=[.!?](?:\[\d+\])*)\s+/)
    .map((chunk) => ({
      text: chunk.replace(/\[\d+\]/g, '').trim(),
      cites: [...chunk.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
    }))
    .filter((s) => s.text)
}

type Word = { word: string; start: number; end: number }

const wordsOf = (text: string): Word[] =>
  [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)].map((m) => ({
    word: m[0].toLowerCase().replace(/’/g, "'"),
    start: m.index!,
    end: m.index! + m[0].length,
  }))

/** Which words of `text` sit in a run of at least `min` words that also appears, word for word, in one of `others`. */
function sharedWords(text: string, others: string[], min: number) {
  const a = wordsOf(text)
  const hit = new Array<boolean>(a.length).fill(false)
  for (const other of others) {
    const b = wordsOf(other)
    // The longest common run ending at each pair of words.
    let prev = new Array<number>(b.length + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
      const row = new Array<number>(b.length + 1).fill(0)
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1].word !== b[j - 1].word) continue
        row[j] = prev[j - 1] + 1
        if (row[j] >= min) for (let k = i - row[j]; k < i; k++) hit[k] = true
      }
      prev = row
    }
  }
  return { words: a, hit }
}

export type Segment = { text: string; marked: boolean }

/** `text` cut into marked and unmarked runs: marked where it shares three words or more, exactly, with one of `others`. */
export function markShared(text: string, others: string[], min = 3): Segment[] {
  const { words, hit } = sharedWords(text, others, min)
  const out: Segment[] = []
  let at = 0
  for (let i = 0; i < words.length; i++) {
    if (!hit[i]) continue
    // A marked run spans from its first word to its last, the spaces between included.
    let j = i
    while (j + 1 < words.length && hit[j + 1]) j++
    if (words[i].start > at) out.push({ text: text.slice(at, words[i].start), marked: false })
    out.push({ text: text.slice(words[i].start, words[j].end), marked: true })
    at = words[j].end
    i = j
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false })
  return out
}

/** The marked phrases alone, for a sentence that says which words matched. */
export const markedPhrases = (segments: Segment[]) =>
  segments.filter((s) => s.marked).map((s) => s.text)
